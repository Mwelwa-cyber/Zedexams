/**
 * Unit tests for src/engines/export-engine/sbaTrackerToXlsx.js — the live-formula SBA mark
 * workbook. Checks the workbook parts and that TOTAL/SBA cells carry the right
 * formulas (so editing a mark in Excel recomputes the ECZ-converted mark).
 *
 * Run: node scripts/test-sba-tracker-xlsx.mjs
 */

import assert from 'node:assert'
import { buildSbaTrackerWorkbookFiles, colLetter } from '../src/engines/export-engine/sbaTrackerToXlsx.js'
import { getSbaBlueprint } from '../src/config/sba.js'

let passed = 0
function ok(name, cond) { assert.ok(cond, name); passed += 1; console.log(`  ok  ${name}`) }

const blueprint = getSbaBlueprint('mathematics', 'G5') // 12 tasks, total 240
const artifact = {
  header: { subjectLabel: 'Mathematics', gradeLabel: 'Grade 5', school: 'Kabulonga Primary', year: '2026' },
  columns: blueprint.columns,
  total: blueprint.total,
  pupils: [
    { name: 'Kangwa Benson', marks: { [blueprint.columns[0].key]: 18, [blueprint.columns[1].key]: 15 } },
    { name: 'Sitali Mwiya', marks: {} },
  ],
}

const files = buildSbaTrackerWorkbookFiles(artifact)

console.log('sbaTrackerToXlsx — colLetter')
ok('0 → A', colLetter(0) === 'A')
ok('26 → AA', colLetter(26) === 'AA')

console.log('sbaTrackerToXlsx — workbook structure')
ok('has content types', typeof files['[Content_Types].xml'] === 'string')
ok('has workbook', files['xl/workbook.xml'].includes('SBA Mark Schedule'))
ok('forces recalc on load', files['xl/workbook.xml'].includes('fullCalcOnLoad="1"'))
ok('has one worksheet', typeof files['xl/worksheets/sheet1.xml'] === 'string')
ok('has styles', files['xl/styles.xml'].includes('styleSheet'))

console.log('sbaTrackerToXlsx — live formulas')
const sheet = files['xl/worksheets/sheet1.xml']
// 12 task columns → tasks C..N, TOTAL = O, SBA = P. First data row 5.
ok('TOTAL is a SUM of the task columns', sheet.includes('<f>SUM(C5:N5)</f>'))
ok('SBA mark is ROUND(total/240*10) clamped to 10',
  sheet.includes('IFERROR(MIN(10,ROUND(O5/240*10,0)),0)'))
ok('second pupil also gets formulas', sheet.includes('<f>SUM(C6:N6)</f>'))
ok('header shows the grade maximum', sheet.includes('TOTAL /240'))
ok("pupil name present", sheet.includes('Kangwa Benson'))
ok('entered mark present as numeric value', sheet.includes('<v>18</v>'))

console.log('sbaTrackerToXlsx — zero-total guard')
{
  const empty = buildSbaTrackerWorkbookFiles({ header: {}, columns: [], total: 0, pupils: [{ name: 'X', marks: {} }] })
  const s = empty['xl/worksheets/sheet1.xml']
  // No tasks → TOTAL col is C, SBA col D; SBA formula degrades to a literal 0.
  ok('zero-total SBA formula is literal 0', s.includes('<f>0</f>'))
}

console.log(`\n✓ sbaTrackerToXlsx — all ${passed} assertions passed.`)
