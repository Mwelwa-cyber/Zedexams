/**
 * What the renderers put on screen — the half `choiceRows.test.js` cannot see.
 *
 * The rules live in `choiceRows.js` and are asserted under plain node. What is
 * left needs a DOM, and it is not decoration:
 *
 *   • the §4 layout contract — ONE vertical column, a letter badge per row;
 *   • that the answer key is not in the markup of an unrevealed question,
 *     which is the rule stated at the level a learner could actually exploit;
 *   • that an undrawable type is refused rather than rendered blank.
 *
 * `RichContent` is NOT stubbed. It is the component §4.1's school-notation
 * requirement runs through, and a stub would make every assertion about
 * rendered content a statement about the stub.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import QuestionRenderer from './QuestionRenderer.jsx'
import ChoiceQuestion from './ChoiceQuestion.jsx'

const rich = (text) => ({ version: 1, tiptapDoc: null, plainTextFallback: text })
const question = (over = {}) => ({
  id: 'q1', type: 'mcq', marks: 1, topicIds: [], answerKey: {},
  prompt: rich('What is the capital of Zambia?'),
  options: [rich('Ndola'), rich('Lusaka'), rich('Kitwe'), rich('Livingstone')],
  correctIndex: 1,
  ...over,
})

const options = (container) => Array.from(container.querySelectorAll('.zx-opt'))

describe('QuestionRenderer — the §4 layout contract', () => {
  it('draws one full-width row per option, in a single vertical column', () => {
    // Not a grid. §4: long options get a full-width row, because a real
    // past-paper option is usually a sentence and a two-column layout
    // truncates it. Every row is a direct child of the one options group.
    const { container } = render(<QuestionRenderer question={question()} answer={null} />)
    // `.opt-grid` is the shipping single-column rule, reused rather than
    // reimplemented — so the contract lives in one CSS declaration.
    const group = screen.getByRole('group', { name: 'Answer choices' })
    expect(group).toHaveClass('opt-grid')
    expect(options(container)).toHaveLength(4)
    for (const row of options(container)) expect(row.parentElement).toBe(group)
  })

  it('gives every row an A/B/C/D letter badge', () => {
    const { container } = render(<QuestionRenderer question={question()} answer={null} />)
    expect(options(container).map((b) => b.querySelector('.zx-opt-letter')?.textContent))
      .toEqual(['A', 'B', 'C', 'D'])
  })

  it('letters a fifth option E rather than leaving it blank', () => {
    const q = question({ options: [...question().options, rich('Kabwe')] })
    const { container } = render(<QuestionRenderer question={q} answer={null} />)
    expect(options(container).map((b) => b.querySelector('.zx-opt-letter')?.textContent))
      .toEqual(['A', 'B', 'C', 'D', 'E'])
  })

  it('renders the option text and the prompt', () => {
    render(<QuestionRenderer question={question()} answer={null} />)
    expect(screen.getByText('What is the capital of Zambia?')).toBeInTheDocument()
    expect(screen.getByText('Lusaka')).toBeInTheDocument()
  })

  it('shows the question number, its topic and its marks', () => {
    render(<QuestionRenderer question={question({ marks: 3, topicIds: ['Geography'] })} answer={null} number={7} />)
    expect(screen.getByText('Q7')).toBeInTheDocument()
    expect(screen.getByText('Geography')).toBeInTheDocument()
    expect(screen.getByText('3 marks')).toBeInTheDocument()
  })

  it('hides the marks pill on a 1-mark question, as the old runner does', () => {
    // QuizRunnerV2.jsx:745 shows marks only above 1. Printed papers mark every
    // question, so showing it always is defensible — but it would differ from
    // the old runner on most questions in most quizzes, on the first engine
    // code a learner sees. That is a decision for both renderers, not a side
    // effect of the migration.
    render(<QuestionRenderer question={question({ marks: 1 })} answer={null} number={1} />)
    expect(screen.queryByText(/mark/)).not.toBeInTheDocument()
  })

  it('renders the stem through .question-text, which carries the reading preferences', () => {
    // --quiz-text-scale and --quiz-line-height hang off this class. A new one
    // would silently drop every text-size setting a learner has chosen.
    const { container } = render(<QuestionRenderer question={question()} answer={null} />)
    expect(container.querySelector('.question-text')).toHaveTextContent('What is the capital of Zambia?')
  })
})

describe('QuestionRenderer — answering', () => {
  it('reports the INDEX the learner picked', () => {
    const onAnswer = vi.fn()
    const { container } = render(<QuestionRenderer question={question()} answer={null} onAnswer={onAnswer} />)
    fireEvent.click(options(container)[2])
    expect(onAnswer).toHaveBeenCalledWith(2)
  })

  it('marks the picked row selected, and only that one', () => {
    const { container } = render(<QuestionRenderer question={question()} answer={2} />)
    expect(options(container).map((b) => b.dataset.selected)).toEqual(['false', 'false', 'true', 'false'])
  })

  it('exposes selection to assistive technology, not only as a data attribute', () => {
    const { container } = render(<QuestionRenderer question={question()} answer={1} />)
    expect(options(container).map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false', 'false'])
  })

  it('a revealed question cannot be answered again', () => {
    const onAnswer = vi.fn()
    const { container } = render(
      <QuestionRenderer question={question()} answer={0} revealed onAnswer={onAnswer} />,
    )
    fireEvent.click(options(container)[3])
    expect(onAnswer).not.toHaveBeenCalled()
  })
})

describe('QuestionRenderer — the key is not in an unrevealed question', () => {
  it('puts NO correctness signal in the markup before reveal', () => {
    // The rule at the level a learner could exploit it: open the inspector
    // mid-exam and there is nothing to read.
    const { container } = render(<QuestionRenderer question={question()} answer={0} />)
    expect(container.querySelector('[data-correct="true"]')).toBeNull()
    expect(container.querySelector('[data-wrong="true"]')).toBeNull()
    expect(screen.queryByLabelText('Correct')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Incorrect')).not.toBeInTheDocument()
  })

  it('shows the verdict once revealed', () => {
    const { container } = render(<QuestionRenderer question={question()} answer={0} revealed />)
    expect(options(container)[1].dataset.correct).toBe('true')
    expect(options(container)[0].dataset.wrong).toBe('true')
  })

  it('signals correctness with a LABELLED mark, never colour alone', () => {
    render(<QuestionRenderer question={question()} answer={0} revealed />)
    expect(screen.getByLabelText('Correct')).toBeInTheDocument()
    expect(screen.getByLabelText('Incorrect')).toBeInTheDocument()
  })
})

describe('QuestionRenderer — what it refuses', () => {
  it('THROWS on a type it cannot draw, naming the type and what is missing', () => {
    // Never `return null`. That draws a question with no way to answer it,
    // silently, to a learner sitting an assessment.
    expect(() => render(<QuestionRenderer question={question({ type: 'matching' })} answer={null} />))
      .toThrow(/cannot draw a "matching" question yet/)
  })

  it('the refusal names what a learner would be missing', () => {
    expect(() => render(<QuestionRenderer question={question({ type: 'sequence' })} answer={null} />))
      .toThrow(/reorder/)
  })

  it('tells the learner a choice question with no options cannot be answered', () => {
    // The other way to render an unanswerable question: a prompt with nothing
    // under it, which reads as a paragraph rather than as a fault.
    render(<ChoiceQuestion question={question({ options: [] })} answer={null} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/cannot be answered/i)
  })
})

describe('QuestionRenderer — legacy and rich content', () => {
  it('renders a legacy plain string through its fallback', () => {
    render(<QuestionRenderer question={question()} answer={null} />)
    expect(screen.getByText('Ndola')).toBeInTheDocument()
  })

  it('renders a Tiptap document rather than its fallback text', () => {
    // §4.1's requirement is that rich content is RENDERED, not flattened. If
    // the component reached for `plainTextFallback` first, school notation
    // would silently become plain text everywhere.
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'rendered-doc' }] }],
    }
    const q = question({ prompt: { version: 1, tiptapDoc: doc, plainTextFallback: 'flat-fallback' } })
    render(<QuestionRenderer question={q} answer={null} />)
    expect(screen.getByText('rendered-doc')).toBeInTheDocument()
    expect(screen.queryByText('flat-fallback')).not.toBeInTheDocument()
  })
})
