/**
 * test:know-zambia — the map game's pure logic, run against the dataset the
 * app actually bundles.
 *
 * Three of these can only be caught here. A React test renders whatever the
 * geometry says and passes; the failures below are all silent on screen:
 *
 *   A PROVINCE THAT DOES NOT PARSE renders as an empty path — an invisible,
 *   untappable province, on a map that otherwise looks complete.
 *   A LABEL ANCHOR OUTSIDE ITS OWN SHAPE prints a province's name on its
 *   neighbour, which reads as a wrong answer being marked right.
 *   A TARGET UNDER 44px is simply hard to tap, and only on a small phone.
 */
import assert from 'node:assert/strict'

import { GAMES_SEED } from '../src/data/gamesSeed.js'
import { ZAMBIA_FACTS, ZAMBIA_PROVINCES_GEO } from '../src/data/zambiaGeography.js'
import {
  DEFAULT_WAVES,
  MAP_MODES,
  capitalSteps,
  ceremonySteps,
  distanceToEdge,
  journeyVerdict,
  journeysFor,
  labelSizeFor,
  modeOf,
  neighbourSteps,
  oddRuleHolds,
  oddSteps,
  provincesTouch,
  richSegments,
  PROVINCE_CODES,
  TOUCH_MIN,
  anchorsBefore,
  buildGeometry,
  haloRadius,
  hintFor,
  placeGain,
  placementsIn,
  pointInPolygon,
  project,
  starsForScore,
  wavesFor,
} from '../src/features/games/lib/knowZambiaCore.js'

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

const provinces = ZAMBIA_PROVINCES_GEO.provinces
const geometry = buildGeometry(provinces)

console.log('know-zambia')

test('every province parses to a closed shape holding its own label anchor', () => {
  assert.equal(Object.keys(geometry).length, 10)
  for (const code of PROVINCE_CODES) {
    const shape = geometry[code]
    assert.ok(shape, `${code} is missing from the dataset`)
    assert.ok(shape.points.length > 8, `${code}: only ${shape.points.length} points parsed — the path is not M/L/Z`)
    assert.ok(
      pointInPolygon(shape.anchor, shape.points),
      `${code}: its label anchor sits outside its own outline, so its name would print on a neighbour`,
    )
  }
})

test('the round grows three, then five, then ten', () => {
  const waves = wavesFor({})
  assert.deepEqual(waves, DEFAULT_WAVES)
  let placed = 0
  const cumulative = waves.map((wave) => (placed += wave.length))
  assert.deepEqual(cumulative, [3, 5, 10])
  assert.deepEqual([...placementsIn(waves)].sort(), [...PROVINCE_CODES].sort())
})

test('a pack may declare its own waves, and rubbish falls back to the default', () => {
  assert.deepEqual(wavesFor({ waves: [['lu', 'ce'], ['so']] }), [['lu', 'ce'], ['so']])
  assert.deepEqual(wavesFor({ waves: [] }), DEFAULT_WAVES)
  assert.deepEqual(wavesFor({ waves: [['not_a_province']] }), DEFAULT_WAVES, 'a wave of unknown codes is not a wave')
})

test('every hint after the first wave names a province already on the map', () => {
  const waves = wavesFor({})
  waves.forEach((wave, index) => {
    const anchors = anchorsBefore(waves, index)
    for (const code of wave) {
      const hint = hintFor(ZAMBIA_FACTS, provinces, code)
      assert.ok(hint, `${code}: no hint at all`)
      if (index === 0) {
        assert.match(hint, /north|south|east|west|top|bottom|middle|centre|corner/i,
          `${code}: nothing is on the map yet, so its hint must give a direction`)
      } else {
        assert.ok(
          anchors.some((anchor) => hint.includes(provinces[anchor].n)),
          `${code}: "${hint}" points at nothing the learner has placed (${anchors.join(', ')})`,
        )
      }
    }
  })
})

test('a province with no hint still gets one', () => {
  const hint = hintFor({ provinces: {} }, provinces, 'lu')
  assert.ok(hint.length > 10, 'the fallback must say something about where it is')
  assert.match(hint, /Lusaka/)
})

