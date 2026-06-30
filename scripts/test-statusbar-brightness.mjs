/**
 * Unit tests for the adaptive transparent status-bar brightness logic
 * (src/utils/statusBarBrightness.js). Plain `node` assertion script — run via
 * `npm run test:statusbar`, auto-discovered by scripts/run-all-tests.mjs.
 */
import assert from 'node:assert/strict'
import {
  parseCssColor,
  relativeLuminance,
  gradientLuminance,
  decideIconsDark,
  STATUS_BAR_HYSTERESIS,
} from '../src/utils/statusBarBrightness.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

console.log('statusBarBrightness')

// ── parseCssColor ──────────────────────────────────────────────────────────
test('parses rgb()', () => {
  assert.deepEqual(parseCssColor('rgb(255, 255, 255)'), { r: 255, g: 255, b: 255, a: 1 })
})
test('parses rgba() with alpha', () => {
  assert.deepEqual(parseCssColor('rgba(0, 0, 0, 0.5)'), { r: 0, g: 0, b: 0, a: 0.5 })
})
test('parses #rrggbb and #rgb hex', () => {
  assert.deepEqual(parseCssColor('#ff0000'), { r: 255, g: 0, b: 0, a: 1 })
  assert.deepEqual(parseCssColor('#0f0'), { r: 0, g: 255, b: 0, a: 1 })
})
test('treats transparent / near-transparent as null (keep walking ancestors)', () => {
  assert.equal(parseCssColor('transparent'), null)
  assert.equal(parseCssColor('rgba(0, 0, 0, 0)'), null)
  assert.equal(parseCssColor('rgba(0, 0, 0, 0.05)'), null)
})
test('rejects garbage', () => {
  assert.equal(parseCssColor('not-a-color'), null)
  assert.equal(parseCssColor(''), null)
  assert.equal(parseCssColor(null), null)
})

// ── relativeLuminance ──────────────────────────────────────────────────────
test('white is ~1, black is 0', () => {
  assert.ok(relativeLuminance({ r: 255, g: 255, b: 255 }) > 0.99)
  assert.equal(relativeLuminance({ r: 0, g: 0, b: 0 }), 0)
})
test('green reads brighter than blue (WCAG weighting)', () => {
  assert.ok(
    relativeLuminance({ r: 0, g: 255, b: 0 }) > relativeLuminance({ r: 0, g: 0, b: 255 })
  )
})

// ── gradientLuminance ──────────────────────────────────────────────────────
test('averages stops of a linear-gradient', () => {
  const l = gradientLuminance('linear-gradient(180deg, rgb(0,0,0) 0%, rgb(255,255,255) 100%)')
  assert.ok(l > 0.4 && l < 0.6, `expected mid-grey, got ${l}`)
})
test('parses hex stops too', () => {
  const l = gradientLuminance('linear-gradient(#ffffff, #ffffff)')
  assert.ok(l > 0.99)
})
test('returns null for raster images and non-gradients', () => {
  assert.equal(gradientLuminance('url(/banner.png)'), null)
  assert.equal(gradientLuminance('none'), null)
})

// ── decideIconsDark (hysteresis) ───────────────────────────────────────────
const { lo, hi } = STATUS_BAR_HYSTERESIS
test('first reading picks from the dead-band midpoint', () => {
  assert.equal(decideIconsDark(0.9, null), true) // bright bg → dark icons
  assert.equal(decideIconsDark(0.1, null), false) // dark bg → light icons
})
test('dark icons stay until the backdrop is convincingly dark', () => {
  // currently dark icons (true); a mid-band value keeps them.
  assert.equal(decideIconsDark((lo + hi) / 2, true), true)
  assert.equal(decideIconsDark(lo - 0.01, true), false) // crosses LO → flip to light icons
})
test('light icons stay until the backdrop is convincingly light', () => {
  // currently light icons (false); a mid-band value keeps them.
  assert.equal(decideIconsDark((lo + hi) / 2, false), false)
  assert.equal(decideIconsDark(hi + 0.01, false), true) // crosses HI → flip to dark icons
})
test('dead-band prevents flicker: a value between LO and HI never flips', () => {
  const mid = (lo + hi) / 2
  assert.equal(decideIconsDark(mid, true), true)
  assert.equal(decideIconsDark(mid, false), false)
})
test('a NaN/absent reading holds the previous decision', () => {
  assert.equal(decideIconsDark(NaN, true), true)
  assert.equal(decideIconsDark(NaN, false), false)
  assert.equal(decideIconsDark(undefined, null), true) // safe default
})

console.log(`\n${passed} assertions passed`)
