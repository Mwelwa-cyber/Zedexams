/**
 * test:fraction-visual — the geometry of a fraction picture.
 *
 * A wrong fraction diagram is the failure with no symptom. A circle drawn in
 * five wedges under the caption "three quarters" renders perfectly: no error,
 * no warning, nothing red — just a child being taught that a quarter is a
 * fifth. Nothing downstream catches it, and a reviewer counting wedges on a
 * phone screen catches it once.
 *
 * So the partition is computed by a pure function and asserted here.
 */
import assert from 'node:assert/strict'

import {
  FRACTION_OBJECTS,
  barSegments,
  buildVisual,
  groupBox,
  groupItems,
  objectNoun,
  pieWedges,
  shadedCount,
  shadedSet,
  sharesAreEqual,
  sharesFor,
  validateVisual,
} from '../src/features/games/lib/fractionVisualCore.js'

let failures = 0
function test(name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failures += 1
    console.error(`  ✗ ${name}\n    ${err.message}`)
  }
}

console.log('fraction-visual')

/* ── equal by construction ─────────────────────────────────────────── */

test('with no shares given, every part is EXACTLY equal', () => {
  for (const parts of [2, 3, 4, 5, 6, 8, 9, 12]) {
    const shares = sharesFor(parts)
    assert.equal(shares.length, parts)
    assert.ok(shares.every((s) => Math.abs(s - 1 / parts) < 1e-12), `${parts} parts came out uneven`)
    assert.ok(Math.abs(shares.reduce((a, b) => a + b, 0) - 1) < 1e-12, 'the parts must make one whole')
    assert.equal(sharesAreEqual(shares), true)
  }
})

test('shares are normalised, so a pack cannot write a whole that is not one', () => {
  const shares = sharesFor(2, [1, 3])
  assert.ok(Math.abs(shares.reduce((a, b) => a + b, 0) - 1) < 1e-12)
  assert.deepEqual(shares, [0.25, 0.75])
  assert.equal(sharesAreEqual(shares), false)
})

test('a shares list of the wrong length falls back to equal parts', () => {
  assert.deepEqual(sharesFor(4, [0.5, 0.5]), [0.25, 0.25, 0.25, 0.25])
})

/* ── the rule ──────────────────────────────────────────────────────── */

test('the region count IS the bottom number', () => {
  assert.equal(validateVisual({ shape: 'circle', parts: 4, denominator: 4, numerator: 3, shaded: 3 }).ok, true)
  const wrong = validateVisual({ shape: 'circle', parts: 5, denominator: 4, numerator: 3, shaded: 3 })
  assert.equal(wrong.ok, false)
  assert.ok(wrong.errors.some((e) => e.code === 'parts-denominator'), 'a five-wedge picture of quarters must be refused')
})

test('the shaded count IS the top number', () => {
  const wrong = validateVisual({ shape: 'bar', parts: 4, numerator: 3, shaded: 2 })
  assert.equal(wrong.ok, false)
  assert.ok(wrong.errors.some((e) => e.code === 'shaded-numerator'))
  assert.equal(validateVisual({ shape: 'bar', parts: 4, numerator: 3, shaded: 3 }).ok, true)
  assert.equal(validateVisual({ shape: 'bar', parts: 4, numerator: 2, shaded: [1, 3] }).ok, true,
    'which regions are shaded is not the rule — how many is')
})

test('more shaded than there are pieces is refused', () => {
  const wrong = validateVisual({ shape: 'circle', parts: 4, numerator: 5 })
  assert.equal(wrong.ok, false)
  assert.ok(wrong.errors.some((e) => e.code === 'numerator-over'))
})

test('a picture claiming unequal parts must really be unequal, and the reverse', () => {
  // The distractor round needs two of three oranges cut wrongly. One that came
  // out equal makes the round unanswerable, and looks perfect on screen.
  const pretend = validateVisual({ shape: 'circle', parts: 2, numerator: 1, expectEqual: false })
  assert.equal(pretend.ok, false)
  assert.ok(pretend.errors.some((e) => e.code === 'not-unequal'))

  const real = validateVisual({ shape: 'circle', parts: 2, numerator: 1, shares: [0.33, 0.67], expectEqual: false })
  assert.equal(real.ok, true)

  // …and an unequal cut that never said so is refused, because equal is what
  // "halves" means and the default has to be the safe one.
  const accident = validateVisual({ shape: 'circle', parts: 2, numerator: 1, shares: [0.33, 0.67] })
  assert.equal(accident.ok, false)
  assert.ok(accident.errors.some((e) => e.code === 'unequal'))
})

test('a zero-size part is refused — a part with no size is not a part', () => {
  const wrong = validateVisual({ shape: 'bar', parts: 3, numerator: 1, shares: [0.5, 0.5, 0] })
  assert.equal(wrong.ok, false)
  assert.ok(wrong.errors.some((e) => e.code === 'shares-value'))
})

