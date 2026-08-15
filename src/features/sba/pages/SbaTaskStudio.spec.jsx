import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SbaTaskStudio from './SbaTaskStudio.jsx'

// Request-locking / idempotency initiative — this suite is the UI-level
// guarantee for the SBA studio: (1) a real generation sends a payload carrying
// a client-minted idempotencyKey, and (2) a synchronous double-submit (two
// clicks before the first resolves) produces exactly ONE generateSbaTask call.
// useAiOperationLock + aiOperationLockCore run for real here — that's the wiring
// under test — everything else the component pulls in is mocked so the studio
// renders in jsdom and its Generate path can be driven. Mirrors
// HomeworkStudio.spec.jsx. The SBA form carries valid defaults (G5 / English /
// reading comprehension), so no curriculum seeding step is needed.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The generator + the constant exports SbaTaskStudio reads for its selects.
vi.mock('../../../utils/teacherTools', () => ({
  generateSbaTask: vi.fn(),
  TEACHER_LANGUAGES: [{ value: 'english', label: 'English' }],
}))

// AuthContext + the generation gate are stubbed to "allowed" so the studio's
// own behaviour is what's under test (and firebase/config stays out of jsdom).
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'test-uid' }, userProfile: {}, isAdmin: false }),
}))
vi.mock('../../../hooks/useGenerationGate', () => ({
  useGenerationGate: () => ({ ensureCanGenerate: () => true }),
}))
vi.mock('../../../contexts/PlatformSettingsContext', () => ({
  usePlatformSettings: () => ({ settings: { featureFlags: {} } }),
}))

// Firebase-backed side effects fired on success — stubbed to no-ops.
vi.mock('../../../utils/teacherLibraryService', () => ({
  attachLibraryToGeneration: vi.fn(() => Promise.resolve()),
  isFreePlanTeacher: () => false,
}))

// Draft manager (PlatformSettingsContext + Firestore) — stubbed idle.
vi.mock('../../../hooks/draft/useDraftManager', () => ({
  useDraftManager: () => ({
    status: 'idle',
    savedAt: null,
    online: true,
    flush: vi.fn(),
    clear: vi.fn(() => Promise.resolve()),
  }),
}))
vi.mock('../../../shared/components/DraftStatusIndicator', () => ({ default: () => null }))
vi.mock('../../../shared/components/DraftRecoveryPrompt', () => ({ default: () => null }))

// Helmet needs a provider we don't want to stand up here.
vi.mock('../../../shared/components/SeoHelmet', () => ({ default: () => null }))

// Presentational bits with no bearing on the generate path.
vi.mock('../../../shared/components/LiveGenerationCanvas', () => ({ default: () => null }))
vi.mock('../components/SbaTaskView', () => ({ default: () => null }))
vi.mock('../components/SbaWorkflowNote', () => ({ default: () => null }))
vi.mock('../../../shared/components/TopicSubtopicPicker', () => ({ default: () => null }))
vi.mock('../../../shared/components/StudioPageHeader', () => ({ default: () => null }))
vi.mock('../../../shared/components/StudioOutputBoundary', () => ({ default: ({ children }) => children }))
vi.mock('../../../shared/components/Toast', () => ({ useToast: () => ({ error: vi.fn() }) }))

// Export paths pull in docx/pdf builders — irrelevant to generation.
vi.mock('../../../engines/export-engine/sbaTaskToDocx', () => ({ downloadSbaTaskDocx: vi.fn() }))
vi.mock('../../../engines/export-engine/sbaTaskToPdf', () => ({ downloadSbaTaskPdf: vi.fn() }))

function renderStudio() {
  return render(
    <MemoryRouter>
      <SbaTaskStudio />
    </MemoryRouter>,
  )
}

function getGenerateButton() {
  return screen.getByRole('button', { name: /Generate SBA task/i })
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  // The lock persists its pending record to sessionStorage keyed by lockKey;
  // clear it so idempotency-key state never leaks across tests.
  sessionStorage.clear()
})

describe('SbaTaskStudio — AI idempotency lock wiring', () => {
  it('sends a payload carrying a client-minted idempotencyKey when generating', async () => {
    const { generateSbaTask } = await import('../../../utils/teacherTools')
    generateSbaTask.mockResolvedValue({
      ok: true,
      data: { task: { header: {} }, generationId: 'gen-1', usage: null, warning: '' },
    })

    renderStudio()
    const generateBtn = getGenerateButton()

    await act(async () => {
      fireEvent.click(generateBtn)
    })

    expect(generateSbaTask).toHaveBeenCalledTimes(1)
    const payload = generateSbaTask.mock.calls[0][0]
    expect(typeof payload.idempotencyKey).toBe('string')
    expect(payload.idempotencyKey).toBeTruthy()
    expect(payload.idempotencyKey).toMatch(UUID_RE)
    // Sanity: the form defaults rode along in the payload.
    expect(payload.grade).toBe('G5')
    expect(payload.subject).toBe('english')
  })

  it('a synchronous double-submit results in exactly one generateSbaTask call', async () => {
    const { generateSbaTask } = await import('../../../utils/teacherTools')
    // A deferred that stays pending, so BOTH clicks land while the first
    // request is still in flight — exactly when the lock has to hold.
    let resolveGenerate
    generateSbaTask.mockImplementation(
      () => new Promise((res) => { resolveGenerate = res }),
    )

    renderStudio()
    const generateBtn = getGenerateButton()

    // Two rapid clicks in the same synchronous burst — like a real double-click
    // firing before React re-renders the disabled state.
    fireEvent.click(generateBtn)
    fireEvent.click(generateBtn)

    expect(generateSbaTask).toHaveBeenCalledTimes(1)

    // Release the in-flight request so nothing dangles.
    await act(async () => {
      resolveGenerate({
        ok: true,
        data: { task: { header: {} }, generationId: 'gen-1', usage: null, warning: '' },
      })
    })
    expect(generateSbaTask).toHaveBeenCalledTimes(1)
  })
})
