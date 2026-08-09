#!/usr/bin/env node
/* global console, process */
/**
 * Unit tests for the cross-timetable conflict engine
 * (src/features/classTimetable/lib/timetableConflictEngine.js): sibling scope, exact-time
 * normalisation, the interval-overlap rule, teacher / room / class
 * conflicts, double periods, legacy-data coverage, deterministic ids and
 * stale-sibling detection. Pure objects only — no Firestore.
 *
 * Plain `node` script that throws on failure, per repo convention.
 * Run: npm run test:timetable-conflicts   (also via npm run test:all)
 */
import {
  SHARED_FACILITIES,
  intervalsOverlap,
  isSiblingTimetableCandidate,
  normaliseTimetableForConflictCheck,
  normaliseBlockTime,
  createConflictId,
  findCrossTimetableConflicts,
  groupConflictsForDisplay,
  summariseConflicts,
  blockingConflicts,
  changedSiblingsSince,
} from '../src/features/classTimetable/lib/timetableConflictEngine.js'
import { buildPeriods, buildTimetableArtifact, DEFAULT_DAYS } from '../src/shared/utils/classTimetable.js'
import { makeBlock, setBlockDetails } from '../src/shared/utils/timetableBlocks.js'

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

/* Shared fixtures: a 40-min day starting 07:35 (P1 08:15 after assembly…
 * actually P1 07:35) and a DIFFERENT school-day shape for the sibling. */
const PERIODS_A = buildPeriods({
  startTime: '07:35', periodMinutes: 40, lessonPeriods: 8,
  breaks: [{ afterPeriod: 4, minutes: 20, name: 'BREAK', event: 'break' }],
})
// Sibling school day: different reporting time AND 35-min periods.
const PERIODS_B = buildPeriods({
  startTime: '08:00', periodMinutes: 35, lessonPeriods: 8,
  breaks: [{ afterPeriod: 4, minutes: 30, name: 'BREAK', event: 'break' }],
})

function artifactWith({ header, periods, blocks }) {
  return buildTimetableArtifact({
    header,
    days: DEFAULT_DAYS,
    periods,
    blocks,
  })
}

function normalised({ id = 't-current', header = {}, periods = PERIODS_A, blocks = [] }) {
  return normaliseTimetableForConflictCheck({
    id,
    output: artifactWith({
      header: { school: 'Chilenje Primary', year: '2026', term: 1, className: 'Grade 5 Blue', grade: 'G5', ...header },
      periods,
      blocks,
    }),
  })
}

/* ── interval rule ────────────────────────────────────────────── */

test('boundary-touching periods do NOT overlap; partial overlaps and containment DO', () => {
  // 08:15–08:55 vs 08:55–09:35 — consecutive.
  assert(!intervalsOverlap(495, 535, 535, 575), 'consecutive periods are not a conflict')
  // 08:15–08:55 vs 08:45–09:25 — partial overlap.
  assert(intervalsOverlap(495, 535, 525, 565), 'partial overlap conflicts')
  // 08:15–09:35 contains 08:55–09:15.
  assert(intervalsOverlap(495, 575, 535, 555), 'containment conflicts')
  assert(intervalsOverlap(535, 555, 495, 575), 'containment conflicts (either order)')
})

/* ── sibling scope ────────────────────────────────────────────── */

test('sibling scope: same school+term+year in, different school/term/year/current/archived out', () => {
  const current = { timetableId: 'cur', school: 'Chilenje Primary', year: '2026', term: '1' }
  const ok = (candidate) => isSiblingTimetableCandidate({ current, candidate })
  assert(ok({ timetableId: 'x', school: 'chilenje  primary', year: '2026', term: '1' }), 'same context (case/space-insensitive school) is a sibling')
  assert(!ok({ timetableId: 'cur', school: 'Chilenje Primary', year: '2026', term: '1' }), 'the current timetable is excluded')
  assert(!ok({ timetableId: 'x', school: 'Kabwata Primary', year: '2026', term: '1' }), 'different school excluded')
  assert(!ok({ timetableId: 'x', school: 'Chilenje Primary', year: '2025', term: '1' }), 'different year excluded')
  assert(!ok({ timetableId: 'x', school: 'Chilenje Primary', year: '2026', term: '2' }), 'different term excluded')
  assert(!ok({ timetableId: 'x', school: 'Chilenje Primary', year: '2026', term: '1', status: 'archived' }), 'archived excluded')
  assert(!ok({ timetableId: 'x', school: 'Chilenje Primary', year: '2026', term: '1', status: 'deleted' }), 'deleted excluded')
  assert(ok({ timetableId: 'x', school: 'Chilenje Primary', year: '2026', term: '' }), 'legacy sibling with no recorded term stays in scope')
})

