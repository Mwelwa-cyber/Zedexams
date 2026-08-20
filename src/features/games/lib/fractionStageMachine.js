/**
 * The state machine for one playable stage.
 *
 * A stage has a teaching shape — answer, be told what went wrong, be offered
 * the working, walk it a step at a time, then do the SAME question again
 * unaided — and the shape is the teaching. Expressed as a handful of booleans
 * (`checking`, `showWorking`, `isRetry`, `locked`, `revealed`) it survives
 * exactly as long as nobody adds a sixth, and then the combinations nobody
 * meant start to be reachable: a Check that fires twice and scores twice, a
 * retry that still shows the answer, an advance that lands before the stage is
 * saved.
 *
 * So it is one `phase` and a transition table, and the states that must not
 * exist are simply not in it:
 *
 *   intro → asking ⇄ (marking) → right | wrong
 *   wrong → workingOffer → working → retry → asking' → right' | stillWrong
 *   right | skipped | stillWrong → next question, or complete
 *
 *   YOU CANNOT SUBMIT TWICE. `submit` is refused unless the phase is `asking`
 *   or `retrying`, and the first thing it does is leave that phase. The guard
 *   is the phase itself, so a double tap in one frame cannot pass it — which a
 *   React state flag can, because it applies on the next render.
 *
 *   THE RETRY HAS NO HELP IN IT. `showsAnswer` and `showsWorking` are derived
 *   from the phase, not stored, and both are false in `retrying`. There is no
 *   way to be in the retry AND showing the solution, because that pair of
 *   values is not a state.
 *
 *   A SKILL CANNOT BE COUNTED TWICE FOR ONE QUESTION. The outcome carries
 *   `firstTry`, and it is false for every path that went through the working
 *   or a second attempt. `recovery` is true only for a right answer given in
 *   the retry — the case the mastery rule refuses to count.
 *
 * No React, no DOM.
 */
import { hasWorking, markResponse } from './fractionQuestionCore.js'

export const PHASES = [
  'intro',        // the stage's opening card
  'asking',       // question on screen, learner working
  'right',        // correct, first attempt
  'wrong',        // incorrect, misconception named, offer standing
  'working',      // the worked solution, revealed step by step
  'retrying',     // the SAME question again, no help of any kind
  'recovered',    // right in the retry — recovery, not mastery
  'stillWrong',   // wrong in the retry too; it goes on the review list
  'skipped',      // "I see it" — help declined, miss still recorded
  'complete',     // stage finished
]

export function initialState({ intro = true, total = 0 } = {}) {
  return {
    phase: intro ? 'intro' : 'asking',
    index: 0,
    total: Math.max(0, Number(total) || 0),
    verdict: null,
    revealed: 0,
    attempts: 0,
    answered: [],
    score: 0,
  }
}

/* ── what the screen may show ──────────────────────────────────────── */

/** True only where a submission is legal. The one guard against double-scoring. */
export function canSubmit(state) {
  return state.phase === 'asking' || state.phase === 'retrying'
}

export function canEditAnswer(state) {
  return state.phase === 'asking' || state.phase === 'retrying'
}

/** The worked solution is never on screen during the retry. */
export function showsWorking(state) {
  return state.phase === 'working'
}

/**
 * Whether the right answer is visible anywhere. False in `retrying` — that is
 * the whole point of the retry, and deriving it means it cannot be set.
 */
export function showsAnswer(state) {
  return state.phase === 'right' || state.phase === 'recovered' || state.phase === 'working'
}

export function isSettled(state) {
  return ['right', 'wrong', 'recovered', 'stillWrong', 'skipped'].includes(state.phase)
}

export function canAdvance(state) {
  // A learner may move on from a wrong answer without taking the working —
  // that is `skip`. They may not move on mid-question.
  return isSettled(state)
}

/* ── transitions ───────────────────────────────────────────────────── */

export function begin(state) {
  if (state.phase !== 'intro') return state
  return { ...state, phase: 'asking' }
}

/**
 * Mark a response.
 *
 * Returns `{ state, verdict, outcome }`. `outcome` is null while the question
 * is unresolved (a blank submission, or a first wrong answer that still has a
 * retry ahead of it) and is the thing the caller records when it is not:
 * `{ questionId, skill, correct, firstTry, recovery, misconception }`.
 */
