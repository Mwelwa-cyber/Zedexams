/**
 * figureLabelLayout tests — labels that don't collide, lines that end on the
 * right part (§4.2).
 *
 * Two of these pin behaviour that is easy to get subtly wrong and impossible to
 * notice from a passing render:
 *
 *  - a leader line must LEAVE the pill, not start under it;
 *  - a label moved to avoid a collision must keep naming the part it was
 *    dropped on, or de-collision quietly relabels the diagram.
 *
 * Run: node src/utils/figureLabelLayout.test.js
 */

import assert from 'node:assert/strict'
import {
  resolveFigureLabels, resolveAnswerKeyLabels, labelBoxSize, figureLabelWarning,
  NOMINAL_FIGURE_BOX,
} from './figureLabelLayout.js'

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

const BOX = { width: 360, height: 240 }

/* ── sizes ──────────────────────────────────────────────────────────────── */

console.log('\n— how big a label is —')

test('a longer label needs a wider pill', () => {
  const short = labelBoxSize({ text: 'Stem' })
  const long = labelBoxSize({ text: 'Left ventricle wall' })
  assert.ok(long.width > short.width, `${long.width} > ${short.width}`)
  assert.equal(long.height, short.height, 'one line of text is one line tall')
})

test('a numbered marker is a fixed circle regardless of its answer text', () => {
  const a = labelBoxSize({ text: 'Aorta' }, { mode: 'identify' })
  const b = labelBoxSize({ text: 'Superior vena cava' }, { mode: 'identify' })
  assert.deepEqual(a, b, 'identify markers show a number, not the text')
  assert.equal(a.width, a.height, 'and it is a circle')
})

/* ── collisions ─────────────────────────────────────────────────────────── */

console.log('\n— labels that would sit on top of each other —')

test('two labels far apart are left exactly where the teacher put them', () => {
  const { labels, movedCount } = resolveFigureLabels(
    [{ x: 0.15, y: 0.2, text: 'Root' }, { x: 0.8, y: 0.8, text: 'Leaf' }],
    BOX,
  )
  assert.equal(movedCount, 0)
  assert.equal(labels[0].x, 0.15)
  assert.equal(labels[1].y, 0.8)
  assert.equal(labels[0].leader, null, 'an unmoved label with no target needs no line')
})

test('two labels dropped on the same spot are separated', () => {
  // THE regression this file exists for: before, both pills drew on top of each
  // other and the paper was unusable.
  const { labels, movedCount, unresolvedOverlaps } = resolveFigureLabels(
    [{ x: 0.5, y: 0.5, text: 'Atrium' }, { x: 0.5, y: 0.5, text: 'Ventricle' }],
    BOX,
  )
  assert.equal(movedCount, 2, 'both moved')
  assert.equal(unresolvedOverlaps, 0, 'and they no longer overlap')
  const dx = Math.abs(labels[0].x - labels[1].x) * BOX.width
  const dy = Math.abs(labels[0].y - labels[1].y) * BOX.height
  const apart = dx >= (labels[0].widthPx + labels[1].widthPx) / 2 ||
    dy >= (labels[0].heightPx + labels[1].heightPx) / 2
  assert.ok(apart, `separated on some axis (dx=${dx}, dy=${dy})`)
})

test('a moved label keeps pointing at the part it was dropped on', () => {
  // The rule that makes de-collision safe. Without it, moving a label to fix an
  // overlap silently renames a different part of the diagram.
  const { labels } = resolveFigureLabels(
    [{ x: 0.5, y: 0.5, text: 'Atrium' }, { x: 0.5, y: 0.5, text: 'Ventricle' }],
    BOX,
  )
  for (const l of labels) {
    assert.ok(l.target, `${l.text} grew a target`)
    assert.ok(Math.abs(l.target.x - 0.5) < 1e-9, 'aimed at where it was authored')
    assert.ok(Math.abs(l.target.y - 0.5) < 1e-9)
    // Either a line back to that point, or the pill still covers it. A short
    // separation leaves the origin under the label, and a stub inside the box
    // would read as a fault rather than a pointer — so the guarantee is the
    // meaning is preserved, not that a line is always drawn.
    const dx = Math.abs(l.x - l.target.x) * BOX.width
    const dy = Math.abs(l.y - l.target.y) * BOX.height
    const stillCovers = dx <= l.widthPx / 2 && dy <= l.heightPx / 2
    assert.ok(l.leader || stillCovers, `${l.text} still names the same part`)
  }
})

