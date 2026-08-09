/**
 * Cross-timetable conflict engine — pure logic behind the Class Timetable
 * Studio's "Timetable conflicts" panel.
 *
 * Compares the CURRENT in-memory timetable (including unsaved edits) against
 * normalised SIBLING class timetables (other saved class_timetable docs in
 * the same scheduling context) and reports:
 *
 *   - teacher conflicts  one teacher (canonical `teacherId`) in two classes
 *                        at overlapping times — severity 'error'. Blocks
 *                        that carry only a free-text teacher name are NEVER
 *                        confirmed matches: an exact-name overlap surfaces
 *                        as a 'warning' with identityUnverified, and the
 *                        coverage summary counts the legacy blocks.
 *   - room conflicts     the same canonical shared facility (roomId from
 *                        SHARED_FACILITIES) booked twice — 'error' unless
 *                        the facility is configured shareable ('warning').
 *                        Free-text room labels are matched as 'warning'
 *                        only; two labels are never definitively one room.
 *   - class conflicts    overlapping blocks inside the current timetable
 *                        itself (duplicate/overlapping occupancy) — these
 *                        run even with no siblings loaded.
 *
 * Times are normalised per timetable from that timetable's own period rows,
 * so different reporting times, period lengths and day structures compare
 * correctly ("Period 2" is never assumed to be the same clock time). A
 * block whose times can't be resolved is flagged "Time structure needs
 * review" — never silently omitted. Doubles occupy their FULL time range.
 *
 * Overlap rule: startA < endB && startB < endA (boundary-touching periods
 * are consecutive, not conflicting).
 *
 * Conflict ids are deterministic (type + timetable ids + block ids) so an
 * unresolved conflict keeps its id across re-renders, reloads and tests.
 *
 * This module never touches Firestore — it takes plain objects and is unit
 * tested under plain node (scripts/test-timetable-conflict-engine.mjs).
 */

import { periodsForDay } from '../../../shared/utils/classTimetable.js'

/* ── Canonical shared facilities ──────────────────────────────────
 * ZedExams has no school room model yet, so this catalog is the safe
 * canonical mapping for the common shared facilities. Picking one in the
 * block editor stamps its `id` onto the block (`roomId`); anything typed
 * free-hand stays a label only and is matched at warning level.
 */
export const SHARED_FACILITIES = [
  { id: 'science-lab', label: 'Science laboratory', shareable: false },
  { id: 'computer-lab', label: 'Computer laboratory', shareable: false },
  { id: 'home-economics-room', label: 'Home Economics room', shareable: false },
  { id: 'workshop', label: 'Workshop', shareable: false },
  { id: 'art-room', label: 'Art room', shareable: false },
  { id: 'music-room', label: 'Music room', shareable: false },
  { id: 'library', label: 'Library', shareable: true },
  { id: 'school-hall', label: 'School hall', shareable: true },
  { id: 'sports-field', label: 'Sports field', shareable: true },
]

export function facilityById(roomId) {
  return SHARED_FACILITIES.find((f) => f.id === roomId) || null
}

/* ── Small helpers ───────────────────────────────────────────── */

const str = (v) => String(v ?? '').trim()
const normLabel = (v) => str(v).toLowerCase().replace(/\s+/g, ' ')

