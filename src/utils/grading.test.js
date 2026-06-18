/**
 * Tests for the pure, server-authoritative grading helpers:
 *   - numericMatches  (numeric-answer questions, ±tolerance)
 *   - hotspotMatches  (image hotspot questions, normalised coords)
 *
 * These graders decide whether a learner earns marks, so a regression here
 * silently mis-scores attempts — the most damaging bug class on the
 * platform. Each helper is duplicated: an ESM copy under src/utils/ (used
 * by the client runner) and a CommonJS port under functions/grading/ (used
 * by server-side grading). The two MUST stay logic-identical, so the last
 * block here cross-checks both copies against the same input matrix and
 * fails the moment they drift.
 *
 * Run: node src/utils/grading.test.js
 */

import { createRequire } from 'node:module'
import { numericMatches as srcNumeric } from './numericGrading.js'
import { hotspotMatches as srcHotspot } from './hotspotGrading.js'

const require = createRequire(import.meta.url)
const { numericMatches: fnNumeric } = require('../../functions/grading/numericGrading.js')
const { hotspotMatches: fnHotspot } = require('../../functions/grading/hotspotGrading.js')

let failures = 0
function assert(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`)
  else { failures += 1; console.error(`  ✗ ${msg}`) }
}

// ── numericMatches ───────────────────────────────────────────────────────
console.log('numericMatches — exact + tolerance')
{
  assert(srcNumeric('3.14', 3.14, 0) === true, 'exact string match')
  assert(srcNumeric(3.14, 3.14, 0) === true, 'exact number match')
  assert(srcNumeric(3.15, 3.14, 0.01) === true, 'within +tolerance (fp slack)')
  assert(srcNumeric(3.13, 3.14, 0.01) === true, 'within -tolerance')
  assert(srcNumeric('3.2', 3.14, 0.01) === false, 'outside tolerance')
  assert(srcNumeric(0, 0, 0) === true, 'zero answer, zero given, exact')
  assert(srcNumeric(-5, -5, 0) === true, 'negative exact match')
  assert(srcNumeric('-4.9', -5, 0.1) === true, 'negative within tolerance')
}

console.log('\nnumericMatches — { value } wrapper from the runner')
{
  assert(srcNumeric({ value: 3 }, 3, 0) === true, 'wrapper exact match')
  assert(srcNumeric({ value: '3.15' }, 3.14, 0.01) === true, 'wrapper string within tolerance')
  assert(srcNumeric({ value: '' }, 0, 0) === false, 'wrapper empty string is unanswered')
}

console.log('\nnumericMatches — blank / garbage never grades correct')
{
  // The headline anti-bug: a blank submission must NOT match correctAnswer 0.
  assert(srcNumeric('', 0, 0) === false, 'empty string != 0')
  assert(srcNumeric('   ', 0, 0) === false, 'whitespace-only != 0')
  assert(srcNumeric('hello', 3.14, 0) === false, 'non-numeric string')
  assert(srcNumeric(undefined, 3.14, 0) === false, 'undefined given')
  assert(srcNumeric(null, 3.14, 0) === false, 'null given')
  assert(srcNumeric(NaN, 3.14, 0) === false, 'NaN given')
  assert(srcNumeric(3.14, NaN, 0) === false, 'NaN correctAnswer')
  assert(srcNumeric(Infinity, Infinity, 0) === false, 'Infinity never finite-matches')
}

console.log('\nnumericMatches — tolerance coercion')
{
  assert(srcNumeric(3.2, 3.14, -1) === false, 'negative tolerance clamps to exact (no match)')
  assert(srcNumeric(3.14, 3.14, -1) === true, 'negative tolerance clamps to exact (match)')
  assert(srcNumeric(3.2, 3.14, NaN) === false, 'NaN tolerance → exact (no match)')
  assert(srcNumeric(3.2, 3.14, '0.1') === true, 'numeric-string tolerance accepted')
}

// ── hotspotMatches ─────────────────────────────────────────────────────────
console.log('\nhotspotMatches — inside / outside the region')
{
  const region = { x: 0.5, y: 0.5, radius: 0.1 }
  assert(srcHotspot({ x: 0.5, y: 0.5 }, region) === true, 'dead-centre tap')
  assert(srcHotspot({ x: 0.55, y: 0.52 }, region) === true, 'inside radius')
  assert(srcHotspot({ x: 0.6, y: 0.5 }, region) === true, 'exactly on the radius boundary')
  assert(srcHotspot({ x: 0.7, y: 0.7 }, region) === false, 'outside radius')
  assert(srcHotspot({ x: '0.55', y: '0.52' }, region) === true, 'numeric-string coords accepted')
}

console.log('\nhotspotMatches — malformed / out-of-range input never matches')
{
  const region = { x: 0.5, y: 0.5, radius: 0.1 }
  assert(srcHotspot(null, region) === false, 'null given')
  assert(srcHotspot(undefined, region) === false, 'undefined given')
  assert(srcHotspot({ x: 0.5 }, region) === false, 'missing y')
  assert(srcHotspot({ x: 0.5, y: 0.5 }, null) === false, 'null region')
  assert(srcHotspot({ x: 0.5, y: 0.5 }, {}) === false, 'empty region (NaN coords)')
  assert(srcHotspot({ x: -0.1, y: 0.5 }, region) === false, 'x below 0 rejected')
  assert(srcHotspot({ x: 1.2, y: 0.5 }, region) === false, 'x above 1 rejected')
  assert(srcHotspot({ x: 0.5, y: 2 }, region) === false, 'y above 1 rejected')
  assert(srcHotspot({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5, radius: -0.1 }) === false, 'negative radius rejected')
  assert(srcHotspot({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5, radius: 0 }) === true, 'zero-radius matches exact centre')
}

// ── src ⇄ functions parity ──────────────────────────────────────────────────
// If either copy drifts from the other, server grading stops matching what
// the client computed. We assert identical output across a representative
// input matrix rather than diffing source text (whitespace/CJS-vs-ESM differ
// by design).
console.log('\nparity — src/utils copies match functions/grading copies')
{
  const numericCases = [
    ['3.14', 3.14, 0], [3.15, 3.14, 0.01], ['3.2', 3.14, 0.01], ['', 0, 0],
    ['   ', 0, 0], ['hello', 3.14, 0], [{ value: 3 }, 3, 0], [undefined, 3.14, 0],
    [null, 3.14, 0], [NaN, 3.14, 0], [3.2, 3.14, -1], [3.2, 3.14, '0.1'],
    [-4.9, -5, 0.1], [0, 0, 0], [Infinity, Infinity, 0],
  ]
  let numericParity = true
  for (const [g, c, t] of numericCases) {
    if (srcNumeric(g, c, t) !== fnNumeric(g, c, t)) {
      numericParity = false
      console.error(`    drift: numericMatches(${JSON.stringify(g)}, ${c}, ${t})`)
    }
  }
  assert(numericParity, 'numericMatches: src and functions copies agree on all cases')

  const region = { x: 0.5, y: 0.5, radius: 0.1 }
  const hotspotCases = [
    [{ x: 0.5, y: 0.5 }, region], [{ x: 0.6, y: 0.5 }, region], [{ x: 0.7, y: 0.7 }, region],
    [{ x: '0.55', y: '0.52' }, region], [null, region], [{ x: 0.5 }, region],
    [{ x: 0.5, y: 0.5 }, null], [{ x: 0.5, y: 0.5 }, {}], [{ x: -0.1, y: 0.5 }, region],
    [{ x: 1.2, y: 0.5 }, region], [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5, radius: -0.1 }],
    [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5, radius: 0 }],
  ]
  let hotspotParity = true
  for (const [g, r] of hotspotCases) {
    if (srcHotspot(g, r) !== fnHotspot(g, r)) {
      hotspotParity = false
      console.error(`    drift: hotspotMatches(${JSON.stringify(g)}, ${JSON.stringify(r)})`)
    }
  }
  assert(hotspotParity, 'hotspotMatches: src and functions copies agree on all cases')
}

console.log('')
if (failures > 0) {
  console.error(`✗ ${failures} assertion(s) failed`)
  process.exit(1)
}
console.log('✓ all grading helper tests passed')
