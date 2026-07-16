// My Teaching Timetable core — plain-node tests (npm run test:teacher-timetable).
import assert from 'node:assert/strict'
import {
  TT_SCHEMA_VERSION,
  normalizeTtBlock,
  normalizeTeacherTimetable,
  isTimetableV2,
  migrateTimetableV1,
  matchLegacyEntry,
  blockRange,
  blocksOverlap,
  computeConflicts,
  computeCoverage,
  computeWorkload,
  validateManualBlock,
  nextBlockId,
  linkKey,
  buildImportCandidates,
  candidateToBlock,
  mergeImportedBlocks,
  reconcileLinkedBlocks,
  buildTtGridModel,
  blocksByDay,
  formatTeachingMinutes,
} from '../src/utils/teacherTimetableCore.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

// Fixture assignments — one CBC Upper Primary (40 min), one CBC Lower Primary
// (30 min), one invalid legacy combination (G7 doesn't exist under the CBC).
const A_ENG = {
  id: 'a_eng', grade: 'G5', subject: 'english', className: 'Grade 5 Blue',
  curriculumType: 'cbc', periodsPerWeek: 6, lessonDurationMinutes: 40, isActive: true,
}
const A_LIT = {
  id: 'a_lit', grade: 'G2', subject: 'literacy', className: '',
  curriculumType: 'cbc', periodsPerWeek: 4, lessonDurationMinutes: 30, isActive: true,
}
const A_BAD = {
  id: 'a_bad', grade: 'G7', subject: 'mathematics', className: '',
  curriculumType: 'cbc', periodsPerWeek: 5, lessonDurationMinutes: 40, isActive: true,
}
const ASSIGNMENTS = [A_ENG, A_LIT, A_BAD]

function block(over = {}) {
  return normalizeTtBlock({
    blockId: 'tb_x', day: 'mon', startTime: '08:15', endTime: '08:55',
    assignmentId: 'a_eng', sourceType: 'manual', ...over,
  })
}

console.log('normalizeTtBlock')
test('derives duration from start/end (stale stored value ignored)', () => {
  const b = block({ durationMinutes: 999 })
  assert.equal(b.durationMinutes, 40)
})
test('double blockType is derived from lengthInPeriods', () => {
  assert.equal(block({ lengthInPeriods: 2 }).blockType, 'double')
  assert.equal(block({ lengthInPeriods: 1 }).blockType, 'single')
})
test('class-timetable blocks default to locked', () => {
  assert.equal(normalizeTtBlock({ sourceType: 'class-timetable', startTime: '08:00', endTime: '08:40' }).locked, true)
  assert.equal(block().locked, false)
})
test('invalid day/times are coerced safely', () => {
  const b = normalizeTtBlock({ day: 'sun', startTime: '99:99', endTime: 'later' })
  assert.equal(b.day, 'mon')
  assert.equal(b.startTime, '')
  assert.equal(b.durationMinutes, null)
})