export function submit(state, question, response, { pointsFor } = {}) {
  if (!canSubmit(state)) return { state, verdict: state.verdict, outcome: null }

  const verdict = markResponse(question, response)

  // Nothing entered is not a mistake. The phase does not move, nothing is
  // recorded, and the learner is simply told the pad is empty.
  if (verdict.blank) {
    return { state: { ...state, verdict }, verdict, outcome: null }
  }

  const retry = state.phase === 'retrying'
  const attempts = state.attempts + 1

  if (verdict.correct) {
    const gained = typeof pointsFor === 'function' ? pointsFor({ firstTry: !retry, question }) : 0
    const outcome = {
      questionId: question.id,
      skill: question.skill,
      correct: true,
      firstTry: !retry,
      recovery: retry,
      misconception: null,
    }
    return {
      state: {
        ...state,
        phase: retry ? 'recovered' : 'right',
        verdict,
        attempts,
        score: state.score + gained,
      },
      verdict,
      outcome,
    }
  }

  if (retry) {
    const outcome = {
      questionId: question.id,
      skill: question.skill,
      correct: false,
      firstTry: false,
      recovery: false,
      misconception: verdict.misconception || null,
    }
    return { state: { ...state, phase: 'stillWrong', verdict, attempts }, verdict, outcome }
  }

  // First wrong answer. The miss is recorded NOW rather than when the question
  // finally resolves: whatever the learner does next — take the working, skip,
  // recover — they got it wrong, and a miss recorded later can be lost by a
  // reload in between.
  const outcome = {
    questionId: question.id,
    skill: question.skill,
    correct: false,
    firstTry: false,
    recovery: false,
    misconception: verdict.misconception || null,
  }
  return { state: { ...state, phase: 'wrong', verdict, attempts }, verdict, outcome }
}

/** "Show me the working." Only available from a wrong answer that HAS one. */
export function openWorking(state, question) {
  if (state.phase !== 'wrong') return state
  if (!hasWorking(question)) return state
  return { ...state, phase: 'working', revealed: 0 }
}

/**
 * Reveal one more step. Never more than one: a solution dropped whole is read
 * as a paragraph, and a solution walked a step at a time is read as steps.
 */
export function revealStep(state, stepCount) {
  if (state.phase !== 'working') return state
  return { ...state, revealed: Math.min(Number(stepCount) || 0, state.revealed + 1) }
}

export function allRevealed(state, stepCount) {
  return state.revealed >= (Number(stepCount) || 0)
}

/** The same question again, with everything taken away. */
export function startRetry(state) {
  if (state.phase !== 'working') return state
  return { ...state, phase: 'retrying', verdict: null }
}

/**
 * "Skip — I see it." The help is declined; the miss stays on the record,
 * because it was recorded when the wrong answer was given and this changes
 * nothing about whether the learner knew it.
 */
export function skip(state) {
  if (state.phase !== 'wrong') return state
  return { ...state, phase: 'skipped' }
}

/**
 * Move to the next question, or finish.
 *
 * The settled question is appended to `answered` HERE, once, from the phase —
 * so a caller cannot append it again by calling `next` twice, and the count on
 * the screen and the count in the snapshot are the same list.
 */
export function next(state, { alreadyAnswered = false } = {}) {
  if (!canAdvance(state)) return state
  const record = {
    index: state.index,
    correct: state.phase === 'right' || state.phase === 'recovered',
    firstTry: state.phase === 'right',
  }
  const answered = alreadyAnswered ? state.answered : [...state.answered, record]
  const index = state.index + 1
  if (index >= state.total) {
    return { ...state, phase: 'complete', answered, verdict: null, revealed: 0, attempts: 0 }
  }
  return { ...state, phase: 'asking', index, answered, verdict: null, revealed: 0, attempts: 0 }
}

/** How the stage went, for the stars and the completion card. */
export function tally(state) {
  const answered = state.answered || []
  return {
    total: state.total,
    answered: answered.length,
    correct: answered.filter((a) => a.correct).length,
    firstTry: answered.filter((a) => a.firstTry).length,
    recovered: answered.filter((a) => a.correct && !a.firstTry).length,
    missed: answered.filter((a) => !a.correct).length,
  }
}
