#!/usr/bin/env node
/* global console, process */
/**
 * Unit tests for the timetable block engine (src/shared/utils/timetableBlocks.js):
 * segments, the double-period invariants (join/split/move/lock), legacy
 * cell ↔ block conversion, structural validation and whole-school conflict
 * detection.
 *
 * Plain `node` script that throws on failure, per repo convention.
 * Run: npm run test:timetable-blocks   (also via npm run test:all)
 */
import {
  BLOCK_TYPES,
  segmentsOf,
  segmentContaining,
  fitsInOneSegment,
  makeBlock,
  isDouble,
  blockAt,
  slotsToBlocks,
  blocksToSlots,
  canJoin,
  joinBlocks,
  splitBlock,
  moveBlock,
  setCellBlock,
  toggleBlockLock,
  suggestJoins,
  validateBlockLayout,
  findTimetableConflicts,
  blockTimeRange,
} from '../src/shared/utils/timetableBlocks.js'
import { buildPeriods, DEFAULT_DAYS } from '../src/shared/utils/classTimetable.js'

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

/* A school day: P1–P3, BREAK, P4–P6, LUNCH, P7–P9. */
const PERIODS = buildPeriods({
  startTime: '07:30', periodMinutes: 40, lessonPeriods: 9,
  breaks: [
    { afterPeriod: 0, minutes: 15, name: 'ASSEMBLY', event: 'assembly' },
    { afterPeriod: 3, minutes: 20, name: 'BREAK', event: 'break' },
    { afterPeriod: 6, minutes: 40, name: 'LUNCH', event: 'lunch' },
  ],
})
const SEGMENTS = segmentsOf(PERIODS)

/* ── segments ─────────────────────────────────────────────────── */

test('segmentsOf groups lesson slots between breaks (assembly ignored as bookend)', () => {
  assert(SEGMENTS.length === 3, `expected 3 segments, got ${SEGMENTS.length}`)
  assert(JSON.stringify(SEGMENTS) === JSON.stringify([[1, 2, 3], [4, 5, 6], [7, 8, 9]]),
    `bad segments: ${JSON.stringify(SEGMENTS)}`)
  assert(segmentContaining(SEGMENTS, 5).includes(4), 'slot 5 lives in the middle segment')
  assert(fitsInOneSegment(SEGMENTS, 2, 2), 'slots 2–3 sit in one segment')
  assert(!fitsInOneSegment(SEGMENTS, 3, 2), 'slots 3–4 cross the break')
})

/* ── double-period invariants ─────────────────────────────────── */

const eng1 = makeBlock({ day: 'Monday', startSlot: 1, length: 1, label: 'English Language' })
const eng2 = makeBlock({ day: 'Monday', startSlot: 2, length: 1, label: 'English Language' })
const eng3 = makeBlock({ day: 'Monday', startSlot: 3, length: 1, label: 'English Language' })
const eng4 = makeBlock({ day: 'Monday', startSlot: 4, length: 1, label: 'English Language' })
const sci2 = makeBlock({ day: 'Monday', startSlot: 2, length: 1, label: 'Science' })
const engTue = makeBlock({ day: 'Tuesday', startSlot: 2, length: 1, label: 'English Language' })

test('two adjacent matching subjects can join into a valid double period', () => {
  assert(canJoin(eng1, eng2, SEGMENTS).ok, 'adjacent same-subject singles should join')
  const res = joinBlocks([eng1, eng2], eng1.blockId, eng2.blockId, SEGMENTS)
  assert(res.ok, res.reason)
  assert(res.blocks.length === 1 && res.blocks[0].length === 2, 'join should produce one length-2 block')
  assert(isDouble(res.blocks[0]), 'the joined block is a double period')
})

test('separated matching subjects are two singles, never a double', () => {
  const check = canJoin(eng1, eng3, SEGMENTS)
  assert(!check.ok, 'slots 1 and 3 are not consecutive')
  assert(/not consecutive/i.test(check.reason), `reason should say not consecutive: ${check.reason}`)
})

test('a subject appearing either side of a break cannot form a double', () => {
  const check = canJoin(eng3, eng4, SEGMENTS)
  assert(!check.ok, 'slots 3–4 straddle the break')
  assert(/break|lunch/i.test(check.reason), `reason should mention the break: ${check.reason}`)
})

test('different subjects and different days never join', () => {
  assert(!canJoin(eng1, sci2, SEGMENTS).ok, 'different subjects must not join')
  assert(!canJoin(eng2, engTue, SEGMENTS).ok, 'a double cannot cross days')
})

