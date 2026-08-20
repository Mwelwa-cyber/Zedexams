/**
 * The fraction answer pad.
 *
 * The rule it exists for: if the question shows a stacked fraction, the answer
 * cannot be a single text box. So the input has the SHAPE of the answer, and
 * the shape follows what the question asks for — a plain fraction, a mixed
 * number, a whole number, a decimal.
 *
 * The key-handling rules are pure (`applyKey`) and tested as functions too,
 * because "delete on an empty box steps back to the box before it" is the sort
 * of thing that is tedious to drive through a DOM and easy to get wrong.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import FractionAnswerPad, {
  applyKey,
  emptyEntry,
  entryReady,
  firstField,
  padShape,
} from './FractionAnswerPad'

const FRACTION = { type: 'write', value: { n: 3, d: 4 } }
const MIXED = { type: 'write', value: { n: 11, d: 4 }, form: 'mixed' }
const WHOLE = { type: 'write', value: { n: 180, d: 1 }, form: 'whole' }
const DECIMAL = { type: 'write', value: { n: 3, d: 8 }, form: 'decimal' }

/* ── the pure half ─────────────────────────────────────────────────── */

describe('the pad rules', () => {
  it('the shape follows what the question asks for', () => {
    expect(padShape(FRACTION)).toBe('fraction')
    // An improper answer gets the whole box too, because the marker accepts a
    // mixed number for it and a learner who writes one must be able to.
    expect(padShape({ type: 'write', value: { n: 7, d: 4 } })).toBe('mixed')
    expect(padShape(MIXED)).toBe('mixed')
    expect(padShape(WHOLE)).toBe('whole')
    expect(padShape(DECIMAL)).toBe('decimal')
    expect(firstField('fraction')).toBe('num')
    expect(firstField('mixed')).toBe('whole')
    expect(firstField('whole')).toBe('whole')
    expect(firstField('decimal')).toBe('decimal')
  })

  it('an empty entry is of the right shape, so the marker knows what it got', () => {
    expect(emptyEntry(FRACTION)).toEqual({ mode: 'fraction', whole: '', num: '', den: '' })
    expect(emptyEntry(WHOLE)).toEqual({ mode: 'whole', whole: '' })
    expect(emptyEntry(DECIMAL)).toEqual({ mode: 'decimal', decimal: '' })
  })

  it('digits land in the focused box and stop at its length', () => {
    let state = { entry: emptyEntry(FRACTION), field: 'num' }
    for (const digit of ['1', '2', '3', '4']) state = applyKey(state.entry, state.field, digit)
    expect(state.entry.num).toBe('123')
  })

  it('delete empties the box, then steps BACK to the one before it', () => {
    // What a learner correcting a mistake means by pressing delete twice.
    let state = applyKey({ mode: 'fraction', whole: '', num: '3', den: '4' }, 'den', 'back')
    expect(state.entry.den).toBe('')
    expect(state.field).toBe('den')
    state = applyKey(state.entry, state.field, 'back')
    expect(state.field).toBe('num', 'a second delete moves to the top number')
    state = applyKey(state.entry, state.field, 'back')
    expect(state.entry.num).toBe('')
    state = applyKey(state.entry, 'num', 'back')
    expect(state.field).toBe('whole')
  })

  it('clear empties every box at once', () => {
    const state = applyKey({ mode: 'fraction', whole: '2', num: '3', den: '4' }, 'den', 'clear')
    expect(state.entry).toEqual({ mode: 'fraction', whole: '', num: '', den: '' })
  })

  it('a decimal point is allowed once, and only in a decimal box', () => {
    let state = applyKey({ mode: 'decimal', decimal: '0' }, 'decimal', '.')
    expect(state.entry.decimal).toBe('0.')
    state = applyKey(state.entry, 'decimal', '.')
    expect(state.entry.decimal).toBe('0.', 'a second point is refused rather than making a number that is not one')
    const fraction = applyKey({ mode: 'fraction', whole: '', num: '3', den: '' }, 'num', '.')
    expect(fraction.entry.num).toBe('3')
  })

  it('an answer is checkable only once there is enough of it', () => {
    expect(entryReady({ mode: 'fraction', num: '3', den: '' }, 'fraction')).toBe(false)
    expect(entryReady({ mode: 'fraction', num: '3', den: '4' }, 'fraction')).toBe(true)
    expect(entryReady({ mode: 'whole', whole: '' }, 'whole')).toBe(false)
    expect(entryReady({ mode: 'whole', whole: '0' }, 'whole')).toBe(true)
    expect(entryReady({ mode: 'decimal', decimal: '.' }, 'decimal')).toBe(false, 'a lone point is not a number')
    expect(entryReady({ mode: 'decimal', decimal: '0.5' }, 'decimal')).toBe(true)
  })
})

