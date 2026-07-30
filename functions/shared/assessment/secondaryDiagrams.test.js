/**
 * The senior figures are mathematically true.
 *
 * These diagrams carry marks. A learner measures the angle in a circle-theorem
 * figure, reads the bearing off a journey, takes a value off a plotted curve
 * and finds the median where an ogive's read-off line lands. So the assertions
 * below are not "it rendered" — they parse the SVG that was actually drawn and
 * do the mathematics on it, the way a learner with a protractor would.
 *
 * It lives HERE rather than under scripts/ for a reason the coverage ratchet
 * made plain: `functions/shared/assessment` is inside the backend coverage
 * scope, the figures are mostly branches, and a test sitting in scripts/ runs
 * in `test:all` but not in `functions:coverage` — so the code counted against
 * the ratchet while its own tests did not count for it. The rule the .c8rc
 * states is to cover the new code rather than lower the bar, and this is that.
 *
 * The SVG reader it uses is a test tool and stays under scripts/lib, with its
 * own tests (`npm run test:svg-geometry`).
 *
 * Run: node functions/shared/assessment/secondaryDiagrams.test.js
 */

import assert from 'node:assert/strict'
import {
  DIAGRAM_CATALOG, getDiagram, renderDiagramSvg,
  resolveFigureForExport, validateDiagramParams,
} from './diagramCatalogCore.js'
import { unresolvedRequiredFigures } from './unresolvedFiguresCore.js'
import {
  parseSvg, select, selectOne, num, texts,
  angleBetween, bearingFromNorth, dist, approx, approxPoint,
  plotFrame, assertFrameMatchesAxisLabels, graphPoints,
} from '../../../scripts/lib/svgGeometry.mjs'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const draw = (key, params) => parseSvg(renderDiagramSvg(key, params, '#1c1612'))
const pointAt = (parsed, name) => {
  const el = selectOne(parsed, 'circle', (e) => e.attrs['data-point'] === name)
  return [num(el, 'cx'), num(el, 'cy')]
}
// validate() is optional — a figure whose every field is free text has nothing
// to complain about, and must not be forced to say so in an empty function.
const issues = (key, params) => {
  const entry = getDiagram(key)
  return entry.validate ? entry.validate({ ...entry.defaults, ...params }) : []
}

/* ── every new family, structurally ──────────────────────────────────────── */

const FAMILIES = [
  'circletheorem', 'bearings', 'elevation', 'labelledtriangle',
  'functiongraph', 'transformation', 'vectordiagram',
  'histogram', 'frequencypolygon', 'ogive', 'travelgraph', 'linearprogramming',
  'earthgeometry', 'venn3elements',
  'frustum', 'pyramid',
]

/** The families that plot into the shared Cartesian frame. */
const GRID_FAMILIES = [
  'functiongraph', 'transformation', 'vectordiagram',
  'histogram', 'frequencypolygon', 'ogive', 'travelgraph', 'linearprogramming',
]

console.log('\nsecondary diagrams — catalog shape')

test('each family is a catalog entry with the standard shape', () => {
  for (const key of FAMILIES) {
    const entry = getDiagram(key)
    assert.ok(entry, `missing entry: ${key}`)
    for (const prop of ['cat', 'name']) {
      assert.equal(typeof entry[prop], 'string', `${key}.${prop}`)
      assert.ok(entry[prop].length, `${key}.${prop} is empty`)
    }
    assert.ok(entry.defaults && typeof entry.defaults === 'object', `${key} needs defaults`)
    assert.ok(Array.isArray(entry.fields) && entry.fields.length, `${key} needs fields`)
    assert.equal(typeof entry.render, 'function', `${key} needs a render fn`)
    // Every field must have a default, or the picker opens on a blank form and
    // the first thing a teacher sees is a broken figure.
    for (const [fieldKey] of entry.fields) {
      assert.ok(fieldKey in entry.defaults, `${key}.${fieldKey} has no default`)
    }
  }
})

test('each family renders a closed SVG from its defaults, with a parseable viewBox', () => {
  for (const key of FAMILIES) {
    const svg = renderDiagramSvg(key, getDiagram(key).defaults, '#1c1612')
    assert.ok(svg.startsWith('<svg') && svg.trim().endsWith('</svg>'), `${key} is not a closed SVG`)
    // assessmentToDocx sizes the Word embed by reading this exact shape —
    // "viewBox=\"0 0 W H\"" with four non-negative numbers. A viewBox with a
    // negative origin parses as no viewBox at all and the figure embeds at a
    // guessed 4:3, which distorts every graph.
    assert.match(svg, /viewBox="0 0 [\d.]+ [\d.]+"/, `${key} needs a 0-origin viewBox`)
  }
})

test('author-entered labels are escaped in every family', () => {
  for (const key of FAMILIES) {
    const entry = getDiagram(key)
    const params = {}
    for (const [fieldKey] of entry.fields) params[fieldKey] = '<script>x</script>'
    const svg = renderDiagramSvg(key, params, '#1c1612')
    assert.ok(!svg.includes('<script>'), `${key} did not escape a hostile label`)
  }
})

test('every family offers the "not drawn to scale" caption', () => {
  for (const key of FAMILIES) {
    const entry = getDiagram(key)
    assert.ok('notToScale' in entry.defaults, `${key} has no notToScale field`)
    const on = renderDiagramSvg(key, { ...entry.defaults, notToScale: 'yes' }, '#1c1612')
    const off = renderDiagramSvg(key, { ...entry.defaults, notToScale: 'no' }, '#1c1612')
    assert.ok(on.includes('Diagram not drawn to scale'), `${key} never prints the caption`)
    assert.ok(!off.includes('Diagram not drawn to scale'), `${key} prints the caption when told not to`)
  }
})

/* ── circle geometry ─────────────────────────────────────────────────────── */

console.log('\ncircle geometry')

test('every point sits on the circle, at the degree the teacher gave it', () => {
  const parsed = draw('circletheorem', { points: 'A@0,B@90,C@180,D@270', joins: '', angles: '' })
  const circle = selectOne(parsed, 'circle', (e) => e.attrs.r && parseFloat(e.attrs.r) > 20)
  const centre = [num(circle, 'cx'), num(circle, 'cy')]
  const r = num(circle, 'r')
  // 0° is the 3 o'clock position and the angles run anticlockwise, so B@90 is
  // straight up: in SVG that is a SMALLER y, and getting the flip wrong would
  // put every circle-theorem figure upside down.
  approx(dist(pointAt(parsed, 'A'), [centre[0] + r, centre[1]]), 0, 0.5, 'A at 0°')
  approx(dist(pointAt(parsed, 'B'), [centre[0], centre[1] - r]), 0, 0.5, 'B at 90°')
  approx(dist(pointAt(parsed, 'C'), [centre[0] - r, centre[1]]), 0, 0.5, 'C at 180°')
  approx(dist(pointAt(parsed, 'D'), [centre[0], centre[1] + r]), 0, 0.5, 'D at 270°')
})

