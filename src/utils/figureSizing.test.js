/**
 * figureSizing tests — the band's minimum, actually applied (§4.2).
 *
 * Phase 2 declared `minFigureSizeMm` on every band and nothing enforced it: the
 * number was rendered into the generator's prompt and ignored by every renderer.
 * A Nursery picture-matching question could print at whatever size a width
 * preset produced, and a five-year-old cannot answer a question about a picture
 * they cannot make out.
 *
 * So what is worth testing is the precedence: the teacher's preset is honoured
 * where the level allows it, overridden where the level requires it, and the
 * page always wins over both.
 *
 * Run: node src/utils/figureSizing.test.js
 */

import assert from 'node:assert/strict'
import {
  figureBox, minFigureMm, mmToPt, mmToPx, ptToMm, pxToMm,
  isBelowBandMinimum, figureSizeWarning, embedBox, FIGURE_RASTER_SCALE,
} from './figureSizing.js'
import { ASSESSMENT_BAND_SEED } from '../config/assessmentBands.js'

const EARLY = ASSESSMENT_BAND_SEED.early_childhood
const SENIOR = ASSESSMENT_BAND_SEED.senior_secondary

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

/* ── units ──────────────────────────────────────────────────────────────── */

console.log('\n— units —')

test('millimetres convert to the units each renderer wants', () => {
  // One inch: 25.4mm = 72pt = 96px.
  assert.equal(Math.round(mmToPt(25.4)), 72)
  assert.equal(Math.round(mmToPx(25.4)), 96)
  assert.equal(Math.round(ptToMm(72)), 25)
  assert.equal(Math.round(pxToMm(96)), 25)
})

test('a nonsense measurement converts to nothing rather than NaN', () => {
  for (const bad of [0, -5, null, undefined, 'wide', NaN]) {
    assert.equal(mmToPt(bad), 0, String(bad))
    assert.equal(mmToPx(bad), 0, String(bad))
    assert.equal(ptToMm(bad), 0, String(bad))
    assert.equal(pxToMm(bad), 0, String(bad))
  }
})

/* ── the band's floor ───────────────────────────────────────────────────── */

console.log('\n— the level\'s minimum —')

test('the seeded bands really do declare a minimum, smallest at the top', () => {
  // If this ever came back 0 the whole feature would silently do nothing.
  assert.ok(minFigureMm(EARLY) > 0, 'early childhood has a minimum')
  assert.ok(minFigureMm(SENIOR) > 0, 'senior secondary has one too')
  assert.ok(
    minFigureMm(EARLY) > minFigureMm(SENIOR),
    'younger learners need bigger pictures than older ones',
  )
})

test('an unknown band means no floor, not no figures', () => {
  assert.equal(minFigureMm(null), 0)
  assert.equal(minFigureMm({}), 0)
  assert.equal(minFigureMm({ minFigureSizeMm: 'big' }), 0)
})

/* ── precedence ─────────────────────────────────────────────────────────── */

console.log('\n— whose choice wins —')

test('with no band the teacher\'s preset is honoured exactly', () => {
  const full = figureBox({ maxWidth: 360, maxHeight: 400, widthPercent: 100 })
  const half = figureBox({ maxWidth: 360, maxHeight: 400, widthPercent: 50 })
  assert.equal(full.width, 360)
  assert.equal(half.width, 180)
  assert.equal(half.raisedToFloor, false)
})

test('a small preset is raised to the floor at Early Childhood', () => {
  // THE regression this file exists for.
  const box = figureBox({
    maxWidth: 360, maxHeight: 400, widthPercent: 25, band: EARLY,
  })
  assert.equal(box.raisedToFloor, true)
  assert.ok(
    Math.min(box.width, box.height) >= mmToPx(minFigureMm(EARLY)) - 1,
    `the smaller side (${Math.min(box.width, box.height)}px) reaches the floor (${box.floorPx}px)`,
  )
})

test('…and the SAME size is left alone at senior secondary', () => {
  // The floor is a pedagogical requirement of the LEVEL, not a global minimum:
  // a box comfortably above the senior floor but under the Early Childhood one
  // is raised at the younger level and untouched at the older.
  const args = { maxWidth: 400, maxHeight: 400, aspect: 1.6, widthPercent: 60 }
  const senior = figureBox({ ...args, band: SENIOR })
  const early = figureBox({ ...args, band: EARLY })
  assert.equal(senior.raisedToFloor, false, 'senior secondary keeps the preset')
  assert.equal(senior.width, 240)
  assert.equal(early.raisedToFloor, true, 'early childhood raises the same box')
  assert.ok(early.height > senior.height, 'and ends up bigger')
})

test('the floor applies to the SMALLER side, not the width', () => {
  // A wide, short diagram whose height fell under the minimum is just as
  // unreadable as a narrow one, so the raise is driven by the short side.
  const box = figureBox({
    maxWidth: 500, maxHeight: 500, aspect: 2, widthPercent: 30, band: EARLY,
  })
  assert.equal(box.raisedToFloor, true)
  assert.ok(box.height >= box.floorPx - 1,
    `the short side reached the floor (${box.height}px vs ${box.floorPx}px)`)
  assert.ok(box.width > box.height, 'and the aspect ratio is preserved')
})