test('splitting a double produces two unlocked singles', () => {
  const joined = joinBlocks([eng1, eng2], eng1.blockId, eng2.blockId, SEGMENTS).blocks
  const res = splitBlock(joined, joined[0].blockId)
  assert(res.ok, res.reason)
  assert(res.blocks.length === 2 && res.blocks.every((b) => b.length === 1), 'split → two singles')
  assert(res.blocks.every((b) => !b.locked), 'split singles are unlocked')
})

test('moving a double moves both periods and respects segments + overlaps', () => {
  const dbl = makeBlock({ day: 'Monday', startSlot: 1, length: 2, label: 'Technology Studies' })
  const other = makeBlock({ day: 'Tuesday', startSlot: 5, length: 1, label: 'Science' })
  // Valid move: Tuesday slots 7–8 (one segment, free).
  const ok = moveBlock([dbl, other], dbl.blockId, 'Tuesday', 7, { segments: SEGMENTS })
  assert(ok.ok, ok.reason)
  const moved = ok.blocks.find((b) => b.label === 'Technology Studies')
  assert(moved.day === 'Tuesday' && moved.startSlot === 7 && moved.length === 2, 'whole block moved')
  // Invalid: crossing the lunch boundary (slots 6–7).
  const cross = moveBlock([dbl], dbl.blockId, 'Tuesday', 6, { segments: SEGMENTS })
  assert(!cross.ok && /break|lunch|assembly/i.test(cross.reason), 'crossing a boundary is refused')
  // Invalid: overlapping another block.
  const clash = moveBlock([dbl, other], dbl.blockId, 'Tuesday', 4, { segments: SEGMENTS })
  assert(!clash.ok && /already/i.test(clash.reason), 'overlap is refused with a specific message')
})

test('locked blocks refuse to move until unlocked', () => {
  const locked = makeBlock({ day: 'Monday', startSlot: 1, length: 2, label: 'Maths', locked: true })
  const res = moveBlock([locked], locked.blockId, 'Tuesday', 1, { segments: SEGMENTS })
  assert(!res.ok && /locked/i.test(res.reason), 'locked block must not move')
  const unlocked = toggleBlockLock([locked], locked.blockId)
  assert(!unlocked[0].locked, 'toggle unlocks')
})

test('editing one slot of a double splits the block; clearing removes just that single', () => {
  const dbl = makeBlock({ day: 'Monday', startSlot: 1, length: 2, label: 'Science' })
  // Overwrite slot 2 with Maths → slot 1 stays as a Science single.
  const next = setCellBlock([dbl], 'Monday', 2, { label: 'Mathematics' })
  const s1 = blockAt(next, 'Monday', 1)
  const s2 = blockAt(next, 'Monday', 2)
  assert(s1 && s1.label === 'Science' && s1.length === 1, 'slot 1 keeps Science as a single')
  assert(s2 && s2.label === 'Mathematics' && s2.length === 1, 'slot 2 becomes Mathematics')
  // Clearing slot 1 leaves slot 2 untouched.
  const cleared = setCellBlock(next, 'Monday', 1, { label: '' })
  assert(!blockAt(cleared, 'Monday', 1) && blockAt(cleared, 'Monday', 2), 'clear removes only that cell')
})

/* ── legacy cells ↔ blocks ────────────────────────────────────── */

test('legacy slots convert to single blocks; adjacent repeats stay singles but are suggested as doubles', () => {
  const slots = {
    p1: { Monday: 'English Language', Tuesday: 'Mathematics' },
    p2: { Monday: 'English Language' },
    p4: { Monday: 'English Language' }, // separated — never suggested
  }
  const blocks = slotsToBlocks(slots, PERIODS, DEFAULT_DAYS)
  assert(blocks.length === 4, `expected 4 single blocks, got ${blocks.length}`)
  assert(blocks.every((b) => b.length === 1), 'legacy cells migrate as singles only')
  const joins = suggestJoins(blocks, SEGMENTS)
  assert(joins.length === 1, `only the adjacent pair is suggested: ${JSON.stringify(joins)}`)
  const [aId] = joins[0]
  assert(blockAt(blocks, 'Monday', 1).blockId === aId, 'suggestion starts at slot 1')
})

