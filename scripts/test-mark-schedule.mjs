#!/usr/bin/env node
/* global console, process */
/**
 * Unit tests for the Mark Schedule studio's deterministic core
 * (src/shared/utils/markSchedule.js): totals, dense-ranked positions with ties,
 * percentage conversion/averaging, comment banding and determinism.
 *
 * Plain `node` script that throws on failure, per repo convention.
 * Run: npm run test:mark-schedule   (also via npm run test:all)
 */
import {
  computeTotal,
  percentFor,
  averagePercent,
  rankPupils,
  weakestSubject,
  bandFor,
  suggestComment,
  buildSchedule,
  buildReportCards,
  scheduleClassLabel,
} from '../src/shared/utils/markSchedule.js'

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

const SUBJECTS = [
  { key: 'maths', label: 'MATHS', max: 25 },
  { key: 'english', label: 'ENGLISH', max: 25 },
  { key: 'science', label: 'SCIENCE', max: 26 },
  { key: 'social', label: 'SOCIAL STUDIES', max: 26 },
  { key: 'cts', label: 'C.T.S', max: 25 },
]

// The /teachers sample roster — totals and ranking verified by hand.
const PUPILS = [
  { sn: 1, name: 'Natasha Zulu', marks: { maths: 23, english: 21, science: 24, social: 22, cts: 20 } },
  { sn: 2, name: 'Emmanuel Tembo', marks: { maths: 20, english: 22, science: 23, social: 21, cts: 21 } },
  { sn: 3, name: 'Chimwemwe Banda', marks: { maths: 19, english: 23, science: 20, social: 24, cts: 18 } },
  { sn: 4, name: 'Joseph Mwewa', marks: { maths: 21, english: 18, science: 22, social: 20, cts: 23 } },
  { sn: 5, name: 'Lushomo Hamoonga', marks: { maths: 18, english: 20, science: 21, social: 19, cts: 20 } },
  { sn: 6, name: 'Chanda Mwansa', marks: { maths: 12, english: 14, science: 13, social: 15, cts: 14 } },
]

console.log('\nclass label')
test('scheduleClassLabel prefers the human gradeLabel end-to-end', () => {
  assert(scheduleClassLabel({ grade: 'F1', gradeLabel: 'Form 1' }) === 'Form 1', 'Form 1 label wins over the F1 code')
  assert(scheduleClassLabel({ grade: 'G5', gradeLabel: 'Grade 5' }) === 'Grade 5', 'Grade 5 label passes through')
})
test('scheduleClassLabel keeps the legacy G-strip fallback for old artifacts', () => {
  assert(scheduleClassLabel({ grade: 'G4' }) === 'Grade 4', "'G4' → 'Grade 4' exactly as before")
  assert(scheduleClassLabel({ grade: 'F1' }) === 'Grade F1', "old 'F1' data renders unchanged (the pre-gradeLabel quirk)")
  assert(scheduleClassLabel({ grade: 'G4', gradeLabel: '  ' }) === 'Grade 4', 'blank gradeLabel falls back')
  assert(scheduleClassLabel({}) === 'Grade ', 'missing grade matches the historical empty rendering')
})

console.log('\ntotals')
test('computeTotal sums across subjects', () => {
  assert(computeTotal(PUPILS[0].marks, SUBJECTS) === 110, 'Natasha should total 110')
  assert(computeTotal(PUPILS[5].marks, SUBJECTS) === 68, 'Chanda should total 68')
})
test('computeTotal treats missing/garbage marks as 0', () => {
  assert(computeTotal({ maths: 10 }, SUBJECTS) === 10, 'missing subjects = 0')
  assert(computeTotal({ maths: 'x', english: null }, SUBJECTS) === 0, 'non-numeric = 0')
})

console.log('\npercentages')
test('percentFor converts against the subject max', () => {
  assert(percentFor(24, 26) === 92, '24/26 → 92')
  assert(percentFor(22, 26) === 85, '22/26 → 85 (rounded)')
  assert(percentFor(20, 25) === 80, '20/25 → 80')
  assert(percentFor(5, 0) === 0, 'max 0 → 0, no division blow-up')
})
test('averagePercent averages whole-number subject percentages', () => {
  assert(averagePercent(PUPILS[0].marks, SUBJECTS) === 87, 'Natasha avg 87')
  assert(averagePercent(PUPILS[5].marks, SUBJECTS) === 54, 'Chanda avg 54')
})

