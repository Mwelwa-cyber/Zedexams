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

import { ZAMBIA_FACTS, ZAMBIA_PROVINCES_GEO } from '../src/data/zambiaGeography.js'
import {
  DEFAULT_WAVES,
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

if (failures > 0) {
  console.error(`\nknow-zambia — ${failures} failed`)
  process.exit(1)
}
console.log('know-zambia — all passed')