test('blocksToSlots flattens blocks (doubles cover both cells) for legacy readers', () => {
  const blocks = [
    makeBlock({ day: 'Monday', startSlot: 1, length: 2, label: 'Science' }),
    makeBlock({ day: 'Friday', startSlot: 9, length: 1, label: 'Clubs', type: BLOCK_TYPES.ACTIVITY }),
  ]
  const slots = blocksToSlots(blocks, PERIODS, DEFAULT_DAYS)
  assert(slots.p1.Monday === 'Science' && slots.p2.Monday === 'Science', 'double covers p1 + p2')
  assert(slots.p9.Friday === 'Clubs', 'activity block lands in its cell')
})

/* ── structural validation ────────────────────────────────────── */

test('validateBlockLayout catches overlaps, cross-break doubles and out-of-range blocks', () => {
  const capacity = () => 9
  const good = [makeBlock({ day: 'Monday', startSlot: 1, length: 2, label: 'CTS' })]
  assert(validateBlockLayout(good, { segments: SEGMENTS, days: DEFAULT_DAYS, slotCountForDay: capacity }).length === 0,
    'a clean layout has no structural errors')
  const bad = [
    makeBlock({ day: 'Monday', startSlot: 3, length: 2, label: 'Science' }),   // crosses break
    makeBlock({ day: 'Monday', startSlot: 3, length: 1, label: 'Maths' }),     // overlaps
    makeBlock({ day: 'Monday', startSlot: 9, length: 2, label: 'English' }),   // runs off the day
  ]
  const errors = validateBlockLayout(bad, { segments: SEGMENTS, days: DEFAULT_DAYS, slotCountForDay: capacity })
  assert(errors.some((e) => /crosses a break/.test(e)), `cross-break double flagged: ${errors.join(' | ')}`)
  assert(errors.some((e) => /overlaps/.test(e)), 'overlap flagged')
  assert(errors.some((e) => /outside/.test(e)), 'out-of-range flagged')
})

/* ── whole-school conflicts ───────────────────────────────────── */

test('findTimetableConflicts detects the same teacher in two classes at once', () => {
  const a = {
    header: { className: 'Grade 6 Blue' },
    periods: PERIODS,
    blocks: [makeBlock({ day: 'Monday', startSlot: 2, length: 1, label: 'Mathematics', teacher: 'Mr Banda' })],
  }
  const b = {
    header: { className: 'Grade 6 Green' },
    periods: PERIODS,
    blocks: [makeBlock({ day: 'Monday', startSlot: 2, length: 1, label: 'Science', teacher: 'mr banda' })],
  }
  const conflicts = findTimetableConflicts(a, [b])
  assert(conflicts.length === 1, `expected 1 teacher conflict, got ${conflicts.length}`)
  assert(conflicts[0].kind === 'teacher' && conflicts[0].otherClass === 'Grade 6 Green',
    `conflict names the other class: ${JSON.stringify(conflicts[0])}`)
})

test('findTimetableConflicts detects a shared room double-booked, ignores different times', () => {
  const a = {
    header: { className: '8A' },
    periods: PERIODS,
    blocks: [
      makeBlock({ day: 'Tuesday', startSlot: 4, length: 2, label: 'Computer Studies', room: 'Computer Lab' }),
      makeBlock({ day: 'Wednesday', startSlot: 1, length: 1, label: 'Science', room: 'Science Lab' }),
    ],
  }
  const b = {
    header: { className: '8B' },
    periods: PERIODS,
    blocks: [
      makeBlock({ day: 'Tuesday', startSlot: 5, length: 1, label: 'ICT', room: 'computer lab' }), // overlaps the double
      makeBlock({ day: 'Wednesday', startSlot: 2, length: 1, label: 'Science', room: 'Science Lab' }), // different time — fine
    ],
  }
  const conflicts = findTimetableConflicts(a, [b])
  assert(conflicts.length === 1, `expected exactly 1 room conflict, got ${conflicts.length}: ${JSON.stringify(conflicts)}`)
  assert(conflicts[0].kind === 'room', 'the clash is a room conflict')
})

test('blockTimeRange resolves a block to its clock range', () => {
  const dbl = makeBlock({ day: 'Monday', startSlot: 1, length: 2, label: 'CTS' })
  const range = blockTimeRange(dbl, PERIODS)
  // Assembly 07:30–07:45, then P1 07:45–08:25, P2 08:25–09:05.
  assert(range.start === 7 * 60 + 45 && range.end === 9 * 60 + 5,
    `expected 07:45–09:05, got ${range.start}–${range.end}`)
})

console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
