/**
 * One question: the passage, the figure, the stem and the options.
 *
 * Shared by BOTH modes, and that is the point — an exam and a practice run
 * must present a question identically, or a learner rehearsing on one is
 * rehearsing for the other. What differs is entirely in the props: exam mode
 * passes `revealed={false}` forever and `correctIndex={null}` (it does not
 * have it — the server stripped it), practice passes both the moment the
 * learner taps.
 *
 * Rich content, figures and read-aloud come from the shared components the
 * rest of the platform uses, so a stacked fraction, a library diagram and a
 * teacher's chosen image position all render here the way they render in the
 * quiz runner and the daily quiz.
 */

import RichContent from '../../../../editor/RichContent'
import DiagramSvg from '../../../../curriculum/diagrams/DiagramSvg'
import ZoomableImage from '../../../../shared/components/ZoomableImage'
import ExtraQuestionImages from '../../../../shared/components/ExtraQuestionImages'
import TextToSpeechButton from '../../../../shared/components/TextToSpeechButton'
import { resolveQuestionFigure } from '../../../../utils/questionFigure'
import { optionLetter, optionText, questionText } from '../lib/answerKey'
import { IconCheck, IconX } from './QuizIcons'

/**
 * The value to hand <RichContent> for an option, so it renders with real
 * stacked fractions / KaTeX like the stem instead of plain text.
 */
function richOptionValue(opt) {
  if (opt == null) return ''
  if (typeof opt === 'string') return opt
  if (typeof opt === 'object') return opt.textJSON ?? opt.text ?? ''
  return String(opt)
}

function Option({ question, index, chosen, revealed, correctIndex, onChoose, shaking }) {
  const options = Array.isArray(question?.options) ? question.options : []
  const opt = options[index]
  const optObj = (opt && typeof opt === 'object') ? opt : null
  const isCorrect = revealed && correctIndex === index
  const isWrong = revealed && chosen === index && correctIndex !== index

  let cls = 'pq-opt'
  if (revealed) {
    if (isCorrect) cls += ' is-correct'
    else if (isWrong) cls += ' is-wrong'
    else cls += ' is-dim'
  } else if (chosen === index) {
    cls += ' is-chosen'
  }
  if (shaking) cls += ' is-shake'

  const label = optionText(opt)
  const letter = optionLetter(index)

  return (
    <button
      type="button"
      className={cls}
      disabled={revealed}
      onClick={() => onChoose(index)}
      // The screen reader gets the verdict as words. Colour and a tick are the
      // sighted learner's; "Correct answer" is everyone's.
      aria-label={revealed
        ? `${letter}. ${label}. ${isCorrect ? 'Correct answer' : isWrong ? 'Your answer, wrong' : ''}`
        : `${letter}. ${label}`}
    >
      <span className="pq-k" aria-hidden="true">{letter}</span>
      <span className="pq-t">
        {optObj?.diagram?.libraryKey ? (
          <span className="pq-opt-figure">
            <DiagramSvg libraryKey={optObj.diagram.libraryKey} params={optObj.diagram.params} alt={`Option ${letter}`} />
          </span>
        ) : optObj?.imageUrl ? (
          <span className="pq-opt-figure">
            <img src={optObj.imageUrl} alt={`Option ${letter}`} />
          </span>
        ) : null}
        <RichContent
          value={richOptionValue(opt)}
          fallback={<span>{label}</span>}
        />
      </span>
      <span className="pq-mark" aria-hidden="true">
        {isCorrect ? <IconCheck size={20} /> : isWrong ? <IconX size={20} /> : null}
      </span>
    </button>
  )
}

export default function QuestionCard({
  question,
  index,
  chosen,
  revealed,
  correctIndex,
  onChoose,
  shakingIndex,
  readAloud,
}) {
  if (!question) return null
  const options = Array.isArray(question.options) ? question.options : []
  const figure = resolveQuestionFigure(question)

  return (
    <div className="pq-qwrap">
      {(question.passage || question.passageJSON) && (
        <div className="pq-passage">
          <RichContent
            value={question.passageJSON ?? question.passage ?? ''}
            fallback={<p>{question.passage}</p>}
          />
        </div>
      )}

      {figure.kind === 'diagram' && (
        <div className="pq-figure">
          <DiagramSvg libraryKey={figure.libraryKey} params={figure.params} alt="Question diagram" />
        </div>
      )}
      {figure.kind === 'image' && (
        <div className="pq-figure">
          <ZoomableImage src={figure.imageUrl} alt="Question illustration" fallbackText={question.diagramText} />
        </div>
      )}
      {/* The described-diagram fallback: a figure we could not draw. Mutually
          exclusive with an image, so it never needs a place beside one. */}
      {figure.kind === 'none' && question.diagramText && (
        <div className="pq-passage">{question.diagramText}</div>
      )}
      <ExtraQuestionImages question={question} />

      <div className="pq-stem">
        <RichContent
          value={question.textJSON ?? question.text ?? ''}
          fallback={<p>{questionText(question)}</p>}
        />
        {readAloud?.enabled && (
          <TextToSpeechButton
            id={`pq-q:${index}`}
            label="question"
            getText={() => questionText(question)}
            tts={readAloud}
          />
        )}
      </div>

      <div className="pq-opts">
        {options.map((_, i) => (
          <Option
            key={i}
            question={question}
            index={i}
            chosen={chosen}
            revealed={revealed}
            correctIndex={correctIndex}
            onChoose={onChoose}
            shaking={shakingIndex === i}
          />
        ))}
        {options.length === 0 && (
          <p className="pq-hint-foot">This question has no options configured yet.</p>
        )}
      </div>
    </div>
  )
}
