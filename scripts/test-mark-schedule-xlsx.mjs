#!/usr/bin/env node
/* global console, process */
/**
 * Unit tests for the Mark Schedule .xlsx exporter
 * (src/engines/export-engine/markScheduleToXlsx.js): workbook part inventory, live
 * formula construction (SUM totals, dense-rank SUMPRODUCT positions,
 * percentage + cross-sheet references), XML escaping, and a jszip
 * round-trip so the produced bytes really are a readable zip.
 *
 * Plain `node` script that throws on failure, per repo convention.
 * Run: npm run test:mark-schedule-xlsx   (also via npm run test:all)
 */
import {
  colLetter,
  buildMarkScheduleWorkbookFiles,
  buildMarkScheduleXlsxBytes,
} from '../src/engines/export-engine/markScheduleToXlsx.js'

let pass = 0
let fail = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    pass += 1
    console.log(`  ok  ${name}`)
  } catch (err) {
    fail += 1
    failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}`)
    console.log(`       ${err.message}`)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const SCHEDULE = {
  schemaVersion: 'mark-schedule-1.0',
  header: { school: 'Kalulu Primary School', grade: 'G4', term: 2, year: '2026' },
  subjects: [
    { key: 'maths', label: 'MATHS', max: 100 },
    { key: 'english', label: 'ENGLISH', max: 50 },
    { key: 'science', label: 'SCIENCE', max: 100 },
  ],
  pupils: [
    { sn: 1, name: 'Bwalya & Sons', marks: { maths: 90, english: 40, science: 80 }, total: 210, position: 1, comment: 'Excellent results! Keep it up, Bwalya.' },
    { sn: 2, name: 'Mutale Chanda', marks: { maths: 70, english: 35, science: 60 }, total: 165, position: 2, comment: 'Very good work. Aim for number one next term, Mutale.' },
    { sn: 3, name: 'Natasha <Phiri>', marks: { maths: 50, english: '', science: 45 }, total: 95, position: 3, comment: 'Pull up your socks in English, Natasha.' },
  ],
}

const files = buildMarkScheduleWorkbookFiles(SCHEDULE)
const sheet1 = files['xl/worksheets/sheet1.xml']
const sheet2 = files['xl/worksheets/sheet2.xml']
const sheet3 = files['xl/worksheets/sheet3.xml']

console.log('\ncolumn letters')
test('colLetter spans A..Z..AA', () => {
  assert(colLetter(0) === 'A' && colLetter(2) === 'C', 'A and C')
  assert(colLetter(25) === 'Z' && colLetter(26) === 'AA' && colLetter(27) === 'AB', 'Z/AA/AB rollover')
})

console.log('\nworkbook parts')
test('all required parts are present', () => {
  for (const p of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/worksheets/sheet3.xml']) {
    assert(files[p], `missing ${p}`)
  }
  assert(files['[Content_Types].xml'].includes('/xl/worksheets/sheet3.xml'), 'content types lists all sheets')
  assert(files['xl/workbook.xml'].includes('fullCalcOnLoad="1"'), 'recalc-on-open is set (formulas carry no cached values)')
  assert(files['xl/workbook.xml'].includes('name="Mark Schedule"') && files['xl/workbook.xml'].includes('name="Report Comments"'), 'sheet names registered')
})

console.log('\nschedule sheet (live formulas)')
test('TOTAL is a live =SUM over the subject columns', () => {
  // 3 subjects → marks C..E, TOTAL F, POSITION G; pupils from row 5.
  assert(sheet1.includes('<c r="F5" s="6"><f>SUM(C5:E5)</f></c>'), `SUM formula for row 5 (got: ${(sheet1.match(/<c r="F5"[^/]*\/?>(<f>[^<]*<\/f>)?/) || ['?'])[0]})`)
  assert(sheet1.includes('<f>SUM(C7:E7)</f>'), 'SUM formula for the last pupil row')
})
test('POSITION is a dense-rank SUMPRODUCT over the totals', () => {
  assert(sheet1.includes('<f>SUMPRODUCT((F$5:F$7&gt;F5)/COUNTIF(F$5:F$7,F$5:F$7))+1</f>'), 'dense-rank formula, absolute totals range, escaped >')
})
test('out-of row carries each max and the grand max', () => {
  assert(sheet1.includes('<c r="C4" s="5"><v>100</v></c>'), 'maths max 100')
  assert(sheet1.includes('<c r="D4" s="5"><v>50</v></c>'), 'english max 50')
  assert(sheet1.includes('<c r="F4" s="6"><v>250</v></c>'), 'grand max 250')
})
test('names and special characters are XML-escaped inline strings', () => {
  assert(sheet1.includes('Bwalya &amp; Sons'), 'ampersand escaped')
  assert(sheet1.includes('Natasha &lt;Phiri&gt;'), 'angle brackets escaped')
  assert(!sheet1.includes('Natasha <Phiri>'), 'no raw angle brackets leak into XML')
})
test('blank marks become empty cells, not zeros', () => {
  assert(sheet1.includes('<c r="D7" s="5"/>'), 'Natasha’s blank English mark is an empty bordered cell')
})
test('grade label drops the G prefix in the heading', () => {
  assert(sheet1.includes('GRADE 4 · TERM 2 MARK SCHEDULE — 2026'), 'heading reads GRADE 4, not GRADE G4')
})
test('header.gradeLabel is preferred in headings (Form 1, not GRADE F1)', () => {
  const formFiles = buildMarkScheduleWorkbookFiles({
    ...SCHEDULE,
    header: { ...SCHEDULE.header, grade: 'F1', gradeLabel: 'Form 1' },
  })
  const formSheet1 = formFiles['xl/worksheets/sheet1.xml']
  const formSheet3 = formFiles['xl/worksheets/sheet3.xml']
  assert(formSheet1.includes('FORM 1 · TERM 2 MARK SCHEDULE — 2026'), 'schedule heading uses the human label')
  assert(!formSheet1.includes('GRADE F1'), 'no GRADE F1 mash-up in the schedule heading')
  assert(formSheet3.includes('REPORT COMMENTS SHEET — FORM 1 TERM 2 2026'), 'comments heading uses the human label')
})

console.log('\npercentages sheet')
test('subject % cells divide sheet-1 marks by sheet-1 maxima', () => {
  assert(sheet2.includes(`<f>IFERROR(ROUND('Mark Schedule'!C5/'Mark Schedule'!C$4*100,0),0)</f>`), 'percent formula references sheet 1')
})
test('AVERAGE % averages this sheet’s percent cells', () => {
  assert(sheet2.includes('<f>IFERROR(ROUND(AVERAGE(C5:E5),0),0)</f>'), 'average formula')
})
test('positions on the percent view come straight from sheet 1', () => {
  assert(sheet2.includes(`<f>'Mark Schedule'!G5</f>`), 'position cross-reference')
})
test('out-of row is all 100s', () => {
  assert(sheet2.includes('<c r="C4" s="5"><v>100</v></c>') && sheet2.includes('<c r="F4" s="6"><v>100</v></c>'), '100s row')
})

console.log('\nreport comments sheet')
test('comments land verbatim with live positions', () => {
  assert(sheet3.includes('Pull up your socks in English, Natasha.'), 'teacher-voice comment present')
  assert(sheet3.includes(`<f>'Mark Schedule'!G5</f>`), 'first pupil position referenced from sheet 1')
  assert(sheet3.includes(`<f>'Mark Schedule'!G7</f>`), 'last pupil position referenced from sheet 1')
  assert(sheet3.includes('REPORT COMMENTS SHEET — GRADE 4 TERM 2 2026'), 'comments sheet heading')
})

console.log('\nzip round-trip')
const bytes = await buildMarkScheduleXlsxBytes(SCHEDULE)
test('produced bytes are a real zip with every part readable', async () => {
  assert(bytes[0] === 0x50 && bytes[1] === 0x4b, 'starts with the PK zip signature')
})
const { default: JSZip } = await import('jszip')
const reopened = await JSZip.loadAsync(bytes)
const sheet1Back = await reopened.file('xl/worksheets/sheet1.xml').async('string')
test('zip reopens and sheet 1 survives the round-trip', () => {
  assert(sheet1Back === sheet1, 'sheet 1 XML identical after zip/unzip')
  assert(reopened.file('xl/styles.xml') && reopened.file('[Content_Types].xml'), 'styles + content types present in zip')
})

console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