test('the angle at the centre really is twice the angle at the circumference', () => {
  // The theorem itself, drawn to scale: A and C on the circle with B on the
  // major arc. Whatever the positions, ∠AOC must measure twice ∠ABC — and
  // that is a property of the DRAWING, not of the labels.
  const parsed = draw('circletheorem', {
    points: 'A@200,B@90,C@340', joins: 'O-A,O-C,A-B,B-C', angles: '', notToScale: 'yes',
  })
  const O = pointAt(parsed, 'O'), A = pointAt(parsed, 'A'), B = pointAt(parsed, 'B'), C = pointAt(parsed, 'C')
  const atCentre = angleBetween(O, A, C)
  const atCircumference = angleBetween(B, A, C)
  approx(atCentre, 2 * atCircumference, 0.5, 'angle at centre vs circumference')
})

test('angles in the same segment are equal, as drawn', () => {
  const parsed = draw('circletheorem', {
    points: 'A@190,B@80,C@110,D@350', joins: 'A-B,B-D,A-C,C-D', angles: '',
  })
  const A = pointAt(parsed, 'A'), B = pointAt(parsed, 'B'), C = pointAt(parsed, 'C'), D = pointAt(parsed, 'D')
  approx(angleBetween(B, A, D), angleBetween(C, A, D), 0.5, 'same-segment angles')
})

test('opposite angles of a cyclic quadrilateral add up to 180°, as drawn', () => {
  const parsed = draw('circletheorem', {
    points: 'P@140,Q@40,R@310,S@215', joins: 'P-Q,Q-R,R-S,S-P', angles: '',
  })
  const P = pointAt(parsed, 'P'), Q = pointAt(parsed, 'Q'), R = pointAt(parsed, 'R'), S = pointAt(parsed, 'S')
  approx(angleBetween(P, S, Q) + angleBetween(R, Q, S), 180, 0.5, 'opposite angles')
})

test('a tangent is perpendicular to the radius at the point it touches', () => {
  const parsed = draw('circletheorem', {
    points: 'A@140,C@300', joins: 'O-C', angles: '', tangent: 'C:T,U',
  })
  const O = pointAt(parsed, 'O'), C = pointAt(parsed, 'C'), T = pointAt(parsed, 'T'), U = pointAt(parsed, 'U')
  approx(angleBetween(C, O, T), 90, 0.2, 'radius ⟂ tangent (T side)')
  approx(angleBetween(C, O, U), 90, 0.2, 'radius ⟂ tangent (U side)')
  // T and U are the two ends of one straight line through C.
  approx(angleBetween(C, T, U), 180, 0.2, 'T, C and U are collinear')
})

test('a marked angle prints its label; a numeric one gains the degree sign', () => {
  const parsed = draw('circletheorem', { points: 'A@160,B@60,C@300', joins: 'O-A,O-C,A-B,B-C', angles: 'AOC=110,ABC=x' })
  const rendered = texts(parsed)
  assert.ok(rendered.includes('110°'), 'the numeric mark prints with a degree sign')
  assert.ok(rendered.includes('x'), 'the symbolic mark prints as written')
  assert.ok(!rendered.includes('x°'), 'an unknown is not given a degree sign')
  assert.equal(select(parsed, 'path', (e) => e.attrs['data-angle-mark']).length, 2, 'one arc per marked angle')
})

test('a right angle is marked with the square, not an arc', () => {
  // On an examination paper the square means "this is the perpendicular",
  // which is frequently the fact the whole question rests on.
  const parsed = draw('circletheorem', { points: 'A@0,B@90', joins: 'O-A,O-B', angles: 'AOB=90', notToScale: 'no' })
  assert.equal(select(parsed, 'path', (e) => e.attrs['data-angle-mark'] === 'arc').length, 0)
  assert.equal(select(parsed, 'polyline', (e) => e.attrs['data-angle-mark'] === 'right').length, 1)
})

console.log('\ncircle geometry — what a teacher is told when it cannot be drawn')

test('a mistyped point, join or angle is named in plain words', () => {
  assert.match(issues('circletheorem', { points: 'A@160,Bee' })[0].message, /is not a point/)
  assert.match(issues('circletheorem', { points: 'A@160,B@60', joins: 'A-Z' })[0].message, /"Z" is not one of your points/)
  assert.match(issues('circletheorem', { points: 'A@160,B@60', joins: '', angles: 'AB=40' })[0].message, /must name three points/)
  assert.match(issues('circletheorem', { points: 'A@10,A@20' })[0].message, /used twice/)
})

test('a tangent must touch the circle', () => {
  assert.match(issues('circletheorem', { points: 'A@160,B@60', joins: '', angles: '', tangent: 'Z:T,U' })[0].message,
    /must be one of your points on the circle/)
})

test('a drawn-to-scale figure whose mark contradicts its own drawing is refused', () => {
  // The failure this catches reaches learners: the teacher turns the caption
  // off (so "you may measure this"), and the 110° written on the page is a 63°
  // corner. Either the mark or the caption is wrong, and the message says so.
  const found = issues('circletheorem', {
    points: 'A@180,B@90,C@0', joins: 'O-A,O-C', angles: 'AOC=110', notToScale: 'no',
  })
  assert.equal(found.length, 1)
  assert.match(found[0].message, /you marked AOC as 110°/i)
  assert.match(found[0].message, /drawn as 180°/)
  // With the caption on, the same figure is fine — the paper has said so.
  assert.deepEqual(issues('circletheorem', {
    points: 'A@180,B@90,C@0', joins: 'O-A,O-C', angles: 'AOC=110', notToScale: 'yes',
  }), [])
})

test('the defaults of every family validate cleanly', () => {
  for (const key of FAMILIES) {
    assert.deepEqual(issues(key, {}), [], `${key}'s own defaults produce a complaint`)
  }
})

/* ── bearings ────────────────────────────────────────────────────────────── */

console.log('\nbearings')

test('each leg is drawn on the true bearing it was given', () => {
  const parsed = draw('bearings', { legs: 'A>B,060,8;B>C,135,6;C>D,300,9' })
  const A = pointAt(parsed, 'A'), B = pointAt(parsed, 'B'), C = pointAt(parsed, 'C'), D = pointAt(parsed, 'D')
  approx(bearingFromNorth(A, B), 60, 0.2, 'leg A→B')
  approx(bearingFromNorth(B, C), 135, 0.2, 'leg B→C')
  approx(bearingFromNorth(C, D), 300, 0.2, 'leg C→D')
})

test('leg lengths stay in proportion — one scale, not one per axis', () => {
  // Fitting the journey by stretching x and y independently would fill the box
  // more neatly and silently change every bearing on the page.
  const parsed = draw('bearings', { legs: 'A>B,090,10;B>C,180,5' })
  const A = pointAt(parsed, 'A'), B = pointAt(parsed, 'B'), C = pointAt(parsed, 'C')
  approx(dist(A, B) / dist(B, C), 2, 0.02, 'a 10 km leg is twice a 5 km leg')
})

