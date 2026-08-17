/**
 * parentalGateCore — the arithmetic gate and the limit formatter.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites"). Lives under
 * src/ because the module does, and runs under plain node because it has no
 * DOM in it — the reason it was split out of the component in the first place.
 */

import assert from 'node:assert/strict'
import { makeGateChallenge, checkGateAnswer, formatDailyLimit } from './parentalGateCore.js'

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

console.log('\nparentalGateCore')

test('the challenge states the sum it is asking', () => {
  const c = makeGateChallenge(() => 0)
  assert.equal(c.answer, c.a * c.b)
  assert.equal(c.prompt, `What is ${c.a} × ${c.b}?`)
})

test('the factors avoid the tables a Grade 7 has memorised', () => {
  // 1, 2, 5 and 10 make the gate a reflex rather than a step.
  const rng = mockSequence([0, 0.99, 0.5, 0.2, 0.7, 0.35, 0.05, 0.85])
  for (let i = 0; i < 200; i += 1) {
    const c = makeGateChallenge(rng)
    for (const f of [c.a, c.b]) {
      assert.ok(![1, 2, 5, 10].includes(f), `${f} is too easy to be in the pool`)
      assert.ok(f >= 3 && f <= 12, `${f} is outside the pool`)
    }
  }
})

test('the challenge varies', () => {
  // A gate that always asks 7 × 8 is a gate whose answer is 56.
  const seen = new Set()
  for (let i = 0; i < 100; i += 1) seen.add(makeGateChallenge().prompt)
  assert.ok(seen.size > 5, `expected varied prompts, got ${seen.size}`)
})

test('the right answer passes and a wrong one does not', () => {
  const c = { a: 7, b: 8, answer: 56 }
  assert.equal(checkGateAnswer('56', c), true)
  assert.equal(checkGateAnswer(56, c), true)
  assert.equal(checkGateAnswer('57', c), false)
  assert.equal(checkGateAnswer('5', c), false)
})

test('whitespace and a stray comma are forgiven', () => {
  // Rejecting a right answer for a formatting reason reads as a broken app.
  const c = { answer: 1056 }
  assert.equal(checkGateAnswer('  1056 ', c), true)
  assert.equal(checkGateAnswer('1,056', c), true)
})

test('an empty or non-numeric answer is refused by decision, not by accident', () => {
  const c = { answer: 56 }
  for (const input of ['', '   ', null, undefined, 'fifty six', '5 6a', '-56']) {
    assert.equal(checkGateAnswer(input, c), false, `input=${String(input)}`)
  }
})

test('a missing challenge never passes', () => {
  assert.equal(checkGateAnswer('56', null), false)
  assert.equal(checkGateAnswer('0', {}), false)
  // NaN === NaN is false, so this already refuses — but relying on that is how
  // the next comparison gets written the other way round.
  assert.equal(checkGateAnswer('56', { answer: undefined }), false)
})

test('the daily limit reads as a sentence, including when there is none', () => {
  assert.equal(formatDailyLimit(null), 'No limit')
  assert.equal(formatDailyLimit(undefined), 'No limit')
  assert.equal(formatDailyLimit(0), 'No limit')
  assert.equal(formatDailyLimit(30), '30m')
  assert.equal(formatDailyLimit(60), '1h')
  assert.equal(formatDailyLimit(90), '1h 30m')
  assert.equal(formatDailyLimit(180), '3h')
  assert.equal(formatDailyLimit('nonsense'), 'No limit')
})

function mockSequence(values) {
  let i = 0
  return () => values[(i += 1) % values.length]
}

console.log(`\nparentalGateCore: ${passed} passed`)
