/**
 * Games Firestore service — client-side data access for the /games surface.
 *
 * Collections in play:
 *   games             — curated game documents (public read, admin write)
 *   scores            — one row per completed game (signed-in users only)
 *   leaderboards/{id} — top-N rollup per game (written by Cloud Function)
 *   badges/{uid}      — earned badges per user
 *   daily_challenges  — one featured game per calendar day
 *
 * Document shape for `games` (as agreed in the product spec):
 *   {
 *     title, subject, grade, type, difficulty, description, timer,
 *     points, active, cbc_topic,
 *     questions: [{ question, options[], answer }]
 *     // optional — for auto-generated content:
 *     generator: 'timesTables' | 'addSubSmall' | 'mixedOps' | ...
 *     createdAt, updatedAt, createdBy
 *   }
 */

import {
  collection, doc, getDoc, getDocs, query, where, orderBy, limit as fsLimit,
  addDoc, serverTimestamp, Timestamp, onSnapshot, runTransaction,
} from 'firebase/firestore'
import { db, auth } from '../../../firebase/config'
import { resetDeletedGameCache } from '../../../utils/gameTombstones'
import { describeFirestoreReadError, withFirestoreReadTimeout } from '../../../utils/firestoreTimeout'
import { levelUpInfo } from '../../../utils/gameProgress'
import { buildGameScorePayload } from '../../../utils/gameScorePayload.js'
import { capture as captureAnalytics } from '../../../utils/analytics'

/* ─────────────────────────────────────────────────────────────────
 *  Taxonomy used by the Grade → Subject → Games list UI
 * ───────────────────────────────────────────────────────────────── */
// Full Zambian CBC primary scope — Grades 1-7. The games library carries
// content from Grade 1 up (see src/data/gamesSeed.js), so every grade needs
// a working Grade→Subject→Games page; gradeByValue() returning null makes
// SubjectSelector/GameList bounce back to /games.
export const GRADES = [
  { value: 1, label: 'Grade 1', band: 'lower' },
  { value: 2, label: 'Grade 2', band: 'lower' },
  { value: 3, label: 'Grade 3', band: 'lower' },
  { value: 4, label: 'Grade 4', band: 'middle' },
  { value: 5, label: 'Grade 5', band: 'middle' },
  { value: 6, label: 'Grade 6', band: 'middle' },
  { value: 7, label: 'Grade 7', band: 'middle' },
]

// Keep subject slugs stable — they become URL segments.
export const SUBJECTS = [
  { slug: 'mathematics', label: 'Mathematics', emoji: '➗', color: 'rose' },
  { slug: 'english',     label: 'English',     emoji: '📖', color: 'sky' },
  { slug: 'science',     label: 'Science',     emoji: '🔬', color: 'emerald' },
  { slug: 'social',      label: 'Social Studies', emoji: '🌍', color: 'amber' },
]

export function gradeByValue(v) {
  const n = Number(v)
  return GRADES.find((g) => g.value === n) || null
}

export function subjectBySlug(slug) {
  return SUBJECTS.find((s) => s.slug === slug) || null
}

/* ─────────────────────────────────────────────────────────────────
 *  Games — read
 * ───────────────────────────────────────────────────────────────── */

/**
 * List all active games for a given grade + subject. Returns [].
 * Sort is client-side by title so the index stays simple.
 */
export async function listGames({ grade, subject } = {}) {
  try {
    const parts = [where('active', '==', true)]
    if (grade != null) parts.push(where('grade', '==', Number(grade)))
    const snap = await withFirestoreReadTimeout(
      getDocs(query(collection(db, 'games'), ...parts)),
      'games list',
    )
    let rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    if (subject) {
      const norm = subject.toLowerCase().trim()
      const meta = SUBJECTS.find((s) => s.slug === norm || s.label.toLowerCase() === norm)
      const slugMatch = meta?.slug ?? norm
      const labelMatch = meta?.label.toLowerCase() ?? norm
      rows = rows.filter((g) => {
        const gs = (g.subject || '').toLowerCase().trim()
        return gs === slugMatch || gs === labelMatch
      })
    }
    rows.sort((a, b) => (a.title || '').localeCompare(b.title || ''))
    return rows
  } catch (err) {
    console.warn('listGames: using bundled fallback because live games could not be read', describeFirestoreReadError(err))
    return []
  }
}

