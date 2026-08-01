/**
 * Node tests for the client correlation-id helper (OBS-003).
 */

import assert from 'node:assert/strict'
import { newRequestId, withRequestId } from './requestId.js'

let passed = 0
function ok(name, fn) { fn(); console.log(`  ✓ ${name}`); passed++ }

console.log('requestId')

ok('newRequestId returns a non-empty distinct id', () => {
  const a = newRequestId()
  const b = newRequestId()
  assert.ok(a && a.length >= 8)
  assert.notEqual(a, b)
})

ok('withRequestId sets x-request-id without mutating the input', () => {
  const base = { 'Content-Type': 'application/json' }
  const out = withRequestId(base)
  assert.equal(out['Content-Type'], 'application/json')
  assert.ok(out['x-request-id'])
  assert.equal('x-request-id' in base, false) // original untouched
})

ok('withRequestId uses a supplied id', () => {
  assert.equal(withRequestId({}, 'fixed-1')['x-request-id'], 'fixed-1')
})

ok('withRequestId preserves an existing id (a retry keeps its id)', () => {
  assert.equal(withRequestId({ 'x-request-id': 'orig' }, 'new')['x-request-id'], 'orig')
  // case-variant header is honoured too
  assert.equal(withRequestId({ 'X-Request-Id': 'ORIG' }, 'new')['x-request-id'], 'ORIG')
})

console.log(`All requestId tests passed (${passed}).`)
