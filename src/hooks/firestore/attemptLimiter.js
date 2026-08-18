/**
 * The free-plan daily attempt limiter.
 *
 * ## Why this is its own module
 *
 * `useSubscription` needs exactly this one function and nothing else from the
 * Firestore layer. While it lived inside `useFirestore`, importing it pulled
 * the whole 55-method surface — and with it the quiz write schema, the question
 * schema and the payment plan table — into the EAGER app shell, because
 * `useSubscription` is reached from `App.jsx` through the subscription front
 * door and `Navbar`. Measured on the 2026-08-18 production build: the shell
 * carried `useFirestore` (8.7 kB gz), `question` (3.3 kB gz) and `quiz`
 * (1.2 kB gz) for a function whose entire dependency set is four Firestore
 * primitives.
 *
 * So this is not a tidying split. The module boundary is what keeps the
 * learner's first paint from downloading the authoring schemas, and a future
 * import of `useFirestore` from here would silently put them back.
 *
 * The body is unchanged from the one that lived in `useFirestore`.
 */
import { doc, getDoc, updateDoc, increment } from 'firebase/firestore'
import { db } from '../../firebase/config'

/**
 * Consume one of today's free attempts, if any remain.
 *
 * Premium accounts short-circuit before any read. A missing user document is
 * refused rather than defaulted, because a learner with no profile has no
 * quota to draw against.
 *
 * @param {string} userId
 * @param {boolean} isPremium
 * @param {number} dailyLimit
 * @returns {Promise<{allowed: boolean, attemptsToday: number, limit: number}>}
 */
export async function checkAndConsumeAttempt(userId, isPremium, dailyLimit) {
  if (isPremium) return { allowed: true, attemptsToday: 0, limit: Infinity }
  const ref  = doc(db, 'users', userId)
  const snap = await getDoc(ref)
  if (!snap.exists()) return { allowed: false, attemptsToday: 0, limit: dailyLimit }
  const data      = snap.data()
  const today     = new Date().toISOString().slice(0, 10)
  const isNewDay  = data.lastAttemptDate !== today
  const used      = isNewDay ? 0 : (data.dailyAttempts ?? 0)
  if (used >= dailyLimit) return { allowed: false, attemptsToday: used, limit: dailyLimit }
  await updateDoc(ref, { dailyAttempts: isNewDay ? 1 : increment(1), lastAttemptDate: today })
  return { allowed: true, attemptsToday: used + 1, limit: dailyLimit }
}