/** Load a single game document. Returns null if missing or inactive. */
export async function getGame(gameId) {
  try {
    const snap = await withFirestoreReadTimeout(
      getDoc(doc(db, 'games', gameId)),
      `game ${gameId}`,
    )
    if (!snap.exists()) return null
    const data = { id: snap.id, ...snap.data() }
    if (data.active === false) return null
    return data
  } catch (err) {
    console.warn('getGame: using bundled fallback because live game could not be read', describeFirestoreReadError(err))
    return null
  }
}

/* ─────────────────────────────────────────────────────────────────
 *  Scores — write
 * ───────────────────────────────────────────────────────────────── */

/**
 * Report that a game ROUND began — the denominator `game_completed` needs.
 *
 * Called from each game engine's own `start()`, deliberately, rather than from
 * the PlayGame route or the cards that link into it. Both alternatives
 * undercount, in different ways:
 *
 *   • The dashboard challenge card fired the only `game_started` in the repo,
 *     so a learner arriving from the games list, a shared /games/play/:id link
 *     or a search result completed a game that never started. Completions could
 *     exceed starts, which makes an abandonment rate not merely wrong but
 *     nonsensical.
 *   • A latch on the PlayGame route would fix those entry paths and still miss
 *     "Play again", which calls the engine's start() again WITHOUT remounting
 *     the route — while saveScore() fires once per finished round. Three
 *     replays would read as one start and three completions.
 *
 * start() is the only thing that is true once per round for every engine, which
 * is what makes this the counterpart of saveScore() rather than an approximation
 * of it. Aggregate fields only, and no Firestore write — analytics is a
 * side-channel here, so a failure must never break the game: `capture` already
 * swallows its own errors, and this adds nothing that can throw.
 */
export function reportGameStart(game) {
  captureAnalytics('game_started', {
    gameId: game?.id ?? null,
    subject: game?.subject ?? null,
    grade: typeof game?.grade === 'number' ? game.grade : null,
    gameType: game?.type ?? null,
  })
}

/**
 * Save a completed-game score. Only works when the user is signed in.
 * Returns { ok, id?, skipped?, reason? }.
 *
 * `endedBy` is ANALYTICS ONLY — it never reaches the `scores` document,
 * because `buildGameScorePayload` picks its fields explicitly. It exists
 * because deleting the countdowns deleted the "timed out" outcome with them,
 * and PROMPT 7b asks for the change to be measured: the question worth
 * answering now is whether learners FINISH a set or stop part-way, which is
 * what `game_started` → `game_completed{endedBy}` measures. Values:
 * `set_complete` (the default — the round ran out of items) and `ended_early`
 * (the learner chose to stop).
 */
export async function saveScore({ game, score, accuracy, timeSpent, correct, wrong, bestStreak, displayName, endedBy = 'set_complete' }) {
  const user = auth.currentUser
  if (!user) return { ok: false, skipped: true, reason: 'not_signed_in' }
  if (!game || !game.id) return { ok: false, reason: 'no_game' }

  // The document itself is built by a pure function so the byte-compatibility
  // harness can produce one without Firebase (see gameScorePayload.js). The
  // three things that are not functions of the round — the uid, the display
  // name and the server timestamp — are supplied here, where they exist.
  const payload = {
    ...buildGameScorePayload({
      game,
      outcome: { score, accuracy, timeSpent, correct, wrong, bestStreak },
      userId: user.uid,
      displayName: displayName || user.displayName,
    }),
    playedAt: serverTimestamp(),
  }

  try {
    const ref = await addDoc(collection(db, 'scores'), payload)
    // Fire-and-forget: update the learner intelligence profile. Any failure
    // here must NOT break the score save — so we dynamic-import + swallow
    // errors. The score is already persisted; intelligence is additive.
    let intelligence = null
    try {
      const { updateLearnerProfileAfterGame } = await import('../../../utils/gamesIntelligence')
      intelligence = await updateLearnerProfileAfterGame({
        game,
        result: { score, accuracy, correct, wrong, timeSpent, bestStreak },
      })
    } catch (err) {
      console.warn('learner intelligence update skipped', err?.code || err?.message)
    }
    // Completion counterpart to reportGameStart(). Without it there is no game
    // abandonment rate — a game learners quit halfway looked identical to one
    // they loved. Aggregate fields only: no answers, no question content.
    // Fires here because every game funnels its finished round through
    // saveScore(), which is what makes this ONE call cover every game.
    captureAnalytics('game_completed', {
      gameId: game?.id ?? null,
      subject: game?.subject ?? null,
      grade: typeof game?.grade === 'number' ? game.grade : null,
      score: typeof score === 'number' ? score : null,
      accuracy: typeof accuracy === 'number' ? accuracy : null,
      timeSpent: typeof timeSpent === 'number' ? timeSpent : null,
      bestStreak: typeof bestStreak === 'number' ? bestStreak : null,
      endedBy,
    })
    return { ok: true, id: ref.id, intelligence }
  } catch (err) {
    console.error('saveScore failed', err)
    return { ok: false, reason: err?.code || 'write_failed' }
  }
}

