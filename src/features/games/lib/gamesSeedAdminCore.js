/**
 * gamesSeedAdminCore — every decision the Games Seed Importer makes, as
 * rules rather than as JSX.
 *
 * Pure: no DOM, no React, no Firebase, no clock. Node-tested by
 * `gamesSeedAdminCore.test.js` (`npm run test:games-seed-admin`).
 *
 * ── The distinction the whole screen is built on ────────────────────────
 *
 * There are TWO catalogues and they are not the same thing:
 *
 *   • `src/data/gamesSeed.js` — the curated SEED, a bundled JS array. It
 *     ships in the app bundle, it is version-controlled, and nothing an
 *     admin does at runtime can change it.
 *   • `games/{id}` in Firestore — the LIVE records learners read.
 *
 * The importer copies the first into the second. Deleting a live record
 * therefore CANNOT delete the seed entry — the seed entry goes back to
 * reading "Not imported" and can be imported again. That is a property of
 * where the two live, not a promise this module makes.
 *
 * ── Why a row is not always a seed entry ────────────────────────────────
 *
 * A game can exist in Firestore and NOT in the seed (hand-written by an
 * admin, or a seed entry that was later removed from the bundle). The old
 * screen listed the seed and only the seed, so such a game was invisible
 * here — and therefore unmanageable: it could not be deactivated or
 * deleted from the one screen that exists to manage games. `buildRows`
 * merges both sides, so every row an admin can act on is a row they can
 * see.
 */

/** The four states a row can be in. `unknown` is a read failure, not a state. */
export const STATUS = Object.freeze({
  LIVE: 'live',
  INACTIVE: 'inactive',
  NOT_IMPORTED: 'not_imported',
  UNKNOWN: 'unknown',
})

export const STATUS_LABEL = Object.freeze({
  [STATUS.LIVE]: 'Live',
  [STATUS.INACTIVE]: 'Inactive',
  [STATUS.NOT_IMPORTED]: 'Not imported',
  [STATUS.UNKNOWN]: 'Unknown',
})

export const STATUS_HINT = Object.freeze({
  [STATUS.LIVE]: 'In Firestore and available to learners',
  [STATUS.INACTIVE]: 'In Firestore but hidden from learners',
  [STATUS.NOT_IMPORTED]: 'In the seed catalogue only — no Firestore record',
  [STATUS.UNKNOWN]: 'The live games collection could not be read',
})

/**
 * Resolve one row's status.
 *
 * `existing` is `null` while the collection is still loading or after a
 * read FAILED — the two are indistinguishable to a caller and both mean
 * "we do not know", which is why there is a fourth status. Reporting a
 * failed read as "Not imported" would invite an admin to import 47 games
 * over the top of 47 live ones.
 */
export function resolveStatus({ inSeed = false, doc = null, existing = undefined } = {}) {
  if (existing === null || existing === undefined) {
    // Nothing loaded — unless this row IS a live doc handed to us directly.
    if (doc) return doc.active === false ? STATUS.INACTIVE : STATUS.LIVE
    return inSeed ? STATUS.UNKNOWN : STATUS.UNKNOWN
  }
  if (!doc) return STATUS.NOT_IMPORTED
  return doc.active === false ? STATUS.INACTIVE : STATUS.LIVE
}

/** Is this row a Firestore record (so: deletable / deactivatable)? */
export function isFirestoreRow(row) {
  return row?.status === STATUS.LIVE || row?.status === STATUS.INACTIVE
}

/** Is this row importable (in the seed, not in Firestore)? */
export function isImportableRow(row) {
  return !!row?.inSeed && row?.status === STATUS.NOT_IMPORTED
}

/**
 * Merge the seed catalogue and the live collection into one row list.
 *
 * Seed order is preserved (it is a curated order — grade bands, then
 * grade), and Firestore-only games are appended after it, sorted by title
 * so they land somewhere predictable rather than in Firestore's iteration
 * order.
 *
 * @param {object}   options
 * @param {Array}    options.seed      GAMES_SEED
 * @param {object|null} options.existing  id -> live doc summary, or null while
 *                                        loading / after a failed read
 * @returns {Array<{id,title,subject,grade,type,inSeed,inFirestore,status,doc}>}
 */
