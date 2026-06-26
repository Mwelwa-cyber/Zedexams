/**
 * Tests for the paper completion-time estimator + duration comparison.
 *
 * Run: node src/utils/assessmentTiming.test.js
 */

import {
  estimateQuestionMinutes, estimatePaperMinutes, analyzeTiming,
} from './assessmentTiming.js'

let failures = 0
function assert(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`)
  else { failures += 1; console.error(`  ✗ ${msg}`) }
}

console.log('estimateQuestionMinutes — type matters')
{
  const mcq = estimateQuestionMinutes({ type: 'mcq', marks: 1 })
  const essay = estimateQuestionMinutes({ type: 'essay', marks: 1 })
  assert(essay > mcq, 'an essay mark costs more time than an MCQ mark')
  assert(estimateQuestionMinutes({ type: 'essay', marks: 6 }) > estimateQuestionMinutes({ type: 'essay', marks: 2 }), 'more marks → more time')
  assert(estimateQuestionMinutes({}) > 0, 'defaults to a positive estimate')
  // Clamps absurd marks so one corrupt value can't blow up the estimate.
  assert(estimateQuestionMinutes({ type: 'mcq', marks: 9999 }) <= 0.75 + 0.25 * 50, 'marks are clamped')
}

console.log('\nestimatePaperMinutes')
{
  const mins = estimatePaperMinutes([
    { type: 'mcq', marks: 1 }, { type: 'mcq', marks: 1 },
    { type: 'essay', marks: 6 },
  ])
  assert(mins === Math.round(1 + 1 + (3 + 2 * 6)), 'sums per-question estimates and rounds')
  assert(estimatePaperMinutes([]) === 0, 'empty paper → 0 minutes')
}

console.log('\nanalyzeTiming — verdict vs duration')
{
  // ~15 min of essay work in a 60-min slot → comfortably under.
  const under = analyzeTiming({ duration: 60 }, [{ type: 'essay', marks: 6 }])
  assert(under.verdict === 'under', 'well below the allowed time → under')

  // A pile of essays in a 20-min slot → over.
  const over = analyzeTiming({ duration: 20 }, Array.from({ length: 5 }, () => ({ type: 'essay', marks: 6 })))
  assert(over.verdict === 'over', 'far above the allowed time → over')
  assert(over.estimatedMinutes > over.duration, 'estimate exceeds duration when over')

  // Roughly matched.
  const ok = analyzeTiming({ duration: 4 }, [{ type: 'mcq', marks: 1 }, { type: 'mcq', marks: 1 }, { type: 'short_answer', marks: 1 }])
  assert(ok.verdict === 'ok', 'estimate near the duration → ok')

  const none = analyzeTiming({}, [{ type: 'mcq', marks: 1 }])
  assert(none.verdict === 'no-duration' && none.ratio === null, 'no duration set → no comparison')
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`)
  process.exit(1)
}
console.log('\nAll assessmentTiming tests passed.')
