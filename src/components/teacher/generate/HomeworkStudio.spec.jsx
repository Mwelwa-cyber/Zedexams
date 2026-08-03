import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import HomeworkStudio from './HomeworkStudio.jsx'

// Request-locking / idempotency initiative — this suite is the UI-level
// guarantee for the Homework studio: (1) a real generation sends a payload
// carrying a client-minted idempotencyKey, and (2) a synchronous double-submit
// (two clicks before the first resolves) produces exactly ONE generateHomework
// call. useAiOperationLock + aiOperationLockCore run for real here — that's the
// wiring under test — everything else the component pulls in is mocked so the
// studio renders in jsdom and its Generate path can be driven. Mirrors the
// approach in CreatePaperModal.spec.jsx.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The generator + the constant exports HomeworkStudio reads for its selects.
vi.mock('../../../utils/teacherTools', () => ({
  generateHomework: vi.fn(),
  TEACHER_LANGUAGES: [{ value: 'english', label: 'English' }],
  CURRICULUM_TERMS: [{ value: '1', label: 'Term 1' }],
  TOTAL_LESSONS_OPTIONS: [{ value: '', label: 'Any' }],
  LESSON_NUMBER_OPTIONS: [{ value: '', label: 'Any' }],
  LEARNING_ENVIRONMENT_OPTIONS: [{ value: '', label: 'Any' }],
}))

// AuthContext + the generation gate are stubbed to "allowed" so the studio's
// own behaviour is what's under test (and firebase/config stays out of jsdom).
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'test-uid' }, userProfile: {}, isAdmin: false }),
}))
vi.mock('../../../hooks/useGenerationGate', () => ({
  useGenerationGate: () => ({ ensureCanGenerate: () => true }),
}))

// URL defaults — no deep-link params in the test.
vi.mock('../../../utils/useFormDefaultsFromUrl', () => ({
  useFormDefaultsFromUrl: () => ({}),
}))

// Firebase-backed side effects fired on success — stubbed to no-ops.
vi.mock('../../../utils/teacherLibraryService', () => ({
  attachLibraryToGeneration: vi.fn(() => Promise.resolve()),
  isFreePlanTeacher: () => false,
}))
vi.mock('../../../utils/questionBankService', () => ({
  captureQuestionsToBank: vi.fn(),
}))

// Draft manager (PlatformSettingsContext + Firestore) — stubbed idle.
vi.mock('../../../hooks/draft/useStudioInputDraft', () => ({
  useStudioInputDraft: () => ({
    status: 'idle',
    savedAt: null,
    online: true,
    flush: vi.fn(),
    clear: vi.fn(() => Promise.resolve()),
  }),
}))
vi.mock('../../draft/DraftStatusIndicator', () => ({ default: () => null }))
vi.mock('../../draft/DraftRecoveryPrompt', () => ({ default: () => null }))

// Helmet needs a provider we don't want to stand up here.
vi.mock('../../seo/SeoHelmet', () => ({ default: () => null }))

// LiveGenerationCanvas has no bearing on the generate path — render nothing.
vi.mock('../../ui/LiveGenerationCanvas', () => ({ default: () => null }))

// The assignment-change notice pulls in the syllabus KB service (firebase) via
// useSubjectsForGrade — irrelevant to the generate path, so stub it out.
vi.mock('./StudioAssignmentChangeNotice', () => ({ default: () => null }))

// The shell's "Set up for you" prefill reads the teacher's Weekly Forecast
// (Firestore via teacherLibraryService) — no suggestion in these tests.
vi.mock('../studio/hooks/useTeacherPlanContext', () => ({
  useTeacherPlanContext: () => ({ loading: false, suggestion: null }),
}))

// The curriculum selector is mocked to a single button that, when clicked,
// hands the studio a fully-satisfied curriculum payload (curriculumMode/grade/
// subject/topic) via its onChange — so onGenerate's guards pass without driving
// the real syllabus-backed selector UI.
const VALID_CURR = {
  curriculumMode: 'cbc',
  grade: '4',
  subject: 'mathematics',
  subjectLabel: 'Mathematics',
  topic: 'Fractions',
  subtopic: 'Adding fractions',
  curriculum: 'cbc',
  framework: '2023',
}
vi.mock('../curriculum/StudioCurriculumSelector', () => ({
  default: ({ onChange }) => (
    <button type="button" onClick={() => onChange(VALID_CURR)}>
      seed-curriculum
    </button>
  ),
}))

function renderStudio() {
  return render(
    <MemoryRouter>
      <HomeworkStudio />
    </MemoryRouter>,
  )
}

// Satisfy the curriculum guards, then return the Generate button.
function seedCurriculumAndGetGenerate() {
  fireEvent.click(screen.getByRole('button', { name: /seed-curriculum/i }))
  return screen.getByRole('button', { name: /Generate Homework/i })
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  // The lock persists its pending record to sessionStorage keyed by lockKey;
  // clear it so idempotency-key state never leaks across tests.
  sessionStorage.clear()
})

describe('HomeworkStudio — AI idempotency lock wiring', () => {
  it('sends a payload carrying a client-minted idempotencyKey when generating', async () => {
    const { generateHomework } = await import('../../../utils/teacherTools')
    generateHomework.mockResolvedValue({
      ok: true,
      data: { homework: { section1: {} }, generationId: 'gen-1', usage: null, warning: '' },
    })

    renderStudio()
    const generateBtn = seedCurriculumAndGetGenerate()

    await act(async () => {
      fireEvent.click(generateBtn)
    })

    expect(generateHomework).toHaveBeenCalledTimes(1)
    const payload = generateHomework.mock.calls[0][0]
    expect(typeof payload.idempotencyKey).toBe('string')
    expect(payload.idempotencyKey).toBeTruthy()
    expect(payload.idempotencyKey).toMatch(UUID_RE)
    // Sanity: the curriculum guards were satisfied and rode along in the payload.
    expect(payload.topic).toBe('Fractions')
  })

  it('a synchronous double-submit results in exactly one generateHomework call', async () => {
    const { generateHomework } = await import('../../../utils/teacherTools')
    // A deferred that stays pending, so BOTH clicks land while the first
    // request is still in flight — exactly when the lock has to hold.
    let resolveGenerate
    generateHomework.mockImplementation(
      () => new Promise((res) => { resolveGenerate = res }),
    )

    renderStudio()
    const generateBtn = seedCurriculumAndGetGenerate()

    // Two rapid clicks in the same synchronous burst — like a real double-click
    // firing before React re-renders the disabled state.
    fireEvent.click(generateBtn)
    fireEvent.click(generateBtn)

    expect(generateHomework).toHaveBeenCalledTimes(1)

    // Release the in-flight request so nothing dangles.
    await act(async () => {
      resolveGenerate({
        ok: true,
        data: { homework: { section1: {} }, generationId: 'gen-1', usage: null, warning: '' },
      })
    })
    expect(generateHomework).toHaveBeenCalledTimes(1)
  })
})
