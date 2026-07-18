/**
 * Timetable block engine — the schedule-block model behind the Class
 * Timetable Studio.
 *
 * A timetable is a set of non-overlapping BLOCKS. A block occupies one or
 * more immediately consecutive lesson slots on a single day:
 *
 *   { blockId, day, startSlot, length, subjectId, label, type, locked,
 *     teacher, room }
 *
 *   - startSlot is 1-based (slot 1 ↔ period row 'p1')
 *   - length 1 is a single period; length 2 is a DOUBLE PERIOD
 *   - type is 'curriculum' (counts toward contact time) or
 *     'school-activity' (clubs, library, remedial … — never counts)
 *
 * Double-period invariant: a double exists ONLY as an explicit block whose
 * slots are immediately consecutive AND inside one SEGMENT — the run of
 * lesson slots between two breaks (assembly / break / lunch / closing all
 * end a segment). Two appearances of a subject with anything between them
 * are two separate single blocks, never a double.
 *
 * Pure and dependency-free so `node` can unit test it
 * (scripts/test-timetable-blocks.mjs).
 */

/* ── Segments ─────────────────────────────────────────────────── */

/**
 * Group the lesson slots of a period list into segments — runs of
 * consecutive lesson slots with no break/assembly/lunch/closing between
 * them. Returns an array of arrays of 1-based slot numbers,
 * e.g. [[1,2],[3,4,5],[6,7,8,9]].
 */
export function segmentsOf(periods) {
  const rows = Array.isArray(periods) ? periods : []
  const segments = []
  let current = []
  let slot = 0
  for (const row of rows) {
    if (row.kind === 'lesson') {
      slot += 1
      current.push(slot)
    } else if (current.length) {
      segments.push(current)
      current = []
    }
  }
  if (current.length) segments.push(current)
  return segments
}

/** The segment (array of slot numbers) containing a slot, or null. */
export function segmentContaining(segments, slot) {
  for (const seg of segments) {
    if (seg.includes(slot)) return seg
  }
  return null
}

/** True when every slot of [startSlot, startSlot+length) sits in ONE segment. */
export function fitsInOneSegment(segments, startSlot, length) {
  const seg = segmentContaining(segments, startSlot)
  if (!seg) return false
  for (let s = startSlot; s < startSlot + length; s += 1) {
    if (!seg.includes(s)) return false
  }
  return true
}

/* ── Block basics ─────────────────────────────────────────────── */

export const BLOCK_TYPES = { CURRICULUM: 'curriculum', ACTIVITY: 'school-activity' }

/** Deterministic block id from its position (positions never overlap). */
export function makeBlockId(day, startSlot) {
  return `blk_${String(day).toLowerCase()}_${startSlot}`
}

export function makeBlock({ day, startSlot, length = 1, subjectId = null, label, type = BLOCK_TYPES.CURRICULUM, locked = false, teacher = null, room = null, teacherId = null, assignmentId = null, roomId = null }) {
  return {
    blockId: makeBlockId(day, startSlot),
    day,
    startSlot,
    length: Math.max(1, Math.round(Number(length) || 1)),
    subjectId: subjectId ?? null,
    label: String(label || ''),
    type,
    locked: Boolean(locked),
    teacher: teacher || null,
    room: room || null,
    // Stable-identity seams: teacherId/assignmentId link a block to a
    // teacher account + Teaching Assignment (personal timetable sync,
    // teacher conflict checking); roomId is the canonical shared-facility
    // id (timetableConflictEngine.SHARED_FACILITIES) for room conflicts.
    // Free-text `teacher`/`room` labels are display-only — never identity.
    teacherId: teacherId || null,
    assignmentId: assignmentId || null,
    roomId: roomId || null,
  }
}

/**
 * Update a block's teacher/room details in place — blockId, position,
 * length, lock state and subject are all preserved, so conflict ids and
 * personal-timetable links stay stable across a details edit.
 */
export function setBlockDetails(blocks, blockId, { teacher, teacherId, assignmentId, room, roomId } = {}) {
  return (Array.isArray(blocks) ? blocks : []).map((b) => {
    if (b.blockId !== blockId) return b
    return {
      ...b,
      ...(teacher !== undefined ? { teacher: teacher || null } : {}),
      ...(teacherId !== undefined ? { teacherId: teacherId || null } : {}),
      ...(assignmentId !== undefined ? { assignmentId: assignmentId || null } : {}),
      ...(room !== undefined ? { room: room || null } : {}),
      ...(roomId !== undefined ? { roomId: roomId || null } : {}),
    }
  })
}

export function isDouble(block) {
  return Boolean(block) && block.length >= 2
}

