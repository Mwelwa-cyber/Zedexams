/**
 * One question, drawn by type — or refused by name.
 *
 * The dispatcher §4 puts at the top of the renderer family. It reads the
 * canonical model and nothing else, which is what lets the same component draw
 * a learner quiz, a past-paper quiz and a `timed_quiz` game: the sources
 * disagree about everything except what `normalise` already reconciled.
 *
 * ## An unsupported type is REFUSED, not skipped
 *
 * The tempting default — `return null` for a type with no renderer — draws a
 * question with no way to answer it, silently, to a learner sitting an
 * assessment. That is the exact shape of the answer-key defect (#2125): no
 * crash, no red test, a learner losing marks for something nobody drew.
 *
 * So this throws. The message names the type and says what is missing, and the
 * boundary above shows the learner a "could not be displayed" state instead of
 * a blank. Louder is correct here: a cutover that meets an undrawable question
 * should stop, and `unrenderableTypes()` lets it be asked BEFORE a learner is
 * shown anything.
 */
import { canRender, unsupportedReason } from './supportedTypes.js'
import ChoiceQuestion from './ChoiceQuestion.jsx'
import QuestionPrompt from './QuestionPrompt.jsx'

/**
 * @param {object} props
 * @param {object} props.question      a canonical question
 * @param {*} props.answer             the learner's answer, in the type's own shape
 * @param {boolean} [props.revealed]
 * @param {(answer: *) => void} props.onAnswer
 * @param {number} [props.number]      1-based position, shown to the learner
 */
export default function QuestionRenderer({ question, answer, revealed = false, onAnswer, number }) {
  if (!canRender(question?.type)) {
    throw new Error(
      `the assessment engine cannot draw a "${question?.type}" question yet — `
      + `missing: ${unsupportedReason(question?.type)}. `
      + 'Ask unrenderableTypes() before rendering an assessment so this is caught '
      + 'before a learner is shown a question they cannot answer.',
    )
  }

  return (
    <div className="zx-question" data-question-type={question.type} data-question-id={question.id}>
      <QuestionPrompt question={question} number={number} />
      <ChoiceQuestion
        question={question}
        answer={typeof answer === 'number' ? answer : null}
        revealed={revealed}
        onAnswer={onAnswer}
      />
    </div>
  )
}
