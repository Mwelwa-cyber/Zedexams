import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import CreatePaperModal, { QUESTION_TYPE_OPTIONS } from './CreatePaperModal.jsx'
import {
  ASSESSMENT_QUESTION_TYPES,
  canonicalizeAssessmentType,
} from '../../utils/questionType.js'

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

vi.mock('./syllabusTopicOptions', () => ({
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
}))

vi.mock('../../utils/teacherTools', () => ({
  generateAssessment: vi.fn(),
}))

// The fail-fast generation gate is covered by its own suite
// (functions/teacherTools/usageMeter.test.js); here it's stubbed to "allowed"
// so the modal's own behaviour is what's under test. Mocking it (and
// AuthContext) also keeps firebase/config out of this jsdom run — the gate
// would otherwise pull in the live Firebase app.
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'test-uid' } }),
}))
vi.mock('../../hooks/useGenerationGate', () => ({
  useGenerationGate: () => ({ ensureCanGenerate: () => true }),
}))

vi.mock('../../utils/aiPaperToSections', () => ({
  aiAssessmentToStudioBlocks: vi.fn(),
}))

vi.mock('../ui/AiGenerationProgress', () => ({ default: () => null }))

// Capture the onStop prop emitted by CreatePaperModal so stop-race tests can
// invoke it without a real LiveGenerationCanvas in the DOM.
const canvasCapture = vi.hoisted(() => ({ onStop: null }))
vi.mock('../ui/LiveGenerationCanvas', () => ({
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
    fireEvent.click(screen.getByRole('button', { name: /Generate/i }))
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
    const { generateAssessment } = await import('../../utils/teacherTools')
    generateAssessment.mockResolvedValue({ ok: false, error: 'stop here' })

    renderModal()
    // A topic is required before generation runs.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Numbers' }))

    // Default selection is MCQ + short answer + structured — turn the studio
    // into the bug's exact selection: Multiple choice + Fill in the blank only.
    fireEvent.click(screen.getByRole('button', { name: 'Short answer' }))
    fireEvent.click(screen.getByRole('button', { name: 'Structured' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fill in the blank' }))

    fireEvent.click(screen.getByRole('button', { name: /Generate paper/i }))

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
    expect(payload.instructions).toMatch(/fill-in-the-blank/i)
  })
})

describe('CreatePaperModal — exam variant', () => {
  beforeEach(() => vi.clearAllMocks())

  it('offers the three exam types instead of the four test types', () => {
    renderModal({ variant: 'exam' })
    const typeSelect = screen.getAllByRole('combobox').find((s) => s.value === 'mock')
    expect(typeSelect).toBeTruthy()
    const labels = within(typeSelect).getAllByRole('option').map((o) => o.textContent)
    expect(labels).toEqual(['Mock Exam', 'Examination', 'Exam'])
  })

  it('generates at exam standard — maps every exam type to the mock_exam format', async () => {
    const { generateAssessment } = await import('../../utils/teacherTools')
    generateAssessment.mockResolvedValue({ ok: false, error: 'stop here' })

    renderModal({ variant: 'exam' })
    // A topic is still required before generation runs.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Numbers' }))
    fireEvent.click(screen.getByRole('button', { name: /Generate paper/i }))

    expect(generateAssessment).toHaveBeenCalledTimes(1)
    const payload = generateAssessment.mock.calls[0][0]
    // The chosen exam type collapses to the server's mock_exam format profile.
    expect(payload.assessmentType).toBe('mock_exam')
    // The instruction pitches the paper at full exam standard.
    expect(payload.instructions).toMatch(/exam standard/i)
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
    const { generateAssessment } = await import('../../utils/teacherTools')
    const { aiAssessmentToStudioBlocks } = await import('../../utils/aiPaperToSections')

    // Deferred promise — we control when the callable resolves
    let resolveGenerate
    generateAssessment.mockImplementation(
      () => new Promise((res) => { resolveGenerate = res }),
    )

    renderModal()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Numbers' }))

    // Click Generate — async handler runs to the first await; status → 'generating'
    // LiveGenerationCanvas renders and canvasCapture.onStop is populated
    fireEvent.click(screen.getByRole('button', { name: /Generate paper/i }))

    expect(canvasCapture.onStop).toBeInstanceOf(Function)

    // Simulate teacher clicking Stop — bumps runRef, status → 'idle'
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
    //   • status is still 'idle', not 'done' — no Apply buttons appear
    expect(aiAssessmentToStudioBlocks).not.toHaveBeenCalled()
    const generateBtn = screen.getByRole('button', { name: /Generate paper/i })
    expect(generateBtn).toBeInTheDocument()
    expect(generateBtn).not.toBeDisabled()
  })
})

// Phase 2 follow-up: the chip map's `canonical` values must stay in lock-step
// with the shared assessment namespace (src/utils/questionType.js). Before this
// was wired, CreatePaperModal carried its own hardcoded assessment-type strings
// that could silently drift from ASSESSMENT_QUESTION_TYPES. This guard fails the
// moment a chip is added with a canonical the normalizer doesn't recognise.
describe('CreatePaperModal — assessment-type chip map parity', () => {
  it('every chip canonical is a member of the shared ASSESSMENT_QUESTION_TYPES', () => {
    for (const opt of QUESTION_TYPE_OPTIONS) {
      expect(ASSESSMENT_QUESTION_TYPES).toContain(opt.canonical)
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
