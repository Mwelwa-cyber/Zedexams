/**
 * Re-export only. The answer key lives in the shared past-paper quiz package.
 *
 * @see functions/shared/paperQuiz/answerKey.js
 *
 * DO NOT ADD A RULE HERE. The server marks every exam with that module; a
 * shape handled only on this side is a question the runner paints green and
 * the score card marks wrong.
 */
export {
  optionText,
  questionText,
  isCorrectChoice,
  correctIndexOf,
  optionLetter,
  optionLabel,
} from '../../../../../functions/shared/paperQuiz/answerKey.js'