test('the halo fires only for a target that needs it', () => {
  // 360px phone: the map renders about 306px wide over a 100-unit viewBox.
  const scale = 306 / 100
  const smallest = Object.values(geometry)
    .map((shape) => ({ code: shape.code, min: Math.min(shape.bbox.w, shape.bbox.h) }))
    .sort((a, b) => a.min - b.min)[0]
  assert.equal(smallest.code, 'lu', 'Lusaka is the province this rule exists for')
  assert.ok(smallest.min * scale < TOUCH_MIN, 'Lusaka should be under 44px, or the rule has nothing to do')

  for (const shape of Object.values(geometry)) {
    const min = Math.min(shape.bbox.w, shape.bbox.h)
    const radius = haloRadius(min, scale)
    const effective = Math.max(min * scale, radius * 2 * scale)
    assert.ok(effective >= TOUCH_MIN - 0.001, `${shape.code} is only ${effective.toFixed(0)}px at 360`)
    if (min * scale >= TOUCH_MIN) {
      assert.equal(radius, 0, `${shape.code} is already big enough and must not steal its neighbour's taps`)
    }
  }
})

test('the halo holds at 320px too, and refuses nonsense', () => {
  const scale = 266 / 100 // 320px phone
  for (const shape of Object.values(geometry)) {
    const min = Math.min(shape.bbox.w, shape.bbox.h)
    const effective = Math.max(min * scale, haloRadius(min, scale) * 2 * scale)
    assert.ok(effective >= TOUCH_MIN - 0.001, `${shape.code} is only ${effective.toFixed(0)}px at 320`)
  }
  assert.equal(haloRadius(10, 0), 0, 'a map that has not been measured yet gets no halo')
  assert.equal(haloRadius(Number.NaN, 3), 0)
})

test('the projection lands its own calibration points in the right province', () => {
  for (const point of ZAMBIA_PROVINCES_GEO.projection.checkPoints) {
    const xy = project(ZAMBIA_PROVINCES_GEO.projection, point.lon, point.lat)
    const found = PROVINCE_CODES.find((code) => pointInPolygon(xy, geometry[code].points))
    assert.equal(found, point.expect, `${point.name} projects into ${found || 'nothing'}`)
  }
})

test('scoring matches the other mechanics', () => {
  assert.equal(placeGain(1), 20)
  assert.equal(placeGain(3), 60)
  assert.equal(placeGain(0), 20, 'a combo below one still pays for the placement')
  assert.equal(starsForScore(200), 3)
  assert.equal(starsForScore(140), 3)
  assert.equal(starsForScore(60), 2)
  assert.equal(starsForScore(0), 1)
})

/* ── the five map modes ───────────────────────────────────────────────
 *
 * Three of these modes can be WRONG WHILE THE GAME STILL PLAYS PERFECTLY,
 * which is the only reason this section exists. A journey through two
 * provinces that do not touch is still tappable in order; an odd-one-out set
 * whose odd province is not actually odd still lights four provinces and
 * accepts a tap. Nothing on screen can tell, and no React test can either —
 * both render whatever the data says and pass.
 * ------------------------------------------------------------------- */

test('a pack picks its mode, and anything unknown plays the original round', () => {
  assert.equal(modeOf(undefined), 'place')
  assert.equal(modeOf({}), 'place', 'the pack that shipped first names no mode and must keep working')
  assert.equal(modeOf({ mode: 'journey' }), 'journey')
  assert.equal(modeOf({ mode: 'not-a-mode' }), 'place', 'an unknown mode must fall back, never render nothing')
  for (const mode of MAP_MODES) assert.equal(modeOf({ mode }), mode)
})

test('every seeded map pack names a real mode and carries no facts of its own', () => {
  const packs = GAMES_SEED.filter((g) => g.type === 'map_place')
  assert.ok(packs.length >= 6, `expected the place pack and the five modes, found ${packs.length}`)
  const modes = packs.map((g) => modeOf(g))
  for (const mode of MAP_MODES) {
    assert.ok(modes.includes(mode), `no pack plays the "${mode}" mode, so it is unreachable in the app`)
  }
  for (const pack of packs) {
    assert.ok(MAP_MODES.includes(pack.mode ?? 'place'), `${pack.id} names mode "${pack.mode}", which no engine plays`)
    /* Every fact comes from the dataset. A pack carrying its own would be a
       second copy of something a Zambian teacher signs off in. */
    assert.deepEqual(pack.questions, [], `${pack.id} carries questions — map packs read the dataset instead`)
    assert.equal(pack.timer, 0, `${pack.id} has a timer; no map mode is timed`)
    assert.ok(pack.title && pack.description, `${pack.id} needs a title and a description for its hub row`)
  }
  const ids = packs.map((p) => p.id)
  assert.equal(new Set(ids).size, ids.length, 'two map packs share an id')
})

