/**
 * Every combination the required check can be asked to judge.
 *
 * The point of enumerating them exhaustively rather than testing the happy path
 * is that the failures here are all silent. A gate that passes on a cancelled
 * render, or on a skip it should have refused, looks exactly like a gate that
 * passed on a comparison — a green tick and no evidence behind it.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 */

import assert from 'node:assert/strict'
import { gateVerdict, JOB_RESULTS } from './gateVerdict.js'

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (err) {
    console.error(`  ✗   ${name}\n      ${err.message}`)
    process.exitCode = 1
  }
}

const verdict = (over) => gateVerdict({ scopeResult: 'success', requiresVisual: 'false', visualResult: 'skipped', ...over })

console.log('\n— the two outcomes that are allowed to pass —')

test('a required render that succeeded passes', () => {
  const v = verdict({ requiresVisual: 'true', visualResult: 'success', summary: '3 files can affect printed output.' })
  assert.equal(v.passed, true)
  assert.equal(v.conclusion, 'compared')
  assert.match(v.message, /3 files can affect printed output/)
})

test('an unaffected pull request passes without rendering', () => {
  const v = verdict({ summary: 'Printed output not affected — none of the 4 changed files can reach a rendered paper.' })
  assert.equal(v.passed, true)
  assert.equal(v.conclusion, 'unaffected')
  assert.match(v.message, /not affected/)
})

console.log('\n— and everything else fails —')

test('a required render that was SKIPPED fails', () => {
  // The dangerous one: on the run page a skipped job is a tidy grey tick, not a
  // hole. Nothing was compared, so nothing is known.
  const v = verdict({ requiresVisual: 'true', visualResult: 'skipped' })
  assert.equal(v.passed, false)
  assert.equal(v.conclusion, 'visual-skipped')
  assert.match(v.message, /skipped render is not a pass/)
})

test('a required render that was CANCELLED fails', () => {
  const v = verdict({ requiresVisual: 'true', visualResult: 'cancelled' })
  assert.equal(v.passed, false)
  assert.equal(v.conclusion, 'visual-cancelled')
  assert.match(v.message, /unverified/)
})

test('a required render that failed fails', () => {
  const v = verdict({ requiresVisual: 'true', visualResult: 'failure' })
  assert.equal(v.passed, false)
  assert.equal(v.conclusion, 'visual-failed')
})

test('scope resolution failing fails, whatever the render did', () => {
  // Including when the render somehow succeeded: if the scope could not be
  // resolved, the run does not know what it was supposed to compare.
  for (const visualResult of JOB_RESULTS) {
    for (const scopeResult of ['failure', 'cancelled', 'skipped', '']) {
      const v = verdict({ scopeResult, visualResult, requiresVisual: 'true' })
      assert.equal(v.passed, false, `scope ${scopeResult || '(none)'} / visual ${visualResult}`)
      assert.equal(v.conclusion, 'scope-failed')
    }
  }
})

test('an unaffected pull request whose render ran anyway and FAILED still fails', () => {
  // The paper it rendered is the paper this pull request produces. "We did not
  // expect this to matter" is not a reason to accept a broken render.
  const v = verdict({ requiresVisual: 'false', visualResult: 'failure' })
  assert.equal(v.passed, false)
  assert.equal(v.conclusion, 'visual-failed')
  assert.match(v.message, /even though the changed files were not expected/)
})

test('an unaffected pull request whose render ran and passed still passes', () => {
  const v = verdict({ requiresVisual: 'false', visualResult: 'success' })
  assert.equal(v.passed, true)
  assert.equal(v.conclusion, 'compared')
})

console.log('\n— the whole matrix, so nothing is undefined —')

test('every scope/visual/required combination has a verdict, and only two shapes pass', () => {
  const passing = []
  for (const scopeResult of JOB_RESULTS) {
    for (const visualResult of [...JOB_RESULTS, '']) {
      for (const requiresVisual of ['true', 'false']) {
        const v = gateVerdict({ scopeResult, visualResult, requiresVisual })
        assert.equal(typeof v.passed, 'boolean', `${scopeResult}/${visualResult}/${requiresVisual}`)
        assert.ok(v.message.length > 0, 'every verdict explains itself')
        if (v.passed) passing.push(`${scopeResult}/${visualResult}/${requiresVisual}`)
      }
    }
  }
  // Enumerated rather than counted: a new passing combination should have to be
  // written down here on purpose.
  assert.deepEqual(passing.sort(), [
    'success//false',
    'success/skipped/false',
    'success/success/false',
    'success/success/true',
  ])
})

test('a missing requiresVisual is treated as NOT required rather than crashing', () => {
  // It can only be missing if the scope job failed to write it, and that path
  // is already caught by the scope check — this pins that the fallback is
  // defined rather than undefined.
  const v = gateVerdict({ scopeResult: 'success', visualResult: 'skipped' })
  assert.equal(v.passed, true)
  assert.equal(v.conclusion, 'unaffected')
})

if (!process.exitCode) {
  console.log(`\n✓ visual gate verdict — ${passed} tests passed`)
}