export function blockSlots(block) {
  const out = []
  for (let s = block.startSlot; s < block.startSlot + block.length; s += 1) out.push(s)
  return out
}

/** Map of `${day}__${slot}` → block for every occupied cell. */
export function occupancy(blocks) {
  const map = new Map()
  for (const b of Array.isArray(blocks) ? blocks : []) {
    for (const s of blockSlots(b)) map.set(`${b.day}__${s}`, b)
  }
  return map
}

export function blockAt(blocks, day, slot) {
  for (const b of Array.isArray(blocks) ? blocks : []) {
    if (b.day === day && slot >= b.startSlot && slot < b.startSlot + b.length) return b
  }
  return null
}

/* ── Legacy slots ↔ blocks ────────────────────────────────────── */

/**
 * Convert a legacy per-cell slots map ({ p1: { Monday: 'English' } }) into
 * single-period blocks. Legacy cells are ALWAYS migrated as singles —
 * adjacent matching cells are only flagged as candidate doubles (see
 * suggestJoins) for the teacher to confirm; separated repeats stay separate.
 */
export function slotsToBlocks(slots, periods, days, { labelToSubjectId } = {}) {
  const rows = (Array.isArray(periods) ? periods : []).filter((p) => p.kind === 'lesson')
  const dayList = Array.isArray(days) ? days : []
  const blocks = []
  rows.forEach((row, i) => {
    const slot = i + 1
    for (const day of dayList) {
      const label = slots?.[row.id]?.[day]
      if (!label) continue
      blocks.push(makeBlock({
        day,
        startSlot: slot,
        length: 1,
        label,
        subjectId: labelToSubjectId ? (labelToSubjectId(label) ?? null) : null,
      }))
    }
  })
  return blocks
}

/**
 * Flatten blocks back to the legacy per-cell slots map (each covered cell
 * carries the block's label). Keeps old saved-library readers and the
 * existing exporters working.
 */
export function blocksToSlots(blocks, periods, days) {
  const rows = (Array.isArray(periods) ? periods : []).filter((p) => p.kind === 'lesson')
  const dayList = new Set(Array.isArray(days) ? days : [])
  const slots = {}
  for (const b of Array.isArray(blocks) ? blocks : []) {
    if (!dayList.has(b.day)) continue
    for (const s of blockSlots(b)) {
      const row = rows[s - 1]
      if (!row) continue
      if (!slots[row.id]) slots[row.id] = {}
      slots[row.id][b.day] = b.label
    }
  }
  return slots
}

/* ── Editing operations ───────────────────────────────────────── */

/**
 * Whether two blocks may be joined into one double/longer block.
 * Requires: same day, same subject label, immediately consecutive slots,
 * both inside one segment (no break/lunch/assembly between), same type,
 * combined length within maxBlockLength.
 * Returns { ok, reason }.
 */
export function canJoin(a, b, segments, { maxBlockLength = 2 } = {}) {
  if (!a || !b || a.blockId === b.blockId) return { ok: false, reason: 'Pick two different periods to join.' }
  if (a.day !== b.day) return { ok: false, reason: 'A double period cannot cross days.' }
  if (a.type !== b.type) return { ok: false, reason: 'Only periods of the same kind can be joined.' }
  if ((a.label || '') !== (b.label || '')) return { ok: false, reason: 'Both periods must be the same subject to form a double period.' }
  const first = a.startSlot <= b.startSlot ? a : b
  const second = first === a ? b : a
  if (first.startSlot + first.length !== second.startSlot) {
    return { ok: false, reason: 'The two periods are not consecutive — separated periods are two singles, not a double period.' }
  }
  const combined = first.length + second.length
  if (combined > maxBlockLength) {
    return { ok: false, reason: `A block here can be at most ${maxBlockLength} periods long.` }
  }
  if (!fitsInOneSegment(segments, first.startSlot, combined)) {
    return { ok: false, reason: 'A double period cannot cross a break, lunch, assembly or closing.' }
  }
  return { ok: true, reason: '' }
}

/** Join two adjacent matching blocks into one. Returns a new blocks array,
 * or the original array unchanged when the join is invalid. */
export function joinBlocks(blocks, aId, bId, segments, opts) {
  const a = blocks.find((x) => x.blockId === aId)
  const b = blocks.find((x) => x.blockId === bId)
  const check = canJoin(a, b, segments, opts)
  if (!check.ok) return { blocks, ok: false, reason: check.reason }
  const first = a.startSlot <= b.startSlot ? a : b
  const merged = makeBlock({
    ...first,
    length: a.length + b.length,
    locked: a.locked || b.locked,
  })
  const next = blocks.filter((x) => x.blockId !== aId && x.blockId !== bId).concat(merged)
  return { blocks: next, ok: true, reason: '' }
}