/* ── time normalisation ───────────────────────────────────────── */

test('blocks normalise to exact minutes from their OWN timetable structure', () => {
  const t = normalised({
    blocks: [
      makeBlock({ day: 'Monday', startSlot: 1, length: 1, label: 'English Language' }),
      makeBlock({ day: 'Monday', startSlot: 5, length: 1, label: 'Science' }), // after the break
    ],
  })
  const [p1, p5] = t.scheduleBlocks
  assert(p1.startMinutes === 7 * 60 + 35 && p1.endMinutes === 8 * 60 + 15, `P1 07:35–08:15, got ${p1.startTime}–${p1.endTime}`)
  // P5 = 07:35 + 4×40 + 20 break = 10:35.
  assert(p5.startMinutes === 10 * 60 + 35, `P5 starts 10:35 after the break, got ${p5.startTime}`)
  assert(p1.timeReview === false, 'clean blocks are not flagged')
})

test('different reporting times and period lengths produce different clock times for the same slot', () => {
  const a = normalised({ blocks: [makeBlock({ day: 'Monday', startSlot: 2, length: 1, label: 'Maths' })] })
  const b = normalised({ id: 't-sib', periods: PERIODS_B, blocks: [makeBlock({ day: 'Monday', startSlot: 2, length: 1, label: 'Maths' })] })
  assert(a.scheduleBlocks[0].startMinutes !== b.scheduleBlocks[0].startMinutes,
    '"Period 2" is not assumed to be the same clock time across timetables')
  assert(b.scheduleBlocks[0].startMinutes === 8 * 60 + 35, `sibling P2 = 08:35, got ${b.scheduleBlocks[0].startTime}`)
})

test('a double period normalises across its FULL time range', () => {
  const t = normalised({ blocks: [makeBlock({ day: 'Monday', startSlot: 1, length: 2, label: 'Science' })] })
  const dbl = t.scheduleBlocks[0]
  assert(dbl.endMinutes - dbl.startMinutes === 80, `double spans 80 minutes, got ${dbl.endMinutes - dbl.startMinutes}`)
})

test('a block that cannot be timed is flagged for review, never silently dropped', () => {
  const t = normaliseTimetableForConflictCheck({
    id: 'legacy',
    output: {
      header: { school: 'Chilenje Primary', year: '2026', term: 1 },
      periods: [], // no rows at all
      blocks: [makeBlock({ day: 'Monday', startSlot: 3, length: 1, label: 'Maths' })],
    },
  })
  assert(t.scheduleBlocks.length === 1, 'the block is kept')
  assert(t.scheduleBlocks[0].timeReview === true, 'flagged: time structure needs review')
  const single = normaliseBlockTime({ block: { day: 'Monday', startSlot: 3, length: 1 }, periods: [] })
  assert(single.timeReview === true && single.startMinutes === null, 'standalone helper flags too')
})

/* ── teacher conflicts ────────────────────────────────────────── */

const T_UID = 'uid_mahenga'
function stamped(block, details) {
  return setBlockDetails([block], block.blockId, details)[0]
}

test('same teacherId + overlapping times across two classes = error conflict', () => {
  const cur = normalised({
    blocks: [stamped(
      makeBlock({ day: 'Monday', startSlot: 2, length: 1, label: 'English Language' }),
      { teacher: 'Mahenga Mwelwa', teacherId: T_UID, assignmentId: 'a1' },
    )],
  })
  // Sibling P2 (08:35–09:10) overlaps current P2 (08:15–08:55).
  const sib = normalised({
    id: 't-sib',
    header: { className: 'Grade 6 Green', grade: 'G6' },
    periods: PERIODS_B,
    blocks: [stamped(
      makeBlock({ day: 'Monday', startSlot: 2, length: 1, label: 'Mathematics' }),
      { teacher: 'Mahenga Mwelwa', teacherId: T_UID, assignmentId: 'a2' },
    )],
  })
  const { conflicts } = findCrossTimetableConflicts({ currentTimetable: cur, siblingTimetables: [sib] })
  const teacher = conflicts.filter((c) => c.type === 'teacher')
  assert(teacher.length === 1, `expected 1 teacher conflict, got ${teacher.length}`)
  assert(teacher[0].severity === 'error' && teacher[0].teacherId === T_UID, 'error severity with canonical id')
  assert(/Mahenga Mwelwa.*Grade 5 Blue.*Grade 6 Green|Grade 6 Green/.test(teacher[0].message), `message names both classes: ${teacher[0].message}`)
  assert(/08:35/.test(teacher[0].message) && /08:55/.test(teacher[0].message), `message carries the overlap window: ${teacher[0].message}`)
})