/* ─────────────────────────────────────────────────────────────────
 *  Leaderboard — read
 * ───────────────────────────────────────────────────────────────── */

/**
 * Top-N scores for a specific game, ordered by score desc (best first).
 * Returns [] on any error (leaderboard should fail silent).
 */
export async function getLeaderboard(gameId, max = 10) {
  if (!gameId) return []
  try {
    const snap = await getDocs(query(
      collection(db, 'scores'),
      where('gameId', '==', gameId),
      orderBy('score', 'desc'),
      orderBy('playedAt', 'desc'),
      fsLimit(max),
    ))
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  } catch (err) {
    console.warn('getLeaderboard failed (likely no index yet)', err?.code || err?.message)
    return []
  }
}

/** The current user's recent score history — for the "My results" strip. */
export async function getMyHistory(max = 20) {
  const user = auth.currentUser
  if (!user) return []
  try {
    const snap = await getDocs(query(
      collection(db, 'scores'),
      where('userId', '==', user.uid),
      orderBy('playedAt', 'desc'),
      fsLimit(max),
    ))
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  } catch (err) {
    console.warn('getMyHistory failed', err?.code || err?.message)
    return []
  }
}

/* ─────────────────────────────────────────────────────────────────
 *  Round progression — level/XP + personal best after a played round
 *
 *  Centralised here (rather than copied into each engine) so the level,
 *  XP, and personal-best logic stays consistent across all game engines.
 * ───────────────────────────────────────────────────────────────── */

// The window the games hub sums for its "points" total. The level/XP shown on
// a done screen must be computed the same way so the two never disagree.
const POINTS_WINDOW = 40

/** Sum of the user's recent scores — the same figure the hub displays. */
async function sumRecentPoints() {
  const history = await getMyHistory(POINTS_WINDOW)
  return history.reduce((sum, row) => sum + (Number(row.score) || 0), 0)
}

/**
 * The signed-in user's all-time best score for a single game, or null if they
 * have never played it. Fails soft (returns null) so a missing index never
 * surfaces a false "personal best".
 */
export async function getMyBestForGame(gameId) {
  const user = auth.currentUser
  if (!user || !gameId) return null
  try {
    const snap = await getDocs(query(
      collection(db, 'scores'),
      where('userId', '==', user.uid),
      where('gameId', '==', gameId),
      orderBy('score', 'desc'),
      fsLimit(1),
    ))
    if (snap.empty) return null
    return Number(snap.docs[0].data().score) || 0
  } catch (err) {
    console.warn('getMyBestForGame failed (likely no index yet)', err?.code || err?.message)
    return null
  }
}

/**
 * Snapshot the progression baseline BEFORE saving a round:
 *   - beforeTotal: the windowed points total the hub currently shows
 *   - prevBest:    the user's all-time best for this game (excludes this round,
 *                  since it is captured before the save)
 * Call this immediately before saveScore().
 */
export async function readRoundBaseline(gameId) {
  const [beforeTotal, prevBest] = await Promise.all([
    sumRecentPoints().catch(() => null),
    getMyBestForGame(gameId),
  ])
  return { beforeTotal, prevBest }
}