/* ── the rendered half ─────────────────────────────────────────────── */

function drawPad(question, overrides = {}) {
  const props = {
    question,
    entry: emptyEntry(question),
    field: firstField(padShape(question)),
    onChange: vi.fn(),
    onFocusField: vi.fn(),
    onCheck: vi.fn(),
    ...overrides,
  }
  return { ...render(<FractionAnswerPad {...props} />), props }
}

describe('<FractionAnswerPad>', () => {
  it('a proper fraction gets two stacked boxes and NO whole-number box', () => {
    // Nothing could ever go in a third box on "write 6/8 in its lowest terms",
    // and a box a learner has to work out is not for them is worse than one
    // less box on a 320px screen.
    drawPad(FRACTION)
    expect(screen.getByRole('button', { name: 'Top number, empty' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bottom number, empty' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Whole number/ })).toBeNull()
  })

  it('a mixed-number answer gets the whole-number box in front', () => {
    drawPad(MIXED)
    expect(screen.getByRole('button', { name: 'Whole number, empty' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Top number, empty' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bottom number, empty' })).toBeInTheDocument()
  })

  it('a whole-number answer gets ONE box — writing 180 over 1 is a lesson nobody asked for', () => {
    drawPad(WHOLE)
    expect(screen.getByRole('button', { name: 'Your answer, empty' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Bottom number/ })).toBeNull()
  })

  it('a decimal answer gets one box and a decimal point on the keypad', () => {
    drawPad(DECIMAL)
    expect(screen.getByRole('button', { name: 'Your answer as a decimal, empty' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '·' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull()
  })

  it('the box being typed into is marked, for sight and for assistive technology', () => {
    drawPad(MIXED, { field: 'den' })
    expect(screen.getByRole('button', { name: 'Bottom number, empty' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: 'Top number, empty' })).not.toHaveAttribute('aria-current')
  })

  it('a box announces what is in it, not just that it is a box', () => {
    drawPad(FRACTION, { entry: { mode: 'fraction', whole: '', num: '3', den: '4' } })
    expect(screen.getByRole('button', { name: 'Top number, 3' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bottom number, 4' })).toBeInTheDocument()
  })

  it('tapping a key reports the change rather than owning the state', () => {
    const { props } = drawPad(FRACTION)
    fireEvent.click(screen.getByRole('button', { name: '7' }))
    expect(props.onChange).toHaveBeenCalledWith({
      entry: { mode: 'fraction', whole: '', num: '7', den: '' },
      field: 'num',
    })
  })

  it('tapping a box moves the caret to it', () => {
    const { props } = drawPad(FRACTION)
    fireEvent.click(screen.getByRole('button', { name: 'Bottom number, empty' }))
    expect(props.onFocusField).toHaveBeenCalledWith('den')
  })

  it('a real keyboard types into the focused box too', () => {
    // The pad is the primary input on a phone. A tablet with a keyboard, and
    // every automated test, still expects digits to work.
    const { props } = drawPad(FRACTION, { field: 'den' })
    fireEvent.keyDown(window, { key: '8' })
    expect(props.onChange).toHaveBeenCalledWith({
      entry: { mode: 'fraction', whole: '', num: '', den: '8' },
      field: 'den',
    })
    fireEvent.keyDown(window, { key: 'Backspace' })
    expect(props.onChange).toHaveBeenCalledTimes(2)
    // A shortcut is not a digit.
    fireEvent.keyDown(window, { key: '8', metaKey: true })
    expect(props.onChange).toHaveBeenCalledTimes(2)
  })

  it('Check is refused until there is an answer to check', () => {
    const { props } = drawPad(FRACTION)
    const check = screen.getByRole('button', { name: 'Check my answer' })
    expect(check).toBeDisabled()
    fireEvent.click(check)
    expect(props.onCheck).not.toHaveBeenCalled()
  })

  it('a settled question locks the pad, keys and all', () => {
    const { props } = drawPad(FRACTION, {
      entry: { mode: 'fraction', whole: '', num: '3', den: '4' },
      disabled: true,
      state: 'ok',
    })
    expect(screen.getByRole('button', { name: 'Check my answer' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '7' })).toBeDisabled()
    fireEvent.keyDown(window, { key: '7' })
    expect(props.onChange).not.toHaveBeenCalled()
  })

  it('the verdict colours the answer, not the keypad', () => {
    const { container } = drawPad(FRACTION, { state: 'no', disabled: true })
    expect(container.querySelector('.lhx-fp-answer')).toHaveClass('is-no')
  })
})
