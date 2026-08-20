/**
 * Fraction PROGRESS — stages inside a level, what "mastered" means, which
 * questions come back, and the stars.
 *
 * The ladder module already answers which LEVELS are open. This answers
 * everything inside one, and it exists as a module because every rule in it
 * fails silently on screen: a stage that awards its stars twice looks like a
 * generous stage, a skill marked mastered after one lucky retry looks like a
 * learner who has learnt something.
 *
 *   A LEVEL IS A LADDER OF SHORT STAGES, DECLARED BY THE CONTENT.
 *   `stagesForLevel` reads the `stage` field the pack puts on each question —
 *   it does not slice a list into fives. "Adding fractions" is four skills in
 *   order (same bottom, one bottom fits, no common bottom, answer over one)
 *   and where those boundaries fall is a teaching decision.
 *
 *   MASTERY IS THREE FIRST-TRY CORRECTS IN THREE SEPARATE SESSIONS.
 *   `recordCorrect` refuses a second count from the same session, exactly as
 *   the spelling pool does, because three rights in one sitting is short-term
 *   memory. And a right answer given straight after reading the worked
 *   solution is NOT one of the three: it goes through `recordRecovery`, which
 *   moves the skill to `recovering` and schedules it to come back. Seeing a
 *   solution and repeating it is recovery. Recalling it unaided a week later
 *   is mastery, and only the second one counts.
 *
 *   A MISS RESETS THE COUNT, NOT THE HISTORY. `misses` keeps climbing — it is
 *   what makes a skill tricky — while the mastery count goes back to zero.
 *
 *   A STAGE IS REWARDED ONCE. `recordStage` keeps the BEST star count per
 *   stage and never adds a second entry, so replaying a stage can improve a
 *   result and can never inflate one. Replay stays open at every level, which
 *   is the reason the guard has to be here rather than in the caller.
 *
 *   THE DRAW IS DETERMINISTIC. Same stage, same pool, same salt → the same
 *   questions, so a refresh is not a reshuffle and a test can drive it.
 *
 * No React, no DOM.
 */
import { FRACTION_LEVELS, levelById } from './fractionLadderCore.js'
import { hashString, seededRng, shuffleWith } from './spellingStagesCore.js'

export const MASTERY_SESSIONS = 3
export const REVIEW_PER_STAGE = 2
/** Next stage but one, then a few stages later, then later still. */
export const SPACING = [2, 5, 11]
export const PROGRESS_VERSION = 2

export const MASTERY_STATES = ['new', 'learning', 'needs_review', 'recovering', 'mastered']

/* ── the skill pool ────────────────────────────────────────────────── */

export function emptySkill() {
  return {
    correct: 0,
    sessions: [],
    misses: 0,
    recoveries: 0,
    dueAt: 0,
    lastMissedAt: 0,
    lastCorrectAt: 0,
    codes: {},
  }
}

export function skillEntry(pool, skill) {
  return pool?.[skill] ? { ...emptySkill(), ...pool[skill] } : emptySkill()
}

/**
 * The state of one skill.
 *
 * `recovering` sits between `needs_review` and `learning` on purpose: the
 * learner has answered it right, so it is no longer simply missed, but the
 * right answer came after help and it has not yet been recalled unaided.
 */
export function masteryState(entry = {}) {
  const e = { ...emptySkill(), ...entry }
  if (e.correct >= MASTERY_SESSIONS) return 'mastered'
  if (e.recoveries > 0 && e.correct === 0) return 'recovering'
  if (e.misses > 0 && e.correct === 0) return 'needs_review'
  if (e.correct > 0 || e.misses > 0 || e.recoveries > 0) return 'learning'
  return 'new'
}

export function isMastered(entry) {
  return masteryState(entry) === 'mastered'
}

export function sessionsToMastery(entry) {
  return Math.max(0, MASTERY_SESSIONS - (entry?.correct || 0))
}

function scheduleReturn(entry, stage) {
  const step = SPACING[Math.min(SPACING.length - 1, entry.correct || 0)]
  return { ...entry, dueAt: Number(stage) + step }
}

/**
 * A first-try correct answer. Counted once per session — the line that says
 * three rights in one sitting is not mastery.
 */