test('every capital is plotted from real coordinates, into its own province', () => {
  const steps = capitalSteps(ZAMBIA_FACTS)
  assert.equal(steps.length, 10, 'ten provinces, ten capitals')
  for (const step of steps) {
    assert.ok(PROVINCE_CODES.includes(step.answer))
    assert.ok(Number.isFinite(step.lon) && Number.isFinite(step.lat), `${step.town} has no coordinates to pin`)
    assert.ok(step.hint, `${step.town} has no hint, so a wrong tap would say only "no"`)
    assert.ok(step.fact, `${step.town} has no fact, so a right tap would teach nothing`)
  }
  /* The one every generated list gets wrong. */
  const southern = steps.find((s) => s.answer === 'so')
  assert.equal(southern.town, 'Choma', 'Southern Province’s capital moved to Choma in 2011')
})

test('every journey is a road that exists on the map', () => {
  const routes = journeysFor(ZAMBIA_FACTS, {})
  assert.ok(routes.length >= 4, 'the brief asks for more routes than the one')
  for (const route of routes) {
    assert.ok(route.provinces.length >= 3, `${route.id} is too short to teach adjacency`)
    assert.equal(new Set(route.provinces).size, route.provinces.length, `${route.id} passes through a province twice`)
    for (let i = 0; i < route.provinces.length - 1; i += 1) {
      const [a, b] = [route.provinces[i], route.provinces[i + 1]]
      assert.ok(
        provincesTouch(ZAMBIA_PROVINCES_GEO, a, b),
        `${route.id}: ${a} → ${b} is not a border you can cross, so the route is not a road`,
      )
    }
    for (const code of route.provinces) {
      assert.ok(route.legs?.[code], `${route.id} says nothing when the learner reaches ${code} — a right tap must teach too`)
    }
    assert.ok(route.approxKm > 0 && route.endNote, `${route.id} prints a distance and an ending to a learner`)
  }
})

test('a pack may name one route, and a bad name falls back to all of them', () => {
  const all = journeysFor(ZAMBIA_FACTS, {})
  assert.equal(journeysFor(ZAMBIA_FACTS, { routeId: all[0].id }).length, 1)
  assert.equal(journeysFor(ZAMBIA_FACTS, { routeId: 'no-such-route' }).length, all.length,
    'a typo in a pack must not leave the mode with nothing to play')
})

test('a wrong turn is answered four different ways, from the map', () => {
  /* This is the mode's whole reason to exist. Collapsing "it touches you but
     goes the wrong way" into "it does not touch you at all" loses the lesson,
     because the difference between them IS the shape of the country. */
  const route = journeysFor(ZAMBIA_FACTS, {}).find((r) => r.from === 'Livingstone' && r.to === 'Kasama')
  assert.ok(route, 'the Great North Road journey is the strongest of the modes')
  assert.deepEqual(route.provinces, ['so', 'lu', 'ce', 'mu', 'no'])
  const at = (atIndex, tapped) => journeyVerdict({ geo: ZAMBIA_PROVINCES_GEO, route, atIndex, tapped })

  assert.equal(at(0, 'so').ok, true)
  assert.equal(at(0, 'ce').kind, 'start')
  assert.equal(at(1, 'we').kind, 'adjacent', 'Western touches Southern, so this is the "wrong way" answer')
  assert.equal(at(1, 'no').kind, 'far', 'Northern does not touch Southern, so this is the "cannot get there" answer')
  assert.equal(at(2, 'so').kind, 'visited')

  /* Each one has to SAY something different, not just be labelled differently. */
  assert.match(at(1, 'we').title, /does touch/)
  assert.match(at(1, 'no').title, /does not touch/)
  assert.match(at(1, 'we').body, /Kasama/, 'the "wrong way" answer must name where you are going')
  assert.match(at(1, 'no').body, /without crossing/, 'the "cannot get there" answer must say why')
  assert.match(at(2, 'so').body, /number 1/, 'a re-tap must point at the strip')
  const bodies = new Set([at(0, 'ce').body, at(1, 'we').body, at(1, 'no').body, at(2, 'so').body])
  assert.equal(bodies.size, 4, 'four branches must give four answers, or one of them is decoration')
})