test('every error is reported, not just the first', () => {
  const result = validateVisual({ shape: 'blob', parts: 0, numerator: -1 })
  assert.equal(result.ok, false)
  assert.ok(result.errors.length >= 3, 'a malformed picture usually has more than one thing wrong with it')
})

test('buildVisual throws rather than drawing a lie', () => {
  assert.throws(() => buildVisual({ shape: 'circle', parts: 5, denominator: 4, numerator: 3 }))
  const built = buildVisual({ shape: 'circle', object: 'orange', parts: 4, numerator: 3, shaded: 3 })
  assert.equal(built.parts, 4)
  assert.equal(built.shaded.size, 3)
  assert.equal(built.equal, true)
  assert.equal(built.object.ink, FRACTION_OBJECTS.orange.ink)
})

/* ── the shapes ────────────────────────────────────────────────────── */

test('a pie has one wedge per part, and the wedges close the circle', () => {
  for (const parts of [2, 3, 4, 5, 8]) {
    const wedges = pieWedges({ parts })
    assert.equal(wedges.length, parts, `${parts} parts drew ${wedges.length} wedges`)
    assert.ok(Math.abs(wedges.reduce((a, w) => a + w.share, 0) - 1) < 1e-12)
    for (const wedge of wedges) assert.ok(wedge.path.startsWith('M'), 'every wedge needs real path data')
  }
})

test('a wedge over half the circle sets the large-arc flag', () => {
  // Without it SVG draws the SMALL side of the same arc — a wedge of the wrong
  // size, which is a wrong fraction that renders without complaint.
  const [big, small] = pieWedges({ parts: 2, shares: [0.8, 0.2] })
  assert.equal(big.large, 1)
  assert.equal(small.large, 0)
  assert.equal(pieWedges({ parts: 2 })[0].large, 0, 'an exact half is not a large arc')
})

test('one part is drawn as a whole circle, not as nothing', () => {
  // An arc from a point back to the same point draws zero pixels, so the
  // "one whole" case has to be two half-arcs.
  const [only] = pieWedges({ parts: 1 })
  assert.equal(only.share, 1)
  assert.ok(/A.*A/.test(only.path), 'a whole circle needs two arcs')
})

test('a bar has one segment per part and fills its width exactly', () => {
  const segments = barSegments({ parts: 5, width: 250 })
  assert.equal(segments.length, 5)
  assert.ok(Math.abs(segments[segments.length - 1].x + segments[segments.length - 1].width - 250) < 1e-9)
  assert.ok(segments.every((s) => Math.abs(s.width - 50) < 1e-9), 'equal parts means equal widths')
})

test('an unequal bar has unequal segments, in the order given', () => {
  const segments = barSegments({ parts: 3, width: 300, shares: [0.2, 0.5, 0.3] })
  assert.ok(Math.abs(segments[0].width - 60) < 1e-9)
  assert.ok(Math.abs(segments[1].width - 150) < 1e-9)
  assert.ok(Math.abs(segments[2].width - 90) < 1e-9)
})

test('a group lays out every item and wraps into rows', () => {
  const items = groupItems({ count: 8, perRow: 4 })
  assert.equal(items.length, 8)
  assert.equal(items[0].row, 0)
  assert.equal(items[4].row, 1)
  assert.equal(items[4].column, 0)
  const box = groupBox({ count: 8, perRow: 4 })
  assert.equal(box.rows, 2)
  assert.equal(box.columns, 4)
})

test('a group of six wraps to two rows of three rather than a line a phone must scroll', () => {
  const box = groupBox({ count: 6, perRow: 3 })
  assert.equal(box.rows, 2)
})

/* ── the shaded set ────────────────────────────────────────────────── */

test('a count shades the first n; a list shades exactly those', () => {
  assert.deepEqual([...shadedSet(3, 4)], [0, 1, 2])
  assert.deepEqual([...shadedSet([2, 0], 4)].sort(), [0, 2])
  assert.equal(shadedCount([1, 1, 2], 4), 2, 'a repeated tap is one region, not two')
  assert.equal(shadedCount(9, 4), 4, 'a count cannot exceed the number of pieces')
})

/* ── the objects ───────────────────────────────────────────────────── */

test('every object has both a real noun and a plain-shape one', () => {
  for (const [key, object] of Object.entries(FRACTION_OBJECTS)) {
    assert.ok(object.noun, `${key} has no noun`)
    assert.ok(object.plain, `${key} has no worksheet noun`)
    assert.ok(/^#[0-9a-f]{6}$/i.test(object.ink), `${key}'s shaded colour is not a hex`)
    assert.ok(/^#[0-9a-f]{6}$/i.test(object.pale), `${key}'s unshaded colour is not a hex`)
  }
  assert.equal(objectNoun('orange'), 'orange')
  assert.equal(objectNoun('orange', { plain: true }), 'shape')
  assert.equal(objectNoun('orange', { plural: true }), 'oranges')
  assert.equal(objectNoun('nothing-like-this'), 'shape', 'an unknown object degrades rather than throwing')
})

console.log(failures ? `\n${failures} failed` : '\nall passed')
process.exit(failures ? 1 : 0)
