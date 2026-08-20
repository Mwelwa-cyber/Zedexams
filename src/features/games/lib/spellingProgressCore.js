/**
 * The learner's spelling record — the shape it is stored in, and the four
 * rules that stop it being corrupted.
 *
 * Spelling progress used to live in `localStorage` alone (`zedexams:spelling:*`),
 * which is not a place learning state may live: it does not survive a new
 * browser, it does not follow a child to the family tablet, and it is gone the
 * day a device is wiped. `spellingProgress/{uid}` is the record now, and the
 * device copy is a MIRROR — read first so the map paints instantly, written
 * always so a signed-out or offline learner keeps playing, and never the
 * authority when the two disagree.
 *
 * THE FOUR RULES, each of which fails silently on screen:
 *
 *   MERGING TAKES THE BETTER OF THE TWO, NEVER THE NEWER. A learner who plays
 *   offline on a phone and then signs in on a laptop has two honest records,
 *   and "last write wins" would throw one away — most likely the phone's, which
 *   is where the work happened. `mergeProgress` maxes the stars and keeps the
 *   further-along pool entry per word, so no route through the merge can lose a
 *   star or un-master a word.
 *
 *   A STAGE PAYS OUT ONCE PER RUN. `applyStageResult` is keyed by `runId` and
 *   returns the record UNCHANGED for an id it has already settled, so a double
 *   tap, a resumed stage finishing twice, or a retried write cannot award the
 *   same stage twice.
 *
 *   REPLAYING NEVER TAKES ANYTHING AWAY. Stars are a max (see
 *   `spellingMapCore.recordStageStars`) and a replay that goes worse settles to
 *   a no-op. "Nothing is lost by replaying" has to be true, or a child learns
 *   not to practise.
 *
 *   THE POOL IS BOUNDED. It is read whole on every visit to the map, so it
 *   cannot be allowed to grow to a word per row of the bank forever. `trimPool`
 *   drops MASTERED words first and oldest-first within that, because a mastered
 *   word costs nothing to forget — it is excluded from the fresh draw only while
 *   unmastered, and its history is a nicety. An unmastered word is never
 *   dropped while there is a mastered one to drop instead.
 *
 * Pure. No React, no DOM, no Firebase.
 */

import { emptyEntry, isMastered } from './spellingStagesCore.js'
import { recordStageStars, totalStars } from './spellingMapCore.js'

/** How many word records one learner's pool may hold. See `trimPool`. */
export const MAX_POOL_WORDS = 400

/** How many settled run ids are remembered. Only ever a duplicate guard. */
export const MAX_SETTLED_RUNS = 12

export function emptyProgress() {
  return {
    stars: {},
    pool: {},
    stagesPlayed: 0,
    settledRuns: [],
    resume: null,
    updatedAtMs: 0,
  }
}

/** Coerce anything (a Firestore doc, a localStorage blob, undefined) into shape. */
export function normaliseProgress(raw) {
  const base = emptyProgress()
  if (!raw || typeof raw !== 'object') return base
  const stars = {}
  for (const [stage, value] of Object.entries(raw.stars || {})) {
    const n = Math.max(0, Math.min(3, Math.floor(Number(value) || 0)))
    if (n > 0 && /^\d+$/.test(String(stage))) stars[String(stage)] = n
  }
  const pool = {}
  for (const [word, value] of Object.entries(raw.pool || {})) {
    if (!word || typeof value !== 'object' || !value) continue
    pool[String(word).toUpperCase()] = {
      ...emptyEntry(),
      ...value,
      sessions: Array.isArray(value.sessions) ? value.sessions.map(String) : [],
    }
  }
  return {
    stars,
    pool,
    stagesPlayed: Math.max(0, Math.floor(Number(raw.stagesPlayed) || 0)),
    settledRuns: Array.isArray(raw.settledRuns) ? raw.settledRuns.map(String).slice(-MAX_SETTLED_RUNS) : [],
    resume: normaliseResume(raw.resume),
    updatedAtMs: Math.max(0, Math.floor(Number(raw.updatedAtMs) || 0)),
  }
}

