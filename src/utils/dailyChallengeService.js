/**
 * Daily Challenge service.
 *
 * Picks one featured game per calendar day (UTC) and tracks a per-user
 * streak counter that increments each consecutive day the student completes
 * the challenge.
 *
 * Two sources decide today's game, in this order:
 *
 *   1. Firestore: /daily_challenges/{YYYY-MM-DD} (admin-curated override).
 *      If a doc exists, its `gameId` is used.
 *
 *   2. Deterministic rotation over the `games` collection. All users see
 *      the same pick on the same UTC day. A fresh deploy will rotate
 *      through the full catalogue in a loop.
 */

import {
  collection, doc, getDoc, getDocs, setDoc, Timestamp, where, query,
} from 'firebase/firestore'
import { db, auth } from '../firebase/config'
import { GAMES_SEED, RETIRED_GAME_TYPES } from '../data/gamesSeed'
import {
  describeFirestoreReadError,
  isFirestoreReadTimeout,
  withFirestoreReadTimeout,
} from './firestoreTimeout'

/** Today's challenge date key in YYYY-MM-DD (UTC). */
export function todaysDateId(d = new Date()) {
  return d.toISOString().slice(0, 10)
}

/** Yesterday's date key — used to detect if a streak continues. */
export function yesterdaysDateId(d = new Date()) {
  const y = new Date(d.getTime() - 86400000)
  return y.toISOString().slice(0, 10)
}

/** Convert a YYYY-MM-DD key to a stable integer (days since epoch). */
function dateKeyToInt(dateId) {
  const [y, m, d] = dateId.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000)
}

/**
 * Load today's challenge game. Returns { game, source } where source is
 * 'firestore-override' or 'rotation'.
 */
export async function getTodaysChallenge({ grade = null } = {}) {
  const dateId = todaysDateId()
  let liveReadsTimedOut = false
  // A learner's grade scopes the pick AT THE QUERY, not after it. Without
  // this the rotation ran over every active game in every grade and the
  // hub told a Grade 7 learner "TODAY'S QUIZ · GRADE 3". `grade == null`
  // means signed out on the public hub — there is no grade to scope to,
  // so the unscoped rotation is correct there and only there.
  const scoped = Number.isFinite(Number(grade)) && Number(grade) > 0 ? Number(grade) : null
  const inGrade = (g) => scoped == null || Number(g?.grade) === scoped

  // 1. Firestore override?
  try {
    const snap = await withFirestoreReadTimeout(
      getDoc(doc(db, 'daily_challenges', dateId)),
      "today's challenge override",
    )
    if (snap.exists()) {
      const data = snap.data()
      const gameId = data.gameId
      if (gameId) {
        const gameSnap = await withFirestoreReadTimeout(
          getDoc(doc(db, 'games', gameId)),
          "today's challenge game",
        )
        if (gameSnap.exists()) {
          const overrideGame = { id: gameSnap.id, ...gameSnap.data() }
          // An override names one game id for a date; it carries no notion
          // of who is looking. Checked against the learner's grade rather
          // than trusted, so an override for another grade falls through
          // to the scoped rotation below instead of overriding the one
          // rule this screen exists to keep.
          if (inGrade(overrideGame)) {
            return {game: overrideGame, source: 'firestore-override', dateId}
          }
        }
      }
    }
  } catch (err) {
    liveReadsTimedOut = isFirestoreReadTimeout(err)
    console.warn('getTodaysChallenge: override lookup failed', describeFirestoreReadError(err))
  }

  // 2. Rotation over published games
  let available = []
  if (!liveReadsTimedOut) {
    try {
      const snap = await withFirestoreReadTimeout(
        getDocs(query(
          collection(db, 'games'),
          where('active', '==', true),
          // Two equality filters need no composite index.
          ...(scoped == null ? [] : [where('grade', '==', scoped)]),
        )),
        "today's challenge games list",
      )
      available = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    } catch (err) {
      console.warn('getTodaysChallenge: games list failed — using seed', describeFirestoreReadError(err))
    }
  }

  // Fallback to bundled seed when live reads are unavailable. Respect the
  // `active` flag so deactivated/out-of-scope seed entries are never chosen
  // as the daily challenge.
  if (!available.length) available = GAMES_SEED.filter((g) => g.active !== false && inGrade(g))

  // A retired mechanic must never be the daily pick — a live doc can still
  // carry one after the 2026-08 redesign retired its engine (step 4).
  available = available.filter((g) => !RETIRED_GAME_TYPES.has(g?.type))

  // Nothing in this learner's grade → say so. The caller renders the empty
  // state; it must never be handed another grade's quiz as a consolation,
  // which is the failure this whole change is about. Guarding here also
  // keeps the modulo below from dividing by zero.
  if (!available.length) return {game: null, source: 'none', dateId, grade: scoped}

  // Deterministic pick keyed by the UTC date integer
  const idx = ((dateKeyToInt(dateId) % available.length) + available.length) % available.length
  available.sort((a, b) => (a.id || '').localeCompare(b.id || '')) // stable order
  return { game: available[idx], source: 'rotation', dateId, grade: scoped }
}

