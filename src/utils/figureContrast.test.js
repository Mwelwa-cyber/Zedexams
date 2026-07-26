/**
 * figureContrast tests — the picture, not the ink (§4.2).
 *
 * The failure this guards is specific, and getting the specificity right is the
 * whole difficulty: a colourful figure is FINE if its colours differ in
 * lightness. What breaks a monochrome print is two regions a reader must tell
 * apart that differ in hue but not in luminance — a red artery beside a blue
 * vein of the same darkness. Those merge into one grey and the question becomes
 * unanswerable.
 *
 * So the tests are built around that distinction, in both directions: the
 * dangerous case must be caught, and the harmless colourful case must NOT be,
 * because a checker that warns about every coloured picture is one a teacher
 * learns to ignore.
 *
 * Run: node src/utils/figureContrast.test.js
 */

import assert from 'node:assert/strict'
import {
  summariseColours, assessFigurePrintability, figurePrintWarning, censusFromPixels,
  MERGE_RATIO, PROMINENT_SHARE,
} from './figureContrast.js'

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
  } catch (err) {
    console.error(`✗ ${name}\n  ${err.message}`)
    process.exitCode = 1
  }
}

const verdict = (census) => assessFigurePrintability(summariseColours(census)).verdict

/* ── the case this exists for ───────────────────────────────────────────── */

console.log('\n— colours that merge in grey —')

test('a red artery beside a blue vein of the same darkness is caught', () => {
  // #c0392b and #2b5fc0 are unmistakable on screen and print as near-identical
  // greys. This is the exact figure a Grade 7 circulation question uses.
  const v = verdict([
    { r: 0xc0, g: 0x39, b: 0x2b, count: 300 },
    { r: 0x2b, g: 0x5f, b: 0xc0, count: 300 },
    { r: 255, g: 255, b: 255, count: 400 },
  ])
  assert.equal(v, 'colour_dependent')
})

test('…and the warning tells a teacher what to do about it', () => {
  const assessment = assessFigurePrintability(summariseColours([
    { r: 0xc0, g: 0x39, b: 0x2b, count: 300 },
    { r: 0x2b, g: 0x5f, b: 0xc0, count: 300 },
    { r: 255, g: 255, b: 255, count: 400 },
  ]))
  const warning = figurePrintWarning(assessment, 'The heart diagram in question 4')
  assert.match(warning, /The heart diagram in question 4/)
  assert.match(warning, /black and white/)
  assert.match(warning, /Regenerate|label/)
  // Plain language: no measurements leak to the screen.
  assert.ok(!/luminance|ratio|RGB|hue|census/i.test(warning), warning)
})

test('a colourful figure whose colours differ in LIGHTNESS is left alone', () => {
  // THE false positive to avoid. Ochre, mid green, near-black: as colourful as
  // the case above and perfectly readable once printed, because every pair
  // differs in darkness as well as in hue. A checker that flags this is one a
  // teacher stops reading.
  const v = verdict([
    { r: 0xd4, g: 0xa0, b: 0x17, count: 300 },
    { r: 0x2e, g: 0x8b, b: 0x57, count: 300 },
    { r: 0x1a, g: 0x1a, b: 0x1a, count: 200 },
    { r: 255, g: 255, b: 255, count: 200 },
  ])
  assert.equal(v, 'ok')
})

test('a pale fill on white is caught — it prints as nothing at all', () => {
  // Worth stating on its own because it is easy to mistake for a false
  // positive: pale yellow reads clearly on screen and is simply absent from a
  // monochrome print. If the question says "the yellow part is the stem", there
  // is no yellow part on the sheet.
  const v = verdict([
    { r: 255, g: 255, b: 255, count: 500 },
    { r: 0xff, g: 0xf1, b: 0x9a, count: 400 },
    { r: 0x1a, g: 0x1a, b: 0x1a, count: 100 },
  ])
  assert.equal(v, 'colour_dependent')
})

test('a black-and-white line drawing is always fine', () => {
  assert.equal(verdict([
    { r: 255, g: 255, b: 255, count: 900 },
    { r: 0, g: 0, b: 0, count: 100 },
  ]), 'ok')
})