test('different teachers, different days and boundary-touching periods never conflict', () => {
  const engA = stamped(makeBlock({ day: 'Monday', startSlot: 1, length: 1, label: 'English' }), { teacherId: 'uid_a', teacher: 'A' })
  const cur = normalised({ blocks: [engA] })
  const sibDifferentTeacher = normalised({
    id: 's1', header: { className: '6A' },
    blocks: [stamped(makeBlock({ day: 'Monday', startSlot: 1, length: 1, label: 'Maths' }), { teacherId: 'uid_b', teacher: 'B' })],
  })
  const sibDifferentDay = normalised({
    id: 's2', header: { className: '6B' },
    blocks: [stamped(makeBlock({ day: 'Tuesday', startSlot: 1, length: 1, label: 'Maths' }), { teacherId: 'uid_a', teacher: 'A' })],
  })
  // Same timetable structure → P2 starts exactly when P1 ends.
  const sibBoundary = normalised({
    id: 's3', header: { className: '6C' },
    blocks: [stamped(makeBlock({ day: 'Monday', startSlot: 2, length: 1, label: 'Maths' }), { teacherId: 'uid_a', teacher: 'A' })],
  })
  for (const [sib, why] of [[sibDifferentTeacher, 'different teachers'], [sibDifferentDay, 'different days'], [sibBoundary, 'boundary touch']]) {
    const { conflicts } = findCrossTimetableConflicts({ currentTimetable: cur, siblingTimetables: [sib] })
    assert(conflicts.filter((c) => c.type === 'teacher').length === 0, `${why} must not conflict`)
  }
})

test('a double period conflicts with a sibling block inside EITHER half', () => {
  const cur = normalised({
    blocks: [stamped(makeBlock({ day: 'Monday', startSlot: 1, length: 2, label: 'Science' }), { teacherId: T_UID, teacher: 'M' })],
  })
  // Current double: 07:35–08:55. Sibling P2 on PERIODS_B: 08:35–09:10 —
  // inside the SECOND half of the double.
  const sib = normalised({
    id: 's-dbl', periods: PERIODS_B, header: { className: '6D' },
    blocks: [stamped(makeBlock({ day: 'Monday', startSlot: 2, length: 1, label: 'Maths' }), { teacherId: T_UID, teacher: 'M' })],
  })
  const { conflicts } = findCrossTimetableConflicts({ currentTimetable: cur, siblingTimetables: [sib] })
  assert(conflicts.some((c) => c.type === 'teacher' && c.severity === 'error'),
    'the second half of a double still conflicts — the full range is occupied')
})

test('display-name similarity without ids is a warning, never a confirmed conflict', () => {
  const cur = normalised({
    blocks: [stamped(makeBlock({ day: 'Monday', startSlot: 1, length: 1, label: 'English' }), { teacher: 'Mr Banda' })],
  })
  const sib = normalised({
    id: 's-name', header: { className: '6E' },
    blocks: [stamped(makeBlock({ day: 'Monday', startSlot: 1, length: 1, label: 'Maths' }), { teacher: 'mr  banda' })],
  })
  const { conflicts, coverage } = findCrossTimetableConflicts({ currentTimetable: cur, siblingTimetables: [sib] })
  const teacher = conflicts.filter((c) => c.type === 'teacher')
  assert(teacher.length === 1 && teacher[0].severity === 'warning' && teacher[0].identityUnverified,
    'name-only match → unverified warning')
  assert(coverage.status === 'partial' && coverage.legacyTeacherNameBlocks === 2,
    `coverage is partial with 2 legacy name blocks, got ${coverage.status}/${coverage.legacyTeacherNameBlocks}`)
  // One side stamped with an id + the other name-only must NOT auto-match.
  const curId = normalised({
    blocks: [stamped(makeBlock({ day: 'Monday', startSlot: 1, length: 1, label: 'English' }), { teacher: 'Mr Banda', teacherId: 'uid_banda' })],
  })
  const r2 = findCrossTimetableConflicts({ currentTimetable: curId, siblingTimetables: [sib] })
  assert(r2.conflicts.filter((c) => c.type === 'teacher' && c.severity === 'error').length === 0,
    'id-vs-name is never a confirmed conflict')
})

/* ── room conflicts ───────────────────────────────────────────── */