/** Split a multi-period block into single periods (each inherits the
 * subject; locks are released so the singles can be moved). */
export function splitBlock(blocks, blockId) {
  const block = blocks.find((x) => x.blockId === blockId)
  if (!block || block.length < 2) return { blocks, ok: false, reason: 'Only a double period can be split.' }
  const singles = blockSlots(block).map((s) => makeBlock({ ...block, startSlot: s, length: 1, locked: false }))
  const next = blocks.filter((x) => x.blockId !== blockId).concat(singles)
  return { blocks: next, ok: true, reason: '' }
}

/**
 * Move a whole block (doubles move as one) to a new day/startSlot.
 * Validates: target slots exist for that day, fit one segment, and don't
 * overlap another block. Returns { blocks, ok, reason }.
 */
export function moveBlock(blocks, blockId, day, startSlot, { segments, slotCountForDay } = {}) {
  const block = blocks.find((x) => x.blockId === blockId)
  if (!block) return { blocks, ok: false, reason: 'That period no longer exists.' }
  if (block.locked) return { blocks, ok: false, reason: 'This period is locked — unlock it first.' }
  const capacity = typeof slotCountForDay === 'function' ? slotCountForDay(day) : Infinity
  if (startSlot < 1 || startSlot + block.length - 1 > capacity) {
    return { blocks, ok: false, reason: `${day} does not have lesson periods there.` }
  }
  if (segments && !fitsInOneSegment(segments, startSlot, block.length)) {
    return { blocks, ok: false, reason: 'A double period cannot cross a break, lunch, assembly or closing.' }
  }
  for (const other of blocks) {
    if (other.blockId === blockId || other.day !== day) continue
    const overlaps = startSlot < other.startSlot + other.length && other.startSlot < startSlot + block.length
    if (overlaps) return { blocks, ok: false, reason: `${other.label || 'Another lesson'} is already placed there.` }
  }
  const moved = makeBlock({ ...block, day, startSlot })
  return { blocks: blocks.filter((x) => x.blockId !== blockId).concat(moved), ok: true, reason: '' }
}

/** Set/replace/clear the content of one cell. Editing one slot of a double
 * splits the block (the other half stays), per the double-period rules. */
export function setCellBlock(blocks, day, slot, { label, subjectId = null, type = BLOCK_TYPES.CURRICULUM } = {}) {
  const existing = blockAt(blocks, day, slot)
  let next = Array.isArray(blocks) ? blocks.slice() : []
  if (existing) {
    next = next.filter((x) => x.blockId !== existing.blockId)
    // Editing/clearing one half of a longer block keeps the other slots as singles.
    for (const s of blockSlots(existing)) {
      if (s === slot) continue
      next.push(makeBlock({ ...existing, startSlot: s, length: 1, locked: false }))
    }
  }
  if (label) {
    next.push(makeBlock({ day, startSlot: slot, length: 1, label, subjectId, type }))
  }
  return next
}

/** Toggle a block's lock. Locked blocks survive auto-fill untouched. */
export function toggleBlockLock(blocks, blockId) {
  return blocks.map((b) => (b.blockId === blockId ? { ...b, locked: !b.locked } : b))
}

/** Adjacent same-subject single blocks the teacher may want to join —
 * candidate doubles (e.g. after importing a legacy timetable). */
export function suggestJoins(blocks, segments, { maxBlockLength = 2 } = {}) {
  const singles = (Array.isArray(blocks) ? blocks : []).filter((b) => b.length === 1 && b.type === BLOCK_TYPES.CURRICULUM)
  const out = []
  for (const a of singles) {
    const b = singles.find((x) => x.day === a.day && x.startSlot === a.startSlot + 1)
    if (!b) continue
    if (canJoin(a, b, segments, { maxBlockLength }).ok) out.push([a.blockId, b.blockId])
  }
  return out
}

/* ── Structural validation ────────────────────────────────────── */

/**
 * Structural errors in a block layout: overlapping blocks, blocks outside
 * the day's slot range, and doubles crossing a segment boundary (a break).
 * Returns an array of message strings — empty means structurally sound.
 *
 * `segments` may be a single array (every day shares one segment layout —
 * the original, uniform-week shape) or a `(day) => segments[]` resolver, for
 * timetables where a day-specific school-day structure gives some days their
 * own break layout and knock-off time.
 */
