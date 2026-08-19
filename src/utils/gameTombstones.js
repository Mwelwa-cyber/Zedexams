/**
 * gameTombstones — the record that an admin deliberately deleted a game.
 *
 * ── Why this collection has to exist ────────────────────────────────────
 *
 * The learner side does not read `games` and stop. Three surfaces fall
 * back to the BUNDLED seed (`src/data/gamesSeed.js`) when a live doc is
 * missing, and each has a good reason to:
 *
 *   • `GamesHub` — `buildCatalogue` fills a mechanic's row from the seed
 *     pack when Firestore has none, so the hub works before anything is
 *     seeded and during a Firestore outage.
 *   • `PlayGame` — falls back to the seed doc by id, which is what makes
 *     those seed-backed cards playable.
 *   • `dailyChallengeService` — rotates over the seed when the live list
 *     is empty or unreadable.
 *
 * The seed is compiled into the app bundle, so deleting `games/{id}` from
 * Firestore does not remove the game from any of those three. Without a
 * record of the deletion, a permanently deleted game would keep appearing
 * on the hub and stay launchable through a direct `/games/play/:id` link —
 * a deletion that deletes nothing a learner can see.
 *
 * A tombstone is that record. It is deliberately a SEPARATE collection
 * from `games`, because the requirement is that the game document is
 * really gone (an admin reading the Firestore console must not find a
 * "deleted" game sitting in `games`), while the DECISION survives.
 *
 * It carries `gameId`, `title`, `type`, `grade` and `subject` for a second
 * reason: `scores` rows store only `gameId`/`grade`/`subject` (that field
 * set is pinned by `gameScorePayload.js` and validated in the rules, so it
 * is not a place to add a title), and this is where a historical row can
 * still resolve what it was a score IN.
 *
 * ── Failure posture: fail OPEN, on purpose ──────────────────────────────
 *
 * If this read fails, the seed fallback is left alone and a deleted game
 * may briefly reappear as a bundled card. That is the right way round: the
 * Firestore document really is deleted, so nothing here is a security or
 * privacy boundary — it is a suppression list over content that already
 * ships in every user's bundle. Failing CLOSED would mean an unreadable
 * collection emptying the games hub during an outage, which is the exact
 * failure the seed fallback exists to prevent.
 */

import { collection, getDocs } from 'firebase/firestore'
import { db } from '../firebase/config'
import { describeFirestoreReadError, withFirestoreReadTimeout } from './firestoreTimeout'

const EMPTY = Object.freeze(new Set())

// One read per page load, shared by every caller. The list changes only
// when an admin deletes a game, so a per-session cache is generous.
let cache = null

/**
 * The set of game ids an admin has permanently deleted.
 * Never throws; returns an empty set when the collection cannot be read.
 *
 * @returns {Promise<Set<string>>}
 */
export function loadDeletedGameIds() {
  if (cache) return cache
  cache = (async () => {
    try {
      const snap = await withFirestoreReadTimeout(
        getDocs(collection(db, 'gameTombstones')),
        'deleted games',
      )
      return new Set(snap.docs.map((d) => d.id))
    } catch (err) {
      console.warn(
        'loadDeletedGameIds: could not read gameTombstones — the bundled seed fallback is left unfiltered',
        describeFirestoreReadError(err),
      )
      return EMPTY
    }
  })()
  return cache
}

/**
 * Drop the cache. Called by the admin importer after it deletes or
 * re-imports a game so the same tab does not keep answering from a list
 * taken before the change.
 */
export function resetDeletedGameCache() {
  cache = null
}

/** Pure: is this game on the deleted list? Safe with a null/undefined set. */
export function isDeletedGame(id, deletedIds) {
  if (!id || !deletedIds) return false
  return deletedIds.has(id)
}