console.log('document + v1 migration')
test('v2 detection', () => {
  assert.equal(isTimetableV2({ schemaVersion: 2 }), true)
  assert.equal(isTimetableV2({ periodMinutes: 40, days: {} }), false)
})
const V1 = {
  periodMinutes: 40,
  days: {
    mon: [
      { start: '08:15', end: '08:55', subject: 'english', grade: 'G5', label: '' },
      { start: '10:00', end: '', subject: 'integrated_science', grade: 'G7', label: 'Sci' },
    ],
    tue: [{ start: '08:15', end: '08:45', subject: 'literacy', grade: 'G2', label: '' }],
  },
}
test('migration preserves every legacy period and the original v1 value', () => {
  const v2 = migrateTimetableV1(V1, ASSIGNMENTS)
  assert.equal(v2.schemaVersion, TT_SCHEMA_VERSION)
  assert.equal(v2.scheduleBlocks.length, 3)
  assert.equal(v2.defaultPeriodLengthMinutes, 40)
  assert.deepEqual(v2.legacyV1.days.mon[0].subject, 'english')
  assert.equal(v2.displayPreferences.timetableLayout, 'days-as-columns')
})
test('confident match links the assignment; different durations survive', () => {
  const v2 = migrateTimetableV1(V1, ASSIGNMENTS)
  const eng = v2.scheduleBlocks.find((b) => b.blockId === 'tb_legacy_mon_1')
  assert.equal(eng.assignmentId, 'a_eng')
  assert.equal(eng.migrationState, '')
  const lit = v2.scheduleBlocks.find((b) => b.blockId === 'tb_legacy_tue_1')
  assert.equal(lit.assignmentId, 'a_lit')
  assert.equal(lit.durationMinutes, 30)
  assert.equal(eng.durationMinutes, 40)
})
test('unmatched legacy entry is preserved as needs-review with original values', () => {
  const v2 = migrateTimetableV1(V1, ASSIGNMENTS)
  const sci = v2.scheduleBlocks.find((b) => b.blockId === 'tb_legacy_mon_2')
  assert.equal(sci.migrationState, 'needs-review')
  assert.equal(sci.assignmentId, '')
  assert.deepEqual(sci.originalValues, { subject: 'integrated_science', grade: 'G7', label: 'Sci' })
  // Missing end time is filled from the v1 global period length.
  assert.equal(sci.endTime, '10:40')
})
test('migration is idempotent (v2 in → same v2 out, no duplicates)', () => {
  const once = migrateTimetableV1(V1, ASSIGNMENTS)
  const twice = migrateTimetableV1(once, ASSIGNMENTS)
  assert.deepEqual(twice, normalizeTeacherTimetable(once))
  assert.equal(twice.scheduleBlocks.length, 3)
})
test('a match to an INVALID assignment is not confident', () => {
  const { confident } = matchLegacyEntry({ subject: 'mathematics', grade: 'G7' }, ASSIGNMENTS)
  assert.equal(confident, false)
})
test('an ambiguous match (two candidate assignments) is not confident', () => {
  const twin = { ...A_ENG, id: 'a_eng2', className: 'Grade 5 Green' }
  const { confident } = matchLegacyEntry({ subject: 'english', grade: 'G5' }, [A_ENG, twin])
  assert.equal(confident, false)
})

console.log('overlaps')
test('exact overlap detected', () => {
  assert.equal(blocksOverlap(block(), block({ blockId: 'tb_y' })), true)
})
test('partial overlap detected (08:15–08:55 vs 08:45–09:25)', () => {
  assert.equal(blocksOverlap(block(), block({ blockId: 'tb_y', startTime: '08:45', endTime: '09:25' })), true)
})
test('back-to-back periods are consecutive, NOT overlapping', () => {
  assert.equal(blocksOverlap(block(), block({ blockId: 'tb_y', startTime: '08:55', endTime: '09:35' })), false)
})
test('same times on different days do not overlap', () => {
  assert.equal(blocksOverlap(block(), block({ blockId: 'tb_y', day: 'tue' })), false)
})
test('an overlap inside one half of a double block is detected', () => {
  const dbl = block({ blockId: 'tb_d', startTime: '08:15', endTime: '09:35', lengthInPeriods: 2 })
  const inner = block({ blockId: 'tb_i', startTime: '08:55', endTime: '09:35' })
  assert.equal(blocksOverlap(dbl, inner), true)
})

console.log('conflicts')
test('overlap conflict is reported with both blocks and a readable message', () => {
  const conflicts = computeConflicts({
    blocks: [block(), block({ blockId: 'tb_y', startTime: '08:45', endTime: '09:25', assignmentId: 'a_lit' })],
    assignments: ASSIGNMENTS,
  })
  const overlap = conflicts.find((c) => c.type === 'overlap')
  assert.ok(overlap)
  assert.deepEqual(overlap.blockIds, ['tb_x', 'tb_y'])
  assert.match(overlap.message, /overlaps/)
})
test('linked-vs-manual overlap keeps both records and says so', () => {
  const conflicts = computeConflicts({
    blocks: [
      block(),
      block({ blockId: 'tb_l', sourceType: 'class-timetable', classTimetableId: 'ct1', scheduleBlockId: 'b1' }),
    ],
    assignments: ASSIGNMENTS,
  })
  const c = conflicts.find((x) => x.type === 'linked-overlap')
  assert.ok(c)
  assert.match(c.message, /Both are kept/)
})
test('missing + invalid assignment references are conflicts', () => {
  const conflicts = computeConflicts({
    blocks: [
      block({ blockId: 'tb_gone', assignmentId: 'a_deleted' }),
      block({ blockId: 'tb_bad', assignmentId: 'a_bad', startTime: '10:00', endTime: '10:40' }),
    ],
    assignments: ASSIGNMENTS,
  })
  assert.equal(conflicts.filter((c) => c.type === 'invalid-assignment').length, 2)
  assert.match(conflicts.find((c) => c.blockIds.includes('tb_bad')).message, /curriculum validation/)
})
test('room double-booking is a warning', () => {
  const conflicts = computeConflicts({
    blocks: [
      block({ roomId: 'Science Lab' }),
      block({ blockId: 'tb_y', roomId: 'science lab', assignmentId: 'a_lit' }),
    ],
    assignments: ASSIGNMENTS,
  })
  const room = conflicts.find((c) => c.type === 'room-clash')
  assert.equal(room.severity, 'warning')
})