test('two shades of the SAME colour are not a merge — nobody names them apart', () => {
  // Two close blues are one region to a reader. Flagging them would report a
  // problem the picture does not have.
  assert.equal(verdict([
    { r: 0x2b, g: 0x5f, b: 0xc0, count: 400 },
    { r: 0x35, g: 0x6a, b: 0xc8, count: 400 },
    { r: 0, g: 0, b: 0, count: 200 },
  ]), 'ok')
})

test('a merging pair too small to matter is not reported', () => {
  // A few pixels of red beside a few of blue is a fringe or an artefact, not a
  // region a learner is asked to identify.
  const v = verdict([
    { r: 255, g: 255, b: 255, count: 4000 },
    { r: 0, g: 0, b: 0, count: 900 },
    { r: 0xc0, g: 0x39, b: 0x2b, count: 50 },
    { r: 0x2b, g: 0x5f, b: 0xc0, count: 50 },
  ])
  assert.equal(v, 'ok')
})

/* ── the simpler failure ────────────────────────────────────────────────── */

console.log('\n— nothing to print —')

test('a pale wash with no range is caught', () => {
  assert.equal(verdict([
    { r: 0xf2, g: 0xf2, b: 0xf4, count: 700 },
    { r: 0xe8, g: 0xe9, b: 0xec, count: 300 },
  ]), 'flat')
})

test('one dark outline is enough to save an otherwise pale figure', () => {
  // Which is why the range is measured across ALL colours, not just the
  // prominent ones — the outline is thin by definition.
  assert.equal(verdict([
    { r: 0xf2, g: 0xf2, b: 0xf4, count: 900 },
    { r: 0x11, g: 0x11, b: 0x11, count: 20 },
  ]), 'ok')
})

test('the pale-figure warning says what to change', () => {
  const a = assessFigurePrintability(summariseColours([
    { r: 0xf2, g: 0xf2, b: 0xf4, count: 700 },
    { r: 0xe8, g: 0xe9, b: 0xec, count: 300 },
  ]))
  assert.equal(a.verdict, 'flat')
  assert.match(figurePrintWarning(a), /pale|blank/)
})

/* ── never a false pass ─────────────────────────────────────────────────── */

console.log('\n— when we do not know —')

test('an empty census is unknown, not fine', () => {
  // A sampling failure must never be reported as a clean bill of health.
  assert.equal(verdict([]), 'unknown')
  assert.equal(verdict(null), 'unknown')
  assert.equal(assessFigurePrintability(null).verdict, 'unknown')
  assert.equal(figurePrintWarning({ verdict: 'unknown' }), '')
})

test('rubbish in a census is dropped rather than throwing', () => {
  assert.doesNotThrow(() => summariseColours([
    null, { count: 0 }, { r: 'red', g: null, b: undefined, count: 5 },
  ]))
})

/* ── the census ─────────────────────────────────────────────────────────── */

console.log('\n— counting pixels —')

test('pixels are grouped into a small palette', () => {
  // Two nearly-identical reds are one region; the census must not treat every
  // anti-aliased pixel as its own colour or the pair comparison explodes.
  const pixels = new Uint8ClampedArray([
    200, 30, 30, 255,
    201, 31, 31, 255,
    255, 255, 255, 255,
  ])
  const census = censusFromPixels(pixels)
  assert.equal(census.length, 2, 'two colours, not three')
  assert.equal(census.reduce((n, c) => n + c.count, 0), 3)
})

test('transparent pixels are not a colour', () => {
  // A figure on a transparent background prints on white; counting the
  // transparency would report a merge with whatever sits behind it.
  const pixels = new Uint8ClampedArray([
    0, 0, 0, 0,
    0, 0, 0, 0,
    10, 10, 10, 255,
  ])
  const census = censusFromPixels(pixels)
  assert.equal(census.length, 1)
  assert.equal(census[0].count, 1)
})

test('no pixels means no census, which means unknown', () => {
  assert.deepEqual(censusFromPixels(new Uint8ClampedArray([])), [])
  assert.deepEqual(censusFromPixels(null), [])
  assert.equal(verdict(censusFromPixels(null)), 'unknown')
})

test('the thresholds are the ones this file reasons about', () => {
  // Guards against a failure being "fixed" by moving the bar.
  assert.ok(MERGE_RATIO < 1.5, 'a merge means collapsed, not merely close')
  assert.ok(PROMINENT_SHARE > 0 && PROMINENT_SHARE < 0.2)
})

console.log(`\n✓ figure contrast — ${passed} tests passed`)