/**
 * After a round is saved, resolve the level change + personal-best result.
 *
 * Refetches the windowed total so the level/XP on the done screen matches the
 * hub exactly — once a user has POINTS_WINDOW saved scores the hub's total
 * drops its oldest row, which a naive `before + score` would miss. Personal
 * best compares the round score against the all-time prevBest captured in the
 * baseline, so an older high score is never overlooked.
 */
export async function readRoundOutcome({ score, baseline }) {
  const gained = Number(score) || 0
  const before = baseline?.beforeTotal
  let levelChange = null
  if (before != null) {
    let after = before + gained
    try { after = await sumRecentPoints() } catch { /* fall back to before + gained */ }
    levelChange = levelUpInfo(before, after)
  }
  const prevBest = baseline?.prevBest
  const personalBest = prevBest != null && gained > prevBest ? { isBest: true, prevBest } : null
  return { levelChange, personalBest }
}

/* ─────────────────────────────────────────────────────────────────
 *  Games — admin writes (the /admin/games-seed importer)
 *
 *  Four functions, and between them they are the ONLY writers to the
 *  `games` collection. There is deliberately no bare "upsert a game"
 *  export any more: the one that existed wrote unconditionally, which is
 *  how a bulk import came to silently re-activate a game an admin had
 *  deactivated on purpose. Every write below states what it does about a
 *  document that already exists.
 *
 *  Authorization is `firestore.rules` (`games`: create/update/delete if
 *  isAdmin(); `gameTombstones` likewise), not these functions and not the
 *  <AdminRoute> around the page — both of those are the client asking
 *  nicely. Behaviourally pinned in scripts/test-firestore-rules-emulator.mjs.
 * ───────────────────────────────────────────────────────────────── */

/**
 * Every `games` document, INCLUDING inactive ones, as a summary map keyed
 * by id — the admin importer's view of the live collection.
 *
 * Distinct from `listGames()` in two ways that both matter here: it does
 * not filter on `active` (an admin has to see and manage what learners
 * cannot), and it THROWS rather than returning `[]` on a read failure.
 * `listGames` fails soft because a learner with no games is better than a
 * learner with an error; an importer that reports a failed read as "the
 * collection is empty" would invite an admin to import 47 games over the
 * top of 47 live ones.
 *
 * Only admins can read inactive docs (see the `games` rule), so a
 * non-admin calling this gets a permission error, which is the correct
 * answer rather than a partial list.
 *
 * @returns {Promise<Record<string, {id,title,subject,grade,type,active,updatedAt}>>}
 */
export async function listAllGamesForAdmin() {
  const snap = await getDocs(collection(db, 'games'))
  const map = {}
  snap.docs.forEach((d) => {
    const data = d.data() || {}
    map[d.id] = {
      id: d.id,
      title: data.title || d.id,
      subject: data.subject || '',
      grade: data.grade ?? null,
      type: data.type || '',
      active: data.active !== false,
      updatedAt: data.updatedAt || null,
    }
  })
  return map
}

/**
 * Import ONE seed game, idempotently.
 *
 * The read and the write are in a transaction, so "does it already exist?"
 * is answered against Firestore at write time rather than against whatever
 * the admin's screen was showing. Two admins clicking Import at once, a
 * double-click, a stale tab and a refresh mid-run all converge on one
 * document: the id is `games/{seed.id}`, so a repeat is a no-op rather
 * than a duplicate record. There is no path here that can create a second
 * copy of a game.
 *
 * An existing document is LEFT ALONE (`outcome: 'skipped'`) rather than
 * merged over. A live doc may carry admin edits, and — more sharply — an
 * inactive one is inactive because somebody decided it should be. Silently
 * re-activating it as a side effect of a bulk import is exactly the
 * surprise this screen is meant to stop. Re-importing over an existing
 * game is available deliberately via `force`.
 *
 * @param {object} seedGame  an entry from GAMES_SEED
 * @param {object} [options]
 * @param {boolean} [options.force]  overwrite an existing document
 * @returns {Promise<{id, outcome: 'ok'|'skipped'|'failed', reason?, error?}>}
 */