test('a north line is drawn at every point a leg leaves from', () => {
  const parsed = draw('bearings', { legs: 'A>B,060,8;B>C,135,6' })
  const norths = select(parsed, 'line', (e) => e.attrs['data-north'])
  assert.deepEqual(norths.map((e) => e.attrs['data-north']).sort(), ['A', 'B'])
  for (const el of norths) {
    // Straight up the page: same x, smaller y.
    approx(num(el, 'x2'), num(el, 'x1'), 0.01, 'the north line is vertical')
    assert.ok(num(el, 'y2') < num(el, 'y1'), 'the north line points up')
  }
})

test('bearings print as three figures, the way a paper writes them', () => {
  const rendered = texts(draw('bearings', { legs: 'A>B,060,8;B>C,7,6' }))
  assert.ok(rendered.includes('060°'), '60 prints as 060°')
  assert.ok(rendered.includes('007°'), '7 prints as 007°')
})

test('the bearing arc sweeps clockwise from north', () => {
  const parsed = draw('bearings', { legs: 'A>B,240,8' })
  const arc = selectOne(parsed, 'path', (e) => e.attrs['data-bearing'])
  approx(parseFloat(arc.attrs['data-bearing']), 240, 0.01, 'arc angle')
  // A reflex bearing needs the large-arc flag, or 240° is drawn as 120°.
  assert.match(arc.attrs.d, /A 30,30 0 1,1/, 'a bearing over 180° takes the long way round')
})

test('distances are labelled with their unit', () => {
  assert.ok(texts(draw('bearings', { legs: 'A>B,060,8', unit: 'km' })).includes('8 km'))
})

test('a leg that starts nowhere, or has an impossible bearing, is explained', () => {
  assert.match(issues('bearings', { legs: 'A>B,060,8;X>Y,100,3' })[0].message, /which no earlier leg reaches/)
  assert.match(issues('bearings', { legs: 'A>B,400,8' })[0].message, /from 000 to 359/)
  assert.match(issues('bearings', { legs: 'A>B,060,-2' })[0].message, /must be a positive number/)
  assert.match(issues('bearings', { legs: 'A to B' })[0].message, /is not a leg/)
})

/* ── trigonometry ────────────────────────────────────────────────────────── */

console.log('\ntrigonometry')

test('an angle of elevation is drawn at the size it was given', () => {
  for (const angle of [20, 35, 62]) {
    const parsed = draw('elevation', { angle: String(angle), mode: 'elevation' })
    const obs = pointAt(parsed, 'observer')
    const obj = pointAt(parsed, 'object')
    const ground = selectOne(parsed, 'line', (e) => e.attrs['data-ground'])
    const along = [num(ground, 'x2'), num(ground, 'y2')]
    approx(angleBetween(obs, along, obj), angle, 0.2, `${angle}° elevation`)
  }
})

test('an angle of depression is measured from the horizontal, downwards', () => {
  const parsed = draw('elevation', { angle: '40', mode: 'depression' })
  const obs = pointAt(parsed, 'observer')
  const obj = pointAt(parsed, 'object')
  const horiz = selectOne(parsed, 'line', (e) => e.attrs['data-horizontal'])
  const along = [num(horiz, 'x2'), num(horiz, 'y2')]
  approx(angleBetween(obs, along, obj), 40, 0.2, '40° depression')
  assert.ok(obj[1] > obs[1], 'the object is below the observer')
})

test('the elevation figure marks the right angle at the foot', () => {
  const parsed = draw('elevation', { angle: '35' })
  assert.equal(select(parsed, 'polyline', (e) => e.attrs['data-angle-mark'] === 'right').length, 1)
})

test('an impossible elevation angle is refused in words a teacher can act on', () => {
  assert.match(issues('elevation', { angle: '95' })[0].message, /between 0° and 90°/)
  assert.match(issues('elevation', { angle: 'steep' })[0].message, /as a number of degrees/)
})

test('a triangle given two angles is drawn with those angles', () => {
  const parsed = draw('labelledtriangle', { angleA: '50', angleB: '60', angleC: '' })
  const A = pointAt(parsed, 'A'), B = pointAt(parsed, 'B'), C = pointAt(parsed, 'C')
  approx(angleBetween(A, B, C), 50, 0.2, 'angle at A')
  approx(angleBetween(B, C, A), 60, 0.2, 'angle at B')
  approx(angleBetween(C, A, B), 70, 0.2, 'angle at C follows')
})

test('a triangle given one angle still draws that one truly', () => {
  const parsed = draw('labelledtriangle', { angleA: '', angleB: '', angleC: '90' })
  const A = pointAt(parsed, 'A'), B = pointAt(parsed, 'B'), C = pointAt(parsed, 'C')
  approx(angleBetween(C, A, B), 90, 0.2, 'the stated right angle')
})

test('angles that cannot belong to a triangle are refused', () => {
  assert.match(issues('labelledtriangle', { angleA: '90', angleB: '80', angleC: '30' })[0].message,
    /add up to 200°.*must add up to 180°/)
  assert.match(issues('labelledtriangle', { angleA: '120', angleB: '70', angleC: '' })[0].message,
    /leaving nothing for the third/)
  assert.match(issues('labelledtriangle', { angleA: '0', angleB: '60', angleC: '' })[0].message,
    /between 0° and 180°/)
})

test('side labels are printed only where the teacher gave one', () => {
  const rendered = texts(draw('labelledtriangle', { sideAB: '', sideBC: '8 cm', sideCA: '' }))
  assert.ok(rendered.includes('8 cm'), 'the given side is labelled')
  assert.equal(rendered.filter((t) => t.includes('cm')).length, 1, 'no blank side labels')
})

/* ── the Cartesian frame ─────────────────────────────────────────────────── */

console.log('\nthe Cartesian plane')

test('every grid family publishes a frame that agrees with its own axis numbers', () => {
  // This is what keeps every assertion below honest. The frame says what a
  // pixel means; the axis labels are painted from the same frame; if the frame
  // were wrong the labels would move with it, so a figure cannot pass this AND
  // a geometry assertion while lying about either.
  for (const key of GRID_FAMILIES) {
    const parsed = draw(key, getDiagram(key).defaults)
    assertFrameMatchesAxisLabels(parsed, plotFrame(parsed))
  }
})

test('the grid is drawn in ink that survives a photocopier', () => {
  // #d9cfbe, which the primary coordinate grid uses, prints at about 1.3:1 on
  // white — invisible once a school has copied the master forty times. A
  // learner reads values off these graphs, so the grid has to be there.
  const svg = renderDiagramSvg('functiongraph', getDiagram('functiongraph').defaults, '#1c1612')
  assert.ok(!svg.includes('#d9cfbe') && !svg.includes('#e4dccd'), 'the senior grid must not use the faint primary greys')
})

/* ── function graphs ─────────────────────────────────────────────────────── */

console.log('\nfunction graphs')

