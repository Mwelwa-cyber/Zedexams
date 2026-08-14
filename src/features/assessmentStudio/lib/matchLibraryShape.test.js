/**
 * Tests for matchLibraryShape — mapping a detected figure to a Diagram Library
 * shape for the "Convert to editable SVG" option. Plain `node` script.
 *
 * Run: node src/features/assessmentStudio/lib/matchLibraryShape.test.js
 */

import assert from 'node:assert'
import { matchLibraryShape, canConvertToSvg } from './matchLibraryShape.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

console.log('matchLibraryShape')

test('matches a triangle by caption', () => {
  const m = matchLibraryShape({ kind: 'shape', caption: 'Triangle ABC' })
  assert.deepEqual(m, { libraryKey: 'triangle', params: {} })
})

test('prefers the more specific right-triangle', () => {
  const m = matchLibraryShape({ kind: 'shape', caption: 'A right-angled triangle' })
  assert.equal(m.libraryKey, 'righttriangle')
})

test('maps a number_line kind straight to numberline', () => {
  assert.equal(matchLibraryShape({ kind: 'number_line' }).libraryKey, 'numberline')
})

test('matches 3D shapes by name', () => {
  assert.equal(matchLibraryShape({ caption: 'A cylinder of radius r' }).libraryKey, 'cylinder')
  assert.equal(matchLibraryShape({ caption: 'Cuboid' }).libraryKey, 'cuboid')
})

test('matches a clock face', () => {
  assert.equal(matchLibraryShape({ kind: 'other', caption: 'Read the clock' }).libraryKey, 'clockface')
})

test('does NOT match a labelled science drawing (kept as an image)', () => {
  assert.equal(matchLibraryShape({ kind: 'labelled_science', caption: 'The human heart' }), null)
  assert.equal(canConvertToSvg({ kind: 'plant', caption: 'A flowering plant' }), false)
})

test('returns null for an empty / unknown figure', () => {
  assert.equal(matchLibraryShape({}), null)
  assert.equal(matchLibraryShape({ kind: 'photo', caption: 'a village market' }), null)
})

test('canConvertToSvg agrees with matchLibraryShape', () => {
  assert.equal(canConvertToSvg({ caption: 'a hexagon' }), true)
})

console.log(`\nmatchLibraryShape: ${passed} passed`)
