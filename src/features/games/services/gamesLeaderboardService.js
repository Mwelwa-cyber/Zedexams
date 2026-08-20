/**
 * src/features/games/services/gamesLeaderboardService.js
 *
 * The ONE client read path for the games weekly board.
 *
 *   gamesLeaderboards/{grade}/weeks/{weekId}/entries/{uid}
 *
 * Reads only. Nothing in this file writes, and there is no export that
 * could: the board is maintained by the `gameScoreOnCreate` trigger, and
 * `firestore.rules` denies every client write to the path in both
 * directions. **Viewing a leaderboard must never write data** — the old
 * board was read-only too, and that property is worth keeping deliberately
 * rather than by accident.
 *
 * ── Why these queries and not others ─────────────────────────────────────
 *
 * The board this replaces subscribed to `scores` with `orderBy('score')` and
 * no filter — every score row ever written, ordered, live. Everything here
 * is scoped to ONE grade and ONE week before it asks for anything, so the
 * working set is a class-sized subcollection rather than the product's
 * entire play history.
 *
 * Only `orderBy('points')` is used, which Firestore serves from the
 * automatic single-field index. There is no composite index to deploy and
 * therefore no window where the page is broken because an index is still
 * building — the ordering WITHIN a tie is applied on the client by
 * `compareEntries`, over at most one page of rows.
 */

import {
  collection, doc, getDoc, getDocs, getCountFromServer,
  limit as fsLimit, onSnapshot, orderBy, query, where,
} from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { BOARD_PAGE_SIZE } from '../lib/gamesLeaderboardCore'

const COLLECTION = 'gamesLeaderboards'

function entriesRef(grade, weekId) {
  return collection(db, COLLECTION, String(grade), 'weeks', String(weekId), 'entries')
}

/**
 * Live top-N for a grade's week.
 *
 * A LISTENER rather than a one-shot read, and it is a cheap one: at most
 * `BOARD_PAGE_SIZE` documents in one grade's week, versus the old board's
 * open subscription to the whole `scores` collection. It earns its keep on
 * the one flow the product promises — finish today's challenge, tap "See the
 * leaderboard", watch the points land — where the trigger typically arrives
 * a moment AFTER the page does. A one-shot read would show the learner a
 * stale number and no reason to think it was stale.
 *
 * `onUpdate` is called with `{ entries, error }`. An error yields
 * `entries: null`, never `[]` — the distinction is the difference between
 * "nobody has played" and "we could not find out", and the page renders
 * those differently.
 */
export function subscribeToWeeklyBoard({ grade, weekId, max = BOARD_PAGE_SIZE }, onUpdate) {
  if (!grade || !weekId) {
    onUpdate({ entries: [], error: null })
    return () => {}
  }
  const q = query(entriesRef(grade, weekId), orderBy('points', 'desc'), fsLimit(max))
  return onSnapshot(
    q,
    (snap) => onUpdate({ entries: snap.docs.map((d) => ({ uid: d.id, ...d.data() })), error: null }),
    (err) => {
      console.warn('games weekly board subscription failed', err?.code || err?.message)
      onUpdate({ entries: null, error: err })
    },
  )
}

/**
 * Live view of the learner's OWN row.
 *
 * A second listener, on one document, and it is not redundant with the query
 * above. A learner outside the top N is not in that result at all, so
 * without this their header would read "—" while the board showed everyone
 * else's live points. One document is the cheapest listener Firestore has.
 */
export function subscribeToMyWeekEntry({ grade, weekId, uid }, onUpdate) {
  if (!grade || !weekId || !uid) {
    onUpdate({ entry: null, error: null })
    return () => {}
  }
  const ref = doc(db, COLLECTION, String(grade), 'weeks', String(weekId), 'entries', String(uid))
  return onSnapshot(
    ref,
    (snap) => onUpdate({ entry: snap.exists() ? { uid: snap.id, ...snap.data() } : null, error: null }),
    (err) => {
      console.warn('games weekly own-entry subscription failed', err?.code || err?.message)
      onUpdate({ entry: null, error: err })
    },
  )
}

/**
 * The learner's competition rank, WITHOUT reading the grade.
 *
 * `1 + count(points > mine)` — a Firestore aggregate query, billed at a
 * fraction of a document read regardless of how many learners it counts.
 * This is the answer to "do not render all 47 learners merely to show the
 * learner where they rank": rank 47 costs the same single count query as
 * rank 4.
 *
 * It is competition ranking by construction, which is why the page's
 * in-list ranks use the same rule — see `compareEntries` in the core. A
 * failure returns null and the header shows an em dash; a GUESSED rank is
 * worse than an absent one, because the learner has no way to tell.
 */
export async function getMyWeeklyRank({ grade, weekId, points }) {
  const mine = Number(points)
  if (!grade || !weekId || !Number.isFinite(mine)) return null
  try {
    const q = query(entriesRef(grade, weekId), where('points', '>', mine))
    const snap = await getCountFromServer(q)
    return (snap.data().count || 0) + 1
  } catch (err) {
    console.warn('games weekly rank count failed', err?.code || err?.message)
    return null
  }
}

/**
 * Last week's entries — enough of them to break a tie the same way the live
 * board would have.
 *
 * Five, not one. `orderBy('points')` alone cannot express the tie-break, so
 * asking Firestore for the single top row would hand back an arbitrary
 * choice among equals; five rows is a rounding error in cost and lets
 * `resolveLastWeekWinner` apply the real comparator.
 *
 * There is no archive and nothing to prune: last week's board is last week's
 * path, still there, because a new week writes to a new document rather than
 * clearing the old one. That is the whole of "persist enough historical
 * information to identify the previous week's winner" — no duplicate data,
 * no scheduled snapshot to go wrong.
 */
export async function getLastWeekTop({ grade, weekId, max = 5 }) {
  if (!grade || !weekId) return []
  try {
    const snap = await getDocs(query(entriesRef(grade, weekId), orderBy('points', 'desc'), fsLimit(max)))
    return snap.docs.map((d) => ({ uid: d.id, ...d.data() }))
  } catch (err) {
    // Advisory only — a missing crown must never take the board down with
    // it, so this is the one read here that resolves to a value on failure.
    console.warn('games last-week winner read failed', err?.code || err?.message)
    return []
  }
}

/**
 * One-shot read of the learner's own row — for callers that want the number
 * once rather than a subscription (tests, and any future summary card).
 */
export async function getMyWeekEntry({ grade, weekId, uid }) {
  if (!grade || !weekId || !uid) return null
  const snap = await getDoc(
    doc(db, COLLECTION, String(grade), 'weeks', String(weekId), 'entries', String(uid)),
  )
  return snap.exists() ? { uid: snap.id, ...snap.data() } : null
}