test('a label pushed clear of its origin grows a line back to it', () => {
  // Same rule, in the case where the pill no longer covers where it was put:
  // three labels on one point separate far enough that at least one is clear,
  // and that one must carry a pointer.
  const { labels } = resolveFigureLabels([
    { x: 0.5, y: 0.5, text: 'Atrium' },
    { x: 0.5, y: 0.5, text: 'Ventricle' },
    { x: 0.5, y: 0.5, text: 'Valve' },
  ], BOX)
  const cleared = labels.filter((l) => {
    if (!l.target) return false
    const dx = Math.abs(l.x - l.target.x) * BOX.width
    const dy = Math.abs(l.y - l.target.y) * BOX.height
    return dx > l.widthPx / 2 || dy > l.heightPx / 2
  })
  assert.ok(cleared.length > 0, 'at least one was pushed clear')
  for (const l of cleared) assert.ok(l.leader, `${l.text} points back at its part`)
})

test('separation is deterministic — the same paper renders the same twice', () => {
  const input = [
    { x: 0.5, y: 0.5, text: 'One' },
    { x: 0.52, y: 0.5, text: 'Two' },
    { x: 0.5, y: 0.52, text: 'Three' },
  ]
  const a = resolveFigureLabels(input, BOX)
  const b = resolveFigureLabels(input, BOX)
  assert.deepEqual(a, b)
})

test('labels are kept inside the picture', () => {
  const { labels } = resolveFigureLabels(
    [{ x: 0, y: 0, text: 'Top left corner part' }, { x: 1, y: 1, text: 'Bottom right' }],
    BOX,
  )
  for (const l of labels) {
    const halfW = l.widthPx / 2 / BOX.width
    const halfH = l.heightPx / 2 / BOX.height
    assert.ok(l.x - halfW >= -1e-6 && l.x + halfW <= 1 + 1e-6, `${l.text} fits horizontally`)
    assert.ok(l.y - halfH >= -1e-6 && l.y + halfH <= 1 + 1e-6, `${l.text} fits vertically`)
  }
})

test('a crowd of labels is a best effort, and says so rather than pretending', () => {
  // Eight long labels on one spot cannot all fit. What matters is that the
  // count of what could not be fixed is reported, not silently swallowed.
  const crowd = Array.from({ length: 8 }, (_, i) => ({
    x: 0.5, y: 0.5, text: `Label number ${i + 1} of the diagram`,
  }))
  const result = resolveFigureLabels(crowd, { width: 200, height: 120 })
  assert.equal(result.movedCount, 8)
  if (result.unresolvedOverlaps > 0) {
    const warning = figureLabelWarning(result, 'The picture in question 4')
    assert.match(warning, /The picture in question 4/)
    assert.ok(!/\bpx\b|overlap pairs|collision|axis/i.test(warning), warning)
  }
})

/* ── leader lines ───────────────────────────────────────────────────────── */

console.log('\n— lines that end on the right part —')

test('a leader line starts at the pill\'s edge, not its centre', () => {
  // The old bug: x1,y1 were the label centre, so the first third of the line ran
  // underneath the pill and struck through the text.
  const { labels } = resolveFigureLabels(
    [{ x: 0.25, y: 0.5, tx: 0.8, ty: 0.5, text: 'Aorta' }],
    BOX,
  )
  const l = labels[0]
  assert.ok(l.leader, 'there is a line')
  const startPx = l.leader.x1 * BOX.width
  const centrePx = l.x * BOX.width
  assert.ok(startPx > centrePx, 'it starts to the right of the centre, toward the target')
  assert.ok(
    startPx >= centrePx + l.widthPx / 2,
    `and outside the pill (start ${startPx.toFixed(1)}, edge ${(centrePx + l.widthPx / 2).toFixed(1)})`,
  )
})