/* ── resume ────────────────────────────────────────────────────────── */

/**
 * A stage left half-finished.
 *
 * The WORDS are stored, not just the position: a stage is composed from the
 * pool, and the pool has changed by the time the learner comes back (they got
 * three of them right), so recomposing would hand them a different stage and
 * call it a resume. `index` is how far through that list they were.
 *
 * `session` travels too, because mastery counts SESSIONS — resuming into a new
 * session id would let a learner bank two mastery sessions for one sitting by
 * leaving and returning.
 */
export function normaliseResume(raw) {
  if (!raw || typeof raw !== 'object') return null
  const words = Array.isArray(raw.words) ? raw.words.map((w) => String(w).toUpperCase()).filter(Boolean) : []
  const stage = raw.stage === 'tricky' ? 'tricky' : Math.floor(Number(raw.stage) || 0)
  if (!words.length || (stage !== 'tricky' && stage < 1)) return null
  return {
    stage,
    band: raw.band ? String(raw.band) : null,
    runId: String(raw.runId || ''),
    session: String(raw.session || ''),
    words,
    index: Math.max(0, Math.min(words.length, Math.floor(Number(raw.index) || 0))),
    firstTryCorrect: Math.max(0, Math.floor(Number(raw.firstTryCorrect) || 0)),
    missedWords: Array.isArray(raw.missedWords) ? raw.missedWords.map((w) => String(w).toUpperCase()) : [],
    poolBefore: raw.poolBefore && typeof raw.poolBefore === 'object' ? raw.poolBefore : {},
    startedAtMs: Math.max(0, Math.floor(Number(raw.startedAtMs) || 0)),
  }
}

/** Is this resume worth offering? A finished one is not; a stale one is not. */
export function resumeIsLive(resume, { now = 0, maxAgeMs = 1000 * 60 * 60 * 24 * 3 } = {}) {
  const state = normaliseResume(resume)
  if (!state) return false
  if (state.index >= state.words.length) return false
  if (now && state.startedAtMs && now - state.startedAtMs > maxAgeMs) return false
  return true
}

/* ── merging two honest records ────────────────────────────────────── */

/** The further-along of two pool entries for one word. */
export function betterEntry(a, b) {
  const left = { ...emptyEntry(), ...(a || {}) }
  const right = { ...emptyEntry(), ...(b || {}) }

  // Which entry is further along: mastery first, then how often the learner
  // has got it right. Whichever wins, the HISTORY fields below are unioned
  // from both — a device that mastered the word must not erase the misses the
  // other device recorded on the way there, because that history is what the
  // Tricky Words list and the weekly report are built from.
  let ahead = left
  if (isMastered(left) !== isMastered(right)) ahead = isMastered(left) ? left : right
  else if ((right.correct || 0) > (left.correct || 0)) ahead = right
  const behind = ahead === left ? right : left

  return {
    ...ahead,
    misses: Math.max(left.misses || 0, right.misses || 0),
    attempts: Math.max(left.attempts || 0, right.attempts || 0),
    lastAt: Math.max(left.lastAt || 0, right.lastAt || 0),
    lastMissAt: Math.max(left.lastMissAt || 0, right.lastMissAt || 0),
    // The LATER due date wins: a word already scheduled further out has been
    // answered more recently, and pulling it forward would re-test a word the
    // learner has just seen.
    dueAt: Math.max(left.dueAt || 0, right.dueAt || 0),
    sessions: [...new Set([...(behind.sessions || []), ...(ahead.sessions || [])])].slice(-3),
  }
}

/**
 * Fold two records into one. Symmetric and lossless in the directions that
 * matter: no star goes down, no mastered word becomes unmastered.
 */
