/**
 * src/features/dailyQuiz/services/dailyQuizService.js
 *
 * THE ONE CLIENT READ PATH for the daily quiz.
 *
 * Every surface that shows the daily quiz — Home's card, the runner, the
 * weekly board — comes through here, and nothing anywhere reads the
 * `dailyQuizzes` collection directly. It could not, in fact:
 * `firestore.rules` denies every client read of it, so this module and the
 * `getTodaysQuiz` callable behind it are the only way in.
 *
 * That closure is the whole point. The bug this feature replaces was two
 * readers of one daily quiz, one of them not grade-filtered — Home reported
 * "no quiz today" while another surface served a Grade 4 quiz to a Grade 6
 * learner. Two readers of one collection will always drift; the fix is not
 * to make the second one careful, it is to delete it.
 *
 * The learner's GRADE is never sent. The server reads it from their profile,
 * because a client-supplied grade is exactly how a learner ends up on
 * another grade's quiz.
 */
import { getFunctions, httpsCallable } from 'firebase/functions'
import {
  collection, doc, getDoc, getDocs, query, orderBy, limit,
} from 'firebase/firestore'
import app, { db } from '../../../firebase/config'
// Re-exported, never re-implemented — see the mirror note on weekIdFor.
export { weekIdFor } from '../lib/dailyQuizCore'

// Same region as every other callable in the project (functions/index.js).
const fns = getFunctions(app, 'us-central1')

const getTodaysQuizCallable = httpsCallable(fns, 'getTodaysQuiz')
const answerCallable = httpsCallable(fns, 'answerDailyQuizQuestion')

/**
 * Today's quiz for the signed-in learner.
 *
 * Returns `{ date, grade, ranked, questions, alreadyPlayed, result, ... }`.
 * The questions carry NO answer key — correct answers stay on the server
 * until the attempt has been marked.
 *
 * The server self-heals a missing document, so a successful call always
 * carries either a ranked quiz or a labelled practice set. A THROW here
 * means the call itself failed, which the card renders as "we could not
 * load it" — never as "there is no quiz".
 */
export async function getTodaysQuiz() {
  const res = await getTodaysQuizCallable()
  return res?.data || null
}

/**
 * Record ONE answer and get the feedback for it.
 *
 * A SCORE IS NEVER SENT — only the chosen option. The server marks it
 * against a key this client has never seen, so there is nothing here to
 * forge, and it returns the verdict plus the one-line explanation for that
 * question alone. Nothing about the other four comes back until they are
 * answered too.
 *
 * The attempt FINALISES on the last answer: the response then also carries
 * `finalised: true` and the whole `result`, so there is no separate submit
 * call to lose halfway through.
 */
export async function answerDailyQuizQuestion({ questionId, chosen, elapsedMs }) {
  const res = await answerCallable({ questionId, chosen, elapsedMs })
  return res?.data || null
}

/**
 * The weekly leaderboard for a grade.
 *
 * This one IS a direct Firestore read, and deliberately: leaderboard entries
 * are a public ranking carrying only a display name and a score, the rules
 * scope them to the learner's own grade, and routing a board refresh through
 * a callable would cost a cold start for data that is already safe to read.
 * The daily quiz DOCUMENT is what must never be client-readable — not the
 * board derived from attempts against it.
 */
export async function getWeeklyBoard({ grade, weekId, max = 50 }) {
  if (!grade || !weekId) return []
  const snap = await getDocs(query(
    collection(db, 'leaderboards', String(grade), 'weeks', String(weekId), 'entries'),
    orderBy('points', 'desc'),
    limit(max),
  ))
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }))
}

/** The signed-in learner's own row, for the "you" line under the top five. */
export async function getMyWeekEntry({ grade, weekId, uid }) {
  if (!grade || !weekId || !uid) return null
  const snap = await getDoc(
    doc(db, 'leaderboards', String(grade), 'weeks', String(weekId), 'entries', String(uid)),
  )
  return snap.exists() ? { uid: snap.id, ...snap.data() } : null
}