test('a leader line ends exactly on the part', () => {
  const { labels } = resolveFigureLabels(
    [{ x: 0.2, y: 0.2, tx: 0.7, ty: 0.65, text: 'Nucleus' }],
    BOX,
  )
  assert.equal(labels[0].leader.x2, 0.7)
  assert.equal(labels[0].leader.y2, 0.65)
  assert.deepEqual(labels[0].target, { x: 0.7, y: 0.65 })
})

test('a label already sitting on its part draws no line', () => {
  const { labels } = resolveFigureLabels(
    [{ x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, text: 'Cell' }],
    BOX,
  )
  assert.equal(labels[0].leader, null, 'a stub inside the pill reads as a fault')
  assert.deepEqual(labels[0].target, { x: 0.5, y: 0.5 })
})

test('a target under the pill draws no line either', () => {
  // Three pixels away is inside the box; a line there would be invisible except
  // as a smudge on the border.
  const { labels } = resolveFigureLabels(
    [{ x: 0.5, y: 0.5, tx: 0.505, ty: 0.5, text: 'Cell' }],
    BOX,
  )
  assert.equal(labels[0].leader, null)
})

test('an authored target survives de-collision — it is not replaced', () => {
  const { labels } = resolveFigureLabels(
    [
      { x: 0.5, y: 0.5, tx: 0.1, ty: 0.1, text: 'Atrium' },
      { x: 0.5, y: 0.5, text: 'Ventricle' },
    ],
    BOX,
  )
  assert.deepEqual(labels[0].target, { x: 0.1, y: 0.1 }, 'the teacher\'s target wins')
  assert.ok(Math.abs(labels[1].target.x - 0.5) < 1e-9, 'the other falls back to where it sat')
})

/* ── the marking key's twin figure (§4.3) ───────────────────────────────── */

console.log('\n— the marking key names the parts —')

const HEART = [
  { x: 0.25, y: 0.3, text: 'Aorta' },
  { x: 0.6, y: 0.55, text: 'Left ventricle' },
]

test('the numbers sit in exactly the same places on both copies', () => {
  // Correspondence is the whole point: the learner writes against number 2 and
  // the marker reads number 2. If a name could shove a marker, the two copies
  // would be describing different parts.
  const learner = resolveFigureLabels(HEART, { mode: 'identify' })
  const key = resolveAnswerKeyLabels(HEART)
  assert.deepEqual(key.markers, learner.labels)
})

test('every name is pushed clear of its marker and points back at it', () => {
  const { names, markers } = resolveAnswerKeyLabels(HEART)
  assert.equal(names.length, 2)
  for (const n of names) {
    assert.ok(n.leader, `${n.text} carries a line back to its number`)
    const marker = markers.find(m => Math.abs(m.x - n.leader.x2) < 1e-9
      && Math.abs(m.y - n.leader.y2) < 1e-9)
    assert.ok(marker, `${n.text}'s line ends on a numbered marker`)
    // Clear of it, or the number would be unreadable underneath the name.
    const dx = Math.abs(n.x - marker.x) * 360
    const dy = Math.abs(n.y - marker.y) * 240
    assert.ok(
      dx > (n.widthPx + marker.widthPx) / 2 - 1 || dy > (n.heightPx + marker.heightPx) / 2 - 1,
      `${n.text} does not cover its number`,
    )
  }
})