test('Copperbelt and Luapula are not neighbours — the Congo Pedicle is between them', () => {
  /* The adjacency fact most likely to be "fixed" by someone who knows both
     provinces are in the north and assumes they must touch. If it were added,
     a journey could be routed straight through the DRC. */
  assert.equal(provincesTouch(ZAMBIA_PROVINCES_GEO, 'cb', 'lp'), false)
  assert.equal(provincesTouch(ZAMBIA_PROVINCES_GEO, 'lp', 'cb'), false)
})

test('every odd-one-out set is right by the rule it declares, not by its answer', () => {
  const declared = ZAMBIA_FACTS.oddOneOut || []
  assert.ok(declared.length >= 2)
  const sound = oddSteps(ZAMBIA_FACTS, ZAMBIA_PROVINCES_GEO)
  assert.equal(sound.length, declared.length,
    `${declared.length - sound.length} set(s) are not true of the data and would have been dropped at runtime`)
  for (const set of declared) {
    const verdicts = set.set.map((code) => oddRuleHolds({ facts: ZAMBIA_FACTS, geo: ZAMBIA_PROVINCES_GEO, code, rule: set.rule }))
    assert.ok(!verdicts.includes(null), `${set.id} uses a rule the engine cannot evaluate: "${set.rule}"`)
    const holds = set.set.filter((_, i) => verdicts[i])
    const dont = set.set.filter((_, i) => !verdicts[i])
    assert.equal(holds.length, 3, `${set.id}: "three of these" is a claim about the data, and ${holds.length} satisfy the rule`)
    assert.deepEqual(dont, [set.odd], `${set.id}: the province that does not satisfy the rule is not the one declared odd`)
    assert.ok(set.q && set.why, `${set.id} must ask a question and explain the answer`)
  }
})

test('an unevaluable rule is a failure, never a pass', () => {
  assert.equal(oddRuleHolds({ facts: ZAMBIA_FACTS, geo: ZAMBIA_PROVINCES_GEO, code: 'ce', rule: 'wat:xx' }), null)
  const broken = { oddOneOut: [{ id: 'x', rule: 'wat:xx', set: ['ce', 'lu', 'so', 'we'], odd: 'ce', q: 'q', why: 'w' }] }
  assert.deepEqual(oddSteps(broken, ZAMBIA_PROVINCES_GEO), [], 'a set the engine cannot check must be dropped, not shown')
})

test('the eight neighbours each have a box big enough to tap', () => {
  const steps = neighbourSteps(ZAMBIA_FACTS)
  assert.equal(steps.length, 8, 'Zambia borders eight countries')
  for (const step of steps) {
    assert.ok(step.zone[2] > 12 && step.zone[3] > 12, `${step.name}'s box is too small to tap`)
    assert.ok(step.fact && step.hint, `${step.name} must teach on the way in and on the way wrong`)
  }
  const botswana = steps.find((s) => s.name === 'Botswana')
  assert.match(botswana.fact, /Kazungula/, 'the shortest border is the one children find surprising')
})

test('a ceremony is one map question and two off it', () => {
  const steps = ceremonySteps(ZAMBIA_FACTS)
  const where = steps.filter((s) => s.kind === 'ceremonyWhere')
  assert.ok(where.length >= 3, 'the brief names three ceremonies, and the dataset carries four')
  assert.equal(steps.length, where.length * 3,
    'each ceremony asks where, whose and when — a learner who only ever taps a map stops reading')
  for (const step of steps.filter((s) => s.kind !== 'ceremonyWhere')) {
    assert.ok(step.options.includes(step.answer), `${step.name}: the right answer is not among the options offered`)
    assert.ok(step.options.length >= 3, `${step.name}: too few options`)
    assert.ok(step.why, `${step.name}: nothing to say once it is answered`)
  }
})