export function recordCorrect(pool = {}, skill, { session, stage = 0, at = 0 } = {}) {
  if (!skill) return pool
  const entry = skillEntry(pool, skill)
  if (entry.sessions.includes(session)) {
    return { ...pool, [skill]: { ...entry, lastCorrectAt: at || entry.lastCorrectAt } }
  }
  const next = scheduleReturn({
    ...entry,
    correct: (entry.correct || 0) + 1,
    sessions: [...entry.sessions, session],
    lastCorrectAt: at || entry.lastCorrectAt,
  }, stage)
  return { ...pool, [skill]: next }
}

/**
 * A right answer given straight after the worked solution.
 *
 * It clears nothing and proves nothing about recall, so it does not touch the
 * mastery count. What it does is schedule the skill to come back — the whole
 * point of the retry is that the learner meets this again with no help.
 */
export function recordRecovery(pool = {}, skill, { stage = 0, at = 0 } = {}) {
  if (!skill) return pool
  const entry = skillEntry(pool, skill)
  const next = scheduleReturn({
    ...entry,
    recoveries: (entry.recoveries || 0) + 1,
    lastCorrectAt: at || entry.lastCorrectAt,
  }, stage)
  return { ...pool, [skill]: next }
}

/** A miss. The mastery count goes back to zero; the miss history does not. */
export function recordMiss(pool = {}, skill, { stage = 0, code = null, at = 0 } = {}) {
  if (!skill) return pool
  const entry = skillEntry(pool, skill)
  const codes = { ...entry.codes }
  if (code) codes[code] = (codes[code] || 0) + 1
  const next = scheduleReturn({
    ...entry,
    correct: 0,
    sessions: [],
    misses: (entry.misses || 0) + 1,
    lastMissedAt: at || entry.lastMissedAt,
    codes,
  }, stage)
  return { ...pool, [skill]: next }
}

/** Skills still being worked on whose spacing interval has elapsed. */
export function dueSkills(pool = {}, stage = 0) {
  return Object.entries(pool)
    .filter(([, raw]) => {
      const entry = { ...emptySkill(), ...raw }
      return !isMastered(entry) && Number(stage) >= (entry.dueAt || 0)
    })
    .map(([skill]) => skill)
}

/**
 * The review list a learner sees — every skill missed and not yet mastered,
 * worst first, with the misconception that keeps coming back.
 */
export function reviewList(pool = {}) {
  return Object.entries(pool)
    .filter(([, raw]) => (raw?.misses || 0) > 0 && !isMastered({ ...emptySkill(), ...raw }))
    .map(([skill, raw]) => {
      const entry = { ...emptySkill(), ...raw }
      const topCode = Object.entries(entry.codes || {}).sort((a, b) => b[1] - a[1])[0]
      return {
        skill,
        misses: entry.misses,
        recoveries: entry.recoveries,
        state: masteryState(entry),
        code: topCode ? topCode[0] : null,
        toMastery: sessionsToMastery(entry),
      }
    })
    .sort((a, b) => b.misses - a.misses || a.skill.localeCompare(b.skill))
}

/* ── stages ────────────────────────────────────────────────────────── */

/**
 * A level's stages, in order, from the pack's own `stage` numbers.
 *
 * A question with no `stage` lands in stage 1 rather than being dropped — an
 * older pack that predates stages still plays as one stage per level, which is
 * exactly what it was before.
 */
export function stagesForLevel(game, levelId) {
  const all = Array.isArray(game?.questions) ? game.questions : []
  const mine = all.filter((q) => q.level === levelId)
  const byStage = new Map()
  for (const question of mine) {
    const key = Number(question.stage) || 1
    if (!byStage.has(key)) byStage.set(key, [])
    byStage.get(key).push(question)
  }
  return [...byStage.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([number, questions], index) => ({
      number,
      index,
      levelId,
      title: questions.find((q) => q.stageTitle)?.stageTitle || `Stage ${number}`,
      blurb: questions.find((q) => q.stageBlurb)?.stageBlurb || '',
      questions,
    }))
}

export function stageKey(levelId, stageNumber) {
  return `${levelId}:${stageNumber}`
}