test('a marker left blank on purpose gets no empty pill', () => {
  // In identify mode a blank label is a real numbered hotspot the teacher marks
  // by hand — it must keep its number and gain no floating empty box.
  const { markers, names } = resolveAnswerKeyLabels([
    { x: 0.3, y: 0.3, text: 'Aorta' },
    { x: 0.7, y: 0.7, text: '' },
  ])
  assert.equal(markers.length, 2, 'both hotspots keep their numbers')
  assert.equal(names.length, 1, 'only the answered one gets a name')
  assert.equal(names[0].text, 'Aorta')
})

test('names de-collide with each other as well as with the numbers', () => {
  const crowded = [
    { x: 0.5, y: 0.5, text: 'Left atrium' },
    { x: 0.53, y: 0.5, text: 'Right atrium' },
  ]
  const { names } = resolveAnswerKeyLabels(crowded)
  const dx = Math.abs(names[0].x - names[1].x) * 360
  const dy = Math.abs(names[0].y - names[1].y) * 240
  assert.ok(
    dx >= (names[0].widthPx + names[1].widthPx) / 2 - 1
      || dy >= (names[0].heightPx + names[1].heightPx) / 2 - 1,
    `the two names are separated (dx=${dx.toFixed(1)}, dy=${dy.toFixed(1)})`,
  )
})

test('an anchor pushes a label and never moves itself', () => {
  const { labels } = resolveFigureLabels(
    [{ x: 0.5, y: 0.5, text: 'Aorta' }],
    { anchors: [{ x: 0.5, y: 0.5, widthPx: 20, heightPx: 20 }] },
  )
  assert.equal(labels[0].moved, true, 'the label gave way')
  const dx = Math.abs(labels[0].x - 0.5) * 360
  const dy = Math.abs(labels[0].y - 0.5) * 240
  assert.ok(
    dx >= (labels[0].widthPx + 20) / 2 - 1 || dy >= (labels[0].heightPx + 20) / 2 - 1,
    'and cleared the anchor',
  )
})

test('an anchor with no size is ignored rather than trapping a label', () => {
  const { labels, movedCount } = resolveFigureLabels(
    [{ x: 0.5, y: 0.5, text: 'Aorta' }],
    { anchors: [{ x: 0.5, y: 0.5 }, null, { x: 0.5, y: 0.5, widthPx: 0, heightPx: 0 }] },
  )
  assert.equal(movedCount, 0)
  assert.equal(labels[0].x, 0.5)
})

/* ── defaults and rubbish ───────────────────────────────────────────────── */

console.log('\n— defaults —')

test('with no box given, the A4 column figure box is used', () => {
  const a = resolveFigureLabels([{ x: 0.5, y: 0.5, text: 'X' }])
  const b = resolveFigureLabels([{ x: 0.5, y: 0.5, text: 'X' }], NOMINAL_FIGURE_BOX)
  assert.deepEqual(a, b)
})

test('nothing in, nothing out', () => {
  assert.deepEqual(resolveFigureLabels([]), { labels: [], movedCount: 0, unresolvedOverlaps: 0 })
  assert.deepEqual(resolveFigureLabels(null).labels, [])
  assert.equal(figureLabelWarning(null), '')
  assert.equal(figureLabelWarning({ unresolvedOverlaps: 0 }), '')
})

test('out-of-range and missing coordinates are clamped, not thrown on', () => {
  assert.doesNotThrow(() => resolveFigureLabels([
    { x: -3, y: 9, text: 'A' }, { text: 'B' }, { x: 'left', y: null, text: 'C' },
  ], BOX))
  const { labels } = resolveFigureLabels([{ x: 5, y: 5, text: 'A' }], BOX)
  assert.ok(labels[0].x <= 1 && labels[0].y <= 1)
})

test('a half-specified target is no target', () => {
  // tx without ty cannot point anywhere; treating it as (tx, 0) would draw a
  // line to the top of the figure.
  const { labels } = resolveFigureLabels([{ x: 0.3, y: 0.3, tx: 0.9, text: 'A' }], BOX)
  assert.equal(labels[0].target, null)
  assert.equal(labels[0].leader, null)
})

console.log(`\n✓ figure label layout — ${passed} tests passed`)