function timeToMin(hhmm) {
  const m = str(hhmm).match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

export function minToTime(total) {
  const t = ((Math.round(Number(total) || 0) % 1440) + 1440) % 1440
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

/** Standard interval overlap; boundary-touching intervals do NOT overlap. */
export function intervalsOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA
}

/* ── Sibling scope ───────────────────────────────────────────── */

/**
 * Whether a saved class-timetable document belongs to the same scheduling
 * context as the current timetable: same school (normalised label — school
 * identity is label-based in the current data model), same academic year,
 * same term, a different document, and not deleted/superseded.
 *
 * `current` / `candidate` are lightweight descriptors:
 *   { timetableId, school, year, term, status? }
 */
export function isSiblingTimetableCandidate({ current, candidate } = {}) {
  if (!current || !candidate) return false
  if (!candidate.timetableId) return false
  if (candidate.timetableId === current.timetableId) return false
  const status = str(candidate.status).toLowerCase()
  if (['deleted', 'archived', 'superseded', 'failed'].includes(status)) return false
  if (normLabel(candidate.school) !== normLabel(current.school)) return false
  if (str(candidate.year) !== str(current.year)) return false
  // Term must match when the current timetable declares one; a sibling with
  // no term recorded stays in scope (legacy docs often omit it) — the
  // coverage summary tells the teacher what was compared.
  const curTerm = str(current.term)
  const candTerm = str(candidate.term)
  if (curTerm && candTerm && curTerm !== candTerm) return false
  if (curTerm && !candTerm) return true
  if (!curTerm && candTerm) return false
  return true
}

/* ── Normalisation ───────────────────────────────────────────── */

/**
 * Normalise one saved class-timetable document (or the current in-memory
 * artifact) into the compact structure conflict checking needs — nothing
 * from the heavy generation payloads is retained.
 *
 * Every curriculum block gets exact minutes computed from ITS OWN
 * timetable's period rows. Blocks that can't be timed are kept with
 * `timeReview: true` so they surface as "Time structure needs review"
 * instead of vanishing from the check.
 *
 * @param {object} doc  { id, output (artifact), savedAt?, createdAt? } or a
 *                      bare artifact plus opts.timetableId
 */
export function normaliseTimetableForConflictCheck(doc, opts = {}) {
  if (!doc || typeof doc !== 'object') return null
  const artifact = doc.output && typeof doc.output === 'object' ? doc.output : doc
  const header = artifact.header || {}
  const timetableId = opts.timetableId || doc.id || artifact.id || ''
  const periods = Array.isArray(artifact.periods) ? artifact.periods : []
  const dayStructure = artifact.dayStructure || null
  const rawBlocks = Array.isArray(artifact.blocks) ? artifact.blocks : []

  const gradeLabel = str(header.grade).replace(/^G/i, '')
  const displayTitle = [
    str(header.className) || (gradeLabel && `Grade ${gradeLabel}`),
    header.term && `Term ${header.term}`,
    header.year,
  ].filter(Boolean).join(' · ') || 'Class timetable'

  const scheduleBlocks = []
  const lessonRowsByDay = new Map()
  for (const b of rawBlocks) {
    if (!b || (b.type && b.type !== 'curriculum')) continue
    // A day-specific school-day structure (see classTimetable.periodsForDay)
    // gives that day its own reporting/knock-off time — never fall back to
    // another day's row list, or its slot times would be wrong.
    const dayKey = b.day || ''
    if (!lessonRowsByDay.has(dayKey)) {
      lessonRowsByDay.set(dayKey, periodsForDay(b.day, periods, dayStructure).filter((p) => p && p.kind === 'lesson'))
    }
    const lessonRows = lessonRowsByDay.get(dayKey)
    const startRow = lessonRows[(b.startSlot || 0) - 1]
    const endRow = lessonRows[(b.startSlot || 0) + (b.length || 1) - 2]
    const startMinutes = startRow ? timeToMin(startRow.start) : null
    const endMinutes = endRow ? timeToMin(endRow.end) : null
    const timed = startMinutes != null && endMinutes != null && endMinutes > startMinutes
    scheduleBlocks.push({
      blockId: str(b.blockId) || `blk_${scheduleBlocks.length}`,
      day: normLabel(b.day),
      startMinutes: timed ? startMinutes : null,
      endMinutes: timed ? endMinutes : null,
      startTime: timed ? minToTime(startMinutes) : '',
      endTime: timed ? minToTime(endMinutes) : '',
      length: Math.max(1, Math.round(Number(b.length) || 1)),
      timeReview: !timed,
      teacherId: str(b.teacherId) || null,
      assignmentId: str(b.assignmentId) || null,
      teacherName: str(b.teacher) || null,
      subjectId: b.subjectId || null,
      subjectDisplayName: str(b.label),
      roomId: str(b.roomId) || null,
      roomDisplayName: str(b.room) || null,
      type: b.type || 'curriculum',
    })
  }

  return {
    timetableId,
    displayTitle,
    school: str(header.school),
    year: str(header.year),
    term: header.term === 0 || header.term ? str(header.term) : '',
    className: str(header.className),
    grade: str(header.grade),
    classKey: `${normLabel(header.grade)}::${normLabel(header.className)}`,
    status: str(doc.status || 'complete'),
    savedAt: artifact.savedAt || null,
    createdAt: doc.createdAt || null,
    scheduleBlocks,
  }
}

/** Exact-time normalisation for a single block against its timetable's
 * period rows — the standalone helper form. */
export function normaliseBlockTime({ block, periods } = {}) {
  const n = normaliseTimetableForConflictCheck(
    { output: { header: {}, periods, blocks: [block] } },
    { timetableId: 't' },
  )
  const b = n?.scheduleBlocks?.[0]
  if (!b || b.timeReview) return { day: normLabel(block?.day), startMinutes: null, endMinutes: null, timeReview: true }
  return { day: b.day, startMinutes: b.startMinutes, endMinutes: b.endMinutes, timeReview: false }
}

/* ── Deterministic ids ───────────────────────────────────────── */

export function createConflictId({ type, currentTimetableId, currentBlockId, siblingTimetableId = '', siblingBlockId = '' }) {
  return ['cf', type, currentTimetableId, currentBlockId, siblingTimetableId, siblingBlockId]
    .map((p) => str(p) || '-').join('__')
}

/* ── The engine ──────────────────────────────────────────────── */

function fmtRange(b) {
  return b.timeReview ? 'time needs review' : `${b.startTime}–${b.endTime}`
}
function dayName(day) {
  return day ? day.charAt(0).toUpperCase() + day.slice(1) : ''
}
function blocksClash(a, b) {
  if (!a.day || a.day !== b.day) return false
  if (a.timeReview || b.timeReview) return false
  return intervalsOverlap(a.startMinutes, a.endMinutes, b.startMinutes, b.endMinutes)
}

/**
 * Run the full cross-timetable conflict check.
 *
 * @param {object} currentTimetable   normalised current timetable (use
 *                                    normaliseTimetableForConflictCheck on
 *                                    the LIVE in-memory artifact so unsaved
 *                                    edits are included)
 * @param {Array}  siblingTimetables  normalised siblings (already scoped)
 * @returns {{ conflicts:Array, coverage:object }}
 */
export function findCrossTimetableConflicts({ currentTimetable, siblingTimetables = [] } = {}) {
  const conflicts = []
  const cur = currentTimetable
  if (!cur) return { conflicts, coverage: buildCoverage(null, [], conflicts) }
  const siblings = (Array.isArray(siblingTimetables) ? siblingTimetables : []).filter(Boolean)

  /* 1 — internal class overlaps (run even with zero siblings). */
  const curBlocks = cur.scheduleBlocks || []
  for (let i = 0; i < curBlocks.length; i += 1) {
    for (let j = i + 1; j < curBlocks.length; j += 1) {
      const a = curBlocks[i]
      const b = curBlocks[j]
      if (!blocksClash(a, b)) continue
      const [first, second] = [a, b].sort((x, y) => x.blockId.localeCompare(y.blockId))
      conflicts.push({
        conflictId: createConflictId({
          type: 'class',
          currentTimetableId: cur.timetableId,
          currentBlockId: first.blockId,
          siblingTimetableId: cur.timetableId,
          siblingBlockId: second.blockId,
        }),
        type: 'class',
        severity: 'error',
        classId: cur.classKey,
        currentBlock: a,
        conflictingBlock: b,
        siblingTimetableId: cur.timetableId,
        siblingTimetableTitle: cur.displayTitle,
        message: `${a.subjectDisplayName || 'A lesson'} and ${b.subjectDisplayName || 'another lesson'} overlap in this class on ${dayName(a.day)} (${fmtRange(a)} vs ${fmtRange(b)}).`,
      })
    }
  }

  /* 2 — cross-timetable teacher + room conflicts. */
  for (const sib of siblings) {
    const sibBlocks = sib.scheduleBlocks || []

    // A second saved timetable claiming the same class in the same context
    // is almost certainly a duplicate — one review warning per sibling.
    if (cur.classKey && sib.classKey === cur.classKey) {
      conflicts.push({
        conflictId: createConflictId({
          type: 'class',
          currentTimetableId: cur.timetableId,
          currentBlockId: 'whole-timetable',
          siblingTimetableId: sib.timetableId,
          siblingBlockId: 'whole-timetable',
        }),
        type: 'class',
        severity: 'warning',
        classId: cur.classKey,
        currentBlock: null,
        conflictingBlock: null,
        siblingTimetableId: sib.timetableId,
        siblingTimetableTitle: sib.displayTitle,
        message: `“${sib.displayTitle}” also describes ${cur.className || 'this class'} for the same term and year — it may be a duplicate that should be archived.`,
      })
    }

    for (const a of curBlocks) {
      for (const b of sibBlocks) {
        if (!blocksClash(a, b)) continue

        /* Teacher: canonical id match = confirmed error; exact-name match
         * without ids on both sides = unverified warning. Never confirm by
         * display name alone. */
        if (a.teacherId && b.teacherId && a.teacherId === b.teacherId) {
          conflicts.push({
            conflictId: createConflictId({
              type: 'teacher',
              currentTimetableId: cur.timetableId,
              currentBlockId: a.blockId,
              siblingTimetableId: sib.timetableId,
              siblingBlockId: b.blockId,
            }),
            type: 'teacher',
            severity: 'error',
            teacherId: a.teacherId,
            teacherDisplayName: a.teacherName || b.teacherName || 'This teacher',
            currentBlock: a,
            siblingBlock: b,
            siblingTimetableId: sib.timetableId,
            siblingTimetableTitle: sib.displayTitle,
            message: `${a.teacherName || 'This teacher'} is scheduled for ${cur.className || 'this class'} ${a.subjectDisplayName} and ${sib.className || sib.displayTitle} ${b.subjectDisplayName} on ${dayName(a.day)} from ${minToTime(Math.max(a.startMinutes, b.startMinutes))} to ${minToTime(Math.min(a.endMinutes, b.endMinutes))}.`,
          })
        } else if (
          !(a.teacherId && b.teacherId)
          && a.teacherName && b.teacherName
          && normLabel(a.teacherName) === normLabel(b.teacherName)
        ) {
          conflicts.push({
            conflictId: createConflictId({
              type: 'teacher',
              currentTimetableId: cur.timetableId,
              currentBlockId: a.blockId,
              siblingTimetableId: sib.timetableId,
              siblingBlockId: b.blockId,
            }),
            type: 'teacher',
            severity: 'warning',
            identityUnverified: true,
            teacherId: null,
            teacherDisplayName: a.teacherName,
            currentBlock: a,
            siblingBlock: b,
            siblingTimetableId: sib.timetableId,
            siblingTimetableTitle: sib.displayTitle,
            message: `“${a.teacherName}” appears in both ${cur.className || 'this class'} and ${sib.className || sib.displayTitle} at overlapping times on ${dayName(a.day)}, but at least one block has no linked teacher account — the identity could not be verified.`,
          })
        }

        /* Room: canonical roomId = confirmed (error unless shareable);
         * label-only equality = warning. */
        if (a.roomId && b.roomId && a.roomId === b.roomId) {
          const facility = facilityById(a.roomId)
          conflicts.push({
            conflictId: createConflictId({
              type: 'room',
              currentTimetableId: cur.timetableId,
              currentBlockId: a.blockId,
              siblingTimetableId: sib.timetableId,
              siblingBlockId: b.blockId,
            }),
            type: 'room',
            severity: facility?.shareable ? 'warning' : 'error',
            roomId: a.roomId,
            roomDisplayName: facility?.label || a.roomDisplayName || a.roomId,
            currentBlock: a,
            siblingBlock: b,
            siblingTimetableId: sib.timetableId,
            siblingTimetableTitle: sib.displayTitle,
            message: facility?.shareable
              ? `${facility.label} is used by both ${cur.className || 'this class'} and ${sib.className || sib.displayTitle} on ${dayName(a.day)} (${fmtRange(a)}) — it is marked shareable, so confirm the double booking is intended.`
              : `${facility?.label || a.roomDisplayName || 'The room'} is booked for both ${cur.className || 'this class'} (${a.subjectDisplayName}) and ${sib.className || sib.displayTitle} (${b.subjectDisplayName}) on ${dayName(a.day)} from ${minToTime(Math.max(a.startMinutes, b.startMinutes))} to ${minToTime(Math.min(a.endMinutes, b.endMinutes))}.`,
          })
        } else if (
          !(a.roomId && b.roomId)
          && a.roomDisplayName && b.roomDisplayName
          && normLabel(a.roomDisplayName) === normLabel(b.roomDisplayName)
        ) {
          conflicts.push({
            conflictId: createConflictId({
              type: 'room',
              currentTimetableId: cur.timetableId,
              currentBlockId: a.blockId,
              siblingTimetableId: sib.timetableId,
              siblingBlockId: b.blockId,
            }),
            type: 'room',
            severity: 'warning',
            identityUnverified: true,
            roomId: null,
            roomDisplayName: a.roomDisplayName,
            currentBlock: a,
            siblingBlock: b,
            siblingTimetableId: sib.timetableId,
            siblingTimetableTitle: sib.displayTitle,
            message: `Rooms named “${a.roomDisplayName}” are booked in both ${cur.className || 'this class'} and ${sib.className || sib.displayTitle} at overlapping times on ${dayName(a.day)} — the room has no canonical id, so this may or may not be the same room.`,
          })
        }
      }
    }
  }

  return { conflicts, coverage: buildCoverage(cur, siblings, conflicts) }
}

/* ── Coverage ────────────────────────────────────────────────── */

function buildCoverage(current, siblings, conflicts) {
  const all = [current, ...siblings].filter(Boolean)
  let blocksChecked = 0
  let withTeacherIds = 0
  let legacyTeacherNameBlocks = 0
  let withRoomIds = 0
  let labelOnlyRoomBlocks = 0
  let timeFailures = 0
  for (const t of all) {
    for (const b of t.scheduleBlocks || []) {
      blocksChecked += 1
      if (b.timeReview) timeFailures += 1
      if (b.teacherId) withTeacherIds += 1
      else if (b.teacherName) legacyTeacherNameBlocks += 1
      if (b.roomId) withRoomIds += 1
      else if (b.roomDisplayName) labelOnlyRoomBlocks += 1
    }
  }
  const notes = []
  if (legacyTeacherNameBlocks > 0) {
    notes.push(`${legacyTeacherNameBlocks} block${legacyTeacherNameBlocks === 1 ? ' carries' : 's carry'} a teacher name without a linked teacher account — teacher conflicts for those blocks could not be verified reliably.`)
  }
  if (labelOnlyRoomBlocks > 0) {
    notes.push(`${labelOnlyRoomBlocks} block${labelOnlyRoomBlocks === 1 ? ' names' : 's name'} a room without a canonical room id — room conflicts for those blocks are reported as unverified warnings.`)
  }
  if (timeFailures > 0) {
    notes.push(`${timeFailures} block${timeFailures === 1 ? '' : 's'} could not be converted to reliable clock times — their time structure needs review.`)
  }
  const currentBroken = current
    ? (current.scheduleBlocks || []).some((b) => b.timeReview)
    : true
  const status = !current || (currentBroken && !(current.scheduleBlocks || []).some((b) => !b.timeReview))
    ? 'failed'
    : (legacyTeacherNameBlocks || timeFailures || labelOnlyRoomBlocks) ? 'partial' : 'complete'
  return {
    status, // 'complete' | 'partial' | 'failed'
    siblingsChecked: siblings.length,
    blocksChecked,
    blocksWithTeacherIds: withTeacherIds,
    legacyTeacherNameBlocks,
    blocksWithRoomIds: withRoomIds,
    labelOnlyRoomBlocks,
    timeNormalisationFailures: timeFailures,
    conflictCount: conflicts.length,
    notes,
  }
}

/* ── Display grouping + policies ─────────────────────────────── */

export function groupConflictsForDisplay(conflicts = []) {
  const groups = { teacher: [], room: [], class: [], review: [] }
  for (const c of Array.isArray(conflicts) ? conflicts : []) {
    if (c.identityUnverified) groups.review.push(c)
    else if (groups[c.type]) groups[c.type].push(c)
    else groups.review.push(c)
  }
  return groups
}

export function summariseConflicts(conflicts = []) {
  const list = Array.isArray(conflicts) ? conflicts : []
  return {
    total: list.length,
    errors: list.filter((c) => c.severity === 'error').length,
    warnings: list.filter((c) => c.severity === 'warning').length,
    teacher: list.filter((c) => c.type === 'teacher' && c.severity === 'error').length,
    room: list.filter((c) => c.type === 'room' && c.severity === 'error').length,
    class: list.filter((c) => c.type === 'class' && c.severity === 'error').length,
  }
}

/** Publish policy: error-level conflicts block a final save; warnings don't. */
export function blockingConflicts(conflicts = []) {
  return (Array.isArray(conflicts) ? conflicts : []).filter((c) => c.severity === 'error')
}

/**
 * Which siblings changed between two loads (stale-data protection): compares
 * each sibling's own savedAt/createdAt stamps. Returns display titles of
 * siblings that are new or changed since the previous snapshot.
 */
export function changedSiblingsSince(previousSiblings = [], freshSiblings = []) {
  const prev = new Map((previousSiblings || []).map((s) => [s.timetableId, s.savedAt || s.createdAt || null]))
  const changed = []
  for (const s of freshSiblings || []) {
    if (!prev.has(s.timetableId)) { changed.push(s.displayTitle); continue }
    const before = prev.get(s.timetableId)
    const now = s.savedAt || s.createdAt || null
    if (String(before ?? '') !== String(now ?? '')) changed.push(s.displayTitle)
  }
  return changed
}
