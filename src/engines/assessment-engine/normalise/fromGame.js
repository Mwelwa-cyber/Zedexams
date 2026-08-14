/**
 * A `games/{id}` document of type `timed_quiz` → the canonical assessment.
 *
 * This is the adapter with real work in it, because the games shape is the one
 * that shares nothing with the other two:
 *
 *   • **Questions are INLINE** on the game document as
 *     `{ question, options, answer }`, not a subcollection. §4.1 note 1 freezes
 *     the subcollection shape for *assessments*; `games` is a different
 *     collection with its own history and is not being migrated.
 *
 *   • **`answer` is the option's VALUE, not its index** — `'42'`, not `2`. The
 *     canonical model carries a position, so resolving it is this adapter's
 *     central job. `timedQuizCore.correctIndexFor` already does exactly this
 *     comparison, string-to-string, "because game docs store answers loosely",
 *     and that looseness is real: a question can hold `7` while its option
 *     holds `'7'`. The same comparison is used here rather than a stricter one,
 *     because a stricter comparison would silently mark correct answers wrong
 *     on documents that work today.
 *
 *   • **An unresolvable answer yields `correctIndex: null`**, never `-1`.
 *     `findIndex` returns -1 for "no match", and -1 flowing into the model as
 *     an index is the kind of value that reads as data until something uses it
 *     to subscript an array. Null says "unknown" in a way a renderer must
 *     handle deliberately.
 *
 *   • **The answer key is the GRADER's shape, not the document's.** This
 *     shipped carrying `{ answer: <the raw stored value> }`, on the reasoning
 *     that a consumer might want to see what the document said. Nothing ever
 *     did, and `answerKey` is not a place to keep source trivia: it is spread
 *     into `projectForScoring` and handed to `computeQuizScore`, which grades
 *     `mcq` by strict equality against `correctAnswer`. A key with no
 *     `correctAnswer` in it does not throw — the scorer compares the learner's
 *     index to `undefined`, every answer marks wrong, and (worse) an
 *     UNANSWERED question also compares `undefined === undefined` and marks
 *     RIGHT. So the engine scored a `timed_quiz` round as the exact inverse of
 *     the truth, silently. Found by the games cutover's replay comparison
 *     (`scripts/replay/replayGameRound.test.js`), which is what it is for; it
 *     is the same defect class `answerKeyCoverage.test.js` was written for
 *     after #2120 — "a grader reads a question field the normaliser drops."
 *
 * Only `timed_quiz` is in scope: seven of the eight game engines are mechanics
 * (memory match, word builder, province shapes, …) with no question to ask.
 */
import { toRichContent, ASSESSMENT_SCHEMA_VERSION } from '../schemas/index.js'

/** Games award one mark per question — there is no per-question marks field. */
const GAME_MARKS_PER_QUESTION = 1

/**
 * Resolve `answer` (a value) to a position, matching `timedQuizCore`'s rule.
 * Returns null rather than -1 when nothing matches.
 */
export function resolveGameCorrectIndex(question) {
  const options = Array.isArray(question?.options) ? question.options : []
  const index = options.findIndex((o) => String(o) === String(question?.answer))
  return index >= 0 ? index : null
}

function normaliseQuestion(raw, index) {
  const options = Array.isArray(raw?.options) ? raw.options : []
  const correctIndex = resolveGameCorrectIndex(raw)
  return {
    // Game questions carry no id — position IS their identity, and it is stable
    // for the life of the document. Prefixed so it can never collide with a
    // Firestore document id from another source in a shared cache.
    id: `game-q${index + 1}`,
    // Every timed_quiz item is a choice question. The vocabulary is the shared
    // package's; 'mcq' is its canonical name for this.
    type: 'mcq',
    // Stringified before wrapping: a game may store a numeric prompt or option,
    // and getRichPlainText returns '' for a number, which would blank it.
    prompt: toRichContent(String(raw?.question ?? '')),
    marks: GAME_MARKS_PER_QUESTION,
    options: options.map((o) => toRichContent(String(o ?? ''))),
    correctIndex,
    // `correctAnswer` is the field `computeQuizScore` grades `mcq` on, and the
    // resolved POSITION is what it must hold — the learner's response is an
    // option index, so a key holding the stored value ('42') would never equal
    // one. It is omitted entirely rather than set to null when the answer could
    // not be resolved: `answer === null` would mark an unanswered question
    // correct, and an absent key marks everything wrong, which is the honest
    // reading of a document that does not say what the answer is. The engine
    // refuses such a round at the cutover before a learner ever meets it.
    answerKey: correctIndex === null ? {} : { correctAnswer: correctIndex },
    topicIds: typeof raw?.topic === 'string' && raw.topic.trim() ? [raw.topic.trim()] : [],
  }
}

/**
 * @param {object} input
 * @param {object} input.game  a `games/{id}` document with `type: 'timed_quiz'`
 */
export function fromGame({ game }) {
  const list = Array.isArray(game?.questions) ? game.questions : []
  const questions = list.map(normaliseQuestion)

  // The round timer is a game mechanic (seconds, counting down over the whole
  // round), not a paper's duration in minutes. It is deliberately NOT mapped
  // onto durationMinutes: rounding 60 seconds to "1 minute" would let a
  // consumer show a learner a minute-granularity clock for a second-granularity
  // game. The engine reports the game as timed with no paper duration, and the
  // game chrome keeps owning its own countdown.
  return {
    schemaVersion: ASSESSMENT_SCHEMA_VERSION,
    source: 'game',
    id: String(game?.id ?? ''),
    title: String(game?.title ?? game?.name ?? ''),
    // Games store subject lowercased and grade as a Number — a documented,
    // deliberate divergence (gamesService.js:132-139) that every games read
    // query depends on. They are carried through as STRINGS here because the
    // model's fields are strings, and this conversion is one-way: nothing in
    // the engine writes back to `games` or to `scores`.
    subject: String(game?.subject ?? ''),
    grade: String(game?.grade ?? ''),
    totalMarks: questions.length * GAME_MARKS_PER_QUESTION,
    settings: {
      timed: true,
      durationMinutes: null,
      // The deck is shuffled by the game engine, per round, via
      // gamesService.shuffle — recorded here as intent, not re-implemented.
      shuffleQuestions: true,
      shuffleOptions: false,
      allowResume: false,
      showResults: true,
    },
    questions,
  }
}
