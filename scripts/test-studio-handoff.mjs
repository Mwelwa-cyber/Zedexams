/**
 * Tests for the cross-studio sessionStorage handoff. A fake window/sessionStorage
 * is installed before importing the module.
 */
import assert from 'node:assert'

const store = (() => {
  let m = {}
  return {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v) },
    removeItem: (k) => { delete m[k] },
  }
})()
globalThis.window = { sessionStorage: store }

const { writeVisualHandoff, consumeVisualHandoff, isVisualHandoffRequest } =
  await import('../src/utils/studioHandoff.js')

// Round-trip: write then consume (read-and-clear).
assert.equal(writeVisualHandoff({ imageUrl: 'u', text: 'hi', blankLabels: ['P', 'Q'] }), true)
const got = consumeVisualHandoff()
assert.equal(got.imageUrl, 'u')
assert.equal(got.text, 'hi')
assert.deepEqual(got.blankLabels, ['P', 'Q'])

// Consumed → cleared.
assert.equal(consumeVisualHandoff(), null)

// A payload with no imageUrl is not stored.
assert.equal(writeVisualHandoff({ text: 'x' }), false)
assert.equal(consumeVisualHandoff(), null)

// Stale payloads are ignored.
store.setItem('zedexams:visual-handoff', JSON.stringify({ imageUrl: 'u', _ts: 1 }))
assert.equal(consumeVisualHandoff(), null)

// Flag detection.
assert.equal(isVisualHandoffRequest({ get: (k) => (k === 'from' ? 'visual-studio' : null) }), true)
assert.equal(isVisualHandoffRequest({ get: () => null }), false)
assert.equal(isVisualHandoffRequest(null), false)

console.log('✓ studio-handoff tests passed')