export async function importSeedGame(seedGame, { force = false } = {}) {
  if (!seedGame?.id) return { id: seedGame?.id || null, outcome: 'failed', reason: 'no_id' }
  const ref = doc(db, 'games', seedGame.id)
  const tombstoneRef = doc(db, 'gameTombstones', seedGame.id)
  try {
    const result = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref)
      if (snap.exists() && !force) return { outcome: 'skipped', reason: 'already_exists' }
      const { id: _id, ...payload } = seedGame
      tx.set(ref, {
        ...payload,
        active: payload.active !== false,
        createdAt: snap.exists() ? (snap.data()?.createdAt || serverTimestamp()) : serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: auth.currentUser?.uid || null,
      }, { merge: true })
      // Importing a game is the admin retracting an earlier deletion, so
      // the tombstone goes with it — otherwise the learner-side seed
      // suppression would keep hiding a game that is live again.
      tx.delete(tombstoneRef)
      return { outcome: 'ok', reason: snap.exists() ? 'overwritten' : 'created' }
    })
    resetDeletedGameCache()
    return { id: seedGame.id, ...result }
  } catch (err) {
    console.error('importSeedGame failed', seedGame.id, err)
    return { id: seedGame.id, outcome: 'failed', reason: err?.code || 'write_failed', error: err?.message }
  }
}

/**
 * Flip a game's visibility to learners without deleting anything.
 *
 * Deactivate is the reversible half of the pair: the document stays, every
 * learner-facing read filters on `active == true`, and the rules stop a
 * non-admin reading an inactive doc at all. Delete is the other half.
 *
 * @returns {Promise<{id, outcome: 'ok'|'skipped'|'failed', reason?}>}
 */
export async function setGameActive(gameId, active) {
  if (!gameId) return { id: null, outcome: 'failed', reason: 'no_id' }
  const ref = doc(db, 'games', gameId)
  try {
    const result = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref)
      if (!snap.exists()) return { outcome: 'skipped', reason: 'already_missing' }
      if ((snap.data()?.active !== false) === !!active) {
        return { outcome: 'skipped', reason: 'already_in_state' }
      }
      tx.update(ref, { active: !!active, updatedAt: serverTimestamp() })
      return { outcome: 'ok' }
    })
    return { id: gameId, ...result }
  } catch (err) {
    console.error('setGameActive failed', gameId, err)
    return { id: gameId, outcome: 'failed', reason: err?.code || 'write_failed', error: err?.message }
  }
}

/**
 * Permanently delete ONE game.
 *
 * Admin-only, and the enforcement is the `games` rule
 * (`allow delete: if isAdmin()`), not this function and not the
 * `<AdminRoute>` around the page — both of those are the client asking
 * nicely. A non-admin calling this directly from a console gets
 * `permission-denied` from Firestore.
 *
 * What it touches is `DELETION_PLAN` in `lib/gamesSeedAdminCore.js`, which
 * is the reviewable version of these three writes:
 *
 *   1. delete `games/{id}`            — the record; questions are an array
 *                                       on it, so there is no subcollection
 *   2. delete `leaderboards/{id}`     — a derived rollup of `scores`
 *   3. create `gameTombstones/{id}`   — the decision, plus enough of the
 *                                       game to keep historical rows
 *                                       readable, plus what suppresses the
 *                                       bundled seed fallback
 *
 * `scores`, `badges`, `learner_profiles`, `dailyStreaks` and `matches` are
 * deliberately untouched — see DELETION_PLAN.preserves.
 *
 * Steps 1 and 3 are one transaction: a deleted game with no tombstone
 * would come straight back as a seed card, and a tombstone with no
 * deletion would hide a live game. Step 2 is a best-effort follow-up,
 * because a leaderboard rollup that outlives its game is stale data an
 * admin can live with, while a failure there must not leave the game
 * half-deleted.
 *
 * @returns {Promise<{id, outcome: 'ok'|'skipped'|'failed', reason?, error?}>}
 */
