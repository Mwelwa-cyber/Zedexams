/**
 * Tests for label-box layout (Visual Studio v2 1B auto placement + 2F perfect
 * layout + the crossing-leader check behind the Smart Suggestions panel).
 */
import assert from 'node:assert'
import {
  autoPlaceBoxes, perfectLayout, sideForAnchor, segmentsIntersect,
  crossingLeaderPairs, BOX_COLUMN_LEFT_X, BOX_COLUMN_RIGHT_X,
  BOX_BAND_TOP_Y, BOX_BAND_BOTTOM_Y, BOX_MIN_GAP_Y,
} from '../src/features/visualStudio/lib/labelBoxLayout.js'

const L = (id, ax, ay, bx = ax, by = ay) =>
  ({ id, word: id, anchor: { x: ax, y: ay }, box: { x: bx, y: by } })

// Side selection: nearer margin.
assert.equal(sideForAnchor({ x: 0.2, y: 0.5 }), 'left')
assert.equal(sideForAnchor({ x: 0.8, y: 0.5 }), 'right')

// autoPlaceBoxes: nearer margin column, no overlaps, input order kept,
// input not mutated.
{
  const labels = [
    L('a', 0.3, 0.30),
    L('b', 0.32, 0.32), // same side, nearly same height → must be pushed down
    L('c', 0.8, 0.5),
  ]
  const placed = autoPlaceBoxes(labels)
  assert.deepEqual(placed.map((l) => l.id), ['a', 'b', 'c'], 'input order preserved')
  assert.equal(placed[0].box.x, BOX_COLUMN_LEFT_X)
  assert.equal(placed[1].box.x, BOX_COLUMN_LEFT_X)
  assert.equal(placed[2].box.x, BOX_COLUMN_RIGHT_X)
  const gap = Math.abs(placed[1].box.y - placed[0].box.y)
  assert.ok(gap >= BOX_MIN_GAP_Y - 1e-9, `stacked boxes at least the min gap apart (got ${gap})`)
  assert.equal(labels[0].box.x, 0.3, 'input labels not mutated')
}

// A tall stack near the bottom compresses back into the printable band.
{
  const labels = Array.from({ length: 6 }, (_, i) => L(`l${i}`, 0.2, 0.9))
  const placed = autoPlaceBoxes(labels)
  for (const l of placed) {
    assert.ok(l.box.y >= BOX_BAND_TOP_Y - 1e-9 && l.box.y <= BOX_BAND_BOTTOM_Y + 1e-9,
      `box y ${l.box.y} stays inside the band`)
  }
  const ys = [...placed.map((l) => l.box.y)].sort((a, b) => a - b)
  for (let i = 1; i < ys.length; i += 1) {
    assert.ok(ys[i] - ys[i - 1] >= BOX_MIN_GAP_Y - 1e-9, 'no overlapping boxes after compression')
  }
}

// perfectLayout: even distribution per side, y-sorted so same-side leaders
// cannot cross; a single box on a side centres in the band.
{
  const labels = [
    L('top', 0.4, 0.2, 0.9, 0.9),    // boxes start crossed on purpose
    L('bottom', 0.42, 0.7, 0.9, 0.1),
    L('solo', 0.9, 0.5),
  ]
  assert.ok(crossingLeaderPairs(labels).length >= 1, 'fixture starts with a crossing')
  const fixed = perfectLayout(labels)
  assert.equal(fixed[0].box.x, BOX_COLUMN_LEFT_X)
  assert.equal(fixed[1].box.x, BOX_COLUMN_LEFT_X)
  assert.ok(fixed[0].box.y < fixed[1].box.y, 'boxes follow anchor y-order')
  assert.equal(fixed[0].box.y, BOX_BAND_TOP_Y)
  assert.equal(fixed[1].box.y, BOX_BAND_BOTTOM_Y)
  assert.equal(fixed[2].box.y, (BOX_BAND_TOP_Y + BOX_BAND_BOTTOM_Y) / 2, 'solo box centres')
  assert.deepEqual(crossingLeaderPairs(fixed), [], 'perfect layout resolves the crossing')
}

// Segment intersection: crossing X yes; parallel no; shared endpoint no.
assert.equal(segmentsIntersect({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 0 }), true)
assert.equal(segmentsIntersect({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }), false)
assert.equal(segmentsIntersect({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 0 }), false,
  'touching at an endpoint is not a crossing')

// crossingLeaderPairs reports ids and ignores malformed labels.
{
  const labels = [
    L('a', 0.9, 0.9, 0.1, 0.1),
    L('b', 0.9, 0.1, 0.1, 0.9),
    { id: 'broken', word: 'x' },
  ]
  assert.deepEqual(crossingLeaderPairs(labels), [['a', 'b']])
}

console.log('test-label-box-layout: all assertions passed')