console.log('coverage + workload')
const WEEK = [
  block({ blockId: 'b1', day: 'mon', startTime: '08:15', endTime: '09:35', lengthInPeriods: 2 }), // double = 2 periods
  block({ blockId: 'b2', day: 'tue', startTime: '08:15', endTime: '08:55' }),
  block({ blockId: 'b3', day: 'wed', startTime: '08:15', endTime: '08:55' }),
  block({ blockId: 'b4', day: 'thu', startTime: '08:15', endTime: '08:45', assignmentId: 'a_lit', sourceType: 'class-timetable', classTimetableId: 'ct1', scheduleBlockId: 'sb1' }),
  block({ blockId: 'b5', day: 'thu', startTime: '10:00', endTime: '10:30', assignmentId: '', migrationState: 'needs-review', originalValues: { subject: 'x', grade: 'G7', label: '' } }),
]
test('a double counts as TWO scheduled periods, not one record', () => {
  const cov = computeCoverage({ assignments: ASSIGNMENTS, blocks: WEEK })
  const eng = cov.find((c) => c.assignmentId === 'a_eng')
  assert.equal(eng.scheduled, 4) // 2 (double) + 1 + 1
  assert.equal(eng.remaining, 2)
  assert.equal(eng.status, 'incomplete')
})
test('over-allocation is flagged', () => {
  const cov = computeCoverage({
    assignments: [{ ...A_LIT, periodsPerWeek: 1 }],
    blocks: [
      block({ blockId: 'x1', assignmentId: 'a_lit' }),
      block({ blockId: 'x2', day: 'tue', assignmentId: 'a_lit' }),
    ],
  })
  assert.equal(cov[0].status, 'over-allocated')
  assert.equal(cov[0].remaining, -1)
})
test('invalid assignments and needs-review blocks never count as valid load', () => {
  const cov = computeCoverage({ assignments: ASSIGNMENTS, blocks: WEEK })
  assert.equal(cov.find((c) => c.assignmentId === 'a_bad').status, 'invalid')
  const w = computeWorkload({ assignments: ASSIGNMENTS, blocks: WEEK })
  assert.equal(w.scheduledPeriods, 5) // b5 (needs-review) excluded
  assert.equal(w.needsReviewCount, 1)
})
test('workload sums assigned load from valid assignments only', () => {
  const w = computeWorkload({ assignments: ASSIGNMENTS, blocks: WEEK })
  assert.equal(w.assignedPeriods, 10) // 6 (eng) + 4 (lit); a_bad excluded as invalid
  assert.equal(w.unscheduledPeriods, 5) // eng 2 remaining + lit 3 remaining
  assert.equal(w.doublePeriods, 1)
  assert.equal(w.linkedPeriods, 1)
  assert.equal(w.manualPeriods, 3)
  assert.equal(w.teachingMinutes, 80 + 40 + 40 + 30)
})
test('formatTeachingMinutes', () => {
  assert.equal(formatTeachingMinutes(920), '15 h 20 min')
  assert.equal(formatTeachingMinutes(40), '40 min')
  assert.equal(formatTeachingMinutes(120), '2 h')
})

