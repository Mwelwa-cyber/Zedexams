/**
 * Behaviour tests for mathematics-aware editing in the inline question card.
 *
 * The failure these pin is the one Phase 1 exists to fix: on a mathematics
 * paper a teacher could not create a stacked fraction where they were working.
 * The card held a <textarea>, so structured content had to be shown read-only
 * behind an "Edit in detail" link, and answer options were <input type="text">
 * and could only ever be plain strings.
 *
 * A real Tiptap editor backs the active-field tests (same pattern as
 * EditorToolbar.spec.jsx) so the toolbar assertions exercise the production
 * extension set rather than a mock of it.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import MathsRichField, {
  MathsEditingProvider, normalizeMathsFieldValue,
} from './MathsRichField.jsx'
import { CardQuestionText, McqOptions } from './AssessmentQuestionEditors.jsx'

const doc = (...content) => ({ type: 'doc', content })
const para = (...content) => ({ type: 'paragraph', content })
const text = (t) => ({ type: 'text', text: t })
const fraction = (num, den, whole = '') => ({ type: 'mathFraction', attrs: { whole, num, den } })

const THREE_FIFTHS = doc(para(text('Calculate '), fraction('3', '5'), text('.')))

/* ------------------------------------------------------------------ *
 * The contract, applied on the way out of the editor
 * ------------------------------------------------------------------ */

describe('normalizeMathsFieldValue — plain stays plain, structured stays structured', () => {
  it('hands a formatting-free document back as plain text', () => {
    // Otherwise fixing a typo on a maths paper would promote an ordinary
    // question to a rich document it never needed, and §7's "existing plain
    // strings remain readable" would decay into "everything becomes JSON".
    const plain = normalizeMathsFieldValue(doc(para(text('Name two farm animals.'))))
    expect(plain).toBe('Name two farm animals.')
  })

  it('keeps a document that carries mathematics', () => {
    expect(normalizeMathsFieldValue(THREE_FIFTHS)).toEqual(THREE_FIFTHS)
  })

  it('passes strings through untouched', () => {
    expect(normalizeMathsFieldValue('3 + 4 = ?')).toBe('3 + 4 = ?')
    expect(normalizeMathsFieldValue(null)).toBe('')
  })

  it('never hands back a value that has already been stringified', () => {
    // "[object Object]" is what a String() on the way out looks like once it
    // reaches a paper. The guarantee is that a document arrives as a document
    // — the serialiser stringifies it as JSON later — so any string result
    // must have come from the plain-text path, never from coercion.
    const out = normalizeMathsFieldValue(THREE_FIFTHS)
    expect(typeof out).toBe('object')
    expect(out.type).toBe('doc')
  })
})

/* ------------------------------------------------------------------ *
 * The inactive field
 * ------------------------------------------------------------------ */

describe('an unfocused mathematics field', () => {
  it('renders the fraction as a STACK, never as "3/5" or a ½ glyph', () => {
    const { container } = render(
      <MathsRichField fieldId="f1" value={THREE_FIFTHS} onChange={() => {}} ariaLabel="Question text" />,
    )
    const stack = container.querySelector('.math-frac-stack')
    expect(stack).toBeTruthy()
    expect(within(stack).getByText('3')).toBeTruthy()
    expect(within(stack).getByText('5')).toBeTruthy()
    // School notation, not computer or typographic notation (§5).
    const rendered = container.textContent
    expect(rendered).not.toMatch(/3\s*\/\s*5/)
    expect(rendered).not.toMatch(/[½¼¾⅓⅔⅕³⁄₅]/)
  })

  it('is reachable and operable from the keyboard (§13)', () => {
    render(<MathsRichField fieldId="f1" value="" onChange={() => {}} placeholder="Question text" />)
    const field = screen.getByRole('button', { name: 'Question text' })
    expect(field.tagName).toBe('BUTTON')
    // Focus alone activates, so tabbing to a field is enough to edit it.
    fireEvent.focus(field)
    expect(screen.queryByRole('button', { name: 'Question text' })).toBeNull()
  })

  it('shows the placeholder when empty and the content when not', () => {
    const { rerender, container } = render(
      <MathsRichField fieldId="f1" value="" onChange={() => {}} placeholder="Question text" />,
    )
    expect(container.textContent).toContain('Question text')
    rerender(
      <MathsRichField fieldId="f1" value="Work out 12 + 9." onChange={() => {}} placeholder="Question text" />,
    )
    expect(container.textContent).toContain('Work out 12 + 9.')
  })
})

/* ------------------------------------------------------------------ *
 * One editor at a time (§14)
 * ------------------------------------------------------------------ */

