import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import CreatePaperModal, { QUESTION_TYPE_OPTIONS } from './CreatePaperModal.jsx'
import {
  ASSESSMENT_QUESTION_TYPES,
  canonicalizeAssessmentType,
} from '../../../utils/questionType.js'
import { ALL_QUESTION_TYPES } from '../../../config/assessmentBands.js'

// Topics/sub-topics the mocked syllabus hook serves up. The modal's "From
// syllabus" mode now renders these as checkboxes so a teacher can tick several
// at once instead of re-opening a drop-down per topic.
const TOPICS = ['Numbers', 'Fractions', 'Geometry', 'Measurement']
const SUBTOPICS = ['Adding fractions', 'Subtracting fractions']

// Mutable so a test can simulate a grade whose curriculum has NO syllabus
// subjects — the picker must show an empty state, never a hardcoded fallback.
const syllabusMock = vi.hoisted(() => ({
  subjects: [{ key: 'mathematics', label: 'Mathematics' }],
}))

vi.mock('../../../components/teacher/syllabusTopicOptions', () => ({
  CURRICULUM_FRAMEWORKS: [
    { value: '2023', label: '2023 CBC' },
    { value: '2013', label: '2013' },
  ],
  useSyllabusSubjectOptions: () => ({
    subjects: syllabusMock.subjects,
    loading: false,
  }),
  useSyllabusTopicOptions: () => ({
    topics: TOPICS,
    subtopics: SUBTOPICS,
    loading: false,
  }),
  // Curriculum-aware level list (includes Grade 4 so the seeded grade stays
  // valid for both frameworks) — mirrors the shape useSyllabusLevelOptions returns.
  useSyllabusLevelOptions: (framework) => ({
    levels: String(framework) === '2013'
      ? [{ value: '1', label: 'Grade 1' }, { value: '4', label: 'Grade 4' },
         { value: '7', label: 'Grade 7' }, { value: 'G8', label: 'Form 1' },
         { value: 'G12', label: 'Form 5' }]
      : [{ value: 'ECE_N', label: 'Nursery' }, { value: 'ECE_R', label: 'Reception' },
         { value: '1', label: 'Grade 1' },
         { value: '4', label: 'Grade 4' }, { value: '6', label: 'Grade 6' },
         { value: 'G8', label: 'Form 1' }, { value: 'G11', label: 'Form 4' }],
    loading: false,
  }),
}))

vi.mock('../../../utils/teacherTools', () => ({
  generateAssessment: vi.fn(),
  planAssessment: vi.fn(),
}))

// The fail-fast generation gate is covered by its own suite
// (functions/teacherTools/usageMeter.test.js); here it's stubbed to "allowed"
// so the modal's own behaviour is what's under test. Mocking it (and
// AuthContext) also keeps firebase/config out of this jsdom run — the gate
// would otherwise pull in the live Firebase app.
// The modal reaches FreePreviewUpsell through `features/teacherPaywall`'s
// front door, and a barrel evaluates every re-export — so `StudioNextSteps`
// comes with it and pulls `useStudioAvailability` -> PlatformSettingsContext
// -> firebase/config, which throws without VITE_FIREBASE_* under Vitest.
// No production cost (this modal's chunk already loads firebase/config); this
// is the same stub 60 other specs here use.
vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'test-uid' } }),
}))
vi.mock('../../../hooks/useGenerationGate', () => ({
  useGenerationGate: () => ({ ensureCanGenerate: () => true }),
}))

vi.mock('../../../utils/aiPaperToSections', () => ({
  aiAssessmentToStudioBlocks: vi.fn(),
}))

vi.mock('../../../shared/components/AiGenerationProgress', () => ({ default: () => null }))

// Capture the onStop prop emitted by CreatePaperModal so stop-race tests can
// invoke it without a real LiveGenerationCanvas in the DOM.
const canvasCapture = vi.hoisted(() => ({ onStop: null }))
vi.mock('../../../shared/components/LiveGenerationCanvas', () => ({
  default: ({ onStop }) => {
    canvasCapture.onStop = onStop
    return null
  },
}))

