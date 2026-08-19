/**
 * Pure decisions for the /games hub. No React, no Firebase — so the rules
 * that decide what a learner is shown test under plain node.
 *
 * These exist because the hub had TWO answers to "what grade is this
 * learner": the daily-quiz hero read the grade off whatever game the
 * rotation happened to pick, and the live-challenge card read it off the
 * profile. A Grade 7 learner saw "TODAY'S QUIZ · GRADE 3" beside
 * "Grade 7", for the same child, on the same screen. One function now
 * answers it, and both heroes render the result.
 */

/**
 * The learner's grade, or null when there isn't one.
 *
 * Null is a real state, not a failure: /games is a PUBLIC route, so a
 * signed-out visitor genuinely has no grade. Callers must treat null as
 * "do not scope and do not claim a grade" rather than substituting a
 * default — a hard-coded `|| 7` is what put "Grade 7" on a card for a
 * learner who had never said so.
 */
export function resolveLearnerGrade(userProfile) {
  const raw = Number(userProfile?.grade)
  return Number.isFinite(raw) && raw > 0 ? raw : null
}

/**
 * The game of `type` to show a learner in `grade`.
 *
 * Returns null rather than another grade's game. The previous rule ended
 * `|| ofType[0]`, which is how a Grade 7 learner got `math_memory_g6` —
 * a Grade 6 MATHEMATICS pack — rendered under the "Meaning Match"
 * mechanic name, while `english_meaning_match_g7` sat unused in the same
 * catalogue. A missing card is honest; a card from the wrong grade is a
 * wrong answer delivered confidently.
 *
 * A null grade (signed out) is not scoped — there is no grade to be wrong
 * about — so the first match wins and the hub still shows a catalogue.
 */
export function pickGameForGrade(pool, type, grade) {
  const ofType = (Array.isArray(pool) ? pool : []).filter((g) => g?.type === type)
  if (!ofType.length) return null
  if (grade == null) return ofType[0]
  return ofType.find((g) => Number(g.grade) === grade) || null
}

/**
 * Whether a daily-challenge pick may be shown to this learner.
 *
 * The rotation is grade-scoped at the query, but an admin override for a
 * given date is not — it names one game id. Rather than trust it blindly,
 * the grade is checked here too: an override for another grade is refused
 * and the caller falls through to the scoped rotation. Belt and braces on
 * the one rule this screen exists to keep.
 */
export function challengeMatchesGrade(game, grade) {
  if (!game) return false
  if (grade == null) return true
  return Number(game.grade) === grade
}

/**
 * The single status pill on a game card: Play / Best <n> / New.
 *
 * Replaces a progress BAR, which measured nothing it claimed to. Three of
 * five games rendered a 0%-filled track beside "Not played yet", and a
 * best SCORE is not a completion percentage — Word Builder's bar read
 * full at "Best 120", which means nothing at all. A score is a number, so
 * it is shown as a number.
 */
export function gameStatusPill(game, best, { now = 0 } = {}) {
  const score = Number(best) || 0
  if (score > 0) return { kind: 'best', label: `Best ${score}` }
  const created = game?.createdAt?.toMillis?.() || game?.createdAt || 0
  const isNew = Boolean(created && now && now - created < 1000 * 60 * 60 * 24 * 30)
  if (isNew) return { kind: 'new', label: 'New' }
  return { kind: 'play', label: 'Play' }
}

/**
 * The one meta line under a game's name: `Subject · Topic`.
 *
 * One line, not two wrapping chips — the chips are what made Meaning
 * Match ~40px taller than Punctuation Pro and broke the "every card is
 * the same height" property the list depends on. The separator is only
 * rendered when there are two parts, so a game with no CBC topic reads
 * "English" rather than "English · ".
 */
export function gameMetaLine(subjectLabel, topic) {
  return [subjectLabel, topic].map((p) => String(p || '').trim()).filter(Boolean).join(' · ')
}
