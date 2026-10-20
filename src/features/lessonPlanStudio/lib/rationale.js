/**
 * The lesson-plan RATIONALE has four parts, in both curricula (CBC and OBC):
 *
 *   1. the lesson content (what the lesson is about),
 *   2. the value or importance of the lesson to learners,
 *   3. the teaching methods to be used,
 *   4. the position of the lesson: "This is lesson K in a series of N."
 *
 * Parts 1–3 can only be asked for, so the wording lives here once and both
 * system prompts and the condense pass quote it. Part 4 is a fact the studio
 * already knows, so it is also checked after generation. A rationale that came
 * back (or was condensed) without its position sentence gets one appended
 * instead of going out to the teacher incomplete.
 */

export const RATIONALE_DIRECTIVE =
  'RATIONALE — one short paragraph with FOUR parts, in this order: (1) the lesson content, what the lesson is about; (2) the value or importance of the lesson to learners; (3) the teaching methods to be used (for example question and answer, group work, demonstration, discovery); (4) the position of the lesson, ending with the sentence "This is lesson K in a series of N." All four parts are required, even when the rationale is short.'

export const CONDENSE_RATIONALE_RULE =
  '- A "rationale" cell must keep all four parts: the lesson content, the value or importance to learners, the teaching methods, and its closing sentence "This is lesson K in a series of N." Write it as short full sentences, not fragments.'

/** The position sentence for lesson `k` of `n`. */
export function rationalePositionSentence(k, n) {
  const lesson = Math.max(1, Number(k) || 1)
  const total = Math.max(lesson, Number(n) || 1)
  return `This is lesson ${lesson} in a series of ${total}.`
}

/** The prompt line telling the model the lesson's position. */
export function rationalePositionPromptLine(k, n) {
  return `- Rationale position: end the rationale with "${rationalePositionSentence(k, n)}"`
}

// "lesson 2 in a series of 3", "lesson is number 1 in the series of 2",
// "lesson 1 of 4", "the first of three lessons".
const POSITION_RE = /\bseries\s+of\s+\w+|\blesson\s+(?:number\s+)?\w+\s+of\s+\w+|\b\w+\s+of\s+\w+\s+lessons\b/i

/** True when the text already states the lesson's position in its series. */
export function hasRationalePosition(text) {
  return POSITION_RE.test(String(text || ''))
}

/**
 * Append the position sentence to a rationale that lacks one. An empty
 * rationale stays empty (the section may be switched off, or omitted at a
 * one-page budget), and a rationale written in a local language is left alone,
 * because an English sentence tacked onto it is worse than none.
 *
 * @param {object} plan
 * @param {{lessonNumber:number, totalLessons:number, localLanguage?:boolean}} position
 * @returns {object} the same plan when nothing changes
 */
export function ensureRationalePosition(plan, { lessonNumber, totalLessons, localLanguage = false }) {
  if (!plan || typeof plan !== 'object' || localLanguage) return plan
  const text = typeof plan.rationale === 'string' ? plan.rationale.trim() : ''
  if (!text || hasRationalePosition(text)) return plan
  const joiner = /[.!?]$/.test(text) ? ' ' : '. '
  return { ...plan, rationale: `${text}${joiner}${rationalePositionSentence(lessonNumber, totalLessons)}` }
}