console.log('\nranking')
test('rankPupils uses dense ranking and ties share a position', () => {
  const ranked = rankPupils(PUPILS, SUBJECTS)
  const byName = Object.fromEntries(ranked.map((p) => [p.name, p]))
  assert(byName['Natasha Zulu'].position === 1, 'Natasha 1st')
  assert(byName['Emmanuel Tembo'].position === 2, 'Emmanuel 2nd')
  assert(byName['Chimwemwe Banda'].total === 104 && byName['Joseph Mwewa'].total === 104, 'tie at 104')
  assert(byName['Chimwemwe Banda'].position === 3 && byName['Joseph Mwewa'].position === 3, 'tied pupils share 3rd')
  assert(byName['Lushomo Hamoonga'].position === 4, 'next distinct total takes the NEXT number (dense)')
  assert(byName['Chanda Mwansa'].position === 5, 'last of five distinct totals')
})
test('rankPupils does not mutate its input', () => {
  const input = PUPILS.map((p) => ({ ...p, marks: { ...p.marks } }))
  rankPupils(input, SUBJECTS)
  assert(input[0].total === undefined && input[0].position === undefined, 'input rows untouched')
  assert(input[0].sn === 1, 'input order preserved')
})

console.log('\nweakest subject + bands')
test('weakestSubject picks the lowest PERCENTAGE, not the lowest raw mark', () => {
  // 19/26 social (73%) is a lower share than 19/25 cts (76%) even when raw marks tie.
  const w = weakestSubject({ maths: 24, english: 24, science: 25, social: 19, cts: 19 }, SUBJECTS)
  assert(w.key === 'social', `expected social, got ${w.key}`)
})
test('bandFor covers the class from top to bottom', () => {
  assert(bandFor(1, 9) === 'top', 'position 1 is top')
  assert(bandFor(2, 9) === 'upper', 'near the top is upper')
  assert(bandFor(5, 9) === 'middle', 'mid-table is middle')
  assert(bandFor(7, 9) === 'lower', 'lower-middle is lower')
  assert(bandFor(9, 9) === 'bottom', 'last is bottom')
  assert(bandFor(2, 2) === 'bottom', 'two-pupil class: second is bottom')
})

console.log('\ncomments')
test('suggestComment is deterministic and uses the first name', () => {
  const ranked = rankPupils(PUPILS, SUBJECTS)
  const last = ranked[ranked.length - 1].position
  const natasha = ranked.find((p) => p.name === 'Natasha Zulu')
  const a = suggestComment(natasha, SUBJECTS, last)
  const b = suggestComment(natasha, SUBJECTS, last)
  assert(a === b, 'same pupil, same comment')
  assert(a.includes('Natasha'), `top comment addresses the pupil (got: ${a})`)
  assert(!a.includes('Zulu'), 'first name only')
})
test('buildSchedule fills comments but keeps teacher-written ones', () => {
  const withOwn = PUPILS.map((p) => p.name === 'Chanda Mwansa'
    ? { ...p, comment: 'Spoke with the parents on Friday.' }
    : p)
  const rows = buildSchedule(withOwn, SUBJECTS)
  assert(rows.every((p) => p.comment && p.comment.length > 0), 'every pupil gets a comment')
  const chanda = rows.find((p) => p.name === 'Chanda Mwansa')
  assert(chanda.comment === 'Spoke with the parents on Friday.', "teacher's own comment is kept")
  const tied = rows.filter((p) => p.total === 104)
  assert(tied.length === 2 && tied.every((p) => p.position === 3), 'tie survives through buildSchedule')
})

console.log('\nreport cards')
test('buildReportCards makes one card per pupil with full subject rows', () => {
  const schedule = {
    header: { school: 'Kalulu Primary', grade: 'G4', term: 2, year: '2026' },
    subjects: SUBJECTS,
    pupils: buildSchedule(PUPILS, SUBJECTS).map((p, i) => ({ ...p, sn: i + 1 })),
  }
  const cards = buildReportCards(schedule)
  assert(cards.length === 6, 'six pupils, six cards')
  assert(cards.every((c) => c.classSize === 6), 'class size on every card')
  const natasha = cards.find((c) => c.name === 'Natasha Zulu')
  assert(natasha.position === 1 && natasha.total === 110, 'position + total carried')
  assert(natasha.rows.length === 5, 'a row per subject')
  assert(natasha.rows[0].subject === 'MATHS' && natasha.rows[0].mark === 23 && natasha.rows[0].max === 25 && natasha.rows[0].percent === 92, 'subject row carries mark, max and percent')
  assert(natasha.maxTotal === 127, 'card knows the grand maximum')
  assert(natasha.averagePercent === 87, 'card average matches averagePercent')
  assert(natasha.comment.includes('Natasha'), 'class teacher comment lands on the card')
})
test('buildReportCards leaves missing marks blank, not zero', () => {
  const schedule = {
    header: {},
    subjects: SUBJECTS,
    pupils: buildSchedule([{ sn: 1, name: 'Absent Andy', marks: { maths: 10 } }], SUBJECTS),
  }
  const card = buildReportCards(schedule)[0]
  const english = card.rows.find((r) => r.subject === 'ENGLISH')
  assert(english.mark === '' && english.percent === 0, 'blank mark stays blank on the card')
  assert(card.rows.find((r) => r.subject === 'MATHS').mark === 10, 'entered mark intact')
})

console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