test('the curve is sampled from the function, not sketched to look right', () => {
  // Every drawn point is checked against y = f(x) in GRAPH coordinates. A
  // hand-drawn parabola of about the right shape fails this at the third
  // sample.
  const fns = [
    ['y = x^2 - 2x - 3', (x) => x * x - 2 * x - 3],
    ['y = 2x + 1', (x) => 2 * x + 1],
    ['y = x^3 - 4x', (x) => x ** 3 - 4 * x],
  ]
  for (const [expr, fn] of fns) {
    const parsed = draw('functiongraph', { fn: expr, xMin: '-4', xMax: '4', yMin: '-8', yMax: '8', show: '' })
    const frame = plotFrame(parsed)
    const curves = select(parsed, 'polyline', (e) => e.attrs['data-curve'])
    assert.ok(curves.length >= 1, `${expr} drew no curve`)
    let checked = 0
    for (const c of curves) {
      for (const [gx, gy] of graphPoints(frame, c)) {
        approx(gy, fn(gx), 0.02, `${expr} at x=${gx.toFixed(3)}`)
        checked += 1
      }
    }
    assert.ok(checked > 50, `${expr} was checked at only ${checked} points`)
  }
})

test('a quadratic\'s turning point and roots are marked at their true positions', () => {
  // y = x² − 2x − 3 has roots at −1 and 3 and a minimum at (1, −4). Those are
  // the values a learner reads off, so they are the values under test.
  const parsed = draw('functiongraph', {
    fn: 'y = x^2 - 2x - 3', xMin: '-3', xMax: '5', yMin: '-6', yMax: '8', show: 'roots,turning,yintercept',
  })
  const frame = plotFrame(parsed)
  const at = (kind) => select(parsed, 'circle', (e) => e.attrs['data-mark'] === kind)
    .map((e) => frame.toGraph([num(e, 'cx'), num(e, 'cy')]))
  const roots = at('root').map(([x]) => x).sort((a, b) => a - b)
  assert.equal(roots.length, 2)
  approx(roots[0], -1, 0.02, 'first root')
  approx(roots[1], 3, 0.02, 'second root')
  const turning = at('turning')
  assert.equal(turning.length, 1)
  approxPoint(turning[0], [1, -4], 0.03, 'minimum')
  approxPoint(at('yintercept')[0], [0, -3], 0.03, 'y-intercept')
  // And the printed coordinates say the same thing as the dots.
  const printed = texts(parsed)
  assert.ok(printed.includes('(1, -4)'), 'the turning point is labelled with its coordinates')
})

test('a cubic\'s three roots and two turning points are all found', () => {
  const parsed = draw('functiongraph', {
    fn: 'y = x^3 - 4x', xMin: '-3', xMax: '3', yMin: '-6', yMax: '6', show: 'roots,turning',
  })
  const frame = plotFrame(parsed)
  const roots = select(parsed, 'circle', (e) => e.attrs['data-mark'] === 'root')
    .map((e) => frame.toGraph([num(e, 'cx'), num(e, 'cy')])[0]).sort((a, b) => a - b)
  assert.equal(roots.length, 3)
  approx(roots[0], -2, 0.02); approx(roots[1], 0, 0.02); approx(roots[2], 2, 0.02)
  const turning = select(parsed, 'circle', (e) => e.attrs['data-mark'] === 'turning').length
  assert.equal(turning, 2, 'a cubic has two turning points')
})

test('a reciprocal is drawn as two branches, never a stroke through its asymptote', () => {
  const parsed = draw('functiongraph', {
    fn: 'y = 6/x', xMin: '-6', xMax: '6', yMin: '-6', yMax: '6', show: '',
  })
  const frame = plotFrame(parsed)
  const curves = select(parsed, 'polyline', (e) => e.attrs['data-curve'])
  assert.equal(curves.length, 2, 'one branch each side of x = 0')
  for (const c of curves) {
    const xs = graphPoints(frame, c).map(([x]) => x)
    assert.ok(xs.every((x) => x > 0) || xs.every((x) => x < 0), 'a branch never crosses the pole')
  }
})

test('a function outside the family it can plot is refused, not approximated', () => {
  assert.match(issues('functiongraph', { fn: 'y = sin x' })[0].message, /Brackets and other functions are not drawn/)
  const svg = renderDiagramSvg('functiongraph', { ...getDiagram('functiongraph').defaults, fn: 'y = sin x' }, '#1c1612')
  assert.ok(svg.includes('Function not recognised'), 'it says so on the figure rather than drawing something else')
})

test('a curve entirely off the page is caught before it is printed', () => {
  assert.match(
    issues('functiongraph', { fn: 'y = x^2 + 40', xMin: '-3', xMax: '3', yMin: '-6', yMax: '8' })[0].message,
    /Widen the y range/,
  )
})

/* ── transformations ─────────────────────────────────────────────────────── */

console.log('\ntransformations')

const OBJECT = '(1,1),(4,1),(1,3)'
const imageOf = (params) => {
  const parsed = draw('transformation', { object: OBJECT, xMin: '-8', xMax: '8', yMin: '-8', yMax: '8', ...params })
  const frame = plotFrame(parsed)
  return graphPoints(frame, selectOne(parsed, 'polygon', (e) => e.attrs['data-shape'] === 'image'))
}

test('the image is computed from the object, never hand-placed', () => {
  // Every case is worked by hand from (1,1),(4,1),(1,3) and asserted in graph
  // coordinates — the answer a learner would write down.
  const cases = [
    ['translation', '3,-2', [[4, -1], [7, -1], [4, 1]]],
    ['reflection', 'y-axis', [[-1, 1], [-4, 1], [-1, 3]]],
    ['reflection', 'x-axis', [[1, -1], [4, -1], [1, -3]]],
    ['reflection', 'y=x', [[1, 1], [1, 4], [3, 1]]],
    ['reflection', 'y=-x', [[-1, -1], [-1, -4], [-3, -1]]],
    ['reflection', 'x=2', [[3, 1], [0, 1], [3, 3]]],
    ['rotation', '90,0,0', [[-1, 1], [-1, 4], [-3, 1]]],
    ['rotation', '180,0,0', [[-1, -1], [-4, -1], [-1, -3]]],
    ['rotation', '-90,0,0', [[1, -1], [1, -4], [3, -1]]],
    ['enlargement', '2,0,0', [[2, 2], [8, 2], [2, 6]]],
    ['enlargement', '-1,0,0', [[-1, -1], [-4, -1], [-1, -3]]],
    ['shear', 'x,2', [[3, 1], [6, 1], [7, 3]]],
    ['stretch', 'y,3', [[1, 3], [4, 3], [1, 9]]],
  ]
  for (const [type, by, expected] of cases) {
    const got = imageOf({ type, by, yMax: '10' })
    assert.equal(got.length, expected.length, `${type} ${by}: wrong number of vertices`)
    got.forEach((pt, i) => approxPoint(pt, expected[i], 0.03, `${type} ${by} vertex ${i}`))
  }
})

test('a rotation about a centre that is not the origin still lands exactly', () => {
  // 90° anticlockwise about (1, 2): (x,y) → (1 - (y-2), 2 + (x-1)).
  const got = imageOf({ type: 'rotation', by: '90,1,2' })
  got.forEach((pt, i) => {
    const [x, y] = [[1, 1], [4, 1], [1, 3]][i]
    approxPoint(pt, [1 - (y - 2), 2 + (x - 1)], 0.03, `rotation about (1,2) vertex ${i}`)
  })
})