describe('only the active field mounts an editor', () => {
  it('moving to a second field releases the first', async () => {
    render(
      <MathsEditingProvider>
        <MathsRichField fieldId="a" value="" onChange={() => {}} placeholder="First" />
        <MathsRichField fieldId="b" value="" onChange={() => {}} placeholder="Second" />
      </MathsEditingProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'First' }))
    // The first is now an editor; the second is still a preview button.
    expect(screen.queryByRole('button', { name: 'First' })).toBeNull()
    const second = screen.getByRole('button', { name: 'Second' })

    fireEvent.click(second)
    // The first has gone back to being a preview — one editor, paper-wide.
    expect(screen.getByRole('button', { name: 'First' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Second' })).toBeNull()
  })
})

/* ------------------------------------------------------------------ *
 * The question card
 * ------------------------------------------------------------------ */

describe('CardQuestionText', () => {
  it('on a mathematics paper, edits in place — no "edit in detail" detour', () => {
    // The whole point of the phase: a fraction is editable where the teacher
    // is working, not behind a link to another surface.
    render(<CardQuestionText value={THREE_FIFTHS} onChange={() => {}} onEditDetail={() => {}} maths fieldId="q1" />)
    expect(screen.queryByText(/edit in detail/i)).toBeNull()
  })

  it('on a non-mathematics paper, behaves exactly as before', () => {
    const onChange = vi.fn()
    const { container } = render(
      <CardQuestionText value="Name two farm animals." onChange={onChange} onEditDetail={() => {}} />,
    )
    const area = container.querySelector('textarea.sv-q-text-input')
    expect(area).toBeTruthy()
    fireEvent.change(area, { target: { value: 'Name three farm animals.' } })
    expect(onChange).toHaveBeenCalledWith('Name three farm animals.')
  })

  it('a formatted question on a non-mathematics paper is still protected from the textarea', () => {
    const { container } = render(
      <CardQuestionText value={THREE_FIFTHS} onChange={() => {}} onEditDetail={() => {}} />,
    )
    expect(container.querySelector('textarea.sv-q-text-input')).toBeNull()
    expect(screen.getByText(/edit in detail/i)).toBeTruthy()
  })
})

/* ------------------------------------------------------------------ *
 * Answer options
 * ------------------------------------------------------------------ */

function mcqQuestion(overrides = {}) {
  return {
    localId: 'q1',
    type: 'mcq',
    options: ['', '', '', ''],
    correctAnswer: 2,
    ...overrides,
  }
}

describe('MCQ options on a mathematics paper', () => {
  it('every option A-D becomes a mathematics field', () => {
    render(
      <McqOptions
        question={mcqQuestion()}
        maths
        onChangeOption={() => {}}
        onSelectCorrect={() => {}}
      />,
    )
    for (const letter of ['A', 'B', 'C', 'D']) {
      expect(screen.getByRole('button', { name: new RegExp(`^Option ${letter}\\b`) })).toBeTruthy()
    }
  })

  it('a fraction option renders stacked, not as a slash', () => {
    const { container } = render(
      <McqOptions
        question={mcqQuestion({ options: [doc(para(fraction('1', '2'))), '', '', ''] })}
        maths
        onChangeOption={() => {}}
        onSelectCorrect={() => {}}
      />,
    )
    expect(container.querySelector('.math-frac-stack')).toBeTruthy()
    expect(container.textContent).not.toMatch(/1\s*\/\s*2/)
  })

  it('clicking INTO an option to edit it does not change the answer key', () => {
    // The option row's onClick marks an option correct. Without the wrapper
    // that stops the click, moving the caret into option A to fix a
    // denominator would silently reassign the correct answer.
    const onSelectCorrect = vi.fn()
    render(
      <McqOptions
        question={mcqQuestion()}
        maths
        onChangeOption={() => {}}
        onSelectCorrect={onSelectCorrect}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /^Option A\b/ }))
    expect(onSelectCorrect).not.toHaveBeenCalled()
  })

  it('a rich option is never flattened by a plain input, even off a maths paper', () => {
    // Reachable whenever a paper's subject is changed after its options were
    // written; a plain <input> would show "[object Object]" and destroy the
    // content on the first keystroke.
    const { container } = render(
      <McqOptions
        question={mcqQuestion({ options: [doc(para(fraction('1', '2'))), 'plain', '', ''] })}
        onChangeOption={() => {}}
        onSelectCorrect={() => {}}
      />,
    )
    expect(container.textContent).not.toContain('[object Object]')
    expect(container.querySelector('.math-frac-stack')).toBeTruthy()
    // The plain sibling still gets the ordinary input it always had.
    expect(container.querySelector('input.sv-opt-text')).toBeTruthy()
  })

  it('a space typed into an option no longer marks that option correct', () => {
    // The row answered Enter/Space for any event that bubbled up, so a space
    // typed in an option both selected it and was swallowed — "less than 1"
    // could not be typed into an answer choice.
    const onSelectCorrect = vi.fn()
    const { container } = render(
      <McqOptions
        question={mcqQuestion()}
        onChangeOption={() => {}}
        onSelectCorrect={onSelectCorrect}
      />,
    )
    const input = container.querySelector('input.sv-opt-text')
    fireEvent.keyDown(input, { key: ' ' })
    expect(onSelectCorrect).not.toHaveBeenCalled()

    // Pressing Space on the row itself still selects it.
    fireEvent.keyDown(container.querySelector('.sv-mcq-option'), { key: ' ' })
    expect(onSelectCorrect).toHaveBeenCalledWith(0)
  })
})
