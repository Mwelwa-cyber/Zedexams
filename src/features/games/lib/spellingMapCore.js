/**
 * The spelling LADDER — chapters, stages, locks and stars.
 *
 * `spellingStagesCore.js` already knew how to compose one stage and whether a
 * word was learnt. What it had no model of is the shape a learner climbs: a
 * path of numbered stages grouped into chapters, some cleared, one live, the
 * rest locked, with a gold node that belongs to nobody else.
 *
 * Four decisions are here rather than in the screen, because each of them is
 * wrong in a way a rendered map still looks fine:
 *
 *   A CHAPTER IS A DIFFICULTY BAND, NOT A TOPIC. The bands in
 *   `src/data/spellingBank.js` group words by WHAT MAKES THEM HARD — silent
 *   letters, double letters, -ie/-ei, suffix rules — and their declared order
 *   IS the ladder. Grouping by topic instead would give a child eight stages
 *   that are each a random mix of easy and impossible.
 *
 *   A STAGE DRAWS FROM ITS OWN CHAPTER. `composeStage` takes whatever pool it
 *   is handed, so it will happily deal a silent-letter word inside the double
 *   letters chapter. `wordsForStage` is what stops that: it filters the bank
 *   to the stage's band first, and the chapter heading then describes the
 *   stage honestly.
 *
 *   STARS ARE KEPT, NEVER REPLACED. A replay that goes worse must not take a
 *   3★ away — the whole point of "nothing is lost by replaying" is that a
 *   learner can practise a cleared stage without risk. `recordStageStars`
 *   is a max, not an assignment.
 *
 *   THE TRICKY NODE IS PERSONAL AND POSITIONAL. It appears only when a
 *   learner has enough unmastered words to be worth a stage of their own, and
 *   it sits immediately before the stage they are on — so two children on
 *   stage 24 do not have the same map. It is never "the next stage": clearing
 *   it does not advance the ladder, because it is practice, not progress.
 *
 * Pure. No React, no DOM, no Firebase.
 */

import { STAGE_WORDS, trickyWords, TRICKY_GATE, composeStage } from './spellingStagesCore.js'

/** The id of the personal tricky-words node. Never a number. */
export const TRICKY_STAGE = 'tricky'

/** How many of a learner's tricky words one tricky stage takes on. */
export const TRICKY_STAGE_WORDS = 8

/** A short practice run, for the "just do 5 of them" door. */
export const TRICKY_SHORT_WORDS = 5

/**
 * How many stages a chapter is worth.
 *
 * Floor, so a chapter never offers a stage it cannot fill — a chapter whose
 * last stage repeats four words because the band ran out is the "same words
 * again" complaint the ladder exists to answer. A band too small for even one
 * stage yields none and simply does not appear.
 */
export function stagesInChapter(wordCount, size = STAGE_WORDS) {
  return Math.max(0, Math.floor(Number(wordCount || 0) / size))
}

/**
 * The chapters of a grade, each with the stage numbers it owns.
 *
 * `bands` is the ordered band table (`{ id, title, blurb }`) and `counts` is
 * `bandId → number of words`. Stage numbers are 1-based and run CONTINUOUSLY
 * across chapters, because that is the number the learner sees on the node
 * and it has to keep counting up when a chapter ends.
 */
export function buildChapters({ bands = [], counts = {}, size = STAGE_WORDS } = {}) {
  const chapters = []
  let next = 1
  for (const band of bands) {
    const count = Number(counts?.[band.id] || 0)
    const stageCount = stagesInChapter(count, size)
    if (stageCount <= 0) continue
    const first = next
    next += stageCount
    chapters.push({
      id: band.id,
      title: band.title,
      blurb: band.blurb || '',
      wordCount: count,
      stageCount,
      firstStage: first,
      lastStage: next - 1,
      index: chapters.length + 1,
    })
  }
  return chapters.map((chapter) => ({ ...chapter, total: chapters.length }))
}