function renderModal(props = {}) {
  return render(
    <CreatePaperModal
      paperMeta={{ grade: '4', subject: 'mathematics', term: '1' }}
      onApply={vi.fn()}
      onClose={vi.fn()}
      {...props}
    />,
  )
}

// A minimal but VALID plan, in the shape planAssessment returns. The plan step
// runs before every generation now, so almost every test here walks through it.
function fakePlan(over = {}) {
  return {
    blueprint: {
      version: 'blueprint.v1',
      grade: 'G4', subject: 'mathematics', framework: '2023',
      assessmentType: 'end_of_term',
      totalMarks: 4, requestedMarks: 4, durationMinutes: 60, estimatedMinutes: 5,
      itemCount: 2, topics: ['Numbers'], warnings: [],
      sections: [{
        name: '', heading: '', instructions: '', marks: 4, itemCount: 2,
        items: [
          {
            id: 'q1', number: 1, topic: 'Numbers', marks: 2, bloomLevel: 'remember',
            difficulty: 'recall', learningOutcome: 'Count to 100',
            activityType: 'multiple_choice', activityLabel: 'Multiple choice',
            activitySupport: 'native', renderType: 'multiple_choice',
            figureRequired: false,
          },
          {
            id: 'q2', number: 2, topic: 'Numbers', marks: 2, bloomLevel: 'understand',
            difficulty: 'understanding', learningOutcome: '',
            activityType: 'short_answer', activityLabel: 'Short answer',
            activitySupport: 'native', renderType: 'short_answer',
            figureRequired: false,
          },
        ],
      }],
    },
    problems: [], topicsOnFile: 4, preview: null,
    ...over,
  }
}

// Generation is a two-step flow: "Plan the paper" costs nothing and shows the
// teacher what is about to be written; "Write this paper" generates it. These
// helpers walk that path so each test stays about the thing it is testing.
async function reachPlanStep(plan) {
  const { planAssessment } = await import('../../../utils/teacherTools')
  planAssessment.mockResolvedValue({ ok: true, data: plan || fakePlan() })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Plan the paper/i }))
  })
}
function writeButton() {
  return screen.getByRole('button', { name: /Write this paper/i })
}
async function planAndWrite() {
  await reachPlanStep()
  await act(async () => { fireEvent.click(writeButton()) })
}

// The topic block is the one labelled "Topics from the syllabus".
function topicGroup() {
  const label = screen.getByText(/Topics from the syllabus/i)
  // label → labelRow → topic section container
  return label.closest('div').parentElement
}