export async function deleteGameForever(gameId, { title, type, grade, subject } = {}) {
  if (!gameId) return { id: null, outcome: 'failed', reason: 'no_id' }
  const gameRef = doc(db, 'games', gameId)
  const tombstoneRef = doc(db, 'gameTombstones', gameId)
  try {
    const result = await runTransaction(db, async (tx) => {
      const snap = await tx.get(gameRef)
      if (!snap.exists()) {
        // Another admin got here first, or the row was stale. That is the
        // state the caller asked for, so it is not an error — but it is
        // reported separately from a deletion this run performed.
        return { outcome: 'skipped', reason: 'already_missing' }
      }
      const data = snap.data() || {}
      tx.delete(gameRef)
      tx.set(tombstoneRef, {
        gameId,
        // Read from the document rather than from the caller's row: the
        // screen may be stale, and this is the copy history will be read
        // through.
        gameTitle: String(data.title || title || gameId).slice(0, 200),
        gameType: String(data.type || type || '').slice(0, 64),
        grade: data.grade ?? grade ?? null,
        subject: String(data.subject || subject || '').slice(0, 64),
        deletedAt: serverTimestamp(),
        deletedBy: auth.currentUser?.uid || null,
      })
      return { outcome: 'ok' }
    })

    if (result.outcome === 'ok') {
      // Derived rollup; its absence is invisible and its presence after
      // the game is gone is merely stale, so this never fails the delete.
      try {
        const { deleteDoc } = await import('firebase/firestore')
        await deleteDoc(doc(db, 'leaderboards', gameId))
      } catch (err) {
        console.warn('deleteGameForever: leaderboard rollup not removed', gameId, err?.code || err?.message)
      }
    }
    resetDeletedGameCache()
    return { id: gameId, ...result }
  } catch (err) {
    console.error('deleteGameForever failed', gameId, err)
    return { id: gameId, outcome: 'failed', reason: err?.code || 'delete_failed', error: err?.message }
  }
}

/* ─────────────────────────────────────────────────────────────────
 *  Live Global Leaderboard — real-time subscription via onSnapshot
 *
 *  Used by /games/leaderboard. Three time windows: 'today' | 'week' | 'all'.
 *  Returns top-N scores across all games, ordered by score descending.
 * ───────────────────────────────────────────────────────────────── */

export function subscribeToGlobalLeaderboard({ window: win = 'all', max = 25 }, onUpdate) {
  let q
  if (win === 'today') {
    const start = startOfTodayUTC()
    q = query(
      collection(db, 'scores'),
      where('playedAt', '>=', start),
      orderBy('playedAt', 'desc'),
      orderBy('score', 'desc'),
      fsLimit(max),
    )
  } else if (win === 'week') {
    const start = startOfWeekAgo()
    q = query(
      collection(db, 'scores'),
      where('playedAt', '>=', start),
      orderBy('playedAt', 'desc'),
      orderBy('score', 'desc'),
      fsLimit(max),
    )
  } else {
    q = query(
      collection(db, 'scores'),
      orderBy('score', 'desc'),
      fsLimit(max),
    )
  }

  const unsub = onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      // For windowed queries we ordered by playedAt first to satisfy the
      // index — re-sort by score on the client to get top scores at top.
      if (win !== 'all') rows.sort((a, b) => (b.score || 0) - (a.score || 0))
      onUpdate({ rows, error: null })
    },
    (err) => {
      console.warn('global leaderboard subscription error', err)
      onUpdate({ rows: [], error: err?.code || err?.message || 'subscription_failed' })
    },
  )
  return unsub
}

function startOfTodayUTC() {
  const now = new Date()
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Timestamp.fromMillis(start)
}

function startOfWeekAgo() {
  return Timestamp.fromMillis(Date.now() - 7 * 24 * 60 * 60 * 1000)
}

/* ─────────────────────────────────────────────────────────────────
 *  Pure helpers (no Firestore) — used by games that want to render
 *  a fresh round each play, and by the seed generator.
 * ───────────────────────────────────────────────────────────────── */

export function shuffle(arr, seed = Date.now()) {
  const a = arr.slice()
  let s = seed >>> 0
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0
    const j = s % (i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function formatWhen(v) {
  if (!v) return ''
  const d = v.toDate ? v.toDate() : new Date(v)
  const diff = Date.now() - d.getTime()
  const m = Math.round(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.round(h / 24)
  return `${days}d ago`
}