/**
 * The questions a stage actually plays: its own, plus up to two questions the
 * learner has missed before and whose spacing has elapsed.
 *
 * The review questions are drawn from EARLIER stages only. A question from
 * later in the ladder would be teaching a skill the learner has not reached,
 * which is a different failure from the one review is for.
 */
export function composeStage({
  game,
  levelId,
  stageNumber,
  pool = {},
  salt = '',
  reviewLimit = REVIEW_PER_STAGE,
} = {}) {
  const stages = stagesForLevel(game, levelId)
  const stage = stages.find((s) => s.number === Number(stageNumber)) || stages[0]
  if (!stage) return { questions: [], review: [], stage: null }

  const own = [...stage.questions]
  const ordinal = globalStageOrdinal(game, levelId, stage.number)
  const due = new Set(dueSkills(pool, ordinal))
  const ownSkills = new Set(own.map((q) => q.skill))

  const earlier = earlierQuestions(game, levelId, stage.number)
    .filter((q) => due.has(q.skill) && !ownSkills.has(q.skill))

  // Deterministic: same stage, same pool, same salt → the same review draw.
  const rng = seededRng(hashString(`${salt}|${levelId}|${stage.number}|${[...due].sort().join(',')}`))
  const seenSkills = new Set()
  const review = []
  for (const question of shuffleWith(earlier, rng)) {
    if (review.length >= reviewLimit) break
    if (seenSkills.has(question.skill)) continue
    seenSkills.add(question.skill)
    review.push(question)
  }

  // Review first: a learner meets the thing they got wrong while they are
  // freshest, and the stage's own new material follows.
  return { questions: [...review, ...own], review: review.map((q) => q.id), stage }
}

/** Every question in the pack before this stage, ladder order. */
export function earlierQuestions(game, levelId, stageNumber) {
  const all = Array.isArray(game?.questions) ? game.questions : []
  const order = levelById(levelId)?.order ?? 0
  return all.filter((q) => {
    const qOrder = levelById(q.level)?.order ?? 0
    if (qOrder < order) return true
    if (qOrder > order) return false
    return (Number(q.stage) || 1) < Number(stageNumber)
  })
}

/**
 * A stage's position across the WHOLE ladder, which is what the spacing counts
 * in. Counting within a level would make a skill missed in the last stage of
 * level 2 come due again in the first stage of level 3 — two stages later by
 * the number, one stage later in the learner's day.
 */
export function globalStageOrdinal(game, levelId, stageNumber) {
  let n = 0
  for (const level of FRACTION_LEVELS) {
    for (const stage of stagesForLevel(game, level.id)) {
      if (level.id === levelId && stage.number === Number(stageNumber)) return n
      n += 1
    }
  }
  return n
}

export function totalStages(game) {
  return FRACTION_LEVELS.reduce((sum, level) => sum + stagesForLevel(game, level.id).length, 0)
}

/* ── stars ─────────────────────────────────────────────────────────── */

/**
 * Stars for a stage. Accuracy only, and FIRST-TRY accuracy — never speed,
 * because speed is not the skill and a clock filters out exactly the readers
 * who need the practice most.
 */
export function starsForStage(firstTryCorrect, total) {
  const size = Math.max(1, Number(total) || 1)
  const right = Math.max(0, Number(firstTryCorrect) || 0)
  if (right >= size) return 3
  if (right >= Math.ceil(size * 0.75)) return 2
  if (right >= Math.ceil(size * 0.4)) return 1
  return 0
}

/* ── the whole progress record ─────────────────────────────────────── */

export function emptyProgress() {
  return { version: PROGRESS_VERSION, stars: {}, pool: {}, sessions: 0, resume: null }
}

/**
 * Read a stored progress record, whatever shape it is in.
 *
 * The first version of this game stored a bare array of passed level ids. A
 * learner who has climbed four levels on their phone must not open the app to
 * an empty ladder because the shape changed, so a legacy array is read as four
 * levels' worth of full stars rather than discarded.
 */
export function readProgress(raw) {
  if (Array.isArray(raw)) {
    return { ...emptyProgress(), legacyPassed: raw.filter((id) => typeof id === 'string') }
  }
  if (!raw || typeof raw !== 'object') return emptyProgress()
  return {
    ...emptyProgress(),
    ...raw,
    stars: raw.stars && typeof raw.stars === 'object' ? raw.stars : {},
    pool: raw.pool && typeof raw.pool === 'object' ? raw.pool : {},
    legacyPassed: Array.isArray(raw.legacyPassed) ? raw.legacyPassed : [],
  }
}

