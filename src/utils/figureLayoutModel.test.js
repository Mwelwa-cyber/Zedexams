/**
 * A figure's physical box.
 *
 * The defect behind this module: `imageWidth` resolved to a PERCENTAGE of a
 * column, and the three renderers have three different columns. Fifty percent of
 * three columns is three figures, and a teacher who sized a diagram to sit
 * beside a question found it bigger in the download.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 */

import assert from 'node:assert/strict'
import {
  figureOverflowsPage, normalizeFigureAlignment, normalizeFigureSpec, resolveFigureBox,
} from './figureLayoutModel.js'
import { resolvePaperLayout } from '../config/paperLayoutTokens.js'

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

const A4 = resolvePaperLayout({})
const near = (a, b, tol = 0.6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`)

console.log('\n— the spec —')

test('a question with no figure settings gets the defaults it always had', () => {
  const spec = normalizeFigureSpec({})
  assert.equal(spec.preset, 'full')
  assert.equal(spec.align, 'center')
  assert.equal(spec.border, false)
  assert.equal(spec.keepWithQuestion, true, 'a diagram stays with its question unless told otherwise')
  assert.equal(spec.widthMm, null)
})

test('a stored preset and a typed width both survive', () => {
  assert.equal(normalizeFigureSpec({ imageWidth: 'small' }).preset, 'small')
  assert.equal(normalizeFigureSpec({ figureWidthMm: 60 }).widthMm, 60)
  assert.equal(normalizeFigureSpec({ figureWidthMm: 9999 }).widthMm, 400, 'a typed width is bounded')
})

test('an unknown alignment is centre', () => {
  assert.equal(normalizeFigureAlignment('middle'), 'center')
  assert.equal(normalizeFigureAlignment('RIGHT'), 'right')
})

console.log('\n— the box —')

test('a full-width figure is the document’s column, not a fixed number', () => {
  const wide = resolveFigureBox(normalizeFigureSpec({}), A4)
  near(wide.widthMm, A4.content.widthMm)
  // The same preset on a narrow-margin A5 paper is a different number of mm,
  // which is the whole point of resolving against the document.
  const a5 = resolvePaperLayout({ pageSize: 'a5', margins: 'narrow' })
  const narrow = resolveFigureBox(normalizeFigureSpec({}), a5)
  near(narrow.widthMm, a5.content.widthMm)
  assert.ok(narrow.widthMm < wide.widthMm)
})

test('a named preset is a physical width', () => {
  assert.equal(resolveFigureBox(normalizeFigureSpec({ imageWidth: 'small' }), A4).widthMm, 45)
  assert.equal(resolveFigureBox(normalizeFigureSpec({ imageWidth: 'medium' }), A4).widthMm, 75)
  assert.equal(resolveFigureBox(normalizeFigureSpec({ imageWidth: 'large' }), A4).widthMm, 120)
})

test('every renderer’s unit comes out of the same resolution', () => {
  const box = resolveFigureBox(normalizeFigureSpec({ imageWidth: 'medium' }), A4)
  near(box.widthPx, (75 / 25.4) * 96, 1)
  assert.equal(box.widthEmu, 75 * 36000)
  assert.ok(box.widthPercent > 0 && box.widthPercent <= 100)
})

test('the column always wins over the teacher’s width', () => {
  // A figure wider than the text column is clipped in print and silently
  // rescaled by Word — two failures nobody connects to one cause.
  const box = resolveFigureBox(normalizeFigureSpec({ figureWidthMm: 300 }), A4)
  near(box.widthMm, A4.content.widthMm)
})

test('a height cap narrows the figure rather than squashing it', () => {
  const box = resolveFigureBox(normalizeFigureSpec({ figureMaxHeightMm: 20 }), A4, { aspect: 1 })
  near(box.heightMm, 20)
  near(box.widthMm, 20, 1)
})

test('the aspect ratio is honoured, and a nonsense one does not divide by zero', () => {
  const wide = resolveFigureBox(normalizeFigureSpec({ imageWidth: 'medium' }), A4, { aspect: 3 })
  near(wide.heightMm, 25)
  const broken = resolveFigureBox(normalizeFigureSpec({ imageWidth: 'medium' }), A4, { aspect: 0 })
  assert.ok(Number.isFinite(broken.heightMm) && broken.heightMm > 0)
})

console.log('\n— the level’s floor —')

test('a band minimum raises a figure that fell under it', () => {
  const box = resolveFigureBox(
    normalizeFigureSpec({ imageWidth: 'small' }), A4,
    { band: { minFigureSizeMm: 45 }, aspect: 1.6 },
  )
  assert.equal(box.raisedToFloor, true)
  assert.ok(Math.min(box.widthMm, box.heightMm) >= 45 - 0.5)
})

test('…but the page still wins, and the shortfall is reported rather than hidden', () => {
  const tiny = resolvePaperLayout({ pageSize: 'a5', margins: 'wide' })
  const box = resolveFigureBox(
    normalizeFigureSpec({ imageWidth: 'small' }), tiny,
    { band: { minFigureSizeMm: 300 }, aspect: 1.6 },
  )
  assert.ok(box.widthMm <= tiny.content.widthMm + 0.01, 'never wider than the column')
  assert.equal(box.belowFloor, true, 'the shortfall is stated, not swallowed')
})

test('no band means no floor, not no figure', () => {
  const box = resolveFigureBox(normalizeFigureSpec({ imageWidth: 'small' }), A4, { band: null })
  assert.equal(box.raisedToFloor, false)
  assert.equal(box.belowFloor, false)
  assert.equal(box.widthMm, 45)
})

console.log('\n— overflow —')

test('a figure taller than the content box cannot be placed and says so', () => {
  assert.equal(figureOverflowsPage({ widthMm: 100, heightMm: 500 }, A4), true)
  assert.equal(figureOverflowsPage({ widthMm: 100, heightMm: 80 }, A4), false)
  assert.equal(figureOverflowsPage(null, A4), false)
})

console.log(`\n✓ figure layout — ${passed} tests passed`)
