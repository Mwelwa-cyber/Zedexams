/**
 * Plain-node tests for the pure half of the paginated preview and Fit to page
 * (§3.3, §2.5).
 *
 * Run: node src/features/lessonPlanStudio/lib/lessonPlanPagination.test.js
 *      (npm run test:lesson-pagination)
 */

import assert from 'node:assert/strict'
import {
  A4_HEIGHT_MM,
  A4_WIDTH_MM,
  fitToPage,
  pageCountVerdict,
  safeAreaOverlay,
  sheetContentBox,
  spillFraction,
} from './lessonPlanPagination.js'
import { MARGIN_PRESETS, resolveLessonFormat } from '../../../utils/lessonPlanFormat.js'

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

console.log('\nsheet geometry')
check('the content box is the sheet less both margins', () => {
  const box = sheetContentBox(15)
  assert.equal(box.widthMm, A4_WIDTH_MM - 30)
  assert.equal(box.heightMm, A4_HEIGHT_MM - 30)
  assert.ok(box.widthPx > 600 && box.widthPx < 700)
})
check('narrower margins really do recover page area', () => {
  const normal = sheetContentBox(MARGIN_PRESETS.normal)
  const narrow = sheetContentBox(MARGIN_PRESETS.narrow)
  const gain = (narrow.widthMm * narrow.heightMm) / (normal.widthMm * normal.heightMm) - 1
  // §2.5 claims ~8-10% per page from margins alone.
  assert.ok(gain > 0.07 && gain < 0.13, `gain was ${(gain * 100).toFixed(1)}%`)
})

console.log('\npage-count verdict')
check('an unmeasured plan reads as measuring, never as a pass', () => {
  const v = pageCountVerdict(null, { pageBudget: '2' })
  assert.equal(v.level, 'measuring')
  assert.equal(v.pages, null)
  assert.match(v.label, /Measuring/)
})
check('within budget is ok', () => {
  assert.equal(pageCountVerdict(2, { pageBudget: '2' }).level, 'ok')
  assert.equal(pageCountVerdict(1, { pageBudget: '2' }).level, 'ok')
})
check('one sheet over is amber, two or more is red', () => {
  assert.equal(pageCountVerdict(3, { pageBudget: '2' }).level, 'amber')
  assert.equal(pageCountVerdict(4, { pageBudget: '2' }).level, 'red')
  assert.equal(pageCountVerdict(2, { pageBudget: '1' }).level, 'amber')
  assert.equal(pageCountVerdict(3, { pageBudget: '1' }).level, 'red')
})
check('No limit never complains', () => {
  assert.equal(pageCountVerdict(9, { pageBudget: 'none' }).level, 'ok')
})
check('the label reads naturally at one page', () => {
  assert.equal(pageCountVerdict(1, { pageBudget: '1' }).label, '1 page')
  assert.equal(pageCountVerdict(2, { pageBudget: '2' }).label, '2 pages')
})

console.log('\nspill')
check('spill is measured against the budget', () => {
  assert.equal(spillFraction(2, { pageBudget: '2' }), 0)
  assert.equal(spillFraction(3, { pageBudget: '2' }), 0.5)
  assert.equal(spillFraction(null, { pageBudget: '2' }), 0)
  assert.equal(spillFraction(9, { pageBudget: 'none' }), 0)
})

console.log('\nfit to page')
check('a plan already within budget is left completely alone', () => {
  let calls = 0
  const result = fitToPage({ pageBudget: '2' }, () => { calls += 1; return 2 })
  assert.equal(result.fitted, true)
  assert.deepEqual(result.steps, [])
  assert.equal(calls, 1, 'measured once and stopped')
})
check('it stops at the first step that fits', () => {
  // Three pages until density goes compact, then two.
  const measure = (f) => (f.density === 'compact' ? 2 : 3)
  const result = fitToPage(resolveLessonFormat({ pageBudget: '2', density: 'comfortable' }), measure)
  assert.equal(result.fitted, true)
  assert.deepEqual(result.steps, ['density'])
  assert.equal(result.pages, 2)
  assert.equal(result.needsCondense, false)
})
check('it walks density → margins → font in that order', () => {
  // Never fits, so the ladder runs to exhaustion and records its route.
  const result = fitToPage(resolveLessonFormat({ pageBudget: '1', density: 'comfortable' }), () => 5)
  assert.equal(result.fitted, false)
  assert.equal(result.needsCondense, true)
  assert.equal(result.steps[0], 'density')
  assert.equal(result.steps[1], 'margins')
  assert.ok(result.steps.includes('tableFont'))
  // Order: every margins step precedes every tableFont step.
  const lastMargin = result.steps.lastIndexOf('margins')
  const firstFont = result.steps.indexOf('tableFont')
  assert.ok(lastMargin < firstFont, `steps were ${result.steps.join(' → ')}`)
})
check('it never squeezes past the printable safe area', () => {
  const result = fitToPage(resolveLessonFormat({ pageBudget: '1' }), () => 5)
  assert.ok(result.format.marginMm >= 5)
})
check('No limit means nothing to fit to', () => {
  let calls = 0
  const result = fitToPage({ pageBudget: 'none' }, () => { calls += 1; return 7 })
  assert.equal(result.fitted, true)
  assert.deepEqual(result.steps, [])
  assert.equal(calls, 1)
})
check('an exhausted ladder asks for the condense pass rather than claiming success', () => {
  const result = fitToPage(resolveLessonFormat({ pageBudget: '1' }), () => 4)
  assert.equal(result.fitted, false)
  assert.equal(result.needsCondense, true)
})
check('a spill inside §2.5\'s 15% is recovered without touching the words', () => {
  // 2-page budget, plan measures 3 at comfortable density but 2 once tightened.
  let stepsTaken = 0
  const measure = (f) => {
    stepsTaken += 1
    return f.density === 'compact' && f.marginMm <= 10 ? 2 : 3
  }
  const result = fitToPage(resolveLessonFormat({ pageBudget: '2', density: 'comfortable' }), measure)
  assert.equal(result.fitted, true)
  assert.equal(result.needsCondense, false, 'no regeneration round-trip needed')
  assert.ok(stepsTaken <= 4)
})

console.log('\nsafe-area overlay')
check('the overlay appears only when the margins are close to the edge', () => {
  assert.equal(safeAreaOverlay({ marginMm: 15 }).show, false)
  assert.equal(safeAreaOverlay({ marginMm: 7 }).show, true)
  assert.equal(safeAreaOverlay({ marginMm: 7 }).level, 'amber')
  assert.equal(safeAreaOverlay({ marginMm: 5 }).level, 'red')
})
check('the overlay sits at the printer safe area, not at the margin', () => {
  assert.equal(safeAreaOverlay({ marginMm: 6 }).insetMm, 5)
})
check('the warning explains the risk in a teacher\'s words', () => {
  assert.match(safeAreaOverlay({ marginMm: 6 }).message, /cut off/i)
  assert.match(safeAreaOverlay({ marginMm: 6 }).message, /You can still print/i)
})

console.log(`\n✅ lessonPlanPagination — ${passed} checks passed\n`)