/** The stars earned on one stage, 0 when it has not been played. */
export function starsFor(progress, levelId, stageNumber) {
  return Number(progress?.stars?.[stageKey(levelId, stageNumber)]) || 0
}

export function stageDone(progress, levelId, stageNumber) {
  return Object.prototype.hasOwnProperty.call(progress?.stars || {}, stageKey(levelId, stageNumber))
}

/**
 * Record a finished stage. Best-of, and idempotent: a replay can raise a star
 * count and can never add a second reward for the same stage.
 */
export function recordStage(progress, levelId, stageNumber, stars) {
  const key = stageKey(levelId, stageNumber)
  const current = Number(progress?.stars?.[key]) || 0
  const earned = Math.max(0, Math.min(3, Number(stars) || 0))
  return {
    ...progress,
    stars: { ...(progress?.stars || {}), [key]: Math.max(current, earned) },
  }
}

/**
 * A level is passed when every stage in it has been played — not when a score
 * crossed a line. A learner who scrapes one star still moves on, which is the
 * rule the ladder has held since it was written: `levelState` has nowhere to
 * read a score, and neither does this.
 */
export function levelPassed(progress, game, levelId) {
  if ((progress?.legacyPassed || []).includes(levelId)) return true
  const stages = stagesForLevel(game, levelId)
  if (!stages.length) return false
  return stages.every((stage) => stageDone(progress, levelId, stage.number))
}

export function passedLevels(progress, game) {
  return FRACTION_LEVELS.filter((level) => levelPassed(progress, game, level.id)).map((l) => l.id)
}

export function levelStars(progress, game, levelId) {
  const stages = stagesForLevel(game, levelId)
  const earned = stages.reduce((sum, stage) => sum + starsFor(progress, levelId, stage.number), 0)
  return { earned, possible: stages.length * 3 }
}

export function totalStars(progress, game) {
  return FRACTION_LEVELS.reduce((acc, level) => {
    const { earned, possible } = levelStars(progress, game, level.id)
    return { earned: acc.earned + earned, possible: acc.possible + possible }
  }, { earned: 0, possible: 0 })
}

/** The next stage a learner should play in a level, or null when all are done. */
export function nextStageNumber(progress, game, levelId) {
  const stages = stagesForLevel(game, levelId)
  const open = stages.find((stage) => !stageDone(progress, levelId, stage.number))
  return open ? open.number : (stages[0]?.number ?? null)
}

/* ── refresh recovery ──────────────────────────────────────────────── */

/**
 * The mid-stage snapshot.
 *
 * A learner who reloads three questions into a stage must not lose them, and
 * must not be paid twice for them either. The snapshot holds the answered
 * question ids and their outcomes — so resuming replays neither the questions
 * nor the rewards — and is CLEARED the moment the stage is recorded, because a
 * snapshot that outlives its stage is how a finished stage reopens itself.
 */
export function snapshotStage({ levelId, stageNumber, index, answered = [], score = 0, session = '' }) {
  return {
    levelId,
    stageNumber: Number(stageNumber),
    index: Number(index) || 0,
    answered: answered.map((a) => ({ id: a.id, correct: !!a.correct, firstTry: !!a.firstTry })),
    score: Number(score) || 0,
    session,
  }
}

/**
 * Is this snapshot still playable against this pack?
 *
 * A snapshot for a stage that no longer exists — the pack was edited, a
 * question was pulled — is refused rather than resumed onto a different set of
 * questions, which would show a learner an answered count that does not match
 * what is in front of them.
 */
export function resumable(progress, game) {
  const resume = progress?.resume
  if (!resume?.levelId) return null
  const stages = stagesForLevel(game, resume.levelId)
  const stage = stages.find((s) => s.number === Number(resume.stageNumber))
  if (!stage) return null
  if (stageDone(progress, resume.levelId, resume.stageNumber)) return null
  if (!Array.isArray(resume.answered) || !resume.answered.length) return null
  return resume
}

export function clearResume(progress) {
  return { ...progress, resume: null }
}
