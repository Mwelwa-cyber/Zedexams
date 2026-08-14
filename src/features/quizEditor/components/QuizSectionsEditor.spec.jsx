/**
 * Behaviour tests for QuizSectionsEditor.jsx — the section/question editor
 * canvas shared by the quiz + past-paper studios.
 *
 * It's a large (2.7k-line) controlled component that was previously untested.
 * These cover the orchestration logic that is the editor's *own* (not a
 * child card's): the empty state, the Add-Question menu wiring, and the
 * ConfirmDialog-gated destructive actions (shuffle). The real, a11y-hardened
 * ConfirmDialog is kept so the confirm flow is exercised end-to-end; the
 * heavy per-question leaves (rich editor, AI assistant, diagrams) are stubbed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { emptyQuestion } from '../../../utils/quizSections.js'

// Heavy per-card leaves — stub so the editor mounts fast and self-contained.
// Editable stub: a textarea keyed by placeholder so the card-editing tests
// below can type into a question stem / option and see the card's onChange
// fire. The rich editor's real onChange hands back its value; we forward the
// textarea value, which is all the card's setOption/set() paths need.
vi.mock('./QuizRichField', () => ({
  default: ({ value, placeholder, onChange }) => (
    <textarea
      placeholder={placeholder || ''}
      value={typeof value === 'string' ? value : ''}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
}))
vi.mock('./QuestionAiAssistant.jsx', () => ({ default: () => null }))
vi.mock('../../../components/diagrams/DiagramSvg.jsx', () => ({ default: () => null }))
vi.mock('../../../components/diagrams/DiagramPicker.jsx', () => ({ default: () => null }))
vi.mock('../../../editor/RichContent', () => ({ default: () => null }))

import QuizSectionsEditor from './QuizSectionsEditor'

function standaloneSection(id, overrides = {}) {
  return { id, kind: 'standalone', question: emptyQuestion({ text: `Question ${id}`, ...overrides }) }
}

function passageSection(id, questions = [emptyQuestion({ localId: `${id}-q1`, text: `Question ${id}` })]) {
  return {
    id,
    kind: 'passage',
    passage: {
      localId: `${id}-p`,
      title: `Passage ${id}`,
      passageText: `Read passage ${id}.`,
      passageKind: 'comprehension',
      questions,
    },
  }
}

// Minimal required props: the editor reads many callbacks but tolerates
// undefined ones (they only fire on interaction). These are the ones our
// assertions exercise.
function renderEditor(props = {}) {
  return render(
    <QuizSectionsEditor
      sections={[]}
      parts={[]}
      quizContext={{ subject: 'Mathematics', grade: '5' }}
      questionNumbers={{}}
      totalQuestions={0}
      {...props}
    />,
  )
}

beforeEach(() => vi.clearAllMocks())

describe('QuizSectionsEditor — empty state', () => {
  it('shows the default empty state when there are no sections', () => {
    renderEditor()
    expect(screen.getByText('No questions yet')).toBeInTheDocument()
    expect(
      screen.getByText('Click "Add Question" below to start building this quiz.'),
    ).toBeInTheDocument()
  })

  it('renders a custom empty-state title and description', () => {
    renderEditor({
      emptyStateTitle: 'Nothing here',
      emptyStateDescription: 'Import a past paper to begin.',
    })
    expect(screen.getByText('Nothing here')).toBeInTheDocument()
    expect(screen.getByText('Import a past paper to begin.')).toBeInTheDocument()
  })
})

describe('QuizSectionsEditor — Add Question menu', () => {
  it('opens the menu and adds a standalone (multiple choice) question', () => {
    const onAddStandalone = vi.fn()
    renderEditor({ onAddStandalone })
    fireEvent.click(screen.getByRole('button', { name: /Add Question/i }))
    fireEvent.click(screen.getByText('Multiple Choice'))
    expect(onAddStandalone).toHaveBeenCalledTimes(1)
  })

  it('adds a comprehension passage from the menu', () => {
    const onAddPassage = vi.fn()
    renderEditor({ onAddPassage })
    fireEvent.click(screen.getByRole('button', { name: /Add Question/i }))
    fireEvent.click(screen.getByText('Comprehension Passage'))
    expect(onAddPassage).toHaveBeenCalledTimes(1)
  })
})

describe('QuizSectionsEditor — populated', () => {
  it('renders question cards instead of the empty state when sections exist', () => {
    renderEditor({
      sections: [standaloneSection('a'), standaloneSection('b')],
      totalQuestions: 2,
    })
    expect(screen.queryByText('No questions yet')).not.toBeInTheDocument()
    // The Add-Question affordance is still present below the cards.
    expect(screen.getByRole('button', { name: /Add Question/i })).toBeInTheDocument()
  })
})

describe('QuizSectionsEditor — insert question between cards', () => {
  it('renders an insert affordance between cards and fires onInsertStandalone with the anchor + Part', () => {
    const onInsertStandalone = vi.fn()
    renderEditor({
      sections: [standaloneSection('a'), standaloneSection('b')],
      totalQuestions: 2,
      onInsertStandalone,
    })
    // One divider at the top of the (ungrouped) group + one after each card = 3.
    const inserts = screen.getAllByRole('button', { name: 'Insert a new question here' })
    expect(inserts).toHaveLength(3)
    // The divider after the first card inserts AFTER card 'a'.
    fireEvent.click(inserts[1])
    expect(onInsertStandalone).toHaveBeenCalledWith({ anchorId: 'a', mode: 'after', partId: null })
  })

  it('omits the insert affordances when the parent does not wire onInsertStandalone', () => {
    renderEditor({
      sections: [{ id: 'a', kind: 'standalone', question: emptyQuestion({ text: 'Q1' }) }],
      totalQuestions: 1,
    })
    expect(screen.queryByRole('button', { name: 'Insert a new question here' })).not.toBeInTheDocument()
  })
})

describe('QuizSectionsEditor — shuffle confirm flow', () => {
  it('requires confirmation before shuffling and then calls onShuffleSections', () => {
    const onShuffleSections = vi.fn()
    renderEditor({
      sections: [standaloneSection('a'), standaloneSection('b')],
      totalQuestions: 2,
      onShuffleSections,
    })
    // Clicking shuffle opens the confirm dialog rather than firing immediately.
    fireEvent.click(screen.getByRole('button', { name: /Shuffle questions/i }))
    expect(onShuffleSections).not.toHaveBeenCalled()
    expect(screen.getByText('Shuffle the order of all questions?')).toBeInTheDocument()
    // Confirming fires the callback.
    fireEvent.click(screen.getByRole('button', { name: 'Shuffle' }))
    expect(onShuffleSections).toHaveBeenCalledTimes(1)
  })

  it('does not offer shuffle with fewer than two questions', () => {
    renderEditor({
      sections: [standaloneSection('a')],
      totalQuestions: 1,
      onShuffleSections: vi.fn(),
    })
    expect(screen.queryByRole('button', { name: /Shuffle questions/i })).not.toBeInTheDocument()
  })
})

describe('QuizSectionsEditor — editing a question card', () => {
  // A ready-to-edit standalone MCQ: four filled options, A currently correct.
  function mcqSection(id = 'a') {
    return standaloneSection(id, {
      type: 'mcq',
      options: ['Lusaka', 'Ndola', 'Kitwe', 'Livingstone'],
      correctAnswer: 0,
    })
  }

  it('marks a different option as correct via onStandaloneChange', () => {
    const onStandaloneChange = vi.fn()
    renderEditor({ sections: [mcqSection()], totalQuestions: 1, onStandaloneChange })
    // Option C (index 2) — the radio is labelled by its letter.
    fireEvent.click(screen.getByLabelText('Mark option C as correct'))
    expect(onStandaloneChange).toHaveBeenCalledWith(0, 'correctAnswer', 2)
  })

  it('edits an option\'s text via onStandaloneChange', () => {
    const onStandaloneChange = vi.fn()
    renderEditor({ sections: [mcqSection()], totalQuestions: 1, onStandaloneChange })
    fireEvent.change(screen.getByPlaceholderText('Option B'), { target: { value: 'Kabwe' } })
    // setOption rebuilds the options array with B replaced.
    expect(onStandaloneChange).toHaveBeenCalledWith(
      0,
      'options',
      ['Lusaka', 'Kabwe', 'Kitwe', 'Livingstone'],
    )
  })

  it('removes a question via onStandaloneRemove', () => {
    const onStandaloneRemove = vi.fn()
    renderEditor({ sections: [mcqSection()], totalQuestions: 1, onStandaloneRemove })
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(onStandaloneRemove).toHaveBeenCalledWith(0)
  })

  it('bulk-deletes selected questions behind a confirm dialog', () => {
    const onStandaloneRemove = vi.fn()
    renderEditor({
      sections: [mcqSection('a'), mcqSection('b')],
      totalQuestions: 2,
      onStandaloneRemove,
    })
    // Select the first question, then hit the bulk Delete affordance.
    fireEvent.click(screen.getByLabelText('Select question 1'))
    fireEvent.click(screen.getByRole('button', { name: /Delete 1/ }))
    // Nothing deleted until the confirm dialog is accepted.
    expect(onStandaloneRemove).not.toHaveBeenCalled()
    expect(screen.getByText('Delete 1 selected question?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onStandaloneRemove).toHaveBeenCalledWith(0)
  })
})

describe('QuizSectionsEditor — editing passage questions', () => {
  it('lets passage questions change type with the same presets as standalone questions', () => {
    const onPassageQuestionChange = vi.fn()
    const question = emptyQuestion({
      localId: 'passage-q1',
      text: 'What is the main idea?',
      type: 'mcq',
      subtype: 'spelling',
      options: ['A', 'B', 'C', 'D'],
      correctAnswer: 0,
    })
    renderEditor({
      sections: [passageSection('p1', [question])],
      questionNumbers: { 'passage-q1': 1 },
      totalQuestions: 1,
      onPassageQuestionChange,
    })

    fireEvent.change(screen.getByDisplayValue('MCQ (4 options)'), {
      target: { value: 'short_answer' },
    })

    expect(onPassageQuestionChange).toHaveBeenCalledWith(0, 0, 'type', 'short_answer')
    expect(onPassageQuestionChange).toHaveBeenCalledWith(0, 0, 'options', [])
    expect(onPassageQuestionChange).toHaveBeenCalledWith(0, 0, 'correctAnswer', '')
    expect(onPassageQuestionChange).toHaveBeenCalledWith(0, 0, 'subtype', null)
  })
})
