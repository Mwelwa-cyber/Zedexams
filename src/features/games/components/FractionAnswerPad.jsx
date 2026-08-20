/**
 * The fraction answer pad — where a learner WRITES a fraction.
 *
 * If a question shows a stacked fraction, the answer cannot be a single text
 * box: the learner is being asked to produce a two-part thing and given one
 * slot for it (docs/learner/zedexams-maths-notation.html). So the input has
 * the shape of the answer — a whole-number box in front, then a top box, a
 * rule, and a bottom box, and the pad follows what the question is asking for:
 *
 *   a plain fraction        top · bottom
 *   a mixed number          whole · top · bottom
 *   a whole-number answer   one box, because "180 learners" is not a fraction
 *   a decimal               one box with a decimal point on the keypad
 *
 * THE KEYPAD IS THE APP'S, NOT THE DEVICE'S. A phone keyboard on a maths
 * question covers half the screen, hides the picture the question is about,
 * and offers a learner every character on the board. Ten digits and a delete
 * key is the whole vocabulary. The boxes are still real `<button>`s and the
 * keys are still real `<button>`s, so a physical keyboard and a screen reader
 * both work — typing digits is handled too, for the tablet-with-a-keyboard
 * case, because refusing a keystroke on a number pad is its own small insult.
 */
import { useEffect } from 'react'

/**
 * Which boxes a question asks for.
 *
 * The whole-number box appears only where a whole number could be PART of the
 * right answer: a question that asks for a mixed number, or one whose answer
 * is an improper fraction, which the marker accepts written either way. On
 * "write 6/8 in its lowest terms" it is a third box a learner has to work out
 * is not for them, on a 320px screen where the two that matter are already
 * small. It is not hidden to tidy the screen — it is hidden because nothing
 * could ever go in it.
 */
export function padShape(question = {}) {
  if (question.form === 'decimal') return 'decimal'
  if (question.form === 'whole') return 'whole'
  if (question.form === 'mixed') return 'mixed'
  const value = question.value
  if (value && Number(value.d) && Number(value.n) >= Number(value.d)) return 'mixed'
  return 'fraction'
}

/** An empty entry of the right shape for a question. */
export function emptyEntry(question = {}) {
  const shape = padShape(question)
  if (shape === 'decimal') return { mode: 'decimal', decimal: '' }
  if (shape === 'whole') return { mode: 'whole', whole: '' }
  return { mode: 'fraction', whole: '', num: '', den: '' }
}

/** The field a shape starts on. */
export function firstField(shape) {
  if (shape === 'decimal') return 'decimal'
  if (shape === 'whole') return 'whole'
  if (shape === 'mixed') return 'whole'
  return 'num'
}

const MAX = { whole: 3, num: 3, den: 3, decimal: 6 }

/**
 * Apply one key to an entry. Pure, so the rules — how long a box may be, what
 * a delete does on an empty box, where the caret goes next — are testable
 * without a DOM.
 */
export function applyKey(entry, field, key) {
  const next = { ...entry }
  if (key === 'clear') {
    return { entry: { ...emptyEntryFor(entry) }, field: field === 'den' ? 'num' : field }
  }
  if (key === 'back') {
    const current = String(next[field] ?? '')
    if (current) {
      next[field] = current.slice(0, -1)
      return { entry: next, field }
    }
    // Deleting on an empty box steps back to the one before it, which is what
    // a learner correcting a mistake means by pressing delete twice.
    if (field === 'den') return { entry: next, field: 'num' }
    if (field === 'num' && entry.mode === 'fraction') return { entry: next, field: 'whole' }
    return { entry: next, field }
  }
  if (key === '.') {
    if (field !== 'decimal') return { entry, field }
    if (String(next.decimal || '').includes('.')) return { entry, field }
    next.decimal = `${next.decimal || ''}.`
    return { entry: next, field }
  }
  const current = String(next[field] ?? '')
  if (current.length >= (MAX[field] || 3)) return { entry, field }
  next[field] = current + key
  return { entry: next, field }
}

function emptyEntryFor(entry) {
  if (entry.mode === 'decimal') return { mode: 'decimal', decimal: '' }
  if (entry.mode === 'whole') return { mode: 'whole', whole: '' }
  return { mode: 'fraction', whole: '', num: '', den: '' }
}

