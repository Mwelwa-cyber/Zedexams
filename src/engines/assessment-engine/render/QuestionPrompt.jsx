/**
 * The question's stem — its number, its topic, its marks, and the prompt.
 *
 * ## `RichContent` is why this is a component and not `{question.prompt}`
 *
 * §4.1 requires Tiptap JSON rendered with KaTeX school notation — stacked
 * fractions with a horizontal bar, never slash forms — through the existing
 * `MathFraction` / `MathInline` / `NumberBase` / `VerticalArithmetic`
 * extensions. A Grade 4 learner reading `3/4` where their exercise book, their
 * teacher's board and their printed paper all show a stacked fraction is being
 * taught that the two are different things.
 *
 * The canonical model always supplies a `RichContent` envelope, so this never
 * branches on format: `tiptapDoc` when the stored value was rich,
 * `plainTextFallback` when it was a legacy plain string. `normalise` did that
 * fold once; every renderer downstream reads one shape.
 *
 * ## It matches the old runner's stem, including where that is arguable
 *
 * `zx-pill-dark` / `zx-pill-orange` and `.question-text` are the shipping
 * classes, and `.question-text` carries the learner's text-scale and
 * line-height preferences (`--quiz-text-scale`, `--quiz-line-height`) — a new
 * class would drop them silently.
 *
 * **Marks are shown only above 1**, which is the runner's rule
 * (`QuizRunnerV2.jsx:745`). ECZ printed convention marks every question, so
 * always-showing is defensible and probably right — but during a canary any
 * visible difference must mean DEFECT, and a product change riding a cutover
 * destroys the one cheap signal an operator has. Deferred to after the cutover,
 * for both renderers, with the visual baselines re-recorded in the same change:
 * `docs/phase3-plan.md` §10.0. (Owner decision, 2026-08-05.)
 */
import RichContent from '../../../editor/RichContent'

/**
 * @param {object} props
 * @param {object} props.question  a canonical question
 * @param {number} [props.number]  1-based position, shown to the learner
 */
export default function QuestionPrompt({ question, number }) {
  const prompt = question?.prompt
  const marks = question?.marks ?? 1
  const topic = question?.topicIds?.[0]

  return (
    <div className="zx-question-prompt space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {number != null && <span className="zx-pill-dark">Q{number}</span>}
        {topic && <span className="zx-pill-dark zx-pill-light">{topic}</span>}
        {marks > 1 && <span className="zx-pill-dark zx-pill-orange">{marks} marks</span>}
      </div>
      <div className="question-text">
        <RichContent value={prompt?.tiptapDoc ?? prompt?.plainTextFallback ?? ''} />
      </div>
    </div>
  )
}