console.log('manual block validation')
test('valid block passes; save-time assignment validation runs', () => {
  const r = validateManualBlock({ block: block(), blocks: [], assignments: ASSIGNMENTS })
  assert.equal(r.valid, true)
})
test('block referencing an invalid assignment is rejected at save time', () => {
  const r = validateManualBlock({ block: block({ assignmentId: 'a_bad' }), blocks: [], assignments: ASSIGNMENTS })
  assert.equal(r.valid, false)
  assert.match(r.errors.join(' '), /curriculum validation/)
})
test('overlapping block is rejected', () => {
  const r = validateManualBlock({
    block: block({ blockId: 'tb_new', startTime: '08:45', endTime: '09:25' }),
    blocks: [block()],
    assignments: ASSIGNMENTS,
  })
  assert.equal(r.valid, false)
  assert.match(r.errors.join(' '), /overlaps/)
})
test('editing a block does not clash with itself', () => {
  const r = validateManualBlock({ block: block(), blocks: [block()], assignments: ASSIGNMENTS })
  assert.equal(r.valid, true)
})
test('over-allocation is a warning, not a blocker', () => {
  const r = validateManualBlock({
    block: block({ blockId: 'tb_new', day: 'tue', assignmentId: 'a_lit' }),
    blocks: [block({ assignmentId: 'a_lit' })],
    assignments: [{ ...A_LIT, periodsPerWeek: 1 }],
  })
  assert.equal(r.valid, true)
  assert.match(r.warnings.join(' '), /more than its 1 periods\/week/)
})
test('missing assignment / times are blocked', () => {
  const r = validateManualBlock({ block: { day: 'mon' }, blocks: [], assignments: ASSIGNMENTS })
  assert.equal(r.valid, false)
  assert.equal(r.errors.length, 3)
})
test('nextBlockId is deterministic and collision-safe', () => {
  assert.equal(nextBlockId([], 'mon', '08:15'), 'tb_mon_0815')
  assert.equal(nextBlockId([{ blockId: 'tb_mon_0815' }], 'mon', '08:15'), 'tb_mon_0815_2')
})

