#!/usr/bin/env node
/**
 * Tests for src/utils/registerValidationCore.js — the checks a term register
 * passes before it can be finalised, and who may do what to it.
 * Pure logic; no Firebase, no DOM.
 * Run: npm run test:register-validation  (also via npm run test:all)
 */

const {
  validateTermRegister,
  registerPermissions,
  REGISTER_STAGES,
} = await import('../src/features/register/lib/registerValidationCore.js')

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

const TERM = { startDate: '2026-05-11', endDate: '2026-08-07' }
const TODAY = '2026-05-15'

const LEARNERS = [
  { id: 'a', fullName: 'Alex Lobela', admissionNumber: 'ADM-001', status: 'active' },
  { id: 'b', fullName: 'Bright Kapaso', admissionNumber: 'ADM-002', status: 'active' },
]

function day(date, records = {}, over = {}) {
  return { date, markable: true, isFuture: false, classification: 'teaching_day', records, ...over }
}

const allPresent = { a: { status: 'present' }, b: { status: 'present' } }

const CLEAN_DAYS = [
  day('2026-05-11', allPresent),
  day('2026-05-12', allPresent),
  day('2026-05-13', allPresent),
]

function run(over = {}) {
  return validateTermRegister({
    learners: LEARNERS, days: CLEAN_DAYS, term: TERM, todayIso: TODAY, ...over,
  })
}

// ── a clean register ─────────────────────────────────────────────

console.log('\na clean register')

test('passes with no issues and reports what was checked', () => {
  const r = run()
  eq(r.errors.length, 0)
  eq(r.warnings.length, 0)
  eq(r.canFinalise, true)
  eq(r.checks.teachingDaysChecked, 3)
  eq(r.checks.learnersChecked, 2)
  eq(r.checks.activeLearners, 2)
})

test('an empty register is valid, not broken', () => {
  const r = validateTermRegister({})
  eq(r.canFinalise, true)
  eq(r.checks.teachingDaysChecked, 0)
})

// ── errors block ─────────────────────────────────────────────────

console.log('\nerrors — the register says something untrue')

test('attendance on a non-teaching day blocks finalisation', () => {
  const r = run({
    days: [...CLEAN_DAYS, day('2026-05-16', allPresent, { markable: false, classification: 'non_teaching_day' })],
  })
  const issue = r.errors.find((e) => e.code === 'marks_on_non_teaching_day')
  assert(issue, 'expected the holiday error')
  eq(issue.count, 2)
  eq(r.canFinalise, false)
})

test('a mark before a learner’s admission date blocks', () => {
  const r = run({
    learners: [{ ...LEARNERS[0], joinedClassOn: '2026-05-13' }, LEARNERS[1]],
  })
  const issue = r.errors.find((e) => e.code === 'marked_before_admission')
  assert(issue, 'expected the admission-window error')
  eq(r.canFinalise, false)
})

test('a mark after a learner left blocks', () => {
  const r = run({
    learners: [{ ...LEARNERS[0], leftClassOn: '2026-05-11' }, LEARNERS[1]],
  })
  assert(r.errors.some((e) => e.code === 'marked_after_leaving'))
})

test('the same learner enrolled twice blocks', () => {
  const r = run({
    learners: [...LEARNERS, { id: 'c', fullName: 'Alex L.', admissionNumber: 'ADM-001', status: 'active' }],
  })
  assert(r.errors.some((e) => e.code === 'duplicate_enrolment'))
  eq(r.canFinalise, false)
})

test('unsynchronised changes block, because the server holds the real register', () => {
  const r = run({ sync: { pendingCount: 4 } })
  const issue = r.errors.find((e) => e.code === 'unsynced_changes')
  assert(issue)
  eq(issue.count, 4)
  eq(r.canFinalise, false)
})

test('unresolved conflicts and rejected writes block separately', () => {
  assert(run({ sync: { conflictCount: 1 } }).errors.some((e) => e.code === 'unresolved_conflicts'))
  assert(run({ sync: { rejectedCount: 2 } }).errors.some((e) => e.code === 'rejected_changes'))
})

test('more marks than enrolled learners blocks', () => {
  const r = run({
    days: [day('2026-05-11', { a: { status: 'present' }, b: { status: 'present' }, ghost: { status: 'present' } })],
  })
  assert(r.errors.some((e) => e.code === 'impossible_totals'))
})

test('marks outside the term window block', () => {
  const r = run({ days: [...CLEAN_DAYS, day('2026-09-01', allPresent)] })
  assert(r.errors.some((e) => e.code === 'marks_outside_term'))
})

// ── warnings do not block ────────────────────────────────────────

console.log('\nwarnings — true but unfinished')

