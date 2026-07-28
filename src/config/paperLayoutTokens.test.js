/**
 * The layout vocabulary: page sizes, orientation, margins, typography.
 *
 * The property most worth pinning is that the DEFAULTS are unchanged. Every
 * paper in the product renders through this module now, so a token whose default
 * drifted would silently reflow every saved paper.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 */

import assert from 'node:assert/strict'
import {
  PAGE_SIZES, DEFAULT_PAPER_LAYOUT, MIN_MARGIN_MM, MAX_MARGIN_MM,
  mmToEmu, mmToPt, mmToPx, mmToTwip, normalizeFontFamily, normalizeOrientation,
  normalizePageSize, pageDimensionsMm, resolveBodySizePt, resolveMarginsMm,
  resolveOptionIndentMm, resolvePaperLayout, resolveSpacingScale,
} from './paperLayoutTokens.js'
import {
  PAGE_MM, PAGE_MARGINS_MM, PAGE_MARGIN_BOTTOM_MM, RESERVED_BOTTOM_MM,
} from './paperPageGeometry.js'

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (err) {
    console.error(`  ✗   ${name}\n      ${err.message}`)
    process.exitCode = 1
  }
}

const near = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`)

console.log('\n— units —')

test('a millimetre converts to every unit a renderer speaks', () => {
  near(mmToPx(25.4), 96)
  near(mmToPt(25.4), 72)
  assert.equal(mmToTwip(25.4), 1440)
  assert.equal(mmToEmu(1), 36000)
})

test('nonsense converts to zero rather than NaN', () => {
  assert.equal(mmToPx('x'), 0)
  assert.equal(mmToEmu(undefined), 0)
})

console.log('\n— the sheet —')

test('A4 is 210 × 297 and it is the default', () => {
  assert.equal(normalizePageSize(undefined), 'a4')
  assert.deepEqual(
    { w: PAGE_SIZES.a4.width, h: PAGE_SIZES.a4.height },
    { w: PAGE_MM.width, h: PAGE_MM.height },
    'the page size agrees with the geometry module that owns the footer',
  )
})

test('an unknown page size is A4, not a crash', () => {
  assert.equal(normalizePageSize('foolscap'), 'a4')
  assert.equal(normalizePageSize('LETTER'), 'letter')
  assert.equal(normalizePageSize(' A5 '), 'a5')
})

test('landscape swaps the sheet, it does not scale it', () => {
  const portrait = pageDimensionsMm('a4', 'portrait')
  const landscape = pageDimensionsMm('a4', 'landscape')
  assert.deepEqual(
    { w: landscape.width, h: landscape.height },
    { w: portrait.height, h: portrait.width },
  )
  assert.equal(landscape.cssSize, 'A4 landscape')
})

test('an unknown orientation is portrait', () => {
  assert.equal(normalizeOrientation('sideways'), 'portrait')
  assert.equal(normalizeOrientation('LANDSCAPE'), 'landscape')
})

console.log('\n— margins —')

test('the default margins are the ones the paper already had', () => {
  const m = resolveMarginsMm(undefined)
  assert.equal(m.top, PAGE_MARGINS_MM.top)
  assert.equal(m.left, PAGE_MARGINS_MM.left)
  assert.equal(m.right, PAGE_MARGINS_MM.right)
})

test('the bottom margin is never a preset’s to decide', () => {
  // It is the footer's offset, derived in paperPageGeometry. A preset that
  // declared its own would be a second answer to a question that has one.
  for (const preset of ['normal', 'narrow', 'wide']) {
    assert.equal(resolveMarginsMm(preset).bottom, PAGE_MARGIN_BOTTOM_MM)
  }
})

test('a custom margin is clamped rather than refused', () => {
  // Refusing would lose a teacher their saved paper over a preference.
  const tight = resolveMarginsMm({ preset: 'custom', top: 1, right: 1, left: 1 })
  assert.equal(tight.top, MIN_MARGIN_MM)
  const huge = resolveMarginsMm({ preset: 'custom', top: 200, right: 200, left: 200 })
  assert.equal(huge.top, MAX_MARGIN_MM)
})

test('a named preset inside an object is still the preset', () => {
  assert.equal(resolveMarginsMm({ preset: 'narrow' }).top, 12)
})

console.log('\n— typography —')

test('the default body size is the one the print stylesheet declared', () => {
  assert.equal(DEFAULT_PAPER_LAYOUT.typography.bodySizePt, 11.5)
  assert.equal(DEFAULT_PAPER_LAYOUT.typography.lineSpacing, 1.45)
})

test('a raw point size is clamped to something printable', () => {
  assert.equal(resolveBodySizePt(2), 8)
  assert.equal(resolveBodySizePt(40), 18)
  assert.equal(resolveBodySizePt('large'), 14)
  assert.equal(resolveBodySizePt('nonsense'), 11.5)
})

test('Word gets half-points and a single family name, never a stack', () => {
  const t = DEFAULT_PAPER_LAYOUT.typography
  assert.equal(t.bodySizeHalfPt, 23)
  assert.equal(t.bodyFontWord, 'Times New Roman')
  assert.ok(!t.bodyFontWord.includes(','), 'Word takes one name and substitutes silently')
  assert.ok(t.bodyFontCss.includes('Liberation Serif'), 'the CSS stack keeps the metric-compatible clone')
})

test('headings scale with the body so a large-print paper stays coherent', () => {
  const small = resolvePaperLayout({ bodySize: 10.5 })
  const large = resolvePaperLayout({ bodySize: 14 })
  assert.ok(large.typography.headingSizePt.subject > small.typography.headingSizePt.subject)
})

test('an unknown font falls back rather than reaching a renderer', () => {
  assert.equal(normalizeFontFamily('comic sans'), 'serif')
  assert.equal(normalizeFontFamily('sans'), 'sans')
})

console.log('\n— the resolved set —')

test('the content box is the sheet less its margins and the footer reservation', () => {
  const l = DEFAULT_PAPER_LAYOUT
  near(l.content.widthMm, PAGE_MM.width - PAGE_MARGINS_MM.left - PAGE_MARGINS_MM.right)
  near(l.content.heightMm, PAGE_MM.height - PAGE_MARGINS_MM.top - RESERVED_BOTTOM_MM)
})

test('a landscape A5 paper resolves without a second code path', () => {
  const l = resolvePaperLayout({ pageSize: 'a5', orientation: 'landscape' })
  assert.equal(l.page.widthMm, 210)
  assert.equal(l.page.heightMm, 148)
  assert.ok(l.content.widthMm > 0 && l.content.heightMm > 0)
})

test('spacing scales together rather than one gap at a time', () => {
  const tight = resolvePaperLayout({ spacing: 'tight' })
  const relaxed = resolvePaperLayout({ spacing: 'relaxed' })
  assert.ok(relaxed.spacing.question > tight.spacing.question)
  assert.ok(relaxed.spacing.option > tight.spacing.option)
  assert.equal(resolveSpacingScale('nonsense'), 1)
})

test('the option indent is a physical distance, because Word cannot take an em', () => {
  assert.equal(resolveOptionIndentMm('wide'), 12)
  assert.equal(resolveOptionIndentMm(500), 30)
  assert.equal(DEFAULT_PAPER_LAYOUT.optionIndentMm, 7)
})

test('the token set is frozen — a renderer must not be able to edit the paper', () => {
  assert.throws(() => { DEFAULT_PAPER_LAYOUT.page.widthMm = 1 }, TypeError)
})

test('a paper with no preferences at all still resolves completely', () => {
  const l = resolvePaperLayout()
  for (const key of ['page', 'margins', 'content', 'typography', 'spacing', 'figure']) {
    assert.ok(l[key], `${key} is present`)
  }
})

console.log(`\n✓ paper layout tokens — ${passed} tests passed`)