console.log('class timetable sync')
const GENERATION = {
  id: 'ct1',
  output: {
    schemaVersion: 'class-timetable-2.0',
    days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    periods: [
      { id: 'a', kind: 'break', event: 'assembly', start: '07:45', end: '08:15' },
      { id: 'p1', kind: 'lesson', start: '08:15', end: '08:55' },
      { id: 'p2', kind: 'lesson', start: '08:55', end: '09:35' },
      { id: 'b', kind: 'break', event: 'break', start: '09:35', end: '09:55' },
      { id: 'p3', kind: 'lesson', start: '09:55', end: '10:35' },
    ],
    blocks: [
      { blockId: 'blk_monday_1', day: 'Monday', startSlot: 1, length: 2, subjectId: 'english', label: 'English', type: 'curriculum' },
      { blockId: 'blk_monday_3', day: 'Monday', startSlot: 3, length: 1, subjectId: null, label: 'Literacy', type: 'curriculum' },
      { blockId: 'blk_tuesday_1', day: 'Tuesday', startSlot: 1, length: 1, label: 'Clubs', type: 'school-activity' },
    ],
  },
}
test('candidates map studio slots to real times; doubles span; activities skipped', () => {
  const cands = buildImportCandidates({ generation: GENERATION, assignments: ASSIGNMENTS })
  assert.equal(cands.length, 2)
  const dbl = cands.find((c) => c.scheduleBlockId === 'blk_monday_1')
  assert.equal(dbl.day, 'mon')
  assert.equal(dbl.startTime, '08:15')
  assert.equal(dbl.endTime, '09:35')
  assert.equal(dbl.lengthInPeriods, 2)
  assert.equal(dbl.suggestedAssignmentId, 'a_eng')
  assert.equal(dbl.matchType, 'subject')
})
test('label-only matches are suggestions, never silent links', () => {
  const cands = buildImportCandidates({ generation: GENERATION, assignments: ASSIGNMENTS })
  const lit = cands.find((c) => c.scheduleBlockId === 'blk_monday_3')
  assert.equal(lit.suggestedAssignmentId, 'a_lit')
  assert.equal(lit.matchType, 'label')
})
test('a block stamped with another teacherId is excluded', () => {
  const g = JSON.parse(JSON.stringify(GENERATION))
  g.output.blocks[0].teacherId = 'someone-else'
  const cands = buildImportCandidates({ generation: g, assignments: ASSIGNMENTS, teacherId: 'me' })
  assert.equal(cands.some((c) => c.scheduleBlockId === 'blk_monday_1'), false)
})
test('candidateToBlock produces a locked linked block with stable ids', () => {
  const cands = buildImportCandidates({ generation: GENERATION, assignments: ASSIGNMENTS })
  const b = candidateToBlock(cands[0], A_ENG)
  assert.equal(b.sourceType, 'class-timetable')
  assert.equal(b.locked, true)
  assert.equal(b.blockType, 'double')
  assert.equal(linkKey(b), 'ct1:blk_monday_1')
  assert.equal(b.assignmentId, 'a_eng')
})
test('re-import updates in place — never duplicates (stable linkKey)', () => {
  const cands = buildImportCandidates({ generation: GENERATION, assignments: ASSIGNMENTS })
  const first = mergeImportedBlocks([block()], [candidateToBlock(cands[0], A_ENG)])
  assert.equal(first.length, 2)
  const moved = { ...candidateToBlock(cands[0], A_ENG), day: 'wed' }
  const second = mergeImportedBlocks(first, [moved])
  assert.equal(second.length, 2)
  assert.equal(second.find((b) => linkKey(b) === 'ct1:blk_monday_1').day, 'wed')
})
test('reconcile: moved source block auto-updates the linked entry', () => {
  const cands = buildImportCandidates({ generation: GENERATION, assignments: ASSIGNMENTS })
  const linked = candidateToBlock(cands[0], A_ENG)
  const moved = JSON.parse(JSON.stringify(GENERATION))
  moved.output.blocks[0].day = 'Tuesday'
  moved.output.blocks[0].blockId = 'blk_monday_1' // id is stable even when moved
  const { blocks: out, changes } = reconcileLinkedBlocks([linked], { ct1: moved })
  assert.equal(out[0].day, 'tue')
  assert.equal(out[0].syncState, 'source-updated')
  assert.equal(changes.length, 1)
  assert.match(changes[0], /Source updated/)
})
test('reconcile: split double reflects as a single (length change syncs)', () => {
  const cands = buildImportCandidates({ generation: GENERATION, assignments: ASSIGNMENTS })
  const linked = candidateToBlock(cands[0], A_ENG)
  const split = JSON.parse(JSON.stringify(GENERATION))
  split.output.blocks[0].length = 1
  const { blocks: out } = reconcileLinkedBlocks([linked], { ct1: split })
  assert.equal(out[0].lengthInPeriods, 1)
  assert.equal(out[0].blockType, 'single')
  assert.equal(out[0].endTime, '08:55')
})
test('reconcile: deleted source marks source-missing without deleting', () => {
  const cands = buildImportCandidates({ generation: GENERATION, assignments: ASSIGNMENTS })
  const linked = candidateToBlock(cands[0], A_ENG)
  const { blocks: out, changes } = reconcileLinkedBlocks([linked], { ct1: null })
  assert.equal(out.length, 1)
  assert.equal(out[0].syncState, 'source-missing')
  assert.match(changes[0], /Source missing/)
})
test('reconcile: unfetched sources are left alone', () => {
  const cands = buildImportCandidates({ generation: GENERATION, assignments: ASSIGNMENTS })
  const linked = candidateToBlock(cands[0], A_ENG)
  const { blocks: out, changes } = reconcileLinkedBlocks([linked], {})
  assert.equal(out[0].syncState, 'synced')
  assert.equal(changes.length, 0)
})

console.log('grid + list models')
test('both orientations draw from identical schedule data (model is layout-free)', () => {
  const model = buildTtGridModel(WEEK)
  assert.deepEqual(model.timeSlots.map((s) => `${s.start}-${s.end}`),
    ['08:15-08:45', '08:45-08:55', '08:55-09:35', '10:00-10:30'])
  const monStart = model.cell('mon', 0)
  assert.equal(monStart.state, 'start')
  assert.equal(monStart.block.blockId, 'b1')
  assert.equal(monStart.span, 3) // double spans all covered slices
  assert.equal(model.cell('mon', 1).state, 'covered')
})
test('list model groups by day sorted by start time', () => {
  const byDay = blocksByDay([
    block({ blockId: 'late', startTime: '10:00', endTime: '10:40' }),
    block({ blockId: 'early' }),
  ])
  assert.deepEqual(byDay.mon.map((b) => b.blockId), ['early', 'late'])
  assert.deepEqual(byDay.fri, [])
})

console.log(`\n${passed} teacher-timetable core tests passed`)
