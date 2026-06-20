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
