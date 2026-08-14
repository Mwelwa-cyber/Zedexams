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
  addDoc, serverTimestamp, setDoc, Timestamp, onSnapshot,
} from 'firebase/firestore'
import { db, auth } from '../../../firebase/config'
import { describeFirestoreReadError, withFirestoreReadTimeout } from '../../../utils/firestoreTimeout'
import { levelUpInfo } from '../../../utils/gameProgress'
import { buildGameScorePayload } from '../../../utils/gameScorePayload.js'

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
 * Save a completed-game score. Only works when the user is signed in.
 * Returns { ok, id?, skipped?, reason? }.
 */
export async function saveScore({ game, score, accuracy, timeSpent, correct, wrong, bestStreak, displayName }) {
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
 *  Games — admin writes (used by seed importer)
 * ───────────────────────────────────────────────────────────────── */

/**
 * Upsert a single game document (admin-only per Firestore rules).
 * Used by the /admin/games-seed button to populate the collection.
 */
export async function upsertGame(gameId, payload) {
  const ref = doc(db, 'games', gameId)
  const now = serverTimestamp()
  await setDoc(
    ref,
    {
      ...payload,
      active: payload.active !== false,
      createdAt: payload.createdAt || now,
      updatedAt: now,
      createdBy: auth.currentUser?.uid || null,
    },
    { merge: true },
  )
  return { ok: true, id: gameId }
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
