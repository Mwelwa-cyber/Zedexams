/**
 * A choice question, drawn the way §4 requires: ONE vertical column of
 * full-width rows, each with an A/B/C/D letter badge, ECZ past-paper style.
 *
 * ## Why the layout is a contract and not a preference
 *
 * `docs/architecture.md` §4: *"single vertical column with A/B/C/D letter
 * badges, ECZ past-paper style, so long options get a full-width row."* The
 * reason is in the last clause. A two-column grid looks tidier on a fixture
 * with one-word options and truncates or wraps badly the moment a real option
 * is a sentence — which, in a Zambian past paper, it usually is. The learner
 * meets the failure, not the author.
 *
 * The letter badge is the other half: papers are marked against letters, learners
 * discuss answers as letters, and a renderer that showed bare options would make
 * "the answer is C" unsayable.
 *
 * ## It reuses the existing classes rather than inventing a look
 *
 * `.opt-grid`, `.zx-opt` and `.zx-opt-letter` are the shipping quiz styles.
 * `.opt-grid` is already `grid-template-columns: 1fr` — the single-column
 * contract expressed once, in CSS — and it carries the answer-spacing reading
 * preference (`[data-quiz-theme] .opt-grid { gap: var(--quiz-answer-gap) }`),
 * as `.zx-opt` carries the dark-theme and high-contrast variants, the 56px WCAG
 * touch target and the letter-size preference.
 *
 * A second set of classes would fork the appearance at exactly the moment the
 * engine renderer and the old runner have to be visually indistinguishable —
 * which is what the visual gate measures — and would silently drop every
 * reading preference a learner has set.
 *
 * ## Correctness is never signalled by colour alone
 *
 * The ✓/✗ marks carry `role="img"` with an accessible label, as the old runner's
 * do. A learner who cannot distinguish the green and red backgrounds still gets
 * the verdict.
 */
import RichContent from '../../../editor/RichContent'
import { buildChoiceRows, isAnswerable } from './choiceRows.js'

/**
 * @param {object} props
 * @param {object} props.question      a canonical question
 * @param {number|null} props.answer   the index the learner picked
 * @param {boolean} [props.revealed]   show verdicts
 * @param {(index: number) => void} props.onAnswer
 * @param {boolean} [props.disabled]  lock every row (e.g. a paywall), beyond
 *                                    the per-row lock reveal already applies —
 *                                    real `disabled`, not a swallowed click,
 *                                    so assistive tech hears the same state
 *                                    sighted users see
 */
export default function ChoiceQuestion({ question, answer, revealed = false, onAnswer, disabled = false }) {
  // A choice question with no options is not a question a learner can answer.
  // Drawing the prompt alone would present it as one.
  if (!isAnswerable(question)) {
    return (
      <p className="zx-render-problem" role="alert">
        This question has no answer choices, so it cannot be answered. Please tell your teacher.
      </p>
    )
  }

  const rows = buildChoiceRows({ question, answer, revealed })

  return (
    <div className="opt-grid" role="group" aria-label="Answer choices">
      {rows.map((row) => (
        <button
          key={row.index}
          type="button"
          onClick={() => onAnswer?.(row.index)}
          disabled={row.revealed || disabled}
          aria-pressed={row.selected}
          data-selected={row.selected ? 'true' : 'false'}
          data-correct={row.correct ? 'true' : 'false'}
          data-wrong={row.wrong ? 'true' : 'false'}
          className="zx-opt"
        >
          <span className="zx-opt-letter">{row.letter}</span>
          <span className="answer-text flex-1 leading-snug">
            {/* RichContent renders a Tiptap doc with KaTeX school notation and
                falls back to the plain string for legacy content. The canonical
                model always hands it a RichContent envelope — `tiptapDoc` when
                there is one, `plainTextFallback` when the stored value was a
                plain string — so this component never branches on format. */}
            <RichContent
              value={row.content?.tiptapDoc ?? row.content?.plainTextFallback ?? ''}
              className="rich-option"
            />
          </span>
          {row.correct && (
            <span className="zx-opt-state text-lg" role="img" aria-label="Correct">✓</span>
          )}
          {row.wrong && (
            <span className="zx-opt-state text-lg" role="img" aria-label="Incorrect">✗</span>
          )}
        </button>
      ))}
    </div>
  )
}