test('the mirror line and the centre of rotation are drawn', () => {
  const mirrored = draw('transformation', { object: OBJECT, type: 'reflection', by: 'y=x' })
  assert.equal(select(mirrored, 'line', (e) => e.attrs['data-mirror']).length, 1)
  assert.ok(texts(mirrored).includes('y = x'), 'the mirror line names itself')
  const rotated = draw('transformation', { object: OBJECT, type: 'rotation', by: '90,1,2' })
  const centre = selectOne(rotated, 'circle', (e) => e.attrs['data-centre'])
  const frame = plotFrame(rotated)
  approxPoint(frame.toGraph([num(centre, 'cx'), num(centre, 'cy')]), [1, 2], 0.03, 'centre of rotation')
})

test('an image that would fall off the paper is caught, not clipped', () => {
  assert.match(
    issues('transformation', { object: OBJECT, type: 'enlargement', by: '4,0,0', xMin: '-6', xMax: '6', yMin: '-6', yMax: '6' })[0].message,
    /outside the grid you set/,
  )
})

test('an unusable transformation is explained in the teacher\'s own terms', () => {
  assert.match(issues('transformation', { type: 'wobble', by: '1' })[0].message, /translation, reflection, rotation/)
  assert.match(issues('transformation', { type: 'reflection', by: 'the middle' })[0].message, /needs its mirror line/)
  assert.match(issues('transformation', { type: 'enlargement', by: '0,0,0' })[0].message, /not zero/)
  assert.match(issues('transformation', { object: 'somewhere' })[0].message, /as coordinates/)
})

/* ── vectors ─────────────────────────────────────────────────────────────── */

console.log('\nvectors')

test('each vector runs between the points it was given, and carries an arrowhead', () => {
  const parsed = draw('vectordiagram', {
    vectors: 'a:(0,0)>(4,2),b:(4,2)>(6,-2)', xMin: '-2', xMax: '8', yMin: '-4', yMax: '5',
  })
  const frame = plotFrame(parsed)
  const a = selectOne(parsed, 'line', (e) => e.attrs['data-vector'] === 'a')
  approxPoint(frame.toGraph([num(a, 'x1'), num(a, 'y1')]), [0, 0], 0.03, 'a starts at the origin')
  approxPoint(frame.toGraph([num(a, 'x2'), num(a, 'y2')]), [4, 2], 0.03, 'a ends at (4,2)')
  assert.equal(select(parsed, 'polygon').length, 2, 'one arrowhead per vector')
  assert.ok(texts(parsed).includes('a') && texts(parsed).includes('b'), 'both vectors are named')
})

test('turning the grid off moves nothing', () => {
  // The axes are simply not printed — the frame is the same, so an off-grid
  // vector diagram and an on-grid one place every arrow identically.
  const params = { vectors: 'a:(1,1)>(5,3)', xMin: '-2', xMax: '8', yMin: '-4', yMax: '5' }
  const on = draw('vectordiagram', { ...params, grid: 'yes' })
  const off = draw('vectordiagram', { ...params, grid: 'no' })
  const arrow = (parsed) => {
    const el = selectOne(parsed, 'line', (e) => e.attrs['data-vector'] === 'a')
    return [num(el, 'x1'), num(el, 'y1'), num(el, 'x2'), num(el, 'y2')]
  }
  assert.deepEqual(arrow(on), arrow(off))
  assert.equal(select(off, 'line', (e) => e.attrs['data-axis-line']).length, 0, 'no axes when the grid is off')
})

test('a vector with no direction, or one off the grid, is refused', () => {
  assert.match(issues('vectordiagram', { vectors: 'a:(2,2)>(2,2)' })[0].message, /no direction to draw/)
  assert.match(issues('vectordiagram', { vectors: 'a:(0,0)>(40,2)' })[0].message, /outside the grid you set/)
  assert.match(issues('vectordiagram', { vectors: 'a goes up a bit' })[0].message, /is not a vector/)
})

/* ── statistics ──────────────────────────────────────────────────────────── */

console.log('\nstatistics')

const DIST = { boundaries: '0,10,20,30,40,50', frequencies: '4,9,14,8,3' }

test('a histogram\'s bars span their class boundaries, at the stated frequency', () => {
  const parsed = draw('histogram', DIST)
  const frame = plotFrame(parsed)
  const bars = select(parsed, 'rect', (e) => e.attrs['data-bar'])
  assert.equal(bars.length, 5)
  const bounds = [0, 10, 20, 30, 40, 50]
  const freqs = [4, 9, 14, 8, 3]
  bars.forEach((el, i) => {
    const left = frame.toGraph([num(el, 'x'), num(el, 'y')])
    const right = frame.toGraph([num(el, 'x') + num(el, 'width'), num(el, 'y') + num(el, 'height')])
    approx(left[0], bounds[i], 0.02, `bar ${i} left edge`)
    approx(right[0], bounds[i + 1], 0.02, `bar ${i} right edge`)
    approx(left[1], freqs[i], 0.02, `bar ${i} height`)
    approx(right[1], 0, 0.02, `bar ${i} sits on the axis`)
  })
})

test('histogram bars touch — it is not a bar chart of separate categories', () => {
  const parsed = draw('histogram', DIST)
  const bars = select(parsed, 'rect', (e) => e.attrs['data-bar'])
  for (let i = 1; i < bars.length; i += 1) {
    approx(num(bars[i], 'x'), num(bars[i - 1], 'x') + num(bars[i - 1], 'width'), 0.05, `gap before bar ${i}`)
  }
})

test('unequal classes plot frequency DENSITY when asked', () => {
  // 0–10 with frequency 5 and 10–30 with frequency 20 are the same height on a
  // frequency axis and half vs one on a density axis. Getting this wrong is
  // the classic misleading histogram.
  const parsed = draw('histogram', { boundaries: '0,10,30', frequencies: '5,20', density: 'yes' })
  const frame = plotFrame(parsed)
  const bars = select(parsed, 'rect', (e) => e.attrs['data-bar'])
  approx(frame.toGraph([num(bars[0], 'x'), num(bars[0], 'y')])[1], 0.5, 0.02, 'density of the narrow class')
  approx(frame.toGraph([num(bars[1], 'x'), num(bars[1], 'y')])[1], 1, 0.02, 'density of the wide class')
})

test('a frequency polygon plots the midpoints and closes to zero at both ends', () => {
  const parsed = draw('frequencypolygon', DIST)
  const frame = plotFrame(parsed)
  const line = graphPoints(frame, selectOne(parsed, 'polyline', (e) => e.attrs['data-polygon']))
  // It closes at the MIDPOINT of the notional empty class at each end — −5 and
  // 55, not the boundaries −10 and 60 — which is what keeps the area under the
  // polygon equal to the area of the histogram it came from.
  const expected = [[-5, 0], [5, 4], [15, 9], [25, 14], [35, 8], [45, 3], [55, 0]]
  assert.equal(line.length, expected.length)
  line.forEach((pt, i) => approxPoint(pt, expected[i], 0.05, `vertex ${i}`))
})

