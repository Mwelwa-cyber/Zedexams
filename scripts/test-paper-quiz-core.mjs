/**
 * The past-paper quiz's pure logic — modes, clock, marking, review grid,
 * coaching, exam access, practice resume.
 *
 * These are the decisions the four screens are projections of. The two that
 * carry the most weight and would fail silently:
 *
 *   • the coaching gate (§4.1's hard rule). A draft explanation reaching a
 *     child is not a visible defect — it looks exactly like a working feature
 *     — so it is asserted field by field, for every non-approved status.
 *   • the clock never trusting a client counter (§1). Every reading is derived
 *     from `expiresAt`, so the test drives it with clocks that jumped,
 *     clocks that are wrong, and a resume after the paper expired.
 *
 * Run: node scripts/test-paper-quiz-core.mjs   (test:paper-quiz-core)
 */
import assert from 'node:assert/strict'

import {
  MODE_FEATURES, MODE_RULES, QUIZ_MODE, QUIZ_MODES,
  isExam, isPractice, isQuizMode, normalizeMode, rulesFor,
} from '../src/features/papers/quiz/lib/quizModes.js'
import {
  correctIndexOf, isCorrectChoice, optionLabel, optionLetter, optionText,
} from '../src/features/papers/quiz/lib/answerKey.js'
import {
  DANGER_SECONDS, SUBMIT_GRACE_SECONDS, WARN_SECONDS,
  clockOffset, formatClock, formatDuration, isExpired, remainingSeconds,
  timeUsedSeconds, timerTone,
} from '../src/features/papers/quiz/lib/examClock.js'
import {
  BAND_LABEL, barTone, chosenText, filterRows, fixupQuestionIds, fromServerRows,
  markPaper, printedNumber, reviewFilters, verdictBand,
} from '../src/features/papers/quiz/lib/attemptMarking.js'
import {
  CELL, buildGrid, gridSummary, isLastQuestion, nextIndex, prevIndex,
  submitSheetLines,
} from '../src/features/papers/quiz/lib/reviewGrid.js'
import {
  EXPLANATION_STATUS, EXPLANATION_STATUSES, coachingHeadline, coachingSubline,
  explanationCoverage, explanationStatus, mayShowProse, resolveCoaching,
  shouldCelebrateStreak,
} from '../src/features/papers/quiz/lib/coaching.js'
import {
  EXAM_ACCESS, EXAM_ACCESS_COPY, resolveExamAccess, unlockGateFor,
} from '../src/features/papers/quiz/lib/examAccess.js'
import {
  emptySession, hasResumableWork, mergeSessions, normalizeSession,
  progressDocId, resumeIndex, selectQuestions, toProgressDoc,
} from '../src/features/papers/quiz/lib/practiceSession.js'
import {
  QUIZ_EVENT, QUIZ_EVENTS, QUIZ_EVENT_PROPS, buildEventProps,
} from '../src/features/papers/quiz/lib/quizAnalytics.js'

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`)
    process.exitCode = 1
  }
}

// ── modes ────────────────────────────────────────────────────────────────
console.log('\nmodes')

test('the §1 table declares both modes with every column', () => {
  assert.deepEqual(QUIZ_MODES, [QUIZ_MODE.EXAM, QUIZ_MODE.PRACTICE])
  const columns = ['clock', 'feedback', 'navigation', 'leaving', 'resumes', 'recorded', 'offline']
  QUIZ_MODES.forEach((mode) => {
    columns.forEach((c) => {
      assert.ok(c in MODE_RULES[mode], `${mode} declares ${c}`)
    })
  })
})

test('the two modes differ on every column the spec says they differ on', () => {
  const e = MODE_RULES[QUIZ_MODE.EXAM]
  const p = MODE_RULES[QUIZ_MODE.PRACTICE]
  assert.equal(e.clock, true)
  assert.equal(p.clock, false)
  assert.equal(e.feedback, 'on_submit')
  assert.equal(p.feedback, 'instant')
  assert.equal(e.navigation, 'free')      // §1 "why exam mode still lets them go back"
  assert.equal(p.navigation, 'forward')
  assert.equal(e.leaving, 'voids')
  assert.equal(p.leaving, 'free')
  assert.equal(e.recorded, true)
  assert.equal(p.recorded, false)
  assert.equal(e.offline, false)
  assert.equal(p.offline, true)
  // Both resume. This is the one row they agree on and the one that matters
  // most: §1 calls losing a reload "a bug", not a design choice.
  assert.equal(e.resumes, true)
  assert.equal(p.resumes, true)
})

test('an unreadable mode reads as exam, never as practice', () => {
  // Downgrading a running exam to practice would drop the clock and stop
  // recording a paper the learner is part-way through.
  assert.equal(normalizeMode(undefined), QUIZ_MODE.EXAM)
  assert.equal(normalizeMode('holiday'), QUIZ_MODE.EXAM)
  assert.equal(normalizeMode(QUIZ_MODE.PRACTICE), QUIZ_MODE.PRACTICE)
  assert.equal(isQuizMode('exam'), true)
  assert.equal(isQuizMode('nope'), false)
  assert.equal(isExam('exam'), true)
  assert.equal(isPractice('practice'), true)
  assert.equal(rulesFor('junk').clock, true)
})

test('each mode card has exactly four feature columns', () => {
  // §1b: "the selected one expands to show four feature columns". Under 360px
  // they become a 2×2 grid, which only works for four.
  QUIZ_MODES.forEach((mode) => {
    assert.equal(MODE_FEATURES[mode].length, 4, `${mode} has 4 features`)
    MODE_FEATURES[mode].forEach((f) => {
      assert.ok(f.icon && f.label, 'each feature names an icon and says something')
    })
  })
})

// ── answer key ───────────────────────────────────────────────────────────
console.log('\nanswer key')

test('all five stored answer shapes resolve to the same index', () => {
  const options = ['do', 'did', 'done', 'doing']
  assert.equal(correctIndexOf({ options, correctAnswerIndex: 1 }), 1)
  assert.equal(correctIndexOf({ options, correctIndex: 1 }), 1)
  assert.equal(correctIndexOf({ options, correctAnswer: 1 }), 1)
  assert.equal(correctIndexOf({ options, correctAnswer: 'B' }), 1)
  assert.equal(correctIndexOf({ options, correctAnswer: 'did' }), 1)
  assert.equal(correctIndexOf({
    options: [{ text: 'do' }, { text: 'did', isCorrect: true }],
  }), 1)
})

test('an option whose TEXT is a letter beats reading that letter as a position', () => {
  // options ["B","C","A","D"] with key "A" means the option READING "A".
  // Getting this backwards marks a whole paper of shuffled-letter questions
  // against the learner, silently.
  assert.equal(correctIndexOf({ options: ['B', 'C', 'A', 'D'], correctAnswer: 'A' }), 2)
})

test('a rich text key is compared against a rich option on both sides', () => {
  const q = { options: ['{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"1/32"}]}]}'], correctAnswer: '1/32' }
  assert.equal(correctIndexOf(q), 0)
})

test('a question with no resolvable key returns null rather than 0', () => {
  // Returning 0 would paint option A green on every unkeyed question.
  assert.equal(correctIndexOf({ options: ['a', 'b'] }), null)
  assert.equal(correctIndexOf({}), null)
  assert.equal(isCorrectChoice({ options: ['a'] }, 0), false)
})

test('letters and labels', () => {
  assert.equal(optionLetter(0), 'A')
  assert.equal(optionLetter(25), 'Z')
  assert.equal(optionLetter(-1), '')
  assert.equal(optionLetter(null), '')
  assert.equal(optionLabel({ options: ['do', 'did'] }, 1), 'B — did')
  // Out of range names nothing rather than rendering a dangling dash.
  assert.equal(optionLabel({ options: ['do'] }, 5), '')
  assert.equal(optionText(null), '')
  assert.equal(optionText({ text: 'x' }), 'x')
})

// ── clock ────────────────────────────────────────────────────────────────
console.log('\nexam clock')

test('remaining time is derived from expiresAt, never counted down', () => {
  const expiresAt = 2_000_000
  assert.equal(remainingSeconds({ expiresAtMs: expiresAt, nowMs: 1_400_000 }), 600)
  // The app was shut for ten minutes. Time while the app was shut is time
  // spent (§1) — the number goes DOWN, it does not resume where it stopped.
  assert.equal(remainingSeconds({ expiresAtMs: expiresAt, nowMs: 2_000_000 - 1 }), 0)
  assert.equal(remainingSeconds({ expiresAtMs: expiresAt, nowMs: 9_999_999 }), 0)
})

test('device clock skew is corrected from the server reading, not guessed', () => {
  // A phone five minutes fast would otherwise be shown five minutes less.
  const offset = clockOffset(1_000_000, 1_300_000)
  assert.equal(offset, -300_000)
  assert.equal(remainingSeconds({ expiresAtMs: 1_600_000, nowMs: 1_300_000, offsetMs: offset }), 600)
  // An unmeasurable skew is a no-op rather than a fabricated correction.
  assert.equal(clockOffset(0, 5), 0)
  assert.equal(clockOffset(NaN, 5), 0)
  assert.equal(clockOffset(undefined, undefined), 0)
})

test('the tone changes at ten and five minutes and never earlier', () => {
  assert.equal(timerTone(WARN_SECONDS + 1), 'calm')
  assert.equal(timerTone(WARN_SECONDS), 'warn')
  assert.equal(timerTone(DANGER_SECONDS + 1), 'warn')
  assert.equal(timerTone(DANGER_SECONDS), 'danger')
  assert.equal(timerTone(0), 'danger')
  assert.equal(timerTone(NaN), 'calm')
})

test('expiry allows the grace window the server allows', () => {
  // §5.3: a submission arriving after expiresAt + 20s is stored `expired` and
  // scored on what arrived. The client's own auto-submit has to fire INSIDE
  // that window, not at the boundary the server is about to close.
  const expiresAt = 1_000_000
  assert.equal(isExpired({ expiresAtMs: expiresAt, nowMs: expiresAt + 1 }), false)
  assert.equal(isExpired({ expiresAtMs: expiresAt, nowMs: expiresAt + SUBMIT_GRACE_SECONDS * 1000 }), false)
  assert.equal(isExpired({ expiresAtMs: expiresAt, nowMs: expiresAt + SUBMIT_GRACE_SECONDS * 1000 + 1 }), true)
})

test('formatting', () => {
  assert.equal(formatClock(605), '10:05')
  assert.equal(formatClock(0), '0:00')
  assert.equal(formatClock(-5), '0:00')
  assert.equal(formatDuration(5400), '1h 30m')
  assert.equal(formatDuration(750), '12m 30s')
})

test('time used prefers the server stamps and never invents a number', () => {
  assert.equal(timeUsedSeconds({ startedAtMs: 1000, submittedAtMs: 61_000 }), 60)
  assert.equal(timeUsedSeconds({ durationMin: 90, secondsLeft: 600 }), 4800)
  // Neither available: null, so the screen says nothing rather than "0m 00s",
  // which is a claim.
  assert.equal(timeUsedSeconds({}), null)
})

// ── marking ──────────────────────────────────────────────────────────────
console.log('\nmarking')

const PAPER_QS = [
  { id: 'q1', n: 1, section: 'Grammar', topic: 'Articles', topicId: 'eng.art', options: ['a', 'an'], correctAnswer: 'B' },
  { id: 'q2', n: 2, section: 'Grammar', topic: 'Articles', topicId: 'eng.art', options: ['in', 'at'], correctAnswer: 'B' },
  { id: 'q3', n: 3, section: 'Grammar', topic: 'Tenses', topicId: 'eng.tense', options: ['do', 'did'], correctAnswer: 'B' },
  { id: 'q4', n: 21, section: 'Spelling', topic: 'Double letters', topicId: 'eng.dbl', options: ['x', 'y'], correctAnswer: 'A' },
]

test('a blank is its own state, not a wrong answer', () => {
  // The submit sheet counts blanks and the review list filters on them;
  // folding blank into wrong loses the one a learner can act on.
  const m = markPaper({ questions: PAPER_QS, answers: { q1: 1, q2: 0 } })
  assert.equal(m.right, 1)
  assert.equal(m.total, 4)
  assert.equal(m.blanks, 2)
  assert.equal(m.percent, 25)
  const blankRow = m.rows.find((r) => r.questionId === 'q3')
  assert.equal(blankRow.blank, true)
  assert.equal(blankRow.correct, false)
  assert.equal(blankRow.selectedIndex, null)
})

test('sections keep paper order and name their most-missed topic', () => {
  const m = markPaper({ questions: PAPER_QS, answers: { q1: 1, q2: 0, q3: 0, q4: 1 } })
  assert.deepEqual(m.bySection.map((s) => s.name), ['Grammar', 'Spelling'])
  assert.equal(m.bySection[0].right, 1)
  assert.equal(m.bySection[0].total, 3)
  assert.equal(m.bySection[0].mostMissed, 'Articles')  // 1 missed Articles… tie broken by count
  assert.equal(m.bySection[1].right, 0)
})

test('a paper that names no sections is ONE section, not none', () => {
  // Otherwise the breakdown card renders empty under a heading promising one.
  const m = markPaper({ questions: [{ id: 'a', options: ['x', 'y'], correctAnswer: 'A' }], answers: { a: 0 } })
  assert.equal(m.bySection.length, 1)
  assert.equal(m.bySection[0].name, 'The paper')
})

test('weak topics rank by marks lost and count blanks', () => {
  // Skipping every tense question is evidence about tenses, and that learner
  // is exactly who the list is for.
  const m = markPaper({ questions: PAPER_QS, answers: { q1: 1 } })
  assert.equal(m.weakTopics[0].topicId, 'eng.art')
  assert.equal(m.weakTopics[0].missed, 1)
  const tense = m.weakTopics.find((t) => t.topicId === 'eng.tense')
  assert.ok(tense, 'a blank question contributes to its topic')
  assert.deepEqual(tense.questions, [3])
})

test('a topic falls back to its label when the paper predates topicId', () => {
  const m = markPaper({
    questions: [{ id: 'a', topic: 'Fractions', options: ['x', 'y'], correctAnswer: 'A' }],
    answers: {},
  })
  assert.equal(m.weakTopics[0].topicId, 'Fractions')
})

test('the server\'s verdict is read, never re-derived', () => {
  // A disagreement means the server knows something the client does not (a
  // voided question, a question edited since). The server's row wins.
  const m = fromServerRows([
    { questionId: 'q1', n: 1, selectedIndex: 0, correctIndex: 1, correct: true, section: 'Grammar', topicId: 't' },
  ])
  assert.equal(m.rows[0].correct, true, 'correct comes from the row, not from index equality')
  assert.equal(m.right, 1)
})

test('bands and bars use one set of thresholds', () => {
  assert.equal(verdictBand(75), 'strong')
  assert.equal(verdictBand(74), 'getting_there')
  assert.equal(verdictBand(50), 'getting_there')
  assert.equal(verdictBand(49), 'needs_work')
  assert.equal(barTone(80), 'strong')
  assert.equal(barTone(60), 'ok')
  assert.equal(barTone(10), 'weak')
  assert.equal(BAND_LABEL.strong, 'Strong')
})

test('review filters count what they will show', () => {
  const m = markPaper({ questions: PAPER_QS, answers: { q1: 1, q2: 0 } })
  const filters = reviewFilters(m.rows)
  filters.forEach((f) => {
    assert.equal(filterRows(m.rows, f.id).length, f.count, `${f.id} chip count matches its rows`)
  })
})

test('the fix-up set includes blanks and keeps paper order', () => {
  const m = markPaper({ questions: PAPER_QS, answers: { q1: 1, q4: 1 } })
  assert.deepEqual(fixupQuestionIds(m.rows), ['q2', 'q3', 'q4'])
})

test('printed numbers survive, and fall back to position', () => {
  assert.equal(printedNumber({ n: 31 }, 0), 31)
  assert.equal(printedNumber({}, 4), 5)
  const m = markPaper({ questions: PAPER_QS, answers: {} })
  assert.equal(m.rows[3].n, 21)
})

test('chosenText reads the option the learner picked', () => {
  const m = markPaper({ questions: PAPER_QS, answers: { q1: 0 } })
  assert.equal(chosenText(PAPER_QS[0], m.rows[0]), 'a')
  assert.equal(chosenText(PAPER_QS[1], m.rows[1]), '')
})

// ── review grid ──────────────────────────────────────────────────────────
console.log('\nreview grid')

test('the grid prints run position, and carries the paper number alongside', () => {
  // A learner counting cells to find "the fourth one" must land on the fourth
  // cell; the results list still needs to say "question 21".
  const cells = buildGrid({ questions: PAPER_QS, answers: { q1: 1 }, flags: { q3: true }, currentIndex: 2 })
  assert.deepEqual(cells.map((c) => c.label), [1, 2, 3, 4])
  assert.equal(cells[3].printed, 21)
  assert.equal(cells[0].state, CELL.ANSWERED)
  assert.equal(cells[1].state, CELL.BLANK)
  assert.equal(cells[2].flagged, true)
  assert.equal(cells[2].current, true)
})

test('the summary and the grid cannot disagree', () => {
  const cells = buildGrid({ questions: PAPER_QS, answers: { q1: 1, q2: 0 }, flags: { q3: true, q4: true } })
  const s = gridSummary(cells)
  assert.equal(s.total, 4)
  assert.equal(s.answered, cells.filter((c) => c.state === CELL.ANSWERED).length)
  assert.equal(s.blank, cells.filter((c) => c.state === CELL.BLANK).length)
  assert.equal(s.flagged, 2)
  assert.equal(s.firstBlankIndex, 2)
})

test('no blanks means no "go to the first blank one" button', () => {
  const s = gridSummary(buildGrid({ questions: PAPER_QS, answers: { q1: 0, q2: 0, q3: 0, q4: 0 } }))
  assert.equal(s.blank, 0)
  assert.equal(s.firstBlankIndex, null)
})

test('strictForward removes the back step and nothing else', () => {
  // It never skips a question and never ends the paper early: a learner who
  // turned it on asked for a harsher rehearsal, not a shorter one.
  assert.equal(nextIndex({ currentIndex: 0, total: 4, strictForward: true }), 1)
  assert.equal(nextIndex({ currentIndex: 0, total: 4, strictForward: false }), 1)
  assert.equal(nextIndex({ currentIndex: 3, total: 4 }), 3, 'never past the end')
  assert.equal(prevIndex({ currentIndex: 2, strictForward: false }), 1)
  assert.equal(prevIndex({ currentIndex: 2, strictForward: true }), null)
  assert.equal(prevIndex({ currentIndex: 0 }), null)
  assert.equal(isLastQuestion({ currentIndex: 3, total: 4 }), true)
})

test('the submit sheet always makes the guess argument when there are blanks', () => {
  const lines = submitSheetLines({ blank: 3, flagged: 2 })
  assert.match(lines[0].text, /3 questions are still blank/)
  assert.match(lines[0].text, /a guess costs you nothing/)
  assert.match(lines[1].text, /flagged 2 questions/)
  assert.equal(submitSheetLines({ blank: 0, flagged: 0 }).length, 0)
  assert.match(submitSheetLines({ blank: 1, flagged: 0 })[0].text, /1 question is still blank/)
})

// ── coaching: the hard rule ──────────────────────────────────────────────
console.log('\ncoaching (§4.1 hard rule)')

const RICH_Q = {
  options: ['a', 'an'],
  correctAnswer: 'B',
  why: 'Umbrella begins with a vowel sound.',
  distractors: { A: 'A is used before a consonant sound.' },
  example: 'an apple · an hour',
  noteRef: 'english/articles',
  gameSlug: 'word-builder',
}

test('an UNAPPROVED explanation renders the answer and NOTHING else', () => {
  // The failure this guards is invisible: a draft AI sentence explaining an
  // exam answer to a child looks exactly like a working feature.
  const proseFields = ['why', 'mistake', 'example', 'noteRef', 'gameSlug']
  const notApproved = [undefined, null, 'missing', 'ai_draft', 'pending', 'APPROVED', 'approved ']
  notApproved.forEach((status) => {
    const c = resolveCoaching({
      question: { ...RICH_Q, explanationStatus: status },
      selectedIndex: 0,
      correctIndex: 1,
    })
    assert.equal(c.approved, false, `status ${JSON.stringify(status)} is not approved`)
    proseFields.forEach((f) => {
      assert.equal(c[f], '', `status ${JSON.stringify(status)} leaks no ${f}`)
    })
    // …but the answer is still there. Unexplained is not unmarked, and the
    // answer is free on every plan, permanently.
    assert.equal(c.answerLabel, 'B — an')
    assert.equal(c.answerLetter, 'B')
  })
})

test('an approved explanation renders every block', () => {
  const c = resolveCoaching({
    question: { ...RICH_Q, explanationStatus: 'approved' },
    selectedIndex: 0,
    correctIndex: 1,
  })
  assert.equal(c.approved, true)
  assert.equal(c.why, RICH_Q.why)
  assert.equal(c.mistake, RICH_Q.distractors.A)
  assert.equal(c.example, RICH_Q.example)
  assert.equal(c.noteRef, 'english/articles')
  assert.equal(c.gameSlug, 'word-builder')
})

test('"why yours is wrong" is scoped to the option they actually picked', () => {
  // "Why B is wrong" when they picked C is the generic feedback this section
  // exists to replace.
  const q = {
    ...RICH_Q,
    explanationStatus: 'approved',
    options: ['a', 'an', 'the'],
    distractors: { A: 'about A', C: 'about C' },
  }
  assert.equal(resolveCoaching({ question: q, selectedIndex: 0, correctIndex: 1 }).mistake, 'about A')
  assert.equal(resolveCoaching({ question: q, selectedIndex: 2, correctIndex: 1 }).mistake, 'about C')
})

test('a correct answer never shows a mistake block', () => {
  // Beside a right answer it reads as an accusation about an option they did
  // not choose.
  const c = resolveCoaching({
    question: { ...RICH_Q, explanationStatus: 'approved' },
    selectedIndex: 1,
    correctIndex: 1,
  })
  assert.equal(c.correct, true)
  assert.equal(c.mistake, '')
  assert.equal(c.why, RICH_Q.why, 'why is still shown when they were right')
})

test('status reads fail closed', () => {
  assert.equal(explanationStatus({}), EXPLANATION_STATUS.MISSING)
  assert.equal(explanationStatus({ explanationStatus: 'nonsense' }), EXPLANATION_STATUS.MISSING)
  assert.equal(mayShowProse({ explanationStatus: 'approved' }), true)
  assert.equal(mayShowProse({}), false)
  assert.deepEqual(EXPLANATION_STATUSES, ['missing', 'ai_draft', 'approved'])
})

test('praise is seeded on the question, not random', () => {
  // Re-rendering the same question (a resize, a settings change, a resume)
  // must not reshuffle the words on a panel the learner is mid-sentence in.
  assert.equal(coachingHeadline({ correct: true, seed: 7 }), coachingHeadline({ correct: true, seed: 7 }))
  assert.equal(coachingHeadline({ correct: false, seed: 7 }), 'Not quite')
})

test('the subline names the right answer when they were wrong', () => {
  const wrong = resolveCoaching({ question: RICH_Q, selectedIndex: 0, correctIndex: 1 })
  assert.match(coachingSubline(wrong), /The correct answer is B — an/)
  const right = resolveCoaching({ question: RICH_Q, selectedIndex: 1, correctIndex: 1 })
  assert.match(coachingSubline(right), /right one/)
})

test('a streak celebrates every third correct answer only', () => {
  assert.equal(shouldCelebrateStreak(3), true)
  assert.equal(shouldCelebrateStreak(6), true)
  assert.equal(shouldCelebrateStreak(2), false)
  assert.equal(shouldCelebrateStreak(0), false)
})

test('coverage counts approved only', () => {
  const c = explanationCoverage([
    { explanationStatus: 'approved' },
    { explanationStatus: 'ai_draft' },
    {},
  ])
  assert.equal(c.approved, 1)
  assert.equal(c.drafted, 1)
  assert.equal(c.missing, 1)
  assert.equal(Math.round(c.coverage * 100), 33)
  assert.equal(explanationCoverage([]).total, 0)
})

// ── exam access ──────────────────────────────────────────────────────────
console.log('\nexam access')

test('exam mode needs the whole paper; practice does not', () => {
  const partial = { coversWholePaper: false }
  assert.deepEqual(
    resolveExamAccess({ signedIn: true, unlocked: false, freeSet: partial, totalQuestions: 60 }),
    { allowed: false, reason: EXAM_ACCESS.NEEDS_FULL_PAPER },
  )
  assert.equal(resolveExamAccess({ signedIn: true, unlocked: true, freeSet: partial, totalQuestions: 60 }).allowed, true)
})

test('a paper whose free set covers all of it is sittable by everybody', () => {
  assert.equal(
    resolveExamAccess({ signedIn: true, unlocked: false, freeSet: { coversWholePaper: true }, totalQuestions: 20 }).allowed,
    true,
  )
})

test('signed out and empty are their own reasons, and neither is a paywall', () => {
  assert.equal(
    resolveExamAccess({ signedIn: false, unlocked: false, freeSet: {}, totalQuestions: 60 }).reason,
    EXAM_ACCESS.SIGNED_OUT,
  )
  assert.equal(
    resolveExamAccess({ signedIn: true, unlocked: true, freeSet: {}, totalQuestions: 0 }).reason,
    EXAM_ACCESS.NO_QUESTIONS,
  )
  // Offering an unlock for either would charge for something that would not help.
  assert.equal(unlockGateFor(EXAM_ACCESS.SIGNED_OUT), null)
  assert.equal(unlockGateFor(EXAM_ACCESS.NO_QUESTIONS), null)
  assert.equal(unlockGateFor(EXAM_ACCESS.NEEDS_FULL_PAPER), 'PAPER_CONTINUE')
})

test('every refusal names what the learner CAN do (§8: never a dead end)', () => {
  Object.values(EXAM_ACCESS).filter((r) => r !== EXAM_ACCESS.OK).forEach((reason) => {
    const copy = EXAM_ACCESS_COPY[reason]
    assert.ok(copy && copy.title && copy.body, `${reason} has copy`)
  })
  assert.match(EXAM_ACCESS_COPY[EXAM_ACCESS.NEEDS_FULL_PAPER].body, /Practice/)
  assert.match(EXAM_ACCESS_COPY[EXAM_ACCESS.SIGNED_OUT].body, /Practice works right now/)
})

test('no refusal mentions a price, a plan or a currency (§8)', () => {
  const text = JSON.stringify(EXAM_ACCESS_COPY)
  ;[/kwacha/i, /ZMW/, /K\d/, /\bprice\b/i, /\bpremium\b/i, /\bplan\b/i, /\bpay\b/i, /\bsubscri/i]
    .forEach((re) => assert.equal(re.test(text), false, `copy is free of ${re}`))
})

// ── practice resume ──────────────────────────────────────────────────────
console.log('\npractice resume')

test('two devices union their answers rather than newest-wins', () => {
  // Newest-wins would discard six questions of answered, coached, understood
  // work because the other device happened to sync later.
  const merged = mergeSessions(
    { lastQuestionN: 10, answered: { a: 1, b: 0 }, updatedAt: 5 },
    { lastQuestionN: 4, answered: { a: 2, c: 1 }, updatedAt: 9 },
  )
  assert.deepEqual(merged.answered, { a: 1, b: 0, c: 1 })
  assert.equal(merged.answered.a, 1, 'the local answer wins a conflict')
  assert.equal(merged.lastQuestionN, 10, 'the cursor takes the further position')
})

test('resume opens on the first UNANSWERED question', () => {
  // lastQuestionN + 1 drops a learner onto a question they have already been
  // coached through, which reads as the app having forgotten.
  const qs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  assert.equal(resumeIndex({ questions: qs, answered: { a: 1, c: 0 } }), 1)
  assert.equal(resumeIndex({ questions: qs, answered: {} }), 0)
  // Everything answered opens on the LAST question, not off the end, so the
  // footer offers "See how you did" instead of a blank screen.
  assert.equal(resumeIndex({ questions: qs, answered: { a: 1, b: 1, c: 1 } }), 2)
  assert.equal(resumeIndex({ questions: [], answered: {} }), 0)
})

test('a corrupt stored answer is dropped, not rendered as a selection', () => {
  const s = normalizeSession({ answered: { a: 1, b: 'B', c: -1, d: null } })
  assert.deepEqual(s.answered, { a: 1 })
  assert.deepEqual(normalizeSession(null).answered, {})
  assert.equal(emptySession('p').paperId, 'p')
})

test('the progress document records a cursor, never a score', () => {
  // §1: practice is not recorded. The way that promise breaks is a resume
  // document that accumulates enough to be reported on later.
  const doc = toProgressDoc(
    { lastQuestionN: 3, answered: { a: 1 } },
    { learnerId: 'u1', paperId: 'p1' },
  )
  assert.deepEqual(Object.keys(doc).sort(), ['answered', 'lastQuestionN', 'learnerId', 'paperId'])
  ;['score', 'correct', 'right', 'percent'].forEach((k) => {
    assert.equal(k in doc, false, `the progress doc carries no ${k}`)
  })
  assert.equal(progressDocId('u1', 'p1'), 'u1_p1')
})

test('resumable work means started but not finished', () => {
  assert.equal(hasResumableWork({ answered: { a: 1 } }, 4), true)
  assert.equal(hasResumableWork({ answered: {} }, 4), false)
  assert.equal(hasResumableWork({ answered: { a: 1, b: 1, c: 1, d: 1 } }, 4), false)
})

test('a fix-up set keeps the paper\'s order, not the Set\'s', () => {
  const picked = selectQuestions(PAPER_QS, ['q4', 'q1'])
  assert.deepEqual(picked.map((q) => q.id), ['q1', 'q4'])
})

// ── analytics ────────────────────────────────────────────────────────────
console.log('\nanalytics')

test('every declared event has a declared property list', () => {
  QUIZ_EVENTS.forEach((e) => {
    assert.ok(Array.isArray(QUIZ_EVENT_PROPS[e]), `${e} declares its properties`)
  })
  assert.equal(QUIZ_EVENTS.length, Object.keys(QUIZ_EVENT_PROPS).length)
})

test('the §7 funnel steps are all present', () => {
  ;['quiz_mode_selected', 'exam_started', 'exam_abandoned', 'exam_submitted', 'exam_timeup',
    'practice_started', 'practice_answer', 'coaching_shown', 'fixup_started',
    'note_opened_from_result', 'game_opened_from_result']
    .forEach((name) => assert.ok(QUIZ_EVENTS.includes(name), `${name} is declared`))
})

test('an undeclared property cannot ride along', () => {
  // A paper title, a question stem or a uid in scope at the call site.
  const props = buildEventProps(QUIZ_EVENT.EXAM_SUBMITTED, {
    percent: 70, blanks: 2, stem: 'I ..... my homework', uid: 'abc',
  })
  assert.deepEqual(props, { percent: 70, blanks: 2 })
  assert.deepEqual(buildEventProps('not_an_event', { a: 1 }), {})
})

console.log(`\n${passed} assertions passed\n`)