export function validateBlockLayout(blocks, { segments, days, slotCountForDay }) {
  const segmentsFor = typeof segments === 'function' ? segments : () => segments
  const errors = []
  const dayList = new Set(Array.isArray(days) ? days : [])
  const seen = new Map()
  for (const b of Array.isArray(blocks) ? blocks : []) {
    if (!dayList.has(b.day)) {
      errors.push(`${b.label || 'A lesson'} sits on ${b.day}, which is not a teaching day.`)
      continue
    }
    const capacity = typeof slotCountForDay === 'function' ? slotCountForDay(b.day) : Infinity
    if (b.startSlot < 1 || b.startSlot + b.length - 1 > capacity) {
      errors.push(`${b.label || 'A lesson'} on ${b.day} falls outside that day's lesson periods.`)
      continue
    }
    const daySegments = segmentsFor(b.day)
    if (b.length > 1 && daySegments && !fitsInOneSegment(daySegments, b.startSlot, b.length)) {
      errors.push(`The ${b.label} double period on ${b.day} crosses a break — split it into two singles.`)
    }
    for (const s of blockSlots(b)) {
      const key = `${b.day}__${s}`
      if (seen.has(key)) {
        errors.push(`${b.label} overlaps ${seen.get(key)} on ${b.day}.`)
      } else {
        seen.set(key, b.label || 'a lesson')
      }
    }
  }
  return errors
}

/* ── Whole-school conflict checking ───────────────────────────── */

function timeToMin(hhmm) {
  const m = String(hhmm ?? '').match(/^(\d{1,2}):(\d{2})$/)
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0
}

/** The clock range [startMin, endMin) a block covers, from its artifact's
 * period rows. Null when the rows can't resolve. */
export function blockTimeRange(block, periods) {
  const rows = (Array.isArray(periods) ? periods : []).filter((p) => p.kind === 'lesson')
  const first = rows[block.startSlot - 1]
  const last = rows[block.startSlot + block.length - 2]
  if (!first || !last) return null
  return { start: timeToMin(first.start), end: timeToMin(last.end) }
}

/**
 * Compare a timetable against other saved timetables and report conflicts:
 * the same teacher or the same room booked for two classes at overlapping
 * times on the same day. Each timetable is an artifact holding { periods,
 * blocks, header }. Block-level `teacher`/`room` win; a block without its
 * own teacher falls back to nothing (the class teacher name on the header
 * is NOT assumed to teach every lesson).
 *
 * @returns {Array<{kind:'teacher'|'room', who, day, time, subject, otherClass, otherSubject}>}
 */
export function findTimetableConflicts(current, others) {
  const conflicts = []
  const mine = indexResources(current)
  for (const other of Array.isArray(others) ? others : []) {
    if (!other || other === current) continue
    const theirs = indexResources(other)
    const otherClass = other?.header?.className || other?.header?.grade || 'another class'
    for (const kind of ['teacher', 'room']) {
      for (const [key, entries] of mine[kind]) {
        const clash = theirs[kind].get(key)
        if (!clash) continue
        for (const a of entries) {
          for (const b of clash) {
            if (a.day !== b.day) continue
            if (a.start < b.end && b.start < a.end) {
              conflicts.push({
                kind,
                who: key,
                day: a.day,
                time: a.label,
                subject: a.subject,
                otherClass,
                otherSubject: b.subject,
              })
            }
          }
        }
      }
    }
  }
  return conflicts
}

function indexResources(artifact) {
  const teacher = new Map()
  const room = new Map()
  const periods = artifact?.periods || []
  for (const b of artifact?.blocks || []) {
    if (b.type !== BLOCK_TYPES.CURRICULUM) continue
    const range = blockTimeRange(b, periods)
    if (!range) continue
    const entry = {
      day: b.day,
      start: range.start,
      end: range.end,
      subject: b.label,
      label: `${minToTime(range.start)}–${minToTime(range.end)}`,
    }
    if (b.teacher) push(teacher, normKey(b.teacher), entry)
    if (b.room) push(room, normKey(b.room), entry)
  }
  return { teacher, room }
}

function push(map, key, entry) {
  if (!map.has(key)) map.set(key, [])
  map.get(key).push(entry)
}

function normKey(s) {
  return String(s || '').trim().toLowerCase()
}

function minToTime(total) {
  const t = ((Math.round(Number(total) || 0) % 1440) + 1440) % 1440
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

/* ── School activities ────────────────────────────────────────── */

/** The activities a school can label spare (non-curriculum) slots with. */
export const SCHOOL_ACTIVITIES = [
  'Remedial work',
  'Guided reading',
  'Library',
  'Continuous assessment',
  'Clubs',
  'Guidance',
  'Class meeting',
  'Sports',
  'Production unit',
  'School assembly programme',
]