test('unmarked learners on a past day warn but never block', () => {
  const r = run({ days: [...CLEAN_DAYS, day('2026-05-14', { a: { status: 'present' } })] })
  const issue = r.warnings.find((w) => w.code === 'unmarked_learners')
  assert(issue, 'expected an unmarked warning')
  eq(issue.count, 1)
  eq(r.canFinalise, true, 'an incomplete register must still be filable (§19)')
})

test('a FUTURE teaching day is not incomplete', () => {
  const r = run({ days: [...CLEAN_DAYS, day('2026-06-01', {}, { isFuture: true })] })
  eq(r.warnings.filter((w) => w.code === 'unmarked_learners').length, 0)
})

test('a missing admission number warns, it does not block', () => {
  const r = run({ learners: [{ id: 'a', fullName: 'Alex Lobela', status: 'active' }, LEARNERS[1]] })
  assert(r.warnings.some((w) => w.code === 'missing_admission_numbers'))
  eq(r.canFinalise, true)
})

test('unconfirmed imported learners warn', () => {
  const r = run({ learners: [{ ...LEARNERS[0], needsReview: true }, LEARNERS[1]] })
  const issue = r.warnings.find((w) => w.code === 'unconfirmed_learners')
  assert(issue)
  eq(issue.count, 1)
})

test('a POSSIBLE duplicate warns; only a shared admission number blocks', () => {
  const r = run({
    learners: [...LEARNERS, { id: 'c', fullName: 'Alex Lobela', status: 'active' }],
  })
  assert(r.warnings.some((w) => w.code === 'possible_duplicate_learners'))
  eq(r.errors.filter((e) => e.code === 'duplicate_enrolment').length, 0)
  eq(r.canFinalise, true)
})

// ── information ──────────────────────────────────────────────────

console.log('\ninformation')

test('half-days and departed learners are stated without implying action', () => {
  const r = run({
    days: [...CLEAN_DAYS, day('2026-05-14', allPresent, { classification: 'half_day' })],
    learners: [...LEARNERS, { id: 'c', fullName: 'Ruth Mwila', admissionNumber: 'ADM-005', status: 'transferred' }],
  })
  assert(r.information.some((i) => i.code === 'half_days'))
  assert(r.information.some((i) => i.code === 'inactive_learners'))
  eq(r.canFinalise, true)
})

test('the three severities are kept separate', () => {
  const r = run({
    days: [
      ...CLEAN_DAYS,
      day('2026-05-14', { a: { status: 'present' } }),
      day('2026-05-16', allPresent, { markable: false }),
    ],
    learners: [{ id: 'a', fullName: 'Alex Lobela', status: 'active' }, LEARNERS[1]],
  })
  assert(r.errors.length > 0 && r.warnings.length > 0)
  assert(r.errors.every((e) => e.severity === 'error'))
  assert(r.warnings.every((w) => w.severity === 'warning'))
  eq(r.issues.length, r.errors.length + r.warnings.length + r.information.length)
})

// ── permissions ──────────────────────────────────────────────────

console.log('\npermissions')

test('a class teacher marks, notes and finalises their own register', () => {
  const p = registerPermissions({ role: 'teacher', isClassTeacher: true, stage: 'in_progress' })
  assert(p.canMarkAttendance && p.canAddNotes && p.canFinalise)
  eq(p.canApprove, false)
})

test('a SUBJECT teacher sees the class list but never edits daily attendance', () => {
  const p = registerPermissions({ role: 'teacher', isClassTeacher: false, stage: 'in_progress' })
  eq(p.canViewClassList, true)
  eq(p.canMarkAttendance, false, 'the official daily register belongs to the class teacher (§20)')
  eq(p.canFinalise, false)
})

test('a headteacher approves, returns and reopens but does not mark', () => {
  const submitted = registerPermissions({ role: 'headteacher', stage: 'submitted' })
  assert(submitted.canApprove && submitted.canReturnForCorrection)
  eq(submitted.canMarkAttendance, false)
  const approved = registerPermissions({ role: 'headteacher', stage: 'approved' })
  eq(approved.canReopen, true)
})

test('a submitted register is closed to its class teacher', () => {
  const p = registerPermissions({ role: 'teacher', isClassTeacher: true, stage: 'submitted' })
  eq(p.canMarkAttendance, false)
  eq(p.canFinalise, false)
})

test('an administrator manages classes and assignments; a teacher does not', () => {
  eq(registerPermissions({ role: 'admin' }).canManageClasses, true)
  eq(registerPermissions({ role: 'teacher', isClassTeacher: true }).canManageClasses, false)
})

test('every stage is declared', () => {
  eq(REGISTER_STAGES.map((s) => s.value).join(','),
    'in_progress,ready_for_review,submitted,approved,locked')
})

// ── summary ──────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nFailures:')
  failures.forEach((f) => console.log(`  - ${f.name}: ${f.message}`))
  process.exit(1)
}