/** Current user's streak state: { streak, longestStreak, lastPlayedDate }. */
export async function getMyStreak() {
  const user = auth.currentUser
  if (!user) return { streak: 0, longestStreak: 0, lastPlayedDate: null, signedIn: false }
  try {
    const snap = await getDoc(doc(db, 'dailyStreaks', user.uid))
    if (!snap.exists()) return { streak: 0, longestStreak: 0, lastPlayedDate: null, signedIn: true }
    const data = snap.data()
    return {
      streak:        Number(data.streak) || 0,
      longestStreak: Number(data.longestStreak) || 0,
      lastPlayedDate: data.lastPlayedDate || null,
      lastGameId:    data.lastGameId || null,
      signedIn: true,
    }
  } catch (err) {
    console.warn('getMyStreak failed', err)
    return { streak: 0, longestStreak: 0, lastPlayedDate: null, signedIn: true }
  }
}

/**
 * Call this after a signed-in user completes a game round. If the game IS
 * today's daily challenge, update their streak (+1 if they played yesterday
 * or it's their first day; reset to 1 otherwise). If it's not the daily,
 * does nothing.
 *
 * Returns { bumped, streak, longestStreak, isDaily, wasAlreadyCountedToday }.
 */
export async function recordDailyPlay({ gameId, dailyGameId }) {
  const user = auth.currentUser
  if (!user) return { skipped: 'not_signed_in' }
  if (!gameId || !dailyGameId) return { skipped: 'no_ids' }
  if (gameId !== dailyGameId) return { isDaily: false }

  const today = todaysDateId()
  const yesterday = yesterdaysDateId()

  const ref = doc(db, 'dailyStreaks', user.uid)
  let current = { streak: 0, longestStreak: 0, lastPlayedDate: null }
  try {
    const snap = await getDoc(ref)
    if (snap.exists()) current = { ...current, ...snap.data() }
  } catch (err) {
    console.warn('recordDailyPlay: read failed', err)
  }

  // Already counted today — don't double-count multiple plays in one day.
  if (current.lastPlayedDate === today) {
    return {
      isDaily: true,
      bumped: false,
      streak: current.streak,
      longestStreak: current.longestStreak,
      wasAlreadyCountedToday: true,
    }
  }

  // Compute new streak: continue if lastPlayedDate was yesterday, else reset to 1
  const continuing = current.lastPlayedDate === yesterday
  const newStreak = continuing ? (current.streak || 0) + 1 : 1
  const newLongest = Math.max(current.longestStreak || 0, newStreak)

  const payload = {
    streak: newStreak,
    longestStreak: newLongest,
    lastPlayedDate: today,
    lastGameId: gameId,
    updatedAt: Timestamp.now(),
  }
  try {
    await setDoc(ref, payload, { merge: true })
  } catch (err) {
    console.warn('recordDailyPlay: write failed', err)
    return { isDaily: true, bumped: false, error: err?.code || 'write_failed' }
  }
  return { isDaily: true, bumped: true, streak: newStreak, longestStreak: newLongest }
}