export function buildRows({ seed = [], existing = undefined } = {}) {
  const live = existing || {}
  const seenSeedIds = new Set()

  const seedRows = seed.map((game) => {
    seenSeedIds.add(game.id)
    const doc = live[game.id] || null
    return {
      id: game.id,
      title: game.title || game.id,
      subject: game.subject || '',
      grade: game.grade ?? null,
      type: game.type || '',
      inSeed: true,
      inFirestore: !!doc,
      status: resolveStatus({ inSeed: true, doc, existing }),
      doc,
      seed: game,
    }
  })

  const orphanRows = Object.entries(live)
    .filter(([id]) => !seenSeedIds.has(id))
    .map(([id, doc]) => ({
      id,
      title: doc.title || id,
      subject: doc.subject || '',
      grade: doc.grade ?? null,
      type: doc.type || '',
      inSeed: false,
      inFirestore: true,
      status: resolveStatus({ inSeed: false, doc, existing }),
      doc,
      seed: null,
    }))
    .sort((a, b) => String(a.title).localeCompare(String(b.title)))

  return [...seedRows, ...orphanRows]
}

/** Normalise a search term the same way both the matcher and the UI do. */
function norm(v) {
  return String(v ?? '').toLowerCase().trim()
}

/**
 * Does this row match the free-text search?
 *
 * Title first — "Search games…" is a title box and that is what admins
 * type. The id is matched too because it is what appears in a URL, a log
 * line and a Firestore console, so it is what an admin has in hand when
 * they arrive here to remove one specific game.
 */
export function matchesSearch(row, term) {
  const q = norm(term)
  if (!q) return true
  return norm(row?.title).includes(q) || norm(row?.id).includes(q)
}

/**
 * Apply the toolbar filters. Every filter is AND-ed; an omitted filter
 * (`'all'`, empty string, null) is not a filter.
 */
export function filterRows(rows = [], {
  status = 'all', search = '', grade = 'all', subject = 'all', type = 'all',
} = {}) {
  return rows.filter((row) => {
    if (status !== 'all' && row.status !== status) return false
    if (grade !== 'all' && String(row.grade) !== String(grade)) return false
    if (subject !== 'all' && norm(row.subject) !== norm(subject)) return false
    if (type !== 'all' && norm(row.type) !== norm(type)) return false
    return matchesSearch(row, search)
  })
}

/**
 * Split a selection into what each action can actually act on.
 *
 * This is what stops an action silently ignoring half a selection. Every
 * selected id lands in exactly one bucket, and `hidden` names the ids that
 * are selected but filtered off-screen — an admin about to delete 12 games
 * while looking at 3 rows is entitled to be told.
 */
export function partitionSelection({ rows = [], visibleRows = null, selectedIds = [] } = {}) {
  const selected = selectedIds instanceof Set ? selectedIds : new Set(selectedIds)
  const byId = new Map(rows.map((r) => [r.id, r]))
  const visibleIds = visibleRows ? new Set(visibleRows.map((r) => r.id)) : null

  const importable = []
  const deletable = []
  const unknown = []
  const hidden = []

  for (const id of selected) {
    const row = byId.get(id)
    if (!row) { unknown.push(id); continue }
    if (visibleIds && !visibleIds.has(id)) hidden.push(row)
    if (isImportableRow(row)) importable.push(row)
    else if (isFirestoreRow(row)) deletable.push(row)
    else unknown.push(id)
  }

  return {
    importable,
    deletable,
    unknown,
    hidden,
    total: selected.size,
    mixed: importable.length > 0 && deletable.length > 0,
  }
}

/**
 * "Select missing" — seed entries with no Firestore record, and nothing
 * else. Never an already-live or already-inactive game: importing over an
 * inactive one silently re-activates it, which is a decision an admin
 * makes deliberately, not a side effect of a convenience button.
 *
 * Scoped to the rows passed in, so it obeys the filters on screen.
 */
export function selectMissingIds(rows = []) {
  return rows.filter(isImportableRow).map((r) => r.id)
}

/**
 * The confirmation copy for a permanent deletion. Pure so the wording is
 * testable — this is the last thing between an admin and an irreversible
 * write, and it must never say "3 games" while deleting 12.
 */
export function deleteConfirmCopy(rows = []) {
  const n = rows.length
  const names = rows.slice(0, 4).map((r) => r.title)
  const more = n - names.length
  return {
    title: n === 1 ? 'Delete 1 game permanently?' : `Delete ${n} games permanently?`,
    names,
    more: more > 0 ? more : 0,
    body: n === 1
      ? 'This game will be permanently removed from Firestore and will no longer be available to learners. This action cannot be undone.'
      : `These ${n} games will be permanently removed from Firestore and will no longer be available to learners. This action cannot be undone.`,
    note: 'Learner scores, badges and history are kept — only the game record is removed. Seed games can be imported again afterwards.',
  }
}