test('an ogive rises from the first LOWER boundary and never falls', () => {
  // Starting the curve at the first UPPER boundary is the common slip, and it
  // moves every quartile a learner reads off it.
  const parsed = draw('ogive', DIST)
  const frame = plotFrame(parsed)
  const curve = graphPoints(frame, selectOne(parsed, 'polyline', (e) => e.attrs['data-curve']))
  approxPoint(curve[0], [0, 0], 0.05, 'the curve starts at (0, 0)')
  const expected = [[0, 0], [10, 4], [20, 13], [30, 27], [40, 35], [50, 38]]
  curve.forEach((pt, i) => approxPoint(pt, expected[i], 0.06, `cumulative point ${i}`))
  for (let i = 1; i < curve.length; i += 1) {
    assert.ok(curve[i][1] >= curve[i - 1][1] - 1e-6, 'a cumulative frequency curve never falls')
  }
})

test('the read-off lines land at the true median and quartiles', () => {
  // n = 38, so the median is read at cf 19 and the quartiles at 9.5 and 28.5.
  // Between (10, 4) and (20, 13) the curve is linear, so cf 9.5 is at
  // x = 10 + (5.5/9)*10 = 16.11…; cf 19 falls between (10,4)→(20,13)→(30,27):
  // 19 is in the 13→27 class, x = 20 + (6/14)*10 = 24.28…; cf 28.5 is in the
  // 27→35 class, x = 30 + (1.5/8)*10 = 31.875.
  const parsed = draw('ogive', { ...DIST, readOff: 'median,quartiles' })
  const frame = plotFrame(parsed)
  const dropAt = (name) => {
    const el = selectOne(parsed, 'line', (e) => e.attrs['data-readoff-drop'] === name)
    return frame.toGraph([num(el, 'x1'), num(el, 'y1')])
  }
  approx(dropAt('median')[0], 20 + (6 / 14) * 10, 0.05, 'median')
  approx(dropAt('lower quartile')[0], 10 + (5.5 / 9) * 10, 0.05, 'lower quartile')
  approx(dropAt('upper quartile')[0], 30 + (1.5 / 8) * 10, 0.05, 'upper quartile')
  // Each read-off is a horizontal line to the curve and a vertical drop to the
  // axis — the way it is done with a ruler.
  assert.equal(select(parsed, 'line', (e) => e.attrs['data-readoff']).length, 3)
  const medianAcross = selectOne(parsed, 'line', (e) => e.attrs['data-readoff'] === 'median')
  approx(num(medianAcross, 'y1'), num(medianAcross, 'y2'), 0.01, 'the read-off line is horizontal')
  approx(frame.toGraph([num(medianAcross, 'x2'), num(medianAcross, 'y2')])[1], 19, 0.05, 'read across at cf 19')
})

test('read-off lines are drawn only when asked for', () => {
  assert.equal(select(draw('ogive', { ...DIST, readOff: '' }), 'line', (e) => e.attrs['data-readoff']).length, 0)
  assert.equal(select(draw('ogive', { ...DIST, readOff: 'median' }), 'line', (e) => e.attrs['data-readoff']).length, 1)
})

test('a table whose frequencies do not match its classes is refused, with the counts', () => {
  assert.match(
    issues('histogram', { boundaries: '0,10,20,30', frequencies: '4,9' })[0].message,
    /4 boundaries make 3 classes, but you gave 2 frequencies/,
  )
  assert.match(issues('ogive', { boundaries: '0,10,5', frequencies: '1,2' })[0].message, /must increase/)
  assert.match(issues('histogram', { ...DIST, frequencies: '4,-9,14,8,3' })[0].message, /cannot be negative/)
})

/* ── travel graphs ───────────────────────────────────────────────────────── */

console.log('\ntravel graphs')

test('the graph passes through every point given, in time order', () => {
  const parsed = draw('travelgraph', { points: '0,0;1,60;2.5,60;4,0' })
  const frame = plotFrame(parsed)
  const line = graphPoints(frame, selectOne(parsed, 'polyline', (e) => e.attrs['data-travel']))
  const expected = [[0, 0], [1, 60], [2.5, 60], [4, 0]]
  assert.equal(line.length, expected.length)
  line.forEach((pt, i) => approxPoint(pt, expected[i], 0.05, `point ${i}`))
})

test('the area under the graph can be shaded — it is what the question asks for', () => {
  assert.equal(select(draw('travelgraph', { points: '0,0;1,20;3,20', shade: 'yes' }), 'path', (e) => e.attrs['data-area']).length, 1)
  assert.equal(select(draw('travelgraph', { points: '0,0;1,20;3,20', shade: 'no' }), 'path', (e) => e.attrs['data-area']).length, 0)
})

test('time that runs backwards is refused', () => {
  assert.match(issues('travelgraph', { points: '0,0;3,60;1,20' })[0].message, /Time runs forwards/)
  assert.match(issues('travelgraph', { points: '0,0' })[0].message, /at least two points/)
  assert.match(issues('travelgraph', { points: '0,0;later,60' })[0].message, /is not a point/)
})

/* ── linear programming ──────────────────────────────────────────────────── */

console.log('\nlinear programming')

const LP = { constraints: 'x+y<=6,2x+y<=8,x>=0,y>=0', xMin: '0', xMax: '8', yMin: '0', yMax: '8' }

test('every vertex of the drawn region satisfies every inequality', () => {
  const parsed = draw('linearprogramming', LP)
  const frame = plotFrame(parsed)
  const region = graphPoints(frame, selectOne(parsed, 'polygon', (e) => e.attrs['data-region']))
  assert.ok(region.length >= 3, 'a region was drawn')
  for (const [x, y] of region) {
    assert.ok(x + y <= 6 + 0.02, `(${x.toFixed(2)}, ${y.toFixed(2)}) breaks x + y <= 6`)
    assert.ok(2 * x + y <= 8 + 0.02, `(${x.toFixed(2)}, ${y.toFixed(2)}) breaks 2x + y <= 8`)
    assert.ok(x >= -0.02 && y >= -0.02, 'the region stays in the first quadrant')
  }
  // The corner where x+y=6 meets 2x+y=8 is (2, 4), and it is a vertex of the
  // feasible region — the point an optimum is usually found at.
  assert.ok(region.some(([x, y]) => Math.abs(x - 2) < 0.05 && Math.abs(y - 4) < 0.05),
    'the intersection of the two boundaries is a vertex of the region')
})

test('a strict inequality is drawn with a dashed boundary', () => {
  // Dashed means the line itself is not part of the region. Drawing it solid
  // tells a learner the wrong thing about every point on it.
  const parsed = draw('linearprogramming', { ...LP, constraints: 'x+y<6,y>=1' })
  const dashed = select(parsed, 'line', (e) => e.attrs['data-strict'])
  assert.equal(dashed.length, 1)
  assert.match(dashed[0].attrs['stroke-dasharray'] || '', /\d/)
  const solid = select(parsed, 'line', (e) => e.attrs['data-boundary'] && !e.attrs['data-strict'])
  assert.equal(solid.length, 1)
  assert.ok(!solid[0].attrs['stroke-dasharray'], 'a non-strict boundary is solid')
})