test('ceremony options are dealt — the answer is not pinned to the top row', () => {
  // The dataset lists the correct people/month FIRST on every ceremony
  // (8 of 8 at the time this was written), so serving stored order let a
  // learner tap the top option without reading. The rng is injected so
  // the deal is deterministic under test.
  const rng = (() => { let s = 42; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } })()
  const steps = ceremonySteps(ZAMBIA_FACTS, rng).filter((s) => s.kind !== 'ceremonyWhere')
  for (const step of steps) {
    assert.ok(step.options.includes(step.answer), `${step.name}: the deal must keep the answer among the options`)
  }
  assert.ok(
    steps.some((step) => step.options[0] !== step.answer),
    'across eight dealt steps at least one answer leaves the top row (deterministic seed)'
  )
})

test('a name is sized by the room at its anchor, not by its bounding box', () => {
  /* Sizing from the box is the box-CENTRE mistake one step along, and it
     printed "North-Western" straight through "Copperbelt" when both were
     labelled. Every anchor must also actually sit inside its own province,
     or the room measured is a neighbour's. */
  for (const code of PROVINCE_CODES) {
    const shape = geometry[code]
    assert.ok(shape.inscribed > 0, `${code}: no room measured at its anchor`)
    assert.ok(
      shape.inscribed <= Math.max(shape.bbox.w, shape.bbox.h) / 2 + 0.001,
      `${code}: the room at the anchor cannot exceed half the shape`,
    )
    const size = labelSizeFor(shape)
    assert.ok(size >= 1.9 && size <= 3.1, `${code}: label size ${size} is outside the clamp`)
  }
  const nw = geometry.nw
  const boxSized = Math.max(1.9, Math.min(3.1, (nw.bbox.w * 0.86) / (nw.name.length * 0.55)))
  assert.ok(
    labelSizeFor(nw) < boxSized,
    'North-Western is the case this rule exists for: its box is far wider than the room at its anchor',
  )
  assert.equal(distanceToEdge([0, 0], [[0, 1], [1, 1], [1, 0]]) > 0, true)
})

test('the emphasis in a question is parsed, never injected', () => {
  /* The odd-one-out questions carry <b> around the thing being asked about.
     Rendering that with dangerouslySetInnerHTML would let a content file put
     markup into the learner app. */
  assert.deepEqual(richSegments('Three touch <b>DR Congo</b>. Tap one.'), [
    { text: 'Three touch ', bold: false },
    { text: 'DR Congo', bold: true },
    { text: '. Tap one.', bold: false },
  ])
  assert.deepEqual(richSegments('<img src=x onerror=alert(1)>hello'), [{ text: 'hello', bold: false }])
  assert.deepEqual(richSegments(''), [])
  assert.deepEqual(richSegments(null), [])

  /* An UNCLOSED tag is the case a single-pass regex strip gets wrong, and the
     one CodeQL flagged: `replace(/<[^>]*>/g, '')` only removes a tag that has
     its ">", so "a <script alert(1)" matches nothing and passes through whole.
     The scanner drops from the "<" onwards instead, and gives a property
     stronger than "no <script>" — no segment can contain "<" at all. */
  for (const nasty of [
    'a <script alert(1)',
    '<script',
    '<b>hi</b> <script',
    '<scr<script>ipt>alert(1)',
    '<<b>b>bold?',
    '<b onclick=alert(1)>x</b>',
    '<b>unclosed',
    'text with an unclosed <tag that never ends',
    '<',
  ]) {
    for (const seg of richSegments(nasty)) {
      assert.ok(!seg.text.includes('<'), `"${nasty}" left a "<" in "${seg.text}"`)
      assert.ok(!/<\s*script/i.test(seg.text), `"${nasty}" left a script tag behind`)
    }
  }
  assert.deepEqual(richSegments('<b onclick=alert(1)>x</b>'), [{ text: 'x', bold: false }],
    'a <b> carrying an attribute is not the tag we support, so it is dropped rather than trusted')

  for (const set of ZAMBIA_FACTS.oddOneOut || []) {
    const segments = richSegments(set.q)
    assert.ok(segments.some((seg) => seg.bold), `${set.id}: the question emphasises nothing`)
    for (const seg of segments) {
      assert.ok(!seg.text.includes('<'), `${set.id}: a "<" reached text the learner is shown`)
      assert.ok(set.q.includes(seg.text), `${set.id}: "${seg.text}" is not text from the question`)
    }
  }
})

if (failures > 0) {
  console.error(`\nknow-zambia — ${failures} failed`)
  process.exit(1)
}
console.log('know-zambia — all passed')