/**
 * Above this many games, the confirm dialog also asks the admin to type
 * DELETE. Small deletions are a routine tidy-up; a large one is the shape
 * of a mistake (a stale "Select all", a forgotten filter), so it costs an
 * extra deliberate act.
 */
export const TYPE_TO_CONFIRM_THRESHOLD = 5
export const TYPE_TO_CONFIRM_WORD = 'DELETE'

export function needsTypedConfirmation(count) {
  return Number(count) >= TYPE_TO_CONFIRM_THRESHOLD
}

export function typedConfirmationAccepted(typed) {
  return String(typed ?? '').trim().toUpperCase() === TYPE_TO_CONFIRM_WORD
}

/**
 * Roll a per-item result list into the counts the admin is shown.
 *
 * Outcomes are named rather than boolean because "nothing happened" has
 * two very different meanings: `skipped` (the game was already in the
 * state you asked for — a no-op, and fine) and `failed` (the write was
 * refused — not fine). Collapsing them into "0 changed" is how a
 * permissions error reads as success.
 */
export function summariseResults(results = []) {
  const summary = { ok: 0, skipped: 0, failed: 0, total: results.length }
  for (const r of results) {
    if (r?.outcome === 'ok') summary.ok++
    else if (r?.outcome === 'skipped') summary.skipped++
    else summary.failed++
  }
  return summary
}

/** One line of plain English for a finished bulk run. */
export function describeSummary(kind, summary) {
  const s = summary || { ok: 0, skipped: 0, failed: 0 }
  if (kind === 'delete') {
    return [
      `${s.ok} deleted`,
      `${s.skipped} already missing`,
      `${s.failed} failed`,
    ]
  }
  return [
    `${s.ok} imported`,
    `${s.skipped} already existed`,
    `${s.failed} failed`,
  ]
}

/**
 * What a permanent deletion touches, and what it deliberately does not.
 *
 * Exported as DATA rather than left implicit in the service so the answer
 * to "what does deleting a game destroy?" is one object a test can pin and
 * a reviewer can read. The service walks `removes`; `preserves` is the
 * documented decision list.
 *
 * ── Why learner history is preserved ────────────────────────────────────
 *
 * A `scores` row is a learner's own result and a public leaderboard row.
 * Deleting a game is an editorial decision about the catalogue; it is not
 * a statement that a child did not play. Cascading into `scores` would
 * silently rewrite every leaderboard, every XP total (the hub sums the
 * last 40 score rows) and every personal best, and none of that is
 * recoverable. The same holds for badges already awarded and for the
 * duel matches played on the game's question bank.
 *
 * What IS removed is derived data that describes a game which no longer
 * exists: `leaderboards/{gameId}` is a rollup cache of `scores`, so it can
 * be rebuilt from the rows we keep and is meaningless without the game.
 */
export const DELETION_PLAN = Object.freeze({
  removes: Object.freeze([
    Object.freeze({
      path: 'games/{gameId}',
      why: 'the record itself — questions live in an array on this document, so there is no subcollection to walk',
    }),
    Object.freeze({
      path: 'leaderboards/{gameId}',
      why: 'a derived top-N rollup of `scores` for this game; meaningless once the game is gone, and rebuildable from the scores we keep',
    }),
  ]),
  writes: Object.freeze([
    Object.freeze({
      path: 'gameTombstones/{gameId}',
      why: 'records that an admin deliberately removed this game, and keeps gameId/gameTitle/gameType/grade/subject so historical rows stay readable. Also what stops the bundled seed re-offering the game to learners',
    }),
  ]),
  preserves: Object.freeze([
    Object.freeze({ path: 'scores/*', why: "learner results and the leaderboard's source of truth; each row already carries gameId, grade and subject" }),
    Object.freeze({ path: 'badges/{uid}', why: 'awarded achievements; `awardedFor.gameId`/`gameTitle` are a historical record of something that happened' }),
    Object.freeze({ path: 'learner_profiles/{uid}', why: '`recentGames` already stores `gameTitle` alongside `gameId`, so entries stay readable with no game document' }),
    Object.freeze({ path: 'dailyStreaks/{uid}', why: '`lastGameId` is a pointer, not content; a dangling one costs nothing and clearing it would break streak continuity checks' }),
    Object.freeze({ path: 'matches/*', why: 'duel history, including the question set actually raced on' }),
    Object.freeze({ path: 'daily_challenges/{date}', why: 'a historical record of what was featured on a day. The daily service already falls through to the rotation when the referenced game is missing' }),
  ]),
})