test('same canonical roomId + overlap = error; shareable facilities warn; different rooms pass', () => {
  const lab = SHARED_FACILITIES.find((f) => f.id === 'science-lab')
  assert(lab && !lab.shareable, 'science lab is a non-shareable facility')
  const cur = normalised({
    blocks: [stamped(makeBlock({ day: 'Monday', startSlot: 1, length: 1, label: 'Science' }), { room: lab.label, roomId: lab.id })],
  })
  const sibSameRoom = normalised({
    id: 's-room', header: { className: '6F' },
    blocks: [stamped(makeBlock({ day: 'Monday', startSlot: 1, length: 1, label: 'Science' }), { room: lab.label, roomId: lab.id })],
  })
  const sibOtherRoom = normalised({
    id: 's-room2', header: { className: '6G' },
    blocks: [stamped(makeBlock({ day: 'Monday', startSlot: 1, length: 1, label: 'ICT' }), { room: 'Computer laboratory', roomId: 'computer-lab' })],
  })
  const r1 = findCrossTimetableConflicts({ currentTimetable: cur, siblingTimetables: [sibSameRoom] })
  assert(r1.conflicts.some((c) => c.type === 'room' && c.severity === 'error'), 'same lab double-booked → error')
  const r2 = findCrossTimetableConflicts({ currentTimetable: cur, siblingTimetables: [sibOtherRoom] })
  assert(r2.conflicts.filter((c) => c.type === 'room').length === 0, 'different canonical rooms never conflict')

  // Shareable facility (library) → warning per configured rules.
  const shareable = normalised({
    blocks: [stamped(makeBlock({ day: 'Monday', startSlot: 1, length: 1, label: 'Reading' }), { room: 'Library', roomId: 'library' })],
  })
  const sibShareable = normalised({
    id: 's-lib', header: { className: '6H' },
    blocks: [stamped(makeBlock({ day: 'Monday', startSlot: 1, length: 1, label: 'Reading' }), { room: 'Library', roomId: 'library' })],
  })
  const r3 = findCrossTimetableConflicts({ currentTimetable: shareable, siblingTimetables: [sibShareable] })
  const roomC = r3.conflicts.filter((c) => c.type === 'room')
  assert(roomC.length === 1 && roomC[0].severity === 'warning', 'shareable facility overlap is a warning')
})

test('free-text room labels match at warning level only, and count toward partial coverage', () => {
  const cur = normalised({
    blocks: [stamped(makeBlock({ day: 'Monday', startSlot: 1, length: 1, label: 'Science' }), { room: 'Room 12' })],
  })
  const sib = normalised({
    id: 's-freetext', header: { className: '6I' },
    blocks: [stamped(makeBlock({ day: 'Monday', startSlot: 1, length: 1, label: 'Maths' }), { room: 'room  12' })],
  })
  const { conflicts, coverage } = findCrossTimetableConflicts({ currentTimetable: cur, siblingTimetables: [sib] })
  const room = conflicts.filter((c) => c.type === 'room')
  assert(room.length === 1 && room[0].severity === 'warning' && room[0].identityUnverified,
    'label-only room match is an unverified warning')
  assert(coverage.labelOnlyRoomBlocks === 2 && coverage.status === 'partial', 'coverage reports label-only room blocks')
})

/* ── class conflicts (internal) ───────────────────────────────── */

test('overlapping blocks inside the current class conflict even with no siblings', () => {
  // Legacy-style duplicate occupancy: same day + same slot from a raw doc.
  const clash = [
    makeBlock({ day: 'Monday', startSlot: 1, length: 2, label: 'Science' }),
    { ...makeBlock({ day: 'Monday', startSlot: 2, length: 1, label: 'Maths' }), blockId: 'legacy_dup' },
  ]
  const cur = normalised({ blocks: clash })
  const { conflicts } = findCrossTimetableConflicts({ currentTimetable: cur, siblingTimetables: [] })
  const cls = conflicts.filter((c) => c.type === 'class')
  assert(cls.length === 1 && cls[0].severity === 'error', `internal overlap detected: got ${cls.length}`)
  assert(/Science|Maths/.test(cls[0].message), 'message names the overlapping lessons')
})

test('a normal non-overlapping week produces zero class conflicts (breaks handled)', () => {
  const cur = normalised({
    blocks: [
      makeBlock({ day: 'Monday', startSlot: 4, length: 1, label: 'English' }),
      makeBlock({ day: 'Monday', startSlot: 5, length: 1, label: 'Maths' }), // across the break — consecutive rows, no overlap
    ],
  })
  const { conflicts } = findCrossTimetableConflicts({ currentTimetable: cur, siblingTimetables: [] })
  assert(conflicts.length === 0, `no false positives across breaks: ${JSON.stringify(conflicts.map((c) => c.message))}`)
})