/**
 * The chapter table for a set of words, from the DECLARED band table plus
 * whatever the words actually carry.
 *
 * The declared table (`SPELLING_BANDS`) is the difficulty ladder and its order
 * is the order a learner climbs, so it always comes first. But a game document
 * may carry its own words with bands the table has never heard of — or with no
 * band at all — and such a game must still get a ladder rather than an empty
 * map. Anything unrecognised is appended AFTER the declared bands, in the order
 * it was met, and a word with no band lands in one implicit chapter.
 *
 * The fallback exists because the alternative failed silently: a game with its
 * own eight words rendered a map with no chapters, no stages and no way in.
 */
export function chapterTableFor(items = [], declared = []) {
  const counts = {}
  let unbanded = 0
  const order = []
  for (const item of items) {
    const band = item?.band || null
    if (!band) { unbanded += 1; continue }
    if (!(band in counts)) order.push(band)
    counts[band] = (counts[band] || 0) + 1
  }

  const known = new Map((declared || []).map((band) => [band.id, band]))
  const bands = (declared || []).filter((band) => counts[band.id])
  for (const id of order) {
    if (known.has(id)) continue
    bands.push({ id, title: titleFromBandId(id), blurb: '' })
  }
  if (unbanded) {
    counts[UNBANDED] = unbanded
    bands.push({ id: UNBANDED, title: 'Spelling practice', blurb: 'Words from this game.' })
  }
  return { bands, counts }
}

/** The catch-all chapter for words that declare no band. */
export const UNBANDED = '_unbanded'

/** A readable chapter name for a band id nothing declared. */
function titleFromBandId(id) {
  return String(id)
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim() || 'Spelling'
}

/** The chapter a stage number belongs to, or null past the end of the ladder. */
export function chapterForStage(chapters, stage) {
  const n = Number(stage)
  return chapters.find((c) => n >= c.firstStage && n <= c.lastStage) || null
}

/** Every stage number on the ladder, in order. */
export function lastStageNumber(chapters) {
  return chapters.length ? chapters[chapters.length - 1].lastStage : 0
}

/* ── stars ─────────────────────────────────────────────────────────── */

/**
 * Record a stage result. The better of the two survives, always.
 *
 * Returns the stars map unchanged when the new result is not an improvement,
 * so a caller can compare by identity and skip a pointless write.
 */
export function recordStageStars(stars = {}, stage, earned) {
  const key = String(stage)
  const now = Math.max(0, Math.min(3, Math.floor(Number(earned) || 0)))
  const held = Math.max(0, Math.min(3, Math.floor(Number(stars?.[key]) || 0)))
  if (now <= held) return stars
  return { ...stars, [key]: now }
}

/** Stars held for a stage — 0 for one never cleared. */
export function starsFor(stars = {}, stage) {
  return Math.max(0, Math.min(3, Math.floor(Number(stars?.[String(stage)]) || 0)))
}

/** Every star the learner has earned across the ladder. */
export function totalStars(stars = {}) {
  return Object.values(stars || {}).reduce(
    (sum, value) => sum + Math.max(0, Math.min(3, Math.floor(Number(value) || 0))),
    0,
  )
}

/* ── the map ───────────────────────────────────────────────────────── */

/**
 * The stage a learner is on: the first one they have not cleared.
 *
 * Derived from the stars map rather than stored, so it cannot disagree with
 * what the map draws. A learner who has cleared everything sits on the last
 * stage — replayable, never a locked dead end.
 */
export function currentStage(stars = {}, chapters = []) {
  const last = lastStageNumber(chapters)
  for (let stage = 1; stage <= last; stage += 1) {
    if (starsFor(stars, stage) <= 0) return stage
  }
  return last || 1
}

/** Is a stage open to play? Everything up to and including the current one. */
export function stageUnlocked(stars, chapters, stage) {
  return Number(stage) <= currentStage(stars, chapters)
}

