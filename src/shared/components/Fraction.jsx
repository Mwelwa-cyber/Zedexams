/**
 * The one fraction renderer.
 *
 * A fraction is written STACKED — a top number, a rule, a bottom number — in
 * every Zambian classroom and in every ECZ paper. "3/4" is programming
 * notation, and a learner who meets it in an app and the stacked form on paper
 * is being asked to hold two notations for one idea.
 *
 * There is one of this component, in `shared/`, for the reason stated in
 * docs/learner/zedexams-maths-notation.html: the moment two surfaces render a
 * fraction differently, learners notice. It is placed below `features/` so
 * notes, quizzes, worked solutions, the study plan and the guardian's report
 * can all reach it without importing a game.
 *
 * THE DIGITS ARE HIDDEN AND THE WORDS ARE THE NAME. `aria-hidden` on the stack
 * and `aria-label` on the wrapper, both generated from the same two numbers —
 * so the screen reader says "three quarters" and cannot drift from what is
 * drawn, because there is nowhere for a second string to live.
 *
 * `role="math"` rather than `role="img"`: this is a mathematical expression,
 * and the distinction is what lets a maths-aware reader treat it as one.
 */
import '../styles/fraction.css'
import { fracWords, mixedWords } from '../utils/fractionMath.js'

/**
 * A fraction. `whole` makes it a mixed number, which is the same component
 * rather than a second one — 2¾ is a whole beside a fraction, and rendering it
 * through a different code path is how the two come to look different.
 *
 * @param {object} props
 * @param {number} props.n numerator
 * @param {number} props.d denominator
 * @param {number} [props.whole] whole part, for a mixed number
 * @param {'inline'|'block'|'lg'} [props.size] `inline` nudges it onto the
 *   baseline of running text; `lg` is the introduce-the-symbol size.
 * @param {string} [props.className]
 */
export function Frac({ n, d, whole = 0, size = 'inline', className = '' }) {
  const numerator = Number(n)
  const denominator = Number(d)
  const wholePart = Number(whole) || 0
  const label = wholePart
    ? mixedWords(wholePart, numerator, denominator)
    : fracWords(numerator, denominator)
  const sizeClass = size === 'lg' ? 'zx-frac-lg' : size === 'inline' ? 'zx-frac-inline' : ''

  return (
    <span className={`zx-frac ${sizeClass} ${className}`.trim()} role="math" aria-label={label}>
      {wholePart ? <span className="zx-frac-w" aria-hidden="true">{wholePart}</span> : null}
      <span className="zx-frac-stack" aria-hidden="true">
        <span className="zx-frac-n">{numerator}</span>
        <span className="zx-frac-d">{denominator}</span>
      </span>
    </span>
  )
}

/**
 * A mixed number, named. It is `<Frac>` with a whole — the separate name
 * exists because a caller holding `{whole, n, d}` should not have to know that
 * the two are the same component, and because §21 asks for it by name.
 */
export function MixedNumber({ whole, n, d, size = 'inline', className = '' }) {
  return <Frac whole={whole} n={n} d={d} size={size} className={className} />
}

/**
 * The spoken form of a fraction, for a caller that needs the string rather
 * than the element — a toast, an `aria-label` on a bigger control, the
 * read-aloud voice. Same function the renderer uses.
 */
export function fractionLabel(n, d, whole = 0) {
  return whole ? mixedWords(whole, n, d) : fracWords(n, d)
}

export default Frac