/** True when there is enough in the boxes to be worth checking. */
export function entryReady(entry, shape) {
  if (shape === 'decimal') return !!String(entry.decimal || '').replace('.', '')
  if (shape === 'whole') return !!String(entry.whole || '')
  return !!String(entry.num || '') && !!String(entry.den || '')
}

function Box({ id, label, value, active, disabled, onFocusField, className = '' }) {
  return (
    <button
      type="button"
      id={id}
      className={`lhx-fp-box ${active ? 'is-focus' : ''} ${className}`.trim()}
      aria-label={`${label}${value ? `, ${value}` : ', empty'}`}
      aria-current={active ? 'true' : undefined}
      disabled={disabled}
      onClick={() => onFocusField()}
    >
      {value || <span className="lhx-fp-ghost" aria-hidden="true">·</span>}
    </button>
  )
}

export default function FractionAnswerPad({
  question,
  entry,
  field,
  onChange,
  onFocusField,
  onCheck,
  disabled = false,
  state = null, // 'ok' | 'no' | null
}) {
  const shape = padShape(question)

  // A real keyboard types into the focused box. Not a substitute for the
  // on-screen pad — the pad is the primary input on a phone — but a tablet
  // with a keyboard, and every automated test, expects digits to work.
  useEffect(() => {
    if (disabled) return undefined
    const onKey = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (/^[0-9]$/.test(event.key)) { onChange(applyKey(entry, field, event.key)); event.preventDefault() }
      else if (event.key === 'Backspace') { onChange(applyKey(entry, field, 'back')); event.preventDefault() }
      else if (event.key === '.' && shape === 'decimal') { onChange(applyKey(entry, field, '.')); event.preventDefault() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [entry, field, disabled, shape, onChange])

  const press = (key) => { if (!disabled) onChange(applyKey(entry, field, key)) }

  return (
    <div className="lhx-fp">
      <div className={`lhx-fp-answer ${state ? `is-${state}` : ''}`.trim()}>
        {shape === 'decimal' && (
          <Box
            id="fp-decimal"
            label="Your answer as a decimal"
            value={entry.decimal}
            active={field === 'decimal'}
            disabled={disabled}
            onFocusField={() => onFocusField('decimal')}
            className="is-wide"
          />
        )}
        {shape === 'whole' && (
          <Box
            id="fp-whole-only"
            label="Your answer"
            value={entry.whole}
            active={field === 'whole'}
            disabled={disabled}
            onFocusField={() => onFocusField('whole')}
            className="is-wide"
          />
        )}
        {(shape === 'fraction' || shape === 'mixed') && (
          <>
            {shape === 'mixed' && (
              <Box
                id="fp-whole"
                label="Whole number"
                value={entry.whole}
                active={field === 'whole'}
                disabled={disabled}
                onFocusField={() => onFocusField('whole')}
                className="is-whole"
              />
            )}
            <span className="lhx-fp-stack">
              <Box
                id="fp-num"
                label="Top number"
                value={entry.num}
                active={field === 'num'}
                disabled={disabled}
                onFocusField={() => onFocusField('num')}
              />
              <span className="lhx-fp-bar" aria-hidden="true" />
              <Box
                id="fp-den"
                label="Bottom number"
                value={entry.den}
                active={field === 'den'}
                disabled={disabled}
                onFocusField={() => onFocusField('den')}
              />
            </span>
          </>
        )}
      </div>

      <p className="lhx-fp-hint">
        {shape === 'decimal' ? 'Type your answer.'
          : shape === 'whole' ? 'Type the number.'
            : 'Tap a box, then type. Top number first.'}
      </p>

      <div className="lhx-fp-pad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
          <button key={digit} type="button" className="lhx-fp-key" disabled={disabled} onClick={() => press(digit)}>
            {digit}
          </button>
        ))}
        {shape === 'decimal'
          ? <button type="button" className="lhx-fp-key is-fn" disabled={disabled} onClick={() => press('.')}>·</button>
          : <button type="button" className="lhx-fp-key is-fn" disabled={disabled} onClick={() => press('clear')}>Clear</button>}
        <button type="button" className="lhx-fp-key" disabled={disabled} onClick={() => press('0')}>0</button>
        <button type="button" className="lhx-fp-key is-fn" aria-label="Delete" disabled={disabled} onClick={() => press('back')}>⌫</button>
      </div>

      <button
        type="button"
        className="lhx-fl-check"
        onClick={onCheck}
        disabled={disabled || !entryReady(entry, shape)}
      >
        Check my answer
      </button>
    </div>
  )
}