export function mergeProgress(a, b) {
  const left = normaliseProgress(a)
  const right = normaliseProgress(b)

  let stars = { ...left.stars }
  for (const [stage, value] of Object.entries(right.stars)) stars = recordStageStars(stars, stage, value)

  const pool = { ...left.pool }
  for (const [word, entry] of Object.entries(right.pool)) {
    pool[word] = word in pool ? betterEntry(pool[word], entry) : entry
  }

  const newer = right.updatedAtMs >= left.updatedAtMs ? right : left
  return {
    stars,
    pool,
    stagesPlayed: Math.max(left.stagesPlayed, right.stagesPlayed),
    settledRuns: [...new Set([...left.settledRuns, ...right.settledRuns])].slice(-MAX_SETTLED_RUNS),
    // A resume is a position in ONE sitting, so it cannot be merged — the
    // newer record's is taken whole, and a stale one is dropped by
    // `resumeIsLive` at the point of offering it.
    resume: newer.resume,
    updatedAtMs: Math.max(left.updatedAtMs, right.updatedAtMs),
  }
}

/* ── settling a stage ──────────────────────────────────────────────── */

/**
 * Bank a finished stage. Idempotent by `runId`.
 *
 * The pool passed in is the pool AFTER the stage — the round records each
 * right and wrong answer as it goes, because mastery has to survive the
 * learner closing the tab on the last word.
 */
export function applyStageResult(progress, { stage, stars: earned = 0, pool = null, runId = '' } = {}) {
  const current = normaliseProgress(progress)
  const id = String(runId || '')
  // Already settled: return what the caller gave us, UNCHANGED BY IDENTITY, so
  // `if (next === prev) return` skips the Firestore write as well as the
  // reward. Returning a fresh normalised copy would settle the same stage
  // twice as far as any caller comparing references could tell.
  if (id && current.settledRuns.includes(id)) return progress

  // The tricky node is practice, not progress: it banks the pool changes (the
  // words were really answered) and earns no stars and no stage advance,
  // because clearing it must not skip a stage of the ladder.
  const isTricky = stage === 'tricky'
  const stars = isTricky ? current.stars : recordStageStars(current.stars, stage, earned)

  return {
    ...current,
    stars,
    pool: pool ? normaliseProgress({ pool }).pool : current.pool,
    stagesPlayed: current.stagesPlayed + 1,
    settledRuns: id ? [...current.settledRuns, id].slice(-MAX_SETTLED_RUNS) : current.settledRuns,
    resume: null,
  }
}

/* ── keeping the document small ────────────────────────────────────── */

/**
 * Bound the pool. Mastered words go first, oldest first within each group.
 *
 * Dropping a mastered word costs its history and nothing else — it is not
 * held back from the fresh draw and it is not on the tricky list, so the
 * learner cannot tell. Dropping an UNMASTERED one would lose real learning
 * state, so it only happens when there is nothing mastered left to drop, and
 * `trimPool` reports how many of each it took.
 */
export function trimPool(pool = {}, max = MAX_POOL_WORDS) {
  const entries = Object.entries(pool)
  if (entries.length <= max) return { pool, dropped: 0, droppedUnmastered: 0 }

  const scored = entries.map(([word, raw]) => {
    const entry = { ...emptyEntry(), ...raw }
    return { word, entry, mastered: isMastered(entry), lastAt: entry.lastAt || 0 }
  })
  scored.sort((a, b) => {
    if (a.mastered !== b.mastered) return a.mastered ? -1 : 1
    return a.lastAt - b.lastAt
  })

  const dropCount = entries.length - max
  const dropped = scored.slice(0, dropCount)
  const kept = Object.fromEntries(scored.slice(dropCount).map((s) => [s.word, s.entry]))
  return {
    pool: kept,
    dropped: dropCount,
    droppedUnmastered: dropped.filter((s) => !s.mastered).length,
  }
}

/**
 * The record as it is written to Firestore. Flat, bounded, and carrying only
 * fields the rules allow — a shape the security rule can actually check.
 */
export function serialiseProgress(progress, { uid, max = MAX_POOL_WORDS } = {}) {
  const record = normaliseProgress(progress)
  const { pool } = trimPool(record.pool, max)
  return {
    uid: String(uid || ''),
    stars: record.stars,
    pool,
    stagesPlayed: record.stagesPlayed,
    settledRuns: record.settledRuns,
    resume: record.resume,
    totalStars: totalStars(record.stars),
  }
}