/**
 * The whole map, ready to render.
 *
 * Every node carries its own state so the screen never recomputes one:
 *   `done`    — cleared, replayable, shows its stars
 *   `current` — the one to play now
 *   `locked`  — not yet reachable
 *   `tricky`  — the personal node (no number, no stars, never locked)
 */
export function buildStageMap({ bands = [], counts = {}, stars = {}, pool = {}, size = STAGE_WORDS } = {}) {
  const chapters = buildChapters({ bands, counts, size })
  const now = currentStage(stars, chapters)
  const tricky = trickyWords(pool)
  const trickyOpen = tricky.length >= TRICKY_GATE

  const withNodes = chapters.map((chapter) => {
    const nodes = []
    for (let stage = chapter.firstStage; stage <= chapter.lastStage; stage += 1) {
      // The gold node sits immediately BEFORE the stage the learner is on, so
      // it is the thing they meet on the way rather than a detour they have
      // to go looking for.
      if (trickyOpen && stage === now) {
        nodes.push({ id: TRICKY_STAGE, kind: 'tricky', state: 'tricky', words: tricky.length })
      }
      const earned = starsFor(stars, stage)
      nodes.push({
        id: String(stage),
        kind: 'stage',
        stage,
        band: chapter.id,
        stars: earned,
        state: earned > 0 ? 'done' : stage === now ? 'current' : stage < now ? 'done' : 'locked',
      })
    }
    const cleared = nodes.filter((n) => n.kind === 'stage' && n.stars > 0).length
    return {
      ...chapter,
      nodes,
      cleared,
      // A chapter is "open" once the ladder has reached it. A locked chapter
      // still renders — greyed, with its name — because seeing what is coming
      // is most of what makes a ladder feel like one.
      locked: chapter.firstStage > now,
      progressPct: chapter.stageCount ? Math.round((cleared / chapter.stageCount) * 100) : 0,
    }
  })

  return {
    chapters: withNodes,
    currentStage: now,
    currentChapter: chapterForStage(withNodes, now),
    lastStage: lastStageNumber(withNodes),
    totalStars: totalStars(stars),
    trickyOpen,
    trickyCount: tricky.length,
    trickyWords: tricky,
  }
}

/* ── composing a stage from its own chapter ────────────────────────── */

/**
 * The words for one stage — drawn from the stage's OWN chapter.
 *
 * `items` are every playable word for the grade, each carrying the `band` it
 * belongs to. Filtering happens here rather than inside `composeStage` so
 * that function stays the one thing it is good at: dealing a set out of a
 * pool under a spacing rule.
 *
 * A stage whose band has fewer words than the pool it draws from falls back
 * to the WHOLE grade rather than serving a short stage — reported through
 * `narrowed`, never hidden.
 */
export function wordsForStage({ items = [], pool = {}, stage = 1, band = null, salt = '', size = STAGE_WORDS } = {}) {
  const inBand = !band
    ? items
    : band === UNBANDED
      ? items.filter((item) => !item.band)
      : items.filter((item) => item.band === band)
  const enough = inBand.length >= size
  const composed = composeStage({
    items: enough ? inBand : items,
    pool,
    stage: Number(stage),
    salt: `${salt}|${band || 'all'}`,
    size,
  })
  return { ...composed, band, narrowed: !enough }
}

/**
 * The words for the personal tricky stage: the learner's own missed words,
 * worst first, capped.
 *
 * No spacing rule applies — the learner chose to take these on, and the
 * whole point of the node is that it is the list they keep getting wrong.
 * A word the pack no longer serves is dropped rather than faked.
 */
export function wordsForTrickyStage({ items = [], pool = {}, size = TRICKY_STAGE_WORDS } = {}) {
  const byWord = new Map(items.map((item) => [item.word, item]))
  const words = trickyWords(pool)
    .map((word) => byWord.get(word) || byWord.get(String(word).toUpperCase()))
    .filter(Boolean)
    .slice(0, Math.max(1, size))
  return { words, fromPool: words.map((item) => item.word), shortfall: 0, band: null, narrowed: false }
}
