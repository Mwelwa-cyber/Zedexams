/**
 * `quizzes/{id}` + its `questions` subcollection → the canonical assessment.
 *
 * Serves BOTH quiz sources: `/quiz/:quizId` (learner quizzes) and
 * `/papers/:paperId/quiz` (past-paper quizzes). They read the same two
 * collections through different service functions and differ only in how the
 * consumer treats the result — the past-paper route persists nothing — so one
 * adapter is correct and two would be a fork waiting to happen. `source` tells
 * them apart for anything downstream that must care.
 *
 * ## It delegates, it does not re-derive
 *
 * `coerceQuestion` (`src/editor/schema/question.js`) is the existing read-side
 * normaliser for this exact shape: it folds type aliases, clamps marks through
 * the shared `normalizeMarks`, and defends `tolerance` / `correctRegion` /
 * `images` against corrupt documents. Re-implementing any of that here would
 * create the second copy this whole phase exists to remove. This adapter's job
 * is only to MAP its output onto the canonical model.
 *
 * It loads under plain `node` (zod plus two pure utils, no TipTap), which is
 * what makes delegating to it compatible with the engine being node-testable.
 */
import { coerceQuestion } from '../../../editor/schema/question.js'
import { toRichContent, ASSESSMENT_SCHEMA_VERSION } from '../schemas/index.js'

/** Marks a question is worth, after the shared clamp `coerceQuestion` applies. */
const marksOf = (q) => q.marks

/**
 * The answer POSITION for a choice question, or null.
 *
 * The quiz shape already stores an index, so this is mostly a validity check:
 * an index pointing past the end of the options is a corrupt document, and
 * returning it unchanged would put the engine in a state no renderer can draw.
 */
function correctIndexOf(question) {
  const raw = question.correctAnswer
  if (!Number.isInteger(raw) || raw < 0) return null
  if (!Array.isArray(question.options) || raw >= question.options.length) return null
  return raw
}

/**
 * Everything type-specific that is NOT the choice index.
 *
 * Passed through untouched. The grading modules (`numericGrading`,
 * `hotspotGrading`, `fillBlanks`, `diagramLabelGrading`, `matchingGrading`,
 * `sequenceGrading`) already own these shapes and are the authority on them;
 * reshaping here would fork the answer key from the code that reads it.
 */
function answerKeyOf(question) {
  const key = {}
  for (const field of [
    'correctAnswer', 'tolerance', 'correctRegion',
    'blanks', 'labels', 'matchingAnswer', 'sequenceAnswer',
  ]) {
    if (question[field] !== undefined) key[field] = question[field]
  }
  return key
}

/** Topic tags, always an array of non-empty strings. */
function topicIdsOf(question) {
  const topic = question.topic
  if (typeof topic === 'string' && topic.trim()) return [topic.trim()]
  return []
}

function normaliseQuestion(raw, index) {
  const q = coerceQuestion(raw)
  if (!q) return null
  return {
    // A stored question always has a document id; the positional fallback
    // covers an in-memory question the editor has not saved yet, which the
    // preview path can hand us.
    id: String(raw?.id ?? q.id ?? `q${index + 1}`),
    type: q.type,
    prompt: toRichContent(q.text ?? raw?.text ?? ''),
    marks: marksOf(q),
    options: (q.options || []).map((o) => toRichContent(o)),
    correctIndex: correctIndexOf(q),
    answerKey: answerKeyOf(q),
    topicIds: topicIdsOf(q),
  }
}

/**
 * @param {object} input
 * @param {object} input.quiz       the `quizzes/{id}` document
 * @param {Array}  input.questions  its ordered `questions` subcollection
 * @param {'quiz'|'pastPaperQuiz'} input.source
 * @param {boolean} [input.timed]   exam mode; the quiz's own duration is used
 */
export function fromQuiz({ quiz, questions, source, timed = false }) {
  const list = Array.isArray(questions) ? questions : []
  const normalised = list.map(normaliseQuestion).filter(Boolean)

  // Total marks are SUMMED from the questions rather than read from
  // `quiz.totalMarks`. The stored field is authored by hand and drifts from the
  // questions it describes; the sum is what any scorer will actually divide by,
  // so a header that disagrees with its own paper must not become the engine's
  // idea of the total.
  const totalMarks = normalised.reduce((sum, q) => sum + q.marks, 0)

  const duration = Number(quiz?.duration ?? quiz?.durationMinutes)
  const durationMinutes = Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null

  return {
    schemaVersion: ASSESSMENT_SCHEMA_VERSION,
    source,
    id: String(quiz?.id ?? ''),
    title: String(quiz?.title ?? ''),
    subject: String(quiz?.subject ?? ''),
    // Grade stays the STRING the quiz path stores. The `scores` collection
    // holds a Number by documented, deliberate divergence (gamesService.js);
    // the two must not be normalised toward each other.
    grade: String(quiz?.grade ?? ''),
    totalMarks,
    settings: {
      timed: Boolean(timed),
      durationMinutes,
      shuffleQuestions: quiz?.shuffleQuestions === true,
      shuffleOptions: quiz?.shuffleOptions === true,
      // A quiz attempt is resumable (localStorage today); a past-paper preview
      // is not, because it persists nothing to resume FROM.
      allowResume: source === 'quiz',
      showResults: true,
    },
    questions: normalised,
  }
}