test('an aspect so extreme the floor cannot fit is reported, not faked', () => {
  // A 45mm-tall figure at 6:1 needs 765pt of width, which no A4 column has. The
  // page wins — and the shortfall surfaces rather than being quietly accepted.
  const box = figureBox({
    maxWidth: 400, maxHeight: 400, aspect: 6, widthPercent: 40, band: EARLY,
  })
  assert.ok(box.width <= 400, 'it stayed inside the column')
  assert.equal(isBelowBandMinimum(box, EARLY), true, 'and the shortfall is visible')
})

test('the page always wins — a figure is never pushed past the column', () => {
  // A very narrow column cannot fit the floor. Overflowing the page is a worse
  // failure than being slightly under the recommended size.
  const box = figureBox({
    maxWidth: 60, maxHeight: 400, aspect: 3, widthPercent: 100, band: EARLY,
  })
  assert.ok(box.width <= 60, `stayed inside the column (${box.width}px)`)
})

test('a tall figure is fitted to the height cap first', () => {
  const box = figureBox({ maxWidth: 360, maxHeight: 100, aspect: 0.5 })
  assert.ok(box.height <= 100, 'respects the height cap')
})

/* ── the shortfall is reported, not hidden ──────────────────────────────── */

console.log('\n— when the floor cannot be met —')

test('a box that met the floor reports no shortfall', () => {
  const box = figureBox({ maxWidth: 360, maxHeight: 400, band: EARLY })
  assert.equal(isBelowBandMinimum(box, EARLY), false)
  assert.equal(figureSizeWarning(box, EARLY), '')
})

test('a box the page squeezed under the floor is reported', () => {
  const box = figureBox({
    maxWidth: 60, maxHeight: 400, aspect: 3, widthPercent: 100, band: EARLY,
  })
  assert.equal(isBelowBandMinimum(box, EARLY), true)
  const warning = figureSizeWarning(box, EARLY, 'The picture in question 3')
  assert.match(warning, /The picture in question 3/)
  assert.match(warning, /at least \d+mm/)
  // Plain language: a teacher reads this, not an engineer.
  assert.ok(!/\bpt\b|\bpx\b|aspect|floor/i.test(warning), warning)
})

test('no band means nothing to warn about', () => {
  const box = figureBox({ maxWidth: 20, maxHeight: 20 })
  assert.equal(isBelowBandMinimum(box, null), false)
  assert.equal(figureSizeWarning(box, null), '')
})

/* ── what is actually embedded ──────────────────────────────────────────── */

console.log('\n— natural size vs the floor —')

test('a picture is never blown up past its own resolution', () => {
  // The studio preview scales with max-width, so an upscaled download would
  // stop matching what the teacher saw — and look blurry doing it.
  const box = figureBox({ maxWidth: 360, maxHeight: 400 })
  const embedded = embedBox(box, 80, 60)
  assert.equal(embedded.width, 80)
  assert.equal(embedded.height, 60)
})

test('…unless the level requires it, and then legibility wins', () => {
  const box = figureBox({ maxWidth: 360, maxHeight: 400, widthPercent: 25, band: EARLY })
  assert.equal(box.raisedToFloor, true, 'precondition: the floor engaged')
  const embedded = embedBox(box, 80, 60)
  assert.equal(embedded.width, box.width, 'the floor beats the no-upscale rule')
  assert.ok(embedded.width > 80, 'so a small source is enlarged rather than left illegible')
})

test('a big picture is fitted down to the box, keeping its shape', () => {
  const box = figureBox({ maxWidth: 360, maxHeight: 400, aspect: 2 })
  const embedded = embedBox(box, 4000, 2000)
  assert.ok(embedded.width <= box.width && embedded.height <= box.height)
  assert.ok(Math.abs(embedded.width / embedded.height - 2) < 0.05, 'aspect ratio preserved')
})

test('unknown natural dimensions fall back to the box, not to nothing', () => {
  const box = figureBox({ maxWidth: 360, maxHeight: 400 })
  for (const [w, h] of [[0, 0], [null, 100], ['wide', 'tall'], [undefined, undefined]]) {
    assert.deepEqual(embedBox(box, w, h), { width: box.width, height: box.height }, `${w}×${h}`)
  }
})

/* ── the raster ─────────────────────────────────────────────────────────── */

console.log('\n— high-DPI raster —')

test('the raster is generated well above the embed size', () => {
  // §4.2: "a high-DPI raster fallback generated for DOCX". 2× looked fuzzy on a
  // laser printer; the box is 96dpi pixels, so 4× lands near 300dpi of detail.
  const box = figureBox({ maxWidth: 360, maxHeight: 400 })
  assert.equal(box.rasterWidth, box.width * FIGURE_RASTER_SCALE)
  assert.equal(box.rasterHeight, box.height * FIGURE_RASTER_SCALE)
  assert.ok(FIGURE_RASTER_SCALE >= 3, 'at least 3× so print stays crisp')
})

test('every dimension is a whole number — half a pixel is not a size', () => {
  const box = figureBox({ maxWidth: 361, maxHeight: 399, aspect: 1.37, widthPercent: 33 })
  for (const key of ['width', 'height', 'rasterWidth', 'rasterHeight', 'floorPx']) {
    assert.ok(Number.isInteger(box[key]), `${key} = ${box[key]}`)
  }
})

test('rubbish inputs produce a usable box rather than throwing', () => {
  assert.doesNotThrow(() => figureBox({}))
  const box = figureBox({ aspect: 0, widthPercent: -10 })
  assert.ok(box.width > 0 && box.height > 0, 'still a real box')
})

console.log(`\n✓ figure sizing — ${passed} tests passed`)
