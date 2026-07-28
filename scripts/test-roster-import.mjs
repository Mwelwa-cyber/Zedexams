#!/usr/bin/env node
/**
 * Tests for the class-register roster importer: text/CSV parsing, header
 * detection, positional + bare-name modes, field normalisers, and the CSV
 * template. Pure logic — no Firebase, no DOM.
 * Run: npm run test:roster-import  (also via npm run test:all)
 */

const {
  ROSTER_HEADERS,
  GENDERS,
  ROSTER_STATUSES,
  buildRosterCsvTemplate,
  normalizeGender,
  normalizeStatus,
  normalizePhone,
  parseRosterText,
  rowsToRoster,
  validRosterEntries,
  rosterNameKey,
  partitionNewRosterEntries,
} = await import('../src/utils/rosterImport.js')

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
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed') }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || 'not equal'} — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`) }

// ── normalisers ──────────────────────────────────────────────────

console.log('\nnormalisers')

test('normalizeGender maps common synonyms', () => {
  eq(normalizeGender('M'), 'M')
  eq(normalizeGender('male'), 'M')
  eq(normalizeGender('Boy'), 'M')
  eq(normalizeGender('f'), 'F')
  eq(normalizeGender('Female'), 'F')
  eq(normalizeGender('girl'), 'F')
  eq(normalizeGender('x'), 'other')
  eq(normalizeGender(''), null)
  eq(normalizeGender(null), null)
})

test('normalizeStatus defaults blank to active', () => {
  eq(normalizeStatus(''), 'active')
  eq(normalizeStatus('Active'), 'active')
  eq(normalizeStatus('transferred'), 'transferred')
  eq(normalizeStatus('moved'), 'transferred')
  // 'inactive' was the single catch-all for "no longer in the class" before
  // the vocabulary widened; it now reads as the closest true statement.
  eq(normalizeStatus('inactive'), 'withdrawn')
  eq(normalizeStatus('dropped'), 'withdrawn')
  eq(normalizeStatus('graduated'), 'graduated')
  eq(normalizeStatus('deceased'), 'deceased')
  eq(normalizeStatus('nonsense'), 'active')
})

test('normalizePhone keeps + and digits, drops the rest', () => {
  eq(normalizePhone('0977 123 456'), '0977123456')
  eq(normalizePhone('+260-977-123456'), '+260977123456')
  eq(normalizePhone(''), null)
  eq(normalizePhone('   '), null)
})

test('exported enums are stable', () => {
  eq(GENDERS.join(','), 'M,F,other')
  eq(ROSTER_STATUSES.join(','), 'active,transferred,withdrawn,graduated,deceased')
  eq(ROSTER_HEADERS.join(','),
    'learnerNumber,admissionNumber,fullName,gender,parentPhone,admissionDate,status')
})

test('admission number is its own column, not folded into the list number', () => {
  const parsed = rowsToRoster([
    ['No.', 'Adm No.', 'Full name', 'Gender'],
    ['1', 'ADM-001', 'Mary Banda', 'F'],
  ])
  eq(parsed.headerDetected, true)
  eq(parsed.rows[0].entry.learnerNumber, '1')
  eq(parsed.rows[0].entry.admissionNumber, 'ADM-001')
})

test('admission dates are read day-first, as Zambian paperwork writes them', () => {
  const parsed = rowsToRoster([
    ['Name', 'Admission date'],
    ['Mary Banda', '03/04/2026'],
    ['John Phiri', '2026-01-12'],
    ['Grace Mwale', 'sometime last year'],
  ])
  eq(parsed.rows[0].entry.admissionDate, '2026-04-03', '03/04 is 3 April, not 4 March')
  eq(parsed.rows[1].entry.admissionDate, '2026-01-12')
  eq(parsed.rows[2].entry.admissionDate, null, 'an unreadable date is left blank…')
  assert(parsed.rows[2].warnings.some((w) => w.includes('could not be read')), '…and reported')
})

test('a shared admission number is a duplicate even when the names differ', () => {
  const { fresh, duplicates } = partitionNewRosterEntries(
    [{ fullName: 'C. Mulenga', admissionNumber: 'ADM-004' }],
    [{ fullName: 'Chanda Mulenga', admissionNumber: 'ADM-004' }],
  )
  eq(fresh.length, 0)
  eq(duplicates, 1)
})

// ── bare-name paste ──────────────────────────────────────────────

console.log('\nbare-name paste')

test('one name per line → fullName only, all active', () => {
  const parsed = parseRosterText('Mary Banda\nJohn Phiri\nGrace Mwale')
  eq(parsed.headerDetected, false)
  eq(parsed.rows.length, 3)
  eq(parsed.summary.ok, 3)
  eq(parsed.rows[0].entry.fullName, 'Mary Banda')
  eq(parsed.rows[0].entry.status, 'active')
  eq(parsed.rows[0].entry.gender, null)
})

test('leading numbering is split into learnerNumber', () => {
  const parsed = parseRosterText('1. Mary Banda\n2) John Phiri\n3 - Grace Mwale\n4  Peter Zulu')
  eq(parsed.rows.length, 4)
  eq(parsed.rows[0].entry.learnerNumber, '1')
  eq(parsed.rows[0].entry.fullName, 'Mary Banda')
  eq(parsed.rows[1].entry.learnerNumber, '2')
  eq(parsed.rows[1].entry.fullName, 'John Phiri')
  eq(parsed.rows[3].entry.learnerNumber, '4')
  eq(parsed.rows[3].entry.fullName, 'Peter Zulu')
})

test('blank lines are ignored', () => {
  const parsed = parseRosterText('Mary Banda\n\n\nJohn Phiri\n')
  eq(parsed.rows.length, 2)
})

