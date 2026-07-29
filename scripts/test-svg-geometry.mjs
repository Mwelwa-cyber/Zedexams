/**
 * scripts/test-svg-geometry.mjs — the harness measures correctly.
 *
 * Every geometric-correctness test for the secondary diagram families is only
 * as trustworthy as the reader underneath it. A tokeniser that quietly returns
 * an empty element list turns "the rotation image is at (3, -1)" into a test
 * that passes because it asserted nothing. So the harness is tested first,
 * against figures whose answers are known by hand.
 *
 * Run: node scripts/test-svg-geometry.mjs
 */

import assert from 'node:assert/strict'
import {
  parseSvg, select, selectOne, num, points, pathCommands, pathPoints, texts,
  angleBetween, bearingFromNorth, dist, approx, plotFrame, assertFrameMatchesAxisLabels,
} from './lib/svgGeometry.mjs'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

console.log('\nsvgGeometry — the reader')

test('reads every element, its attributes and its text', () => {
  const parsed = parseSvg(
    '<svg viewBox="0 0 10 20" xmlns="http://www.w3.org/2000/svg" width="10">' +
    '<line x1="1" y1="2" x2="3" y2="4" stroke="#000"/>' +
    '<circle cx="5" cy="6" r="7"/>' +
    '<text x="8" y="9">hello</text></svg>',
  )
  assert.equal(parsed.root.attrs.viewBox, '0 0 10 20')
  assert.equal(select(parsed, 'line').length, 1)
  assert.equal(num(selectOne(parsed, 'circle'), 'r'), 7)
  assert.deepEqual(texts(parsed), ['hello'])
})

test('unescapes text back to what a reader sees', () => {
  const parsed = parseSvg('<svg viewBox="0 0 1 1"><text x="0" y="0">a &lt; b &amp; c</text></svg>')
  assert.deepEqual(texts(parsed), ['a < b & c'])
})

test('a missing numeric attribute throws instead of yielding NaN', () => {
  // The failure this prevents: `num(el, 'cx') === NaN` compared against a
  // number is false, so an assertion written the other way round would PASS on
  // an element that has no such attribute at all.
  const parsed = parseSvg('<svg viewBox="0 0 1 1"><circle r="3"/></svg>')
  assert.throws(() => num(selectOne(parsed, 'circle'), 'cx'), /no numeric "cx"/)
})

test('selectOne refuses an ambiguous match', () => {
  const parsed = parseSvg('<svg viewBox="0 0 1 1"><line x1="0" y1="0" x2="1" y2="1"/><line x1="1" y1="1" x2="2" y2="2"/></svg>')
  assert.throws(() => selectOne(parsed, 'line'), /found 2/)
})

test('parses polygon points and path commands', () => {
  const parsed = parseSvg(
    '<svg viewBox="0 0 1 1"><polygon points="1,2 3,4 5,6"/>' +
    '<path d="M 10,20 A 5,5 0 0,1 30,40 L 50,60"/></svg>',
  )
  assert.deepEqual(points(selectOne(parsed, 'polygon')), [[1, 2], [3, 4], [5, 6]])
  const cmds = pathCommands(selectOne(parsed, 'path'))
  assert.deepEqual(cmds.map((c) => c.cmd), ['M', 'A', 'L'])
  // The arc's endpoint is on the curve; its radii are not.
  assert.deepEqual(pathPoints(selectOne(parsed, 'path')), [[10, 20], [30, 40], [50, 60]])
})

test('a relative path command is refused, not silently misread', () => {
  assert.throws(() => pathCommands('M 0,0 l 5,5'), /relative path command/)
})

console.log('\nsvgGeometry — the mathematics')

test('measures an angle between two rays', () => {
  approx(angleBetween([0, 0], [10, 0], [0, -10]), 90, 1e-9, 'right angle')
  approx(angleBetween([0, 0], [10, 0], [-10, 0]), 180, 1e-9, 'straight angle')
  approx(angleBetween([0, 0], [10, 0], [10, -10]), 45, 1e-9, '45°')
})

test('bearings are read from north, clockwise, in SVG y-down coordinates', () => {
  // Due north is -y. Getting the flip wrong reflects every bearing about the
  // east-west line: 060° would read as 120°, which is a plausible-looking
  // number and completely wrong.
  approx(bearingFromNorth([0, 0], [0, -10]), 0, 1e-9, 'north')
  approx(bearingFromNorth([0, 0], [10, 0]), 90, 1e-9, 'east')
  approx(bearingFromNorth([0, 0], [0, 10]), 180, 1e-9, 'south')
  approx(bearingFromNorth([0, 0], [-10, 0]), 270, 1e-9, 'west')
  approx(bearingFromNorth([0, 0], [10, -10]), 45, 1e-9, '045°')
})

test('measures distance', () => {
  approx(dist([0, 0], [3, 4]), 5, 1e-9, 'hypotenuse')
})

console.log('\nsvgGeometry — graph coordinates')

const GRID = '<svg viewBox="0 0 200 200" data-plot-ox="100" data-plot-oy="100" data-plot-ux="20" data-plot-uy="20">' +
  '<text data-axis="x" x="140" y="114">2</text>' +
  '<text data-axis="y" x="94" y="64" data-baseline="4">2</text>' +
  '<polygon points="120,80 160,80 120,60"/></svg>'

test('converts drawn pixels back into graph units, y flipped', () => {
  const parsed = parseSvg(GRID)
  const frame = plotFrame(parsed)
  assert.deepEqual(frame.toGraph([100, 100]), [0, 0])
  assert.deepEqual(frame.toGraph([120, 80]), [1, 1])
  assert.deepEqual(frame.toSvg([-2, 1]), [60, 80])
})

test('the declared frame is checked against where the axis numbers were painted', () => {
  const parsed = parseSvg(GRID)
  assertFrameMatchesAxisLabels(parsed, plotFrame(parsed))
})

test('a frame that disagrees with its own axis labels fails', () => {
  // This is the check that stops plotFrame from being the renderer's own
  // unverified claim: move the scale and the labels no longer line up.
  const parsed = parseSvg(GRID.replace('data-plot-ux="20"', 'data-plot-ux="30"'))
  assert.throws(() => assertFrameMatchesAxisLabels(parsed, plotFrame(parsed)), /x-axis label/)
})

test('a grid figure with no declared frame is an error, not a default', () => {
  const parsed = parseSvg('<svg viewBox="0 0 10 10"><line x1="0" y1="0" x2="1" y2="1"/></svg>')
  assert.throws(() => plotFrame(parsed), /publish its plotting frame/)
})

console.log(`\nsvgGeometry: ${passed} passed\n`)