test('shading the unwanted region leaves the feasible region clear', () => {
  const unwanted = draw('linearprogramming', { ...LP, shade: 'unwanted' })
  const shading = selectOne(unwanted, 'path', (e) => e.attrs['data-shading'] === 'unwanted')
  // The whole box with the region punched out of it, by the even-odd rule —
  // so the shading and the outline cannot disagree about where the boundary is.
  assert.equal(shading.attrs['fill-rule'], 'evenodd')
  assert.equal((shading.attrs.d.match(/Z/g) || []).length, 2, 'two subpaths: the box and the region')
  const wanted = draw('linearprogramming', { ...LP, shade: 'wanted' })
  assert.equal(select(wanted, 'path', (e) => e.attrs['data-shading'] === 'wanted').length, 1)
})

test('the feasible region is labelled', () => {
  assert.ok(texts(draw('linearprogramming', { ...LP, regionLabel: 'R' })).includes('R'))
})

test('inequalities with no common region are refused, rather than drawn empty', () => {
  assert.match(
    issues('linearprogramming', { ...LP, constraints: 'x+y<=2,x+y>=6' })[0].message,
    /No region satisfies all of these inequalities/,
  )
  assert.match(issues('linearprogramming', { ...LP, constraints: 'x squared <= 4' })[0].message, /is not an inequality this can draw/)
})

/* ── earth geometry ──────────────────────────────────────────────────────── */

console.log('\nearth geometry')

const placeAt = (parsed, name) => {
  const el = selectOne(parsed, 'circle', (e) => e.attrs['data-place'] === name)
  return [num(el, 'cx'), num(el, 'cy')]
}

test('two points on the same parallel are drawn at the same height', () => {
  // The property a latitude question rests on. A decorative ellipse globe gets
  // this wrong the moment the two longitudes differ.
  const parsed = draw('earthgeometry', { points: 'P:60N,20E;Q:60N,80E' })
  approx(placeAt(parsed, 'P')[1], placeAt(parsed, 'Q')[1], 0.05, 'same parallel, same height')
})

test('north of the equator is above it, and south is below', () => {
  const parsed = draw('earthgeometry', { points: 'A:40N,0;B:0,0;C:40S,0' })
  const [, ay] = placeAt(parsed, 'A')
  const [, by] = placeAt(parsed, 'B')
  const [, cy] = placeAt(parsed, 'C')
  assert.ok(ay < by, '40N is above the equator')
  assert.ok(by < cy, '0 is above 40S')
})

test('a point sits on the sphere, not inside or outside it', () => {
  const parsed = draw('earthgeometry', { points: 'P:35N,15E;Q:10S,40W' })
  const globe = selectOne(parsed, 'circle', (e) => e.attrs.r && parseFloat(e.attrs.r) > 50)
  const centre = [num(globe, 'cx'), num(globe, 'cy')]
  const R = num(globe, 'r')
  for (const name of ['P', 'Q']) {
    assert.ok(dist(placeAt(parsed, name), centre) <= R + 0.5, `${name} is on or inside the outline`)
  }
})

test('a parallel of latitude is drawn for the equator and for each point', () => {
  const parsed = draw('earthgeometry', { points: 'P:60N,20E;Q:30S,20E', showParallels: 'yes' })
  const drawn = new Set(select(parsed, 'polyline', (e) => e.attrs['data-parallel'])
    .map((e) => Number(e.attrs['data-parallel'])))
  assert.deepEqual([...drawn].sort((a, b) => a - b), [-30, 0, 60])
  assert.equal(select(draw('earthgeometry', { points: 'P:60N,20E', showParallels: 'no' }), 'polyline', (e) => e.attrs['data-parallel']).length, 0)
})

test('the far side of a circle is dashed, the near side solid', () => {
  // What makes the sketch read as a sphere rather than a disc.
  const parsed = draw('earthgeometry', { points: 'P:0,0', showParallels: 'yes', showMeridians: 'no' })
  const arcs = select(parsed, 'polyline', (e) => e.attrs['data-parallel'] === '0')
  assert.ok(arcs.some((e) => e.attrs['stroke-dasharray']), 'the hidden half is dashed')
  assert.ok(arcs.some((e) => !e.attrs['stroke-dasharray']), 'the visible half is solid')
})

test('an impossible latitude or longitude is refused', () => {
  assert.match(issues('earthgeometry', { points: 'P:100N,20E' })[0].message, /Latitude runs from 0° to 90°/)
  assert.match(issues('earthgeometry', { points: 'P:60N,200E' })[0].message, /Longitude runs from 0° to 180°/)
  assert.match(issues('earthgeometry', { points: 'somewhere hot' })[0].message, /is not a point/)
})

/* ── three-set Venn ──────────────────────────────────────────────────────── */

console.log('\nthree-set Venn')

test('all seven regions and the outside are written in', () => {
  // The two-set figure cannot express A∩B∩C, which is most of what a senior
  // sets question is about.
  const parsed = draw('venn3elements', {
    a: 'A', b: 'B', c: 'C',
    onlyA: '2', onlyB: '5', onlyC: '7', aAndB: '3', aAndC: '4', bAndC: '6', all: '1', outside: '8',
  })
  const rendered = texts(parsed)
  for (const v of ['1', '2', '3', '4', '5', '6', '7', '8']) {
    assert.ok(rendered.includes(v), `region value ${v} was not written in`)
  }
  assert.equal(select(parsed, 'circle', (e) => e.attrs['data-set']).length, 3)
})

test('the three circles are the same size and each overlaps both others', () => {
  const parsed = draw('venn3elements', getDiagram('venn3elements').defaults)
  const sets = select(parsed, 'circle', (e) => e.attrs['data-set'])
  const centres = sets.map((e) => [num(e, 'cx'), num(e, 'cy')])
  const radii = sets.map((e) => num(e, 'r'))
  assert.ok(radii.every((r) => Math.abs(r - radii[0]) < 0.01), 'equal radii')
  for (let i = 0; i < 3; i += 1) {
    for (let j = i + 1; j < 3; j += 1) {
      assert.ok(dist(centres[i], centres[j]) < radii[0] * 2, `circles ${i} and ${j} overlap`)
      assert.ok(dist(centres[i], centres[j]) > 1, `circles ${i} and ${j} are not on top of each other`)
    }
  }
})

/* ── editable solids ─────────────────────────────────────────────────────── */

console.log('\neditable solids')

