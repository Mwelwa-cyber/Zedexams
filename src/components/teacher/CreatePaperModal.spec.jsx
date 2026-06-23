import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import CreatePaperModal from './CreatePaperModal.jsx'

// Topics/sub-topics the mocked syllabus hook serves up. The modal's "From
// syllabus" mode now renders these as checkboxes so a teacher can tick several
// at once instead of re-opening a drop-down per topic.
const TOPICS = ['Numbers', 'Fractions', 'Geometry', 'Measurement']
const SUBTOPICS = ['Adding fractions', 'Subtracting fractions']

vi.mock('./syllabusTopicOptions', () => ({
  CURRICULUM_FRAMEWORKS: [
    { value: '2023', label: '2023 CBC' },
    { value: '2013', label: '2013' },
  ],
  useSyllabusSubjectOptions: () => ({
    subjects: [{ key: 'mathematics', label: 'Mathematics' }],
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
  beforeEach(() => vi.clearAllMocks())

  it('renders every syllabus topic as a checkbox in "From syllabus" mode', () => {
    renderModal()
    for (const t of TOPICS) {
      expect(screen.getByRole('checkbox', { name: t })).toBeInTheDocument()
    }
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
  // (deduped: fill-in-the-blank collapses into short_answer) so the generator
  // can hard-restrict the paper to exactly those types.
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
    // fill-in-the-blank → short_answer; "multiple choice" → multiple_choice.
    expect([...payload.questionTypes].sort()).toEqual(
      ['multiple_choice', 'short_answer'],
    )
    // The disallowed type is gone — no structured.
    expect(payload.questionTypes).not.toContain('structured')
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
