/**
 * Daily Challenge service.
 *
 * Picks one featured game per calendar day (UTC) and tracks a per-user
 * streak counter that increments each consecutive day the student completes
 * the challenge.
 *
 * Both sources are scoped to a GRADE when the caller passes one, and every
 * learner-facing caller does. See `getTodaysChallenge` for why there is no
 * cross-grade fallback anywhere in this file.
 *
 * Two sources decide today's game, in this order:
 *
 *   1. Firestore: /daily_challenges/{YYYY-MM-DD} (admin-curated override).
 *      If a doc exists and it is the right grade, its `gameId` is used.
 *
 *   2. Deterministic rotation over the `games` collection, filtered to the
 *      grade in the query. Every learner in a grade sees the same pick on
 *      the same UTC day. A fresh deploy rotates through that grade's
 *      catalogue in a loop.
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

/** Does this game doc belong to the grade being asked for? */
function matchesGrade(game, grade) {
  if (grade == null) return true
  return Number(game?.grade) === Number(grade)
}

/**
 * Load today's challenge game.
 *
 * Returns { game, source, dateId, grade } where source is
 * 'firestore-override', 'rotation', or 'none' when the grade has no quiz
 * today. `game` is null in that last case.
 *
 * ── The grade scope is the whole point of the options bag ───────────────
 *
 * Without `grade` this rotated over EVERY active game in the collection, so
 * a Grade 7 learner's hub offered them a Grade 3 quiz and labelled it
 * honestly — "TODAY'S QUIZ · GRADE 3" — right beside a live-challenge card
 * reading "Grade 7". Both the label and the quiz came from here.
 *
 * The filter is applied IN THE QUERY (`where('grade','==',grade)`), not to
 * the results: a client-side filter over a collection-wide read is one
 * `slice` away from silently going missing, and the rules already let any
 * signed-out visitor read the collection, so scoping at the source is also
 * what stops the rotation drifting the day another grade is seeded.
 *
 * There is NO cross-grade fallback anywhere in this function. A grade with
 * no quiz today returns `{ game: null }` and the caller renders its empty
 * state. Handing back another grade's quiz is the bug, not the graceful
 * degradation — a learner cannot tell the difference and their streak would
 * be counted against a game they were never meant to be given.
 *
 * @param {object}  [options]
 * @param {number}  [options.grade]  scope the day's pick to this grade.
 *                                   Omitted → unscoped (the pre-2026-08-19
 *                                   behaviour), kept for callers that
 *                                   genuinely have no learner in hand.
 */
export async function getTodaysChallenge({ grade = null } = {}) {
  const dateId = todaysDateId()
  let liveReadsTimedOut = false

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
          const game = { id: gameSnap.id, ...gameSnap.data() }
          // An admin curates ONE override per day, for whichever grade they
          // had in mind. It is not authority to serve that grade's quiz to
          // every other grade, so an override for someone else's grade is
          // passed over and the rotation answers instead.
          if (matchesGrade(game, grade)) {
            return { game, source: 'firestore-override', dateId, grade }
          }
          console.info(
            `getTodaysChallenge: override ${gameId} is grade ${game.grade}, not ${grade} — falling through to the rotation`,
          )
        }
      }
    }
  } catch (err) {
    liveReadsTimedOut = isFirestoreReadTimeout(err)
    console.warn('getTodaysChallenge: override lookup failed', describeFirestoreReadError(err))
  }

  // 2. Rotation over published games, scoped to the grade in the query.
  let available = []
  if (!liveReadsTimedOut) {
    try {
      const constraints = [where('active', '==', true)]
      if (grade != null) constraints.push(where('grade', '==', Number(grade)))
      const snap = await withFirestoreReadTimeout(
        getDocs(query(collection(db, 'games'), ...constraints)),
        "today's challenge games list",
      )
      available = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    } catch (err) {
      console.warn('getTodaysChallenge: games list failed — using seed', describeFirestoreReadError(err))
    }
  }

  // Fallback to bundled seed when live reads are unavailable. Respect the
  // `active` flag so deactivated/out-of-scope seed entries are never chosen
  // as the daily challenge — and the grade scope, which the seed has to
  // honour for the same reason the query does.
  if (!available.length) {
    available = GAMES_SEED.filter((g) => g.active !== false && matchesGrade(g, grade))
  }

  // A retired mechanic must never be the daily pick — a live doc can still
  // carry one after the 2026-08 redesign retired its engine (step 4).
  available = available.filter((g) => !RETIRED_GAME_TYPES.has(g?.type))

  // No quiz for this grade today. Say so; never widen the search.
  if (!available.length) return { game: null, source: 'none', dateId, grade }

  // Deterministic pick keyed by the UTC date integer
  const idx = ((dateKeyToInt(dateId) % available.length) + available.length) % available.length
  available.sort((a, b) => (a.id || '').localeCompare(b.id || '')) // stable order
  return { game: available[idx], source: 'rotation', dateId, grade }
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