test('the frustum is drawn in the true proportions of its measurements', () => {
  // Base 15 x 6, top 10 x 4, height 8 — the front base edge and the front top
  // edge are on the page in the SAME scale, so their ratio is the stated one.
  const parsed = draw('frustum', { l: '15 cm', w: '6 cm', tl: '10 cm', tw: '4 cm', h: '8 cm' })
  const edges = select(parsed, 'line', (e) => e.attrs['data-edge'] === 'visible')
  const widths = edges.map((e) => Math.abs(num(e, 'x2') - num(e, 'x1'))).filter((v) => v > 1)
  const frontBase = Math.max(...widths)
  // The top front edge is the largest horizontal run at the top height.
  const tops = edges.filter((e) => num(e, 'y1') === num(e, 'y2'))
    .sort((a, b) => num(a, 'y1') - num(b, 'y1'))
  const topEdge = Math.abs(num(tops[0], 'x2') - num(tops[0], 'x1'))
  approx(topEdge / frontBase, 10 / 15, 0.02, 'top length : base length')
})

test('the top face is centred over the base — a frustum, not an oblique prism', () => {
  const parsed = draw('frustum', { l: '12 cm', w: '6 cm', tl: '6 cm', tw: '3 cm', h: '5 cm' })
  // The three VISIBLE horizontal edges, lowest on the page first: front base,
  // front top, top back. A CENTRED top face sits half the width difference
  // deeper than the front base edge, and in oblique projection that depth
  // shifts it right by exactly oz * 0.45 * scale — where the scale is read
  // back off the page from the base edge itself (length 12 drawn at l*s px).
  // An oblique-prism top (not centred) misses this by its own offset.
  const horiz = select(parsed, 'line', (e) => e.attrs['data-edge'] === 'visible' && num(e, 'y1') === num(e, 'y2'))
    .sort((a, b) => num(b, 'y1') - num(a, 'y1'))
  assert.equal(horiz.length, 3)
  const mid = (e) => (num(e, 'x1') + num(e, 'x2')) / 2
  const len = (e) => Math.abs(num(e, 'x2') - num(e, 'x1'))
  const scale = len(horiz[0]) / 12
  const expectedShift = ((6 - 3) / 2) * 0.45 * scale
  approx(mid(horiz[1]) - mid(horiz[0]), expectedShift, 0.5, 'top centred over base (allowing the depth shift)')
  // And the top edge really is the stated 6-of-12 proportion of the base.
  approx(len(horiz[1]) / len(horiz[0]), 0.5, 0.02, 'top length : base length')
})

test('hidden edges are dashed and the height is a dashed interior line', () => {
  for (const key of ['frustum', 'pyramid']) {
    const parsed = draw(key, getDiagram(key).defaults)
    const hidden = select(parsed, 'line', (e) => (e.attrs['data-edge'] === 'hidden' || e.attrs['data-slant'] === 'hidden'))
    assert.ok(hidden.length >= 2, `${key} has dashed hidden edges`)
    for (const e of hidden) assert.ok(e.attrs['stroke-dasharray'], `${key} hidden edge is dashed`)
    const height = selectOne(parsed, 'line', (e) => e.attrs['data-height'])
    assert.ok(height.attrs['stroke-dasharray'], `${key} height is dashed`)
    // Vertical: the perpendicular height drops straight down.
    approx(num(height, 'x1'), num(height, 'x2'), 0.01, `${key} height is vertical`)
  }
})

test('an impossible frustum is refused in the teacher\'s own terms', () => {
  assert.match(issues('frustum', { tl: '20 cm' })[0].message, /top face is smaller than its base/)
  // A symbolic label ("h") is legitimate and falls back to the default
  // proportions; only an explicit non-positive measurement is refused.
  assert.match(issues('pyramid', { h: '0 cm' })[0].message, /positive measurement/)
  assert.deepEqual(issues('pyramid', { h: 'h' }), [])
  assert.deepEqual(issues('frustum', {}), [])
})

/* ── the export gate ─────────────────────────────────────────────────────── */

console.log('\nthe export gate')

test('a figure that draws something WRONG is refused for export', () => {
  // The distinction the senior families make necessary. A circle-theorem
  // figure whose 110° mark sits on a 180° corner renders perfectly well; it is
  // simply wrong, and a learner measuring it has no way to know. The gate's
  // resolver refuses it and the validator's own sentence becomes the reason.
  const bad = {
    points: 'A@180,B@90,C@0', joins: 'O-A,O-C', angles: 'AOC=110', notToScale: 'no', centre: 'O', tangent: '',
  }
  assert.throws(() => resolveFigureForExport('circletheorem', bad), /drawn as 180°/)
  // The renderer is deliberately NOT stricter — a teacher mid-edit still sees
  // the figure they are fixing.
  assert.ok(renderDiagramSvg('circletheorem', bad, '#1c1612').startsWith('<svg'))
})

test('the gate reports a params problem the way it reports a missing figure', () => {
  // unresolvedRequiredFigures treats a resolver that throws as a figure that
  // could not be drawn — which is exactly the verdict — and carries the
  // message through, so the teacher reads the sentence and not a code.
  const paper = {
    questions: [{ id: 'q1', imageDiagram: { libraryKey: 'linearprogramming', params: { constraints: 'x+y<=2,x+y>=6' } } }],
    passages: [],
  }
  const found = unresolvedRequiredFigures(paper, resolveFigureForExport)
  assert.equal(found.length, 1)
  assert.equal(found[0].questionNumber, 1)
  assert.match(found[0].reason, /No region satisfies all of these inequalities/)
})

test('a good figure passes the gate, and an unknown key still fails it', () => {
  const ok = { questions: [{ id: 'q1', imageDiagram: { libraryKey: 'bearings', params: { legs: 'A>B,060,8' } } }], passages: [] }
  assert.deepEqual(unresolvedRequiredFigures(ok, resolveFigureForExport), [])
  const unknown = { questions: [{ id: 'q1', imageDiagram: { libraryKey: 'not-a-figure', params: {} } }], passages: [] }
  assert.equal(unresolvedRequiredFigures(unknown, resolveFigureForExport).length, 1)
})

test('validateDiagramParams answers for a figure that has no validator', () => {
  assert.deepEqual(validateDiagramParams('triangle', {}), [])
  assert.deepEqual(validateDiagramParams('not-a-figure', {}), [])
})

/* ── the catalog is still one catalog ────────────────────────────────────── */

console.log('\nregression')

test('every pre-existing key still renders from its defaults', () => {
  for (const [key, entry] of Object.entries(DIAGRAM_CATALOG)) {
    const svg = renderDiagramSvg(key, entry.defaults, '#7c2d12')
    assert.ok(svg && svg.startsWith('<svg') && svg.trim().endsWith('</svg>'), `${key} stopped rendering`)
  }
})

test('a validate() is optional, and where present takes the merged params', () => {
  // The primary figures have none, and must keep working without one.
  assert.equal(getDiagram('triangle').validate, undefined)
  for (const [key, entry] of Object.entries(DIAGRAM_CATALOG)) {
    if (!entry.validate) continue
    const found = entry.validate({ ...entry.defaults })
    assert.ok(Array.isArray(found), `${key}.validate must return an array`)
    for (const issue of found) {
      assert.equal(typeof issue.field, 'string', `${key} issue needs a field`)
      assert.equal(typeof issue.message, 'string', `${key} issue needs a message`)
    }
  }
})

console.log(`\nsecondary diagrams: ${passed} passed\n`)
