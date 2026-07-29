/**
 * scripts/test-secondary-diagrams.mjs — the senior figures are mathematically true.
 *
 * These diagrams carry marks. A learner measures the angle in a circle-theorem
 * figure, reads the bearing off a journey, takes a value off a plotted curve
 * and finds the median where an ogive's read-off line lands. So the assertions
 * below are not "it rendered" — they parse the SVG that was actually drawn and
 * do the mathematics on it, the way a learner with a protractor would.
 *
 * Run: node scripts/test-secondary-diagrams.mjs
 */

import assert from 'node:assert/strict'
import {
  DIAGRAM_CATALOG, getDiagram, renderDiagramSvg,
} from '../functions/shared/assessment/diagramCatalogCore.js'
import {
  parseSvg, select, selectOne, num, points, texts,
  angleBetween, bearingFromNorth, dist, approx, approxPoint,
  plotFrame, assertFrameMatchesAxisLabels, graphPoints,
} from './lib/svgGeometry.mjs'

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
const issues = (key, params) => {
  const entry = getDiagram(key)
  return entry.validate({ ...entry.defaults, ...params })
}

/* ── every new family, structurally ──────────────────────────────────────── */

const FAMILIES = [
  'circletheorem', 'bearings', 'elevation', 'labelledtriangle',
  'functiongraph', 'transformation', 'vectordiagram',
]

/** The families that plot into the shared Cartesian frame. */
const GRID_FAMILIES = ['functiongraph', 'transformation', 'vectordiagram']

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