// ── header mode ──────────────────────────────────────────────────

console.log('\nheader mode')

test('CSV with header maps columns in any order', () => {
  const csv = 'fullName,gender,parentPhone,status,learnerNumber\nMary Banda,F,0977123456,active,1\nJohn Phiri,M,,transferred,2'
  const parsed = parseRosterText(csv)
  eq(parsed.headerDetected, true)
  eq(parsed.rows.length, 2)
  const a = parsed.rows[0].entry
  eq(a.fullName, 'Mary Banda')
  eq(a.gender, 'F')
  eq(a.parentPhone, '0977123456')
  eq(a.status, 'active')
  eq(a.learnerNumber, '1')
  eq(parsed.rows[1].entry.status, 'transferred')
})

test('friendly header synonyms are recognised', () => {
  const csv = 'No.,Pupil Name,Sex,Parent Phone\n1,Mary Banda,F,0977\n2,John Phiri,M,'
  const parsed = parseRosterText(csv)
  eq(parsed.headerDetected, true)
  eq(parsed.rows[0].entry.learnerNumber, '1')
  eq(parsed.rows[0].entry.fullName, 'Mary Banda')
  eq(parsed.rows[0].entry.gender, 'F')
})

test('the downloadable template round-trips through the parser', () => {
  const parsed = parseRosterText(buildRosterCsvTemplate())
  eq(parsed.headerDetected, true)
  eq(parsed.summary.error, 0)
  assert(parsed.rows.length >= 3, 'template should include example rows')
})

// ── positional (no header) ───────────────────────────────────────

console.log('\npositional mode')

test('tab-separated Excel paste with leading number column', () => {
  const text = '1\tMary Banda\tF\t0977123456\n2\tJohn Phiri\tM\t'
  const parsed = parseRosterText(text)
  eq(parsed.headerDetected, false)
  eq(parsed.rows[0].entry.learnerNumber, '1')
  eq(parsed.rows[0].entry.fullName, 'Mary Banda')
  eq(parsed.rows[0].entry.gender, 'F')
  eq(parsed.rows[0].entry.parentPhone, '0977123456')
})

test('comma columns without a number column treat col0 as name', () => {
  const text = 'Mary Banda,F,0977\nJohn Phiri,M,'
  const parsed = parseRosterText(text)
  eq(parsed.headerDetected, false)
  eq(parsed.rows[0].entry.fullName, 'Mary Banda')
  eq(parsed.rows[0].entry.gender, 'F')
})

// ── validation ───────────────────────────────────────────────────

console.log('\nvalidation')

test('missing name is an error row, excluded from valid entries', () => {
  const csv = 'learnerNumber,fullName,gender\n1,Mary Banda,F\n2,,M'
  const parsed = parseRosterText(csv)
  eq(parsed.summary.error, 1)
  eq(parsed.summary.ok, 1)
  const valid = validRosterEntries(parsed)
  eq(valid.length, 1)
  eq(valid[0].fullName, 'Mary Banda')
})

test('unrecognised gender warns but still imports as other', () => {
  const csv = 'fullName,gender\nMary Banda,unicorn'
  const parsed = parseRosterText(csv)
  eq(parsed.rows[0].status, 'warning')
  eq(parsed.rows[0].entry.gender, 'other')
  eq(validRosterEntries(parsed).length, 1)
})

test('rowsToRoster handles an empty grid', () => {
  const parsed = rowsToRoster([])
  eq(parsed.rows.length, 0)
  eq(parsed.summary.total, 0)
})

// ── duplicate detection ──────────────────────────────────────────

console.log('\nduplicate detection')

test('rosterNameKey collapses case + whitespace', () => {
  eq(rosterNameKey('  Mary   Banda '), 'mary banda')
  eq(rosterNameKey('MARY BANDA'), 'mary banda')
  eq(rosterNameKey(null), '')
})

test('existing names are skipped, new ones kept', () => {
  const existing = [{ fullName: 'Mary Banda', linkedUid: null }]
  const { fresh, duplicates } = partitionNewRosterEntries(
    [{ fullName: 'mary  banda' }, { fullName: 'John Phiri' }],
    existing,
  )
  eq(duplicates, 1)
  eq(fresh.length, 1)
  eq(fresh[0].fullName, 'John Phiri')
})

test('linkedUid match is a duplicate even when names differ', () => {
  const existing = [{ fullName: 'Old Name', linkedUid: 'uid-1' }]
  const { fresh, duplicates } = partitionNewRosterEntries(
    [{ fullName: 'New Name', linkedUid: 'uid-1' }, { fullName: 'Other', linkedUid: 'uid-2' }],
    existing,
  )
  eq(duplicates, 1)
  eq(fresh.length, 1)
  eq(fresh[0].linkedUid, 'uid-2')
})

test('repeats WITHIN one import are de-duplicated', () => {
  const { fresh, duplicates } = partitionNewRosterEntries(
    [{ fullName: 'Grace Mwale' }, { fullName: 'grace mwale' }, { fullName: 'Grace Mwale' }],
    [],
  )
  eq(duplicates, 2)
  eq(fresh.length, 1)
})

test('empty / non-array inputs never throw', () => {
  eq(partitionNewRosterEntries([], []).fresh.length, 0)
  eq(partitionNewRosterEntries(undefined, undefined).duplicates, 0)
  eq(partitionNewRosterEntries([{ fullName: 'A' }]).fresh.length, 1)
})

// ── summary ──────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nFailures:')
  failures.forEach((f) => console.log(`  - ${f.name}: ${f.message}`))
  process.exit(1)
}