describe('CreatePaperModal — topic checkboxes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    syllabusMock.subjects = [{ key: 'mathematics', label: 'Mathematics' }]
  })

  it('renders every syllabus topic as a checkbox in "From syllabus" mode', () => {
    renderModal()
    for (const t of TOPICS) {
      expect(screen.getByRole('checkbox', { name: t })).toBeInTheDocument()
    }
  })

  it('shows only the syllabus subjects — no hardcoded fallback when the syllabus is empty', () => {
    // Grade whose curriculum carries no syllabus subjects.
    syllabusMock.subjects = []
    renderModal()
    // The empty state is shown instead of a fabricated subject list.
    expect(screen.getByText(/no subjects in this syllabus/i)).toBeInTheDocument()
    // None of the old static fallback subjects leak in.
    expect(screen.queryByRole('option', { name: 'English' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Social Studies' })).not.toBeInTheDocument()
    // Generating is blocked with a clear message rather than sending a stale subject.
    fireEvent.click(screen.getByRole('button', { name: /Plan the paper/i }))
    expect(screen.getByText(/no subjects in the chosen syllabus/i)).toBeInTheDocument()
  })

  it('ticks multiple topics without re-opening a control', () => {
    renderModal()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Numbers' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Fractions' }))
    expect(screen.getByRole('checkbox', { name: 'Numbers' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Fractions' })).toBeChecked()
    // The selection counter reflects both ticks (end_of_term cap is 15).
    expect(within(topicGroup()).getByText('2/15 selected')).toBeInTheDocument()
  })

  it('unticking a topic removes it', () => {
    renderModal()
    const box = screen.getByRole('checkbox', { name: 'Geometry' })
    fireEvent.click(box)
    expect(box).toBeChecked()
    fireEvent.click(box)
    expect(box).not.toBeChecked()
    expect(within(topicGroup()).getByText('0/15 selected')).toBeInTheDocument()
  })

  it('enforces the topic cap by disabling unchecked boxes once it is reached', () => {
    renderModal()
    // Narrow the cap to 3 by switching to a topic test.
    const typeSelect = screen.getAllByRole('combobox').find((s) => s.value === 'end_of_term')
    fireEvent.change(typeSelect, { target: { value: 'topic_test' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Numbers' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Fractions' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Geometry' }))
    expect(within(topicGroup()).getByText('3/3 selected')).toBeInTheDocument()
    // The 4th, still-unchecked option is now disabled.
    expect(screen.getByRole('checkbox', { name: 'Measurement' })).toBeDisabled()
    // Already-checked ones stay tickable so a teacher can swap.
    expect(screen.getByRole('checkbox', { name: 'Numbers' })).not.toBeDisabled()
  })

  it('renders sub-topics as checkboxes too', () => {
    renderModal()
    for (const s of SUBTOPICS) {
      expect(screen.getByRole('checkbox', { name: s })).toBeInTheDocument()
    }
    fireEvent.click(screen.getByRole('checkbox', { name: 'Adding fractions' }))
    expect(screen.getByRole('checkbox', { name: 'Adding fractions' })).toBeChecked()
  })
})

describe('CreatePaperModal — question types', () => {
  beforeEach(() => vi.clearAllMocks())

  // Reproduces the reported bug: the teacher selected only Multiple choice +
  // Fill in the blank but the paper also came back with Short answer and
  // Structured questions. The fix sends a canonical `questionTypes` whitelist
  // so the generator can hard-restrict the paper to exactly those types.
  // fill-in-the-blank is now the dedicated fill_blanks type (v1.6), distinct
  // from short_answer — the two are no longer deduped into one canonical.
  it('sends only the selected question types (deduped to canonical keys)', async () => {
    const { generateAssessment } = await import('../../../utils/teacherTools')
    generateAssessment.mockResolvedValue({ ok: false, error: 'stop here' })

    renderModal()
    // A topic is required before generation runs.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Numbers' }))

    // The default grade is 4, whose band (Grades 1-4) does not permit
    // Structured — so that chip is not offered at all here, and the seeded
    // selection has already dropped it. Narrow the rest down to the bug's exact
    // selection: Multiple choice + Fill in the blank only.
    expect(screen.queryByRole('button', { name: 'Structured' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Short answer' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fill in the blank' }))

    await planAndWrite()

    expect(generateAssessment).toHaveBeenCalledTimes(1)
    const payload = generateAssessment.mock.calls[0][0]
    // fill-in-the-blank → fill_blanks (its own schema type, v1.6);
    // "multiple choice" → multiple_choice.
    expect([...payload.questionTypes].sort()).toEqual(
      ['fill_blanks', 'multiple_choice'],
    )
    // The disallowed types are gone — no short_answer, no structured.
    expect(payload.questionTypes).not.toContain('structured')
    expect(payload.questionTypes).not.toContain('short_answer')
    // The human phrasing is also echoed in the instructions so the prompt
    // renders fill-in-the-blank as blanks.
    expect(payload.instructions).toMatch(/fill in the blank/i)
  })
})

describe('CreatePaperModal — assessment type picker', () => {
  beforeEach(() => vi.clearAllMocks())

  it('offers all 7 types, grouped into Tests and Examinations, in one picker', () => {
    renderModal()
    const typeSelect = screen.getByLabelText('Assessment type')
    const groups = within(typeSelect).getAllByRole('group')
    expect(groups.map((g) => g.getAttribute('label'))).toEqual(['Tests', 'Examinations'])
    const labels = within(typeSelect).getAllByRole('option').map((o) => o.textContent)
    expect(labels).toEqual([
      'Topic Test', 'Weekly Test', 'Mid-Term Test', 'End-of-Term Test',
      'Mock Examination', 'Examination', 'Final Examination',
    ])
  })

  it('defaults to End-of-Term Test regardless of how the modal was opened', () => {
    renderModal()
    expect(screen.getByLabelText('Assessment type').value).toBe('end_of_term')
  })

  // Regression: every examination type used to collapse to the literal
  // 'mock_exam' before reaching generateAssessment — so picking "Examination"
  // silently generated (and saved) a Mock Examination. The type the teacher
  // picks must reach the backend completely unchanged.
  it.each([
    ['mock_exam', 'Mock Examination'],
    ['examination', 'Examination'],
    ['final_exam', 'Final Examination'],
  ])('sends %s through unchanged when "%s" is selected — never collapsed to mock_exam', async (value) => {
    const { generateAssessment } = await import('../../../utils/teacherTools')
    generateAssessment.mockResolvedValue({ ok: false, error: 'stop here' })

    renderModal()
    fireEvent.change(screen.getByLabelText('Assessment type'), { target: { value } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Numbers' }))
    await planAndWrite()

    expect(generateAssessment).toHaveBeenCalledTimes(1)
    const payload = generateAssessment.mock.calls[0][0]
    expect(payload.assessmentType).toBe(value)
    if (value !== 'mock_exam') expect(payload.assessmentType).not.toBe('mock_exam')
    // Every examination-category type pitches the paper at full exam standard.
    expect(payload.instructions).toMatch(/exam standard/i)
  })

  it('a test-category type is sent unchanged too (no exam-standard framing)', async () => {
    const { generateAssessment } = await import('../../../utils/teacherTools')
    generateAssessment.mockResolvedValue({ ok: false, error: 'stop here' })

    renderModal()
    fireEvent.change(screen.getByLabelText('Assessment type'), { target: { value: 'topic_test' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Numbers' }))
    await planAndWrite()

    const payload = generateAssessment.mock.calls[0][0]
    expect(payload.assessmentType).toBe('topic_test')
    expect(payload.instructions).not.toMatch(/exam standard/i)
  })
})

// Regression: "Stop generation" was cosmetic — the awaited callable continued
// running and its success path (setResult / setStatus('done')) fired anyway.
// Fix: per-run token (runRef) — onStop bumps it; after each await, bail if the
// token has been superseded.
describe('CreatePaperModal — stop-generation race', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    canvasCapture.onStop = null
  })

  it('discards a resolved generation result when Stop was clicked first', async () => {
    const { generateAssessment } = await import('../../../utils/teacherTools')
    const { aiAssessmentToStudioBlocks } = await import('../../../utils/aiPaperToSections')

    // Deferred promise — we control when the callable resolves
    let resolveGenerate
    generateAssessment.mockImplementation(
      () => new Promise((res) => { resolveGenerate = res }),
    )

    renderModal()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Numbers' }))

    // Confirm the plan, then click Write — the async handler runs to the first
    // await; status → 'generating', LiveGenerationCanvas renders and
    // canvasCapture.onStop is populated.
    await reachPlanStep()
    fireEvent.click(writeButton())

    expect(canvasCapture.onStop).toBeInstanceOf(Function)

    // Simulate teacher clicking Stop — bumps runRef and drops back to the
    // confirmed plan, so the teacher can write it again without re-planning.
    act(() => { canvasCapture.onStop() })

    // Now the callable resolves with a valid result
    await act(async () => {
      resolveGenerate({
        ok: true,
        data: {
          assessment: { header: { title: 'Test paper' }, sections: [] },
          warning: '',
        },
      })
    })

    // The bail check (run !== runRef.current) must have fired:
    //   • aiAssessmentToStudioBlocks was never reached
    //   • status is back on the plan, not 'done' — no Apply buttons appear
    expect(aiAssessmentToStudioBlocks).not.toHaveBeenCalled()
    const writeBtn = writeButton()
    expect(writeBtn).toBeInTheDocument()
    expect(writeBtn).not.toBeDisabled()
  })
})

// Phase 2 follow-up: the chip map's `canonical` values must stay in lock-step
// with the shared assessment namespace (src/utils/questionType.js). Before this
// was wired, CreatePaperModal carried its own hardcoded assessment-type strings
// that could silently drift from ASSESSMENT_QUESTION_TYPES. This guard fails the
// moment a chip is added with a canonical the normalizer doesn't recognise.
describe('CreatePaperModal — assessment-type chip map parity', () => {
  it('every chip canonical is a recognised type — schema or band vocabulary', () => {
    // The eight ASSESSMENT_QUESTION_TYPES are what the output schema validates.
    // The band vocabulary adds the stage-specific TASK names (early-years and
    // upper-band), which the server maps onto a schema type before generating.
    // A chip outside both sets is a spelling nothing downstream recognises.
    const recognised = new Set([...ASSESSMENT_QUESTION_TYPES, ...ALL_QUESTION_TYPES])
    for (const opt of QUESTION_TYPE_OPTIONS) {
      expect(recognised).toContain(opt.canonical)
    }
  })

  it('every band-vocabulary chip has a chip, so a band can never offer nothing', () => {
    // A band listing a type with no chip would silently narrow the picker.
    const chipCanonicals = new Set(QUESTION_TYPE_OPTIONS.map((o) => o.canonical))
    for (const type of ALL_QUESTION_TYPES) {
      expect(chipCanonicals).toContain(type)
    }
  })

  it('every chip canonical round-trips through canonicalizeAssessmentType unchanged', () => {
    // Already-canonical values must be a fixed point of the canonicalizer, so
    // canonicalTypesFor()'s fold is a safe no-op rather than a silent rewrite.
    for (const opt of QUESTION_TYPE_OPTIONS) {
      expect(canonicalizeAssessmentType(opt.canonical)).toBe(opt.canonical)
    }
  })
})

// Request-locking / idempotency initiative — this is the UI-level guarantee
// that a double-click or rapid tap on "Generate paper" produces exactly one
// Anthropic call and one billed generation. useAiOperationLock itself is
// unit-tested in isolation (useAiOperationLock.spec.jsx); this suite proves
// CreatePaperModal actually wires it in on the real "Generate paper" button.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

describe('CreatePaperModal — duplicate-click protection', () => {
  beforeEach(() => vi.clearAllMocks())

  it('a double-click on Generate paper sends exactly one request', async () => {
    const { generateAssessment } = await import('../../../utils/teacherTools')
    let resolveGenerate
    generateAssessment.mockImplementation(
      () => new Promise((res) => { resolveGenerate = res }),
    )

    renderModal()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Numbers' }))

    await reachPlanStep()
    const btn = writeButton()
    // Two rapid clicks in the same synchronous burst, like a real double-click
    // firing before React re-renders the disabled state.
    fireEvent.click(btn)
    fireEvent.click(btn)

    expect(generateAssessment).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveGenerate({ ok: false, error: 'stop here' })
    })
  })

  it('every request carries a client-generated UUID idempotencyKey', async () => {
    const { generateAssessment } = await import('../../../utils/teacherTools')
    generateAssessment.mockResolvedValue({ ok: false, error: 'stop here' })

    renderModal()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Numbers' }))
    await planAndWrite()

    const payload = generateAssessment.mock.calls[0][0]
    expect(payload.idempotencyKey).toMatch(UUID_RE)
  })

  it('retrying the same failed request (unchanged inputs) reuses the same idempotencyKey', async () => {
    const { generateAssessment } = await import('../../../utils/teacherTools')
    generateAssessment.mockResolvedValue({ ok: false, error: 'stop here' })

    renderModal()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Numbers' }))
    await reachPlanStep()
    const btn = writeButton()

    await act(async () => { fireEvent.click(btn) })
    const firstKey = generateAssessment.mock.calls[0][0].idempotencyKey

    await act(async () => { fireEvent.click(btn) })
    const secondKey = generateAssessment.mock.calls[1][0].idempotencyKey

    expect(secondKey).toBe(firstKey)
  })

  it('changing the topic before regenerating mints a fresh idempotencyKey', async () => {
    const { generateAssessment } = await import('../../../utils/teacherTools')
    generateAssessment.mockResolvedValue({ ok: false, error: 'stop here' })

    renderModal()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Numbers' }))
    await planAndWrite()
    const firstKey = generateAssessment.mock.calls[0][0].idempotencyKey

    // A genuinely different request — different topic selection. The teacher
    // goes back to the settings, changes the topic, and plans again; a changed
    // request must not reuse the previous request's key.
    fireEvent.click(screen.getByRole('button', { name: /Change settings/i }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Fractions' }))
    await planAndWrite()
    const secondKey = generateAssessment.mock.calls[1][0].idempotencyKey

    expect(secondKey).not.toBe(firstKey)
  })
})

// ── Assessment bands (Phase 2) ────────────────────────────────────────────
// The acceptance criterion: "changing the grade visibly changes which question
// types are offered". Selecting Baby Class must not offer Essay / Composition;
// selecting Form 4 must not offer Colouring.
describe('CreatePaperModal — question types follow the band', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  async function selectGrade(value) {
    const select = screen.getByLabelText(/Grade \/ level/i)
    // The band resolves asynchronously (Firestore read, falling back to the
    // published defaults), so let the re-render settle before asserting.
    await act(async () => {
      fireEvent.change(select, { target: { value } })
    })
  }

  // Find a question-type chip by its ACTIVITY NAME. Chips for limited-support
  // activities append a "· basic" marker, and that marker is part of the point —
  // so strip it before comparing rather than matching the whole label.
  const chip = (label) => screen.getAllByRole('button').find((b) => (
    b.className.includes('sv-cpm-pill') &&
    b.textContent.replace(/·\s*basic\s*$/i, '').trim() === label
  )) || null

  it('Nursery offers early-years tasks and no writing tasks', () => {
    renderModal({ paperMeta: { grade: 'ECE_N', subject: 'numeracy', term: '1' } })
    for (const early of ['Match pictures', 'Counting', 'Tracing', 'Colouring', 'Sorting']) {
      expect(chip(early)).not.toBeNull()
    }
    // A child who cannot read cannot be set an essay, a comprehension or a
    // structured multi-part question.
    for (const tooHard of ['Essay / Composition', 'Structured', 'Comprehension']) {
      expect(chip(tooHard)).toBeNull()
    }
    // …nor a reading passage.
    expect(chip('Comprehension passage')).toBeNull()
  })

  it('Form 4 offers examination tasks and no early-years tasks', () => {
    renderModal({ paperMeta: { grade: 'G11', subject: 'mathematics', term: '1' } })
    for (const senior of ['Essay / Composition', 'Case study', 'Practical', 'Extended response']) {
      expect(chip(senior)).not.toBeNull()
    }
    for (const tooEasy of ['Colouring', 'Tracing', 'Counting', 'Match pictures']) {
      expect(chip(tooEasy)).toBeNull()
    }
  })

  it('changing the grade visibly changes the offered types', async () => {
    renderModal({ paperMeta: { grade: 'G11', subject: 'mathematics', term: '1' } })
    expect(chip('Essay / Composition')).not.toBeNull()
    expect(chip('Colouring')).toBeNull()

    await selectGrade('ECE_N')

    expect(chip('Essay / Composition')).toBeNull()
    expect(chip('Colouring')).not.toBeNull()
  })

  it('drops a selected type the new band forbids rather than carrying it over', async () => {
    const { generateAssessment } = await import('../../../utils/teacherTools')
    generateAssessment.mockResolvedValue({ ok: false, error: 'stop here' })

    renderModal({ paperMeta: { grade: 'G11', subject: 'mathematics', term: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Essay / Composition' }))
    // Switching down to Baby Class must not smuggle "essay" through to the
    // generator via a chip that is no longer on screen.
    await selectGrade('ECE_N')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Numbers' }))
    await planAndWrite()

    expect(generateAssessment).toHaveBeenCalledTimes(1)
    expect(generateAssessment.mock.calls[0][0].questionTypes).not.toContain('essay')
  })

  it('never leaves the teacher with no type selected', () => {
    // Every seeded default is forbidden at Baby Class, so the band's own first
    // types are selected instead of leaving an empty, un-generatable form.
    renderModal({ paperMeta: { grade: 'ECE_N', subject: 'numeracy', term: '1' } })
    const active = screen.getAllByRole('button')
      .filter((b) => b.className.includes('sv-cpm-pill') && b.className.includes('active'))
    expect(active.length).toBeGreaterThan(0)
  })
})
