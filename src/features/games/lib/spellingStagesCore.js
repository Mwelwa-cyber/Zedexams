/**
 * Pure logic for spelling PROGRESS — the word pool, mastery, and the spacing
 * that decides when a missed word comes back.
 *
 * Ported from docs/learner/zedexams-spelling-stages.html. The Word Builder
 * engine already spells words; what it had no model of is whether a learner
 * has actually LEARNT one. Four rules carry that, and each is here rather than
 * in the component because each fails silently on screen:
 *
 *   MASTERY IS THREE RIGHTS IN THREE SEPARATE SESSIONS. Three in one sitting is
 *   short-term memory — the learner can still see the word they just spelled.
 *   `recordCorrect` refuses to count a second right answer from the same
 *   session, so a word cannot be mastered in one round however many times it
 *   comes up.
 *
 *   A MISS RESETS THE COUNT, NOT THE HISTORY. `misses` keeps climbing (it is
 *   what makes a word "tricky") while `correct` and `sessions` go back to
 *   zero, because a word you have just got wrong is not two-thirds learnt.
 *
 *   A WORD COMES BACK ON ITS SPACING SCHEDULE AND NO OTHER WAY. 2 stages, then
 *   5, then 11. `composeStage` excludes EVERY unmastered word from the "new"
 *   draw, not just the ones it picked — otherwise a word missed in stage 4
 *   arrives in stage 5 as a fresh word, and the spacing quietly never happens.
 *
 *   THE DRAW IS DETERMINISTIC. Same stage, same learner, same pool → the same
 *   eight words, so a reload is not a reshuffle and a test can drive it.
 *
 * No React, no DOM. `rng` is injectable everywhere a shuffle happens.
 */

export const STAGE_WORDS = 8
export const POOL_PER_STAGE = 3
export const MASTERY_SESSIONS = 3
export const TRICKY_GATE = 10

/** Next stage but one, then a few stages later, then later still. */
export const SPACING = [2, 5, 11]

/* ── deterministic randomness ──────────────────────────────────────── */

export function hashString(text) {
  let h = 2166136261
  for (let i = 0; i < String(text).length; i += 1) {
    h ^= String(text).charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** mulberry32 — small, seeded, and good enough to deal eight words. */
export function seededRng(seed) {
  let a = seed >>> 0
  return function next() {
    a += 0x6d2b79f5
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function shuffleWith(list, rng) {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/* ── the pool ──────────────────────────────────────────────────────── */

/** `{ correct, sessions: [id], misses, dueAt }` per word. */
export function emptyEntry() {
  return { correct: 0, sessions: [], misses: 0, dueAt: 0 }
}

export function entryFor(pool, word) {
  return pool?.[word] ? { ...emptyEntry(), ...pool[word] } : emptyEntry()
}

export function isMastered(entry) {
  return (entry?.correct || 0) >= MASTERY_SESSIONS
}

export function sessionsToMastery(entry) {
  return Math.max(0, MASTERY_SESSIONS - (entry?.correct || 0))
}

/** When a word next becomes eligible: 2 stages out, then 5, then 11. */
export function scheduleReturn(entry, stage) {
  const step = SPACING[Math.min(SPACING.length - 1, entry.correct || 0)]
  return { ...entry, dueAt: Number(stage) + step }
}

/**
 * A right answer. Counted only ONCE per session — three rights in one sitting
 * is not mastery, and this is the line that says so.
 */
export function recordCorrect(pool, word, { session, stage = 0 } = {}) {
  const entry = entryFor(pool, word)
  if (entry.sessions.includes(session)) return { ...pool, [word]: entry }
  const next = scheduleReturn({
    ...entry,
    correct: (entry.correct || 0) + 1,
    sessions: [...entry.sessions, session],
  }, stage)
  return { ...pool, [word]: next }
}

/** A miss. The count goes back to zero; the miss history does not. */
export function recordMiss(pool, word, { stage = 0 } = {}) {
  const entry = entryFor(pool, word)
  const next = scheduleReturn({
    ...entry,
    correct: 0,
    sessions: [],
    misses: (entry.misses || 0) + 1,
  }, stage)
  return { ...pool, [word]: next }
}

/** Words still being worked on, whose spacing interval has elapsed. */
export function dueWords(pool = {}, stage = 0) {
  return Object.entries(pool)
    .filter(([, raw]) => {
      const entry = { ...emptyEntry(), ...raw }
      return !isMastered(entry) && Number(stage) >= (entry.dueAt || 0)
    })
    .map(([word]) => word)
}

/** Every word not yet mastered — due or not. */
export function heldWords(pool = {}) {
  return new Set(
    Object.entries(pool)
      .filter(([, raw]) => !isMastered({ ...emptyEntry(), ...raw }))
      .map(([word]) => word),
  )
}

/** The tricky-word pool: enough missed words to be worth its own practice. */
export function trickyWords(pool = {}) {
  return Object.entries(pool)
    .filter(([, raw]) => (raw?.misses || 0) > 0 && !isMastered({ ...emptyEntry(), ...raw }))
    .sort((a, b) => (b[1].misses || 0) - (a[1].misses || 0))
    .map(([word]) => word)
}

export function trickyPoolOpen(pool = {}) {
  return trickyWords(pool).length >= TRICKY_GATE
}

/**
 * The words for one stage: due words first (capped), then fresh ones.
 *
 * `items` are the pack's playable words in whatever shape the engine uses —
 * each must have a `word`. The return keeps that shape, so the caller does not
 * have to look anything up again.
 */
export function composeStage({ items = [], pool = {}, stage = 0, salt = '', size = STAGE_WORDS } = {}) {
  const byWord = new Map(items.map((item) => [item.word, item]))
  const rng = seededRng(hashString(`${stage}|${salt}|${Object.keys(pool).sort().join(',')}`))

  const due = dueWords(pool, stage).map((word) => byWord.get(word)).filter(Boolean)
  const fromPool = shuffleWith(due, rng).slice(0, POOL_PER_STAGE)

  // Every unmastered word is held back from the "new" draw, not just the ones
  // picked above — otherwise a word missed last stage returns immediately as a
  // fresh word and its spacing never happens.
  const held = heldWords(pool)
  const fresh = shuffleWith(items.filter((item) => !held.has(item.word)), rng)
    .slice(0, Math.max(0, size - fromPool.length))

  // A pack too small to fill the stage falls back to repeating due words
  // rather than serving fewer — but the shortfall is reported, not hidden.
  const words = shuffleWith([...fresh, ...fromPool], rng)
  return {
    words,
    fromPool: fromPool.map((item) => item.word),
    shortfall: Math.max(0, size - words.length),
  }
}

/** Accuracy only. Never time. */
export function starsForStage(firstTimeCorrect, size = STAGE_WORDS) {
  if (firstTimeCorrect >= size) return 3
  if (firstTimeCorrect >= Math.ceil(size * 0.75)) return 2
  return 1
}
