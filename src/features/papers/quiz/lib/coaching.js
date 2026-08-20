/**
 * What the coaching panel is allowed to say.
 *
 * ── The hard rule (§4.1) ─────────────────────────────────────────────────
 *
 * "If `explanationStatus !== 'approved'`, the coaching panel renders the
 * correct answer and nothing else. An unreviewed AI sentence never explains an
 * exam answer to a child."
 *
 * That is enforced HERE, in one function, rather than by each of the four
 * blocks checking for itself — because the failure mode is a block that
 * forgets. `resolveCoaching` returns a shape whose prose fields are EMPTY
 * unless the gate passed, so a component that renders whatever it is handed
 * cannot leak a draft. `test:paper-quiz-coaching` asserts exactly that: for
 * every non-approved status, every prose field comes back empty while the
 * answer still comes back.
 *
 * ── Why the answer is still shown ────────────────────────────────────────
 *
 * A learner who has committed to an answer and is told nothing has been
 * charged for the attempt and paid nothing. The answer is free on every plan,
 * permanently, and it does not depend on an author having written prose about
 * it. Unexplained is not the same as unmarked.
 *
 * Pure: node-tested.
 */

import { optionLabel, optionLetter, optionText } from './answerKey.js'

export const EXPLANATION_STATUS = Object.freeze({
  MISSING: 'missing',
  AI_DRAFT: 'ai_draft',
  APPROVED: 'approved',
})

/** Every value the field may hold, for the rules enum and the studio. */
export const EXPLANATION_STATUSES = Object.freeze([
  EXPLANATION_STATUS.MISSING,
  EXPLANATION_STATUS.AI_DRAFT,
  EXPLANATION_STATUS.APPROVED,
])

/**
 * Read the status off a question.
 *
 * Fails CLOSED, twice over. An unrecognised value reads as `missing`, and a
 * question with no field at all reads as `missing` rather than as approved —
 * so every question authored before this pipeline existed shows its answer and
 * no prose, which is the safe half of the rule. A paper does not become
 * explained by the field being absent.
 */
export function explanationStatus(question) {
  const raw = question?.explanationStatus
  return EXPLANATION_STATUSES.includes(raw) ? raw : EXPLANATION_STATUS.MISSING
}

/** True only for a human-approved explanation. */
export function mayShowProse(question) {
  return explanationStatus(question) === EXPLANATION_STATUS.APPROVED
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Everything the coaching panel renders, for one answered question.
 *
 * @param {object} args
 * @param {object} args.question
 * @param {number|null} args.selectedIndex  what the learner picked
 * @param {number|null} args.correctIndex   the resolved key
 * @returns {{
 *   correct: boolean, approved: boolean,
 *   answerLetter: string, answerLabel: string,
 *   why: string, mistake: string, example: string,
 *   noteRef: string, gameSlug: string,
 * }}
 */
export function resolveCoaching({ question, selectedIndex, correctIndex }) {
  const approved = mayShowProse(question)
  const correct = Number.isInteger(selectedIndex)
    && Number.isInteger(correctIndex)
    && selectedIndex === correctIndex

  const base = {
    correct,
    approved,
    answerLetter: optionLetter(correctIndex),
    answerLabel: optionLabel(question, correctIndex),
    chosenLetter: optionLetter(selectedIndex),
    chosenLabel: optionLabel(question, selectedIndex),
    why: '',
    mistake: '',
    example: '',
    noteRef: '',
    gameSlug: '',
  }
  if (!approved) return base

  // `distractors` is keyed by LETTER on the stored question ({A: '…'}), which
  // is what an author writes and what the marking scheme uses. The panel knows
  // an index, so the lookup converts — and it is scoped to the option the
  // learner actually picked, because "why B is wrong" when they picked C is
  // the generic feedback this whole section exists to replace.
  const distractors = question?.distractors && typeof question.distractors === 'object'
    ? question.distractors
    : {}
  const chosenLetter = optionLetter(selectedIndex)

  return {
    ...base,
    why: cleanText(question?.why),
    // Only when they got it wrong. Shown beside a correct answer it reads as
    // an accusation about an option they did not choose.
    mistake: correct ? '' : cleanText(distractors[chosenLetter]),
    example: cleanText(question?.example),
    noteRef: cleanText(question?.noteRef),
    gameSlug: cleanText(question?.gameSlug),
  }
}

/**
 * The panel's headline. Praise is varied so a learner answering forty
 * questions is not told "Nice one!" forty times, and the variation is SEEDED
 * on the question rather than random: re-rendering the same question (a
 * resize, a settings change, a resume) must not reshuffle the words on a panel
 * the learner is reading.
 */
const PRAISE = Object.freeze(['Nice one!', 'Well done!', "That's it!", 'Correct!', 'Sharp!'])

export function coachingHeadline({ correct, seed = 0 }) {
  if (!correct) return 'Not quite'
  const i = Math.abs(Math.floor(Number(seed) || 0)) % PRAISE.length
  return PRAISE[i]
}

/**
 * The line under the headline.
 *
 * When they were wrong it NAMES the right answer, because that is the one
 * thing every learner wants first and the one thing the hard rule guarantees
 * regardless of whether prose exists.
 */
export function coachingSubline(coaching) {
  if (coaching.correct) {
    return coaching.chosenLetter
      ? `You picked ${coaching.chosenLetter} — that's the right one.`
      : "That's the right one."
  }
  return coaching.answerLabel
    ? `The correct answer is ${coaching.answerLabel}`
    : 'Have another look at this one.'
}

/**
 * A streak celebrates every third consecutive correct answer (§3). Nothing
 * negative animates, so there is no counterpart for a run of wrong ones.
 */
export function shouldCelebrateStreak(streak) {
  const s = Number(streak)
  return Number.isInteger(s) && s > 0 && s % 3 === 0
}

/**
 * How much of a paper carries approved prose. Shown to ADMINS in the studio;
 * learners never see it (§6) — an unexplained question simply shows its
 * answer, and a learner told "this paper is 40% explained" learns only that
 * they may have drawn the bad 60%.
 */
export function explanationCoverage(questions = []) {
  const list = Array.isArray(questions) ? questions : []
  if (list.length === 0) return { approved: 0, drafted: 0, missing: 0, total: 0, coverage: 0 }
  let approved = 0
  let drafted = 0
  list.forEach((q) => {
    const s = explanationStatus(q)
    if (s === EXPLANATION_STATUS.APPROVED) approved += 1
    else if (s === EXPLANATION_STATUS.AI_DRAFT) drafted += 1
  })
  return {
    approved,
    drafted,
    missing: list.length - approved - drafted,
    total: list.length,
    coverage: approved / list.length,
  }
}

/** The plain text of the correct option — used by the review list. */
export function correctText(question, correctIndex) {
  const options = Array.isArray(question?.options) ? question.options : []
  return optionText(options[correctIndex])
}
