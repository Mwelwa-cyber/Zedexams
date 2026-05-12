/**
 * Game Badges Firestore service.
 *
 * Document path:  /badges/{userId}
 * Shape:
 *   {
 *     gameBadges: {
 *       [badgeId]: {
 *         awardedAt,
 *         awardedFor: { gameId, gameTitle, score, bestStreak, accuracy }
 *       },
 *       ...
 *     }
 *   }
 *
 * Firestore rules allow a signed-in user to create/update their own badges
 * doc; reads are owner-or-admin.
 */

import {
  doc, getDoc, setDoc, collection, getDocs, query, where,
  Timestamp,
} from 'firebase/firestore'
import { db, auth } from '../firebase/config'
import { evaluateGameBadges } from '../data/gameBadges'

/** Load the current user's earned game badges.  Returns { byId, loading: false }. */
export async function getMyGameBadges() {
  const user = auth.currentUser
  if (!user) return { byId: {}, userId: null }
  try {
    const snap = await getDoc(doc(db, 'badges', user.uid))
    if (!snap.exists()) return { byId: {}, userId: user.uid }
    const data = snap.data() || {}
    return { byId: data.gameBadges || {}, userId: user.uid }
  } catch (err) {
    console.warn('getMyGameBadges failed', err)
    return { byId: {}, userId: user.uid }
  }
}

/**
 * After a game round finishes, evaluate + award any newly-earned badges.
 * Returns the list of badges that were newly added (for the toast UI).
 *
 * ctx should include: game, score, correct, wrong, accuracy, bestStreak
 */
export async function evaluateAndAwardGameBadges(ctx) {
  const user = auth.currentUser
  if (!user) return { newlyEarned: [], skipped: 'not_signed_in' }

  // 1. Pull cross-play context: subjects played + total plays count.
  const history = await _getUserScoresLight(user.uid)
  const subjectsPlayed = new Set(history.map((s) => s.subject).filter(Boolean))
  if (ctx.game?.subject) subjectsPlayed.add(ctx.game.subject)
  const playsCount = history.length + 1 // include the one we just saved

  const enrichedCtx = { ...ctx, subjectsPlayed, playsCount }

  // 2. Load existing badges so we only toast NEW ones.
  const existing = await getMyGameBadges()
  const alreadyIds = new Set(Object.keys(existing.byId))

  // 3. Evaluate.
  const { newlyEarned } = evaluateGameBadges(enrichedCtx, alreadyIds)
  if (newlyEarned.length === 0) return { newlyEarned: [] }

  // 4. Write new badges to Firestore (merge into existing doc).
  const updates = { gameBadges: { ...existing.byId } }
  const awardedFor = {
    gameId: ctx.game?.id || null,
    gameTitle: ctx.game?.title || null,
    score: Number(ctx.score) || 0,
    bestStreak: Number(ctx.bestStreak) || 0,
    accuracy: Number(ctx.accuracy) || 0,
  }
  for (const badge of newlyEarned) {
    updates.gameBadges[badge.id] = {
      awardedAt: Timestamp.now(),
      awardedFor,
    }
  }
  try {
    await setDoc(doc(db, 'badges', user.uid), updates, { merge: true })
  } catch (err) {
    console.warn('saving badges failed', err)
    return { newlyEarned: [], error: err?.code || 'write_failed' }
  }

  return { newlyEarned }
}

/**
 * Internal: fetch a lightweight version of the user's score history —
 * just enough to compute subjects played and total plays count.
 * Cap at 200 to keep costs bounded.
 */
async function _getUserScoresLight(userId) {
  try {
    const snap = await getDocs(query(
      collection(db, 'scores'),
      where('userId', '==', userId),
    ))
    return snap.docs.map((d) => {
      const x = d.data()
      return { subject: x.subject, gameId: x.gameId }
    })
  } catch (err) {
    console.warn('_getUserScoresLight failed', err)
    return []
  }
}

/** Format a badge's awarded timestamp for display. */
export function formatAwardedAt(ts) {
  if (!ts) return ''
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleDateString('en-ZM', { year: 'numeric', month: 'short', day: 'numeric' })
}