test('a second saved timetable for the SAME class in the same context is flagged as a likely duplicate', () => {
  const cur = normalised({ blocks: [makeBlock({ day: 'Monday', startSlot: 1, length: 1, label: 'English' })] })
  const dup = normalised({ id: 't-dup', blocks: [] }) // same className + grade
  const { conflicts } = findCrossTimetableConflicts({ currentTimetable: cur, siblingTimetables: [dup] })
  assert(conflicts.some((c) => c.type === 'class' && c.severity === 'warning' && /duplicate/.test(c.message)),
    'duplicate-class warning raised')
})

/* ── ids, grouping, policies, staleness ───────────────────────── */

test('conflict ids are deterministic across re-runs', () => {
  const cur = normalised({
    blocks: [stamped(makeBlock({ day: 'Monday', startSlot: 1, length: 1, label: 'English' }), { teacherId: T_UID, teacher: 'M' })],
  })
  const sib = normalised({
    id: 's-id', header: { className: '6J' },
    blocks: [stamped(makeBlock({ day: 'Monday', startSlot: 1, length: 1, label: 'Maths' }), { teacherId: T_UID, teacher: 'M' })],
  })
  const run1 = findCrossTimetableConflicts({ currentTimetable: cur, siblingTimetables: [sib] })
  const run2 = findCrossTimetableConflicts({ currentTimetable: cur, siblingTimetables: [sib] })
  assert(run1.conflicts[0].conflictId === run2.conflicts[0].conflictId, 'same unresolved conflict → same id')
  assert(createConflictId({ type: 'teacher', currentTimetableId: 'a', currentBlockId: 'b', siblingTimetableId: 'c', siblingBlockId: 'd' })
    === createConflictId({ type: 'teacher', currentTimetableId: 'a', currentBlockId: 'b', siblingTimetableId: 'c', siblingBlockId: 'd' }),
    'id factory is pure')
})

test('grouping, summary and publish policy behave as configured', () => {
  const conflicts = [
    { conflictId: '1', type: 'teacher', severity: 'error' },
    { conflictId: '2', type: 'teacher', severity: 'warning', identityUnverified: true },
    { conflictId: '3', type: 'room', severity: 'error' },
    { conflictId: '4', type: 'class', severity: 'warning' },
  ]
  const groups = groupConflictsForDisplay(conflicts)
  assert(groups.teacher.length === 1 && groups.review.length === 1, 'unverified items group under review')
  const s = summariseConflicts(conflicts)
  assert(s.errors === 2 && s.warnings === 2 && s.teacher === 1 && s.room === 1 && s.class === 0, `summary counts: ${JSON.stringify(s)}`)
  assert(blockingConflicts(conflicts).length === 2, 'only error-level conflicts block a final save')
})

test('changedSiblingsSince detects updated and new siblings by their own stamps', () => {
  const before = [
    { timetableId: 'a', displayTitle: 'Grade 6 Green', savedAt: '2026-07-16T10:00:00Z' },
    { timetableId: 'b', displayTitle: 'Grade 4 Red', savedAt: '2026-07-16T10:00:00Z' },
  ]
  const after = [
    { timetableId: 'a', displayTitle: 'Grade 6 Green', savedAt: '2026-07-16T11:30:00Z' }, // updated
    { timetableId: 'b', displayTitle: 'Grade 4 Red', savedAt: '2026-07-16T10:00:00Z' },   // unchanged
    { timetableId: 'c', displayTitle: 'Grade 7 Gold', savedAt: '2026-07-16T11:00:00Z' },  // new
  ]
  const changed = changedSiblingsSince(before, after)
  assert(changed.length === 2 && changed.includes('Grade 6 Green') && changed.includes('Grade 7 Gold'),
    `changed siblings: ${JSON.stringify(changed)}`)
})

test('coverage is complete only when every block carries verifiable identities and times', () => {
  const cur = normalised({
    blocks: [stamped(makeBlock({ day: 'Monday', startSlot: 1, length: 1, label: 'English' }), { teacherId: T_UID, teacher: 'M' })],
  })
  const clean = findCrossTimetableConflicts({ currentTimetable: cur, siblingTimetables: [] })
  assert(clean.coverage.status === 'complete', `clean data → complete, got ${clean.coverage.status}`)
  assert(clean.coverage.blocksChecked === 1 && clean.coverage.blocksWithTeacherIds === 1, 'block counts reported')
})

console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
