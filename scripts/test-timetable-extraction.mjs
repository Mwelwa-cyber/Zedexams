#!/usr/bin/env node
/* global console, process */
/**
 * Unit tests for the Upload-Timetable extraction mapping
 * (src/utils/timetableExtraction.js): subject snapping and the
 * Gemini-JSON → studio-grid normalisation. The network/Gemini call and the
 * browser-only file reading are not exercised here — only the pure helpers,
 * which is where the mapping logic lives.
 *
 * Plain `node` script that throws on failure, per repo convention.
 * Run: npm run test:timetable-extraction   (also via npm run test:all)
 */
import {
  snapSubjectLabel,
  normalizeExtracted,
  fileKind,
} from '../src/utils/timetableExtraction.js'

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
function assert(cond, msg) { if (!cond) throw new Error(msg) }

const UP = ['English Language', 'Mathematics', 'Integrated Science', 'Social Studies', 'Technology Studies']

/* ── subject snapping ─────────────────────────────────────────── */

test('snapSubjectLabel maps common abbreviations to curriculum subjects', () => {
  assert(snapSubjectLabel('Maths', UP) === 'Mathematics', 'Maths → Mathematics')
  assert(snapSubjectLabel('Eng', UP) === 'English Language', 'Eng → English Language')
  assert(snapSubjectLabel('SS', UP) === 'Social Studies', 'SS → Social Studies')
  assert(snapSubjectLabel('ICT', UP) === 'Technology Studies', 'ICT → Technology Studies')
  assert(snapSubjectLabel('Science', UP) === 'Integrated Science', 'Science ⊂ Integrated Science')
})

test('snapSubjectLabel keeps an unknown subject (tidied) so it still shows', () => {
  assert(snapSubjectLabel('library period', UP) === 'Library Period', 'unknown → title-cased')
  assert(snapSubjectLabel('  maths  ', []) === 'Mathematics', 'alias applied even with no candidates')
})

/* ── file kind ────────────────────────────────────────────────── */

test('fileKind classifies uploads by extension and mime', () => {
  assert(fileKind({ name: 'tt.pdf' }) === 'pdf', 'pdf')
  assert(fileKind({ name: 'TT.DOCX' }) === 'docx', 'docx (case-insensitive)')
  assert(fileKind({ name: 'sheet.xlsx' }) === 'xlsx', 'xlsx')
  assert(fileKind({ name: 'photo.JPG' }) === 'image', 'jpg image')
  assert(fileKind({ name: 'scan', type: 'image/png' }) === 'image', 'mime fallback')
  assert(fileKind({ name: 'notes.txt' }) === 'unknown', 'unsupported')
})

/* ── normalisation ────────────────────────────────────────────── */

const RAW = {
  detectedGrade: 'Grade 5',
  days: ['mon', 'Tuesday', 'FRI', 'Funday'],
  startTime: '08:00',
  periodMinutes: 35,
  periodCount: 3,
  lessons: [
    { day: 'Monday', period: 1, subject: 'Maths' },
    { day: 'monday', period: 2, subject: 'Eng' },
    { day: 'Tue', period: 1, subject: 'Science' },
    { day: 'Friday', period: 5, subject: 'PE' }, // period out of range → dropped
    { day: 'Funday', period: 1, subject: 'Maths' }, // invalid day → dropped
  ],
  notes: 'bottom row was faint',
}

test('normalizeExtracted canonicalises days and keeps week order', () => {
  const r = normalizeExtracted(RAW, { candidates: UP })
  assert(r.days.join(',') === 'Monday,Tuesday,Friday', `days wrong: ${r.days.join(',')}`)
})

test('normalizeExtracted carries the detected timing', () => {
  const r = normalizeExtracted(RAW, { candidates: UP })
  assert(r.timing.startTime === '08:00', 'startTime')
  assert(r.timing.periodMinutes === 35, 'periodMinutes')
  assert(r.timing.lessonPeriods === 3, 'lessonPeriods from periodCount')
  assert(r.timing.breaks.length === 0, 'breaks start empty for an upload')
})

test('normalizeExtracted maps lessons to the grid and snaps subjects', () => {
  const r = normalizeExtracted(RAW, { candidates: UP })
  assert(r.slots.p1.Monday === 'Mathematics', `p1 Monday: ${r.slots.p1?.Monday}`)
  assert(r.slots.p2.Monday === 'English Language', `p2 Monday: ${r.slots.p2?.Monday}`)
  assert(r.slots.p1.Tuesday === 'Integrated Science', `p1 Tuesday: ${r.slots.p1?.Tuesday}`)
  // Out-of-range period and invalid day are dropped → 3 lessons total.
  assert(r.lessonCount === 3, `expected 3 lessons, got ${r.lessonCount}`)
  assert(r.detectedSubjects.length === 3, `expected 3 distinct subjects, got ${r.detectedSubjects.length}`)
  assert(r.detectedGrade === 'Grade 5' && r.notes === 'bottom row was faint', 'passthrough fields')
})

test('normalizeExtracted falls back to default days when none parse', () => {
  const r = normalizeExtracted({ days: ['Blursday'], lessons: [] }, { daysFallback: ['Monday', 'Wednesday'] })
  assert(r.days.join(',') === 'Monday,Wednesday', `fallback days wrong: ${r.days.join(',')}`)
})

console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
