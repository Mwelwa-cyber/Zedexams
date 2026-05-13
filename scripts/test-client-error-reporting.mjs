#!/usr/bin/env node
/**
 * Tests for the client-side error reporter:
 *   - sanitises browser-shaped inputs into { name, message } reliably
 *   - rate-limits to MAX_EVENTS_PER_SESSION per page session
 *   - deduplicates identical (name, message) within DEDUP_WINDOW_MS
 *   - distinct errors after dedup still fire
 *   - context tag is truncated + defaulted safely
 *
 * Run: npm run test:client-errors  (also via npm run test:all)
 *
 * No DOM needed for these — initClientErrorReporting is bypassed and
 * we drive reportClientError() directly with an injected capture spy.
 */

const {
  reportClientError,
  __resetForTests,
  __setCaptureForTests,
  __TEST_CONFIG,
} = await import('../src/utils/clientErrorReporting.js')

let pass = 0
let fail = 0
const failures = []

function test(name, fn) {
  try {
    __resetForTests()
    fn()
    pass++
    console.log(`  ok  ${name}`)
  } catch (err) {
    fail++
    failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}`)
    console.log(`       ${err.message}`)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function makeSpy() {
  const calls = []
  const spy = (event, props) => calls.push({ event, props })
  __setCaptureForTests(spy)
  return calls
}

// ── sanitisation ────────────────────────────────────────────────

console.log('\nreportClientError: input sanitisation')

test('Error instance is captured by name + message', () => {
  const calls = makeSpy()
  reportClientError(new TypeError('oh no'), 'unit')
  assert(calls.length === 1, `expected 1 capture, got ${calls.length}`)
  assert(calls[0].event === 'client_error')
  assert(calls[0].props.error_name === 'TypeError')
  assert(calls[0].props.error_message === 'oh no')
  assert(calls[0].props.context === 'unit')
})

test('plain string input falls back to Error name', () => {
  const calls = makeSpy()
  reportClientError('something broke', 'unit')
  assert(calls.length === 1)
  assert(calls[0].props.error_name === 'Error')
  assert(calls[0].props.error_message === 'something broke')
})

test('null input becomes NullError', () => {
  // `Promise.reject()` with no argument lands here.
  const calls = makeSpy()
  reportClientError(null, 'unit')
  assert(calls.length === 1)
  assert(calls[0].props.error_name === 'NullError')
  assert(calls[0].props.error_message === '')
})

test('undefined input is captured (Error with empty message)', () => {
  const calls = makeSpy()
  reportClientError(undefined, 'unit')
  assert(calls.length === 1)
  assert(calls[0].props.error_name === 'NullError')
})

test('plain object input is summarised via .message', () => {
  const calls = makeSpy()
  reportClientError({ name: 'CustomKind', message: 'boom' }, 'unit')
  assert(calls.length === 1)
  assert(calls[0].props.error_name === 'CustomKind')
  assert(calls[0].props.error_message === 'boom')
})

test('long messages are truncated to MESSAGE_MAX_LEN', () => {
  const calls = makeSpy()
  const longMsg = 'x'.repeat(__TEST_CONFIG.MESSAGE_MAX_LEN + 500)
  reportClientError(new Error(longMsg), 'unit')
  assert(calls.length === 1)
  assert(
    calls[0].props.error_message.length === __TEST_CONFIG.MESSAGE_MAX_LEN,
    `expected message truncated to ${__TEST_CONFIG.MESSAGE_MAX_LEN}, got ${calls[0].props.error_message.length}`
  )
})

test('context tag truncated to 40 chars, non-string falls back to "manual"', () => {
  const calls = makeSpy()
  reportClientError(new Error('x'), 'a'.repeat(60))
  assert(calls[0].props.context.length === 40)
  reportClientError(new Error('y'), { not: 'a string' })
  assert(calls[1].props.context === 'manual', `got ${calls[1].props.context}`)
})

test('reporter never throws on unserialisable inputs', () => {
  const calls = makeSpy()
  const circular = {}
  circular.self = circular
  reportClientError(circular, 'unit') // must not throw
  assert(calls.length === 1)
})

// ── rate limit ──────────────────────────────────────────────────

console.log('\nreportClientError: rate limit')

test('caps at MAX_EVENTS_PER_SESSION even with distinct errors', () => {
  const calls = makeSpy()
  for (let i = 0; i < __TEST_CONFIG.MAX_EVENTS_PER_SESSION + 5; i++) {
    reportClientError(new Error(`distinct-${i}`), 'unit')
  }
  assert(
    calls.length === __TEST_CONFIG.MAX_EVENTS_PER_SESSION,
    `expected cap of ${__TEST_CONFIG.MAX_EVENTS_PER_SESSION}, got ${calls.length}`
  )
})

test('rate-limit cap survives reset for next test isolation', () => {
  const calls = makeSpy()
  for (let i = 0; i < __TEST_CONFIG.MAX_EVENTS_PER_SESSION; i++) {
    reportClientError(new Error(`a-${i}`), 'unit')
  }
  // After saturation, additional errors are silently dropped.
  reportClientError(new Error('over-cap'), 'unit')
  assert(calls.length === __TEST_CONFIG.MAX_EVENTS_PER_SESSION)
})

// ── dedup ───────────────────────────────────────────────────────

console.log('\nreportClientError: dedup')

test('identical errors within window collapse to one event', () => {
  const calls = makeSpy()
  for (let i = 0; i < 5; i++) {
    reportClientError(new TypeError('same'), 'unit')
  }
  assert(calls.length === 1, `expected dedup to 1, got ${calls.length}`)
})

test('distinct errors are NOT deduped', () => {
  const calls = makeSpy()
  reportClientError(new TypeError('first'), 'unit')
  reportClientError(new TypeError('second'), 'unit')
  reportClientError(new RangeError('first'), 'unit')
  assert(calls.length === 3, `expected 3 distinct, got ${calls.length}`)
})

test('messages differing past DEDUP_KEY_LEN still dedup (intentional)', () => {
  // The dedup key uses the first 80 chars of message. Two errors that
  // agree on those 80 but diverge after — almost certainly the same bug
  // with different variable data — collapse, which is what we want.
  const calls = makeSpy()
  const prefix = 'x'.repeat(__TEST_CONFIG.DEDUP_KEY_LEN)
  reportClientError(new Error(prefix + ' alpha'), 'unit')
  reportClientError(new Error(prefix + ' beta'), 'unit')
  assert(calls.length === 1, `expected dedup, got ${calls.length}`)
})

// ── Report ──────────────────────────────────────────────────────

console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  console.log('\nfailures:')
  failures.forEach(f => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
