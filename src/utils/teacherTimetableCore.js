// My Teaching Timetable — pure model (no Firebase, unit-testable).
//
// The Settings timetable (/settings/timetable) is the logged-in teacher's
// PERSONAL teaching schedule: what they teach, when, and how it covers their
// Teaching Assignments. It is deliberately NOT a second Class Timetable Studio
// — the studio (src/features/classTimetable/pages/ClassTimetableStudio.jsx)
// remains authoritative for a class's full schedule; this model only mirrors
// the blocks that belong to this teacher, plus manual personal periods.
//
// Storage: users/{uid}.timetable (same field the v1 grid used), upgraded to a
// versioned block-based shape:
//
//   {
//     schemaVersion: 2,
//     defaultPeriodLengthMinutes,      // fallback for manual periods only
//     displayPreferences: { timetableLayout, viewMode },
//     scheduleBlocks: [ ...blocks ],
//     legacyV1: { periodMinutes, days } | null,   // original v1 doc, retained
//   }
//
// Every block stores its own actual duration — linked and per-assignment
// durations are never overwritten by the default (a teacher can hold 30-minute
// Lower Primary and 40-minute Upper Primary periods on one timetable).
//
// Curriculum integrity: a block never carries its own grade/subject picked
// from a generic list — it references a Teaching Assignment (assignmentId),
// which is validated through validateAssignment (teachingProfileCore). Legacy
// v1 rows that can't be confidently matched are preserved and marked
// `needs-review`, never rewritten or dropped.
//
// Run tests: npm run test:teacher-timetable

import {
  normalizeAssignment,
  validateAssignment,
  assignmentLabel,
  gradeLabel,
  subjectLabel,
} from './teachingProfileCore.js'
import { TIMETABLE_DAYS, normalizeTimetable } from './teacherSettingsCore.js'

export const TT_SCHEMA_VERSION = 2
export const MAX_TT_BLOCKS = 100

export const TT_DAY_LABELS = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
}

// Same value strings as the Class Timetable Studio (classTimetable.js
// TIMETABLE_LAYOUTS) so the two surfaces speak one layout language.
export const TT_LAYOUT_VALUES = ['days-as-columns', 'days-as-rows']
export const TT_VIEW_MODES = ['grid', 'day', 'list']

export const TT_SOURCE_TYPES = ['manual', 'class-timetable', 'legacy']

// Sync states a linked block can be in relative to its source timetable.
export const TT_SYNC_STATES = ['synced', 'source-updated', 'source-missing']

// ── small coercers (mirror teacherSettingsCore.js) ───────────────────────────

function obj(v) {
  return v && typeof v === 'object' ? v : {}
}
function str(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}
function intInRange(v, min, max) {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  const r = Math.round(n)
  return r >= min && r <= max ? r : null
}
function oneOf(v, allowed, def) {
  return allowed.includes(v) ? v : def
}
function timeStr(v) {
  return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v.trim()) ? v.trim() : ''
}

// ── time math ────────────────────────────────────────────────────────────────

export function timeToMin(hhmm) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm || ''))
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

export function minToTime(total) {
  const t = Math.max(0, Math.min(23 * 60 + 59, Math.round(Number(total) || 0)))
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

/** "15 h 20 min" / "40 min" — workload display. */
export function formatTeachingMinutes(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0))
  const h = Math.floor(m / 60)
  const rest = m % 60
  if (h === 0) return `${rest} min`
  if (rest === 0) return `${h} h`
  return `${h} h ${rest} min`
}

// ── block model ──────────────────────────────────────────────────────────────

/**
 * Coerce a stored/partial block into the canonical shape. Duration is always
 * recomputed from start/end when both are valid, so a stale stored
 * durationMinutes can never disagree with the block's actual span.
 */
export function normalizeTtBlock(raw) {
  const d = obj(raw)
  const day = oneOf(d.day, TIMETABLE_DAYS, 'mon')
  const startTime = timeStr(d.startTime)
  const endTime = timeStr(d.endTime)
  const startMin = timeToMin(startTime)
  const endMin = timeToMin(endTime)
  const span = startMin != null && endMin != null && endMin > startMin ? endMin - startMin : null
  const lengthInPeriods = intInRange(d.lengthInPeriods, 1, 4) ?? 1
  const sourceType = oneOf(d.sourceType, TT_SOURCE_TYPES, 'manual')
  const original = d.originalValues && typeof d.originalValues === 'object'
    ? {
        subject: str(d.originalValues.subject, 40),
        grade: str(d.originalValues.grade, 12),
        label: str(d.originalValues.label, 60),
      }
    : null
  const snap = obj(d.snapshot)
  return {
    blockId: str(d.blockId, 80),
    day,
    startTime,
    endTime,
    durationMinutes: span ?? (intInRange(d.durationMinutes, 5, 480) ?? null),
    lengthInPeriods,
    blockType: lengthInPeriods >= 2 ? 'double' : 'single',
    assignmentId: str(d.assignmentId, 64),
    sourceType,
    classTimetableId: str(d.classTimetableId, 80),
    scheduleBlockId: str(d.scheduleBlockId, 80),
    roomId: str(d.roomId, 60),
    notes: str(d.notes, 200),
    locked: typeof d.locked === 'boolean' ? d.locked : sourceType === 'class-timetable',
    syncState: oneOf(d.syncState, TT_SYNC_STATES, 'synced'),
    migrationState: d.migrationState === 'needs-review' ? 'needs-review' : '',
    originalValues: original,
    // Display snapshot for resilience (labels survive an assignment delete);
    // canonical identity stays the assignmentId reference.
    snapshot: {
      label: str(snap.label, 80),
      grade: str(snap.grade, 12),
      subject: str(snap.subject, 40),
      className: str(snap.className, 40),
      curriculumType: str(snap.curriculumType, 12),
    },
  }
}

function isEmptyBlock(b) {
  return !b.startTime && !b.endTime && !b.assignmentId && !b.snapshot.label && !b.originalValues
}

// ── document model ───────────────────────────────────────────────────────────

/** True when the stored users/{uid}.timetable value is already the v2 shape. */
export function isTimetableV2(data) {
  return Number(obj(data).schemaVersion) >= TT_SCHEMA_VERSION
}

/**
 * Coerce a stored v2 timetable doc. v1 data should go through
 * migrateTimetableV1 instead (this normalizer treats non-v2 input as empty).
 */
export function normalizeTeacherTimetable(data = {}) {
  const d = obj(data)
  const prefs = obj(d.displayPreferences)
  const rawBlocks = Array.isArray(d.scheduleBlocks) ? d.scheduleBlocks : []
  const blocks = rawBlocks
    .slice(0, MAX_TT_BLOCKS)
    .map(normalizeTtBlock)
    .filter((b) => !isEmptyBlock(b))
  return {
    schemaVersion: TT_SCHEMA_VERSION,
    defaultPeriodLengthMinutes: intInRange(d.defaultPeriodLengthMinutes, 5, 240) ?? 40,
    displayPreferences: {
      timetableLayout: oneOf(prefs.timetableLayout, TT_LAYOUT_VALUES, 'days-as-columns'),
      viewMode: oneOf(prefs.viewMode, TT_VIEW_MODES, 'grid'),
    },
    scheduleBlocks: blocks,
    legacyV1: d.legacyV1 && typeof d.legacyV1 === 'object' ? d.legacyV1 : null,
  }
}

// ── legacy migration (v1 rows → v2 blocks) ──────────────────────────────────

/**
 * Match a v1 period row to the teacher's assignments. The old grid stored the
 * same canonical value spaces the assignments use (TEACHER_SUBJECTS slugs /
 * TEACHER_GRADES codes), so an exact (grade, subject) hit against exactly ONE
 * active, valid assignment is a confident match. Anything else — zero hits,
 * ambiguous hits, or a match that no longer passes curriculum validation — is
 * preserved as needs-review.
 */
export function matchLegacyEntry(entry, assignments = []) {
  const subject = str(obj(entry).subject, 40)
  const grade = str(obj(entry).grade, 12)
  if (!subject || !grade) return { assignment: null, confident: false }
  const list = (Array.isArray(assignments) ? assignments : []).filter((a) => {
    if (!a || !a.id) return false
    const n = normalizeAssignment(a)
    return n.isActive && n.subject === subject && n.grade === grade
  })
  if (list.length !== 1) return { assignment: null, confident: false }
  const only = list[0]
  if (!validateAssignment(only).valid) return { assignment: only, confident: false }
  return { assignment: only, confident: true }
}

/**
 * Convert a stored v1 timetable ({ periodMinutes, days }) into the v2 doc.
 * Idempotent: v2 input passes straight through normalizeTeacherTimetable, and
 * re-running on the same v1 data regenerates the same deterministic blockIds
 * (day + index), so nothing duplicates. The full original v1 value is retained
 * under `legacyV1` — migration never deletes the old structure.
 */
export function migrateTimetableV1(data = {}, assignments = []) {
  if (isTimetableV2(data)) return normalizeTeacherTimetable(data)
  const v1 = normalizeTimetable(data)
  const blocks = []
  for (const day of TIMETABLE_DAYS) {
    v1.days[day].forEach((entry, i) => {
      const startTime = timeStr(entry.start)
      const endTime = timeStr(entry.end) ||
        (startTime ? minToTime((timeToMin(startTime) ?? 0) + (v1.periodMinutes || 40)) : '')
      const { assignment, confident } = matchLegacyEntry(entry, assignments)
      const n = assignment ? normalizeAssignment(assignment) : null
      blocks.push(normalizeTtBlock({
        blockId: `tb_legacy_${day}_${i + 1}`,
        day,
        startTime,
        endTime,
        lengthInPeriods: 1,
        sourceType: 'legacy',
        assignmentId: confident ? assignment.id : '',
        locked: false,
        migrationState: confident ? '' : 'needs-review',
        originalValues: confident
          ? null
          : { subject: entry.subject, grade: entry.grade, label: entry.label },
        snapshot: n
          ? {
              label: assignmentLabel(n),
              grade: n.grade,
              subject: n.subject,
              className: n.className,
              curriculumType: n.curriculumType,
            }
          : {
              label: [entry.grade ? gradeLabel(entry.grade) : '', entry.subject ? subjectLabel(entry.subject) : '', entry.label]
                .filter(Boolean).join(' · '),
              grade: entry.grade,
              subject: entry.subject,
              className: '',
              curriculumType: '',
            },
      }))
    })
  }
  return normalizeTeacherTimetable({
    schemaVersion: TT_SCHEMA_VERSION,
    defaultPeriodLengthMinutes: v1.periodMinutes,
    displayPreferences: { timetableLayout: 'days-as-columns', viewMode: 'grid' },
    scheduleBlocks: blocks,
    legacyV1: v1,
  })
}

// ── overlap + conflict detection ────────────────────────────────────────────

/** [startMin, endMin) for a block, or null when its times are incomplete. */
export function blockRange(block) {
  const s = timeToMin(block?.startTime)
  const e = timeToMin(block?.endTime)
  if (s == null || e == null || e <= s) return null
  return { start: s, end: e }
}

/**
 * True when two blocks overlap in time on the same day. Half-open ranges, so
 * back-to-back periods (08:15–08:55 then 08:55–09:35) do NOT overlap, while
 * any partial intersection (08:15–08:55 vs 08:45–09:25) does.
 */
export function blocksOverlap(a, b) {
  if (!a || !b || a.day !== b.day) return false
  const ra = blockRange(a)
  const rb = blockRange(b)
  if (!ra || !rb) return false
  return ra.start < rb.end && rb.start < ra.end
}

function describeBlock(block, assignmentsById) {
  const a = assignmentsById?.[block.assignmentId]
  const label = a ? assignmentLabel(a) : (block.snapshot.label || 'Unscheduled period')
  return `${label} (${TT_DAY_LABELS[block.day]} ${block.startTime}–${block.endTime})`
}

function byId(assignments) {
  const map = {}
  for (const a of Array.isArray(assignments) ? assignments : []) {
    if (a && a.id) map[a.id] = a
  }
  return map
}

/**
 * All conflicts across the personal timetable:
 *   • overlap          — two blocks intersect in time (partial counts); a
 *                        linked-vs-manual pair is called out explicitly and
 *                        NEITHER record is dropped — resolution is manual.
 *   • room-clash       — two same-time blocks claim the same room (warning).
 *   • invalid-assignment — a block references a missing/failed assignment.
 *   • over-allocation  — an assignment has more periods scheduled than its
 *                        weekly allocation (warning).
 * Returns [{ type, severity: 'error'|'warning', message, blockIds }].
 */
export function computeConflicts({ blocks = [], assignments = [] } = {}) {
  const list = (Array.isArray(blocks) ? blocks : []).map(normalizeTtBlock)
  const ids = byId(assignments)
  const conflicts = []

  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i]
      const b = list[j]
      if (!blocksOverlap(a, b)) continue
      const crossSource =
        (a.sourceType === 'class-timetable') !== (b.sourceType === 'class-timetable')
      conflicts.push({
        type: crossSource ? 'linked-overlap' : 'overlap',
        severity: 'error',
        blockIds: [a.blockId, b.blockId],
        message: crossSource
          ? `A linked class timetable lesson overlaps a manual period: ${describeBlock(a, ids)} and ${describeBlock(b, ids)}. Both are kept — resolve one of them.`
          : `${describeBlock(a, ids)} overlaps ${describeBlock(b, ids)}.`,
      })
      if (a.roomId && b.roomId && a.roomId.toLowerCase() === b.roomId.toLowerCase()) {
        conflicts.push({
          type: 'room-clash',
          severity: 'warning',
          blockIds: [a.blockId, b.blockId],
          message: `Room "${a.roomId}" is booked twice on ${TT_DAY_LABELS[a.day]} (${a.startTime}–${a.endTime}).`,
        })
      }
    }
  }

  for (const b of list) {
    if (b.migrationState === 'needs-review') continue // surfaced as review, not conflict
    if (b.sourceType !== 'class-timetable' && !b.assignmentId) {
      conflicts.push({
        type: 'invalid-assignment',
        severity: 'error',
        blockIds: [b.blockId],
        message: `${describeBlock(b, ids)} is not attached to a Teaching Assignment.`,
      })
      continue
    }
    if (b.assignmentId) {
      const a = ids[b.assignmentId]
      if (!a) {
        conflicts.push({
          type: 'invalid-assignment',
          severity: 'error',
          blockIds: [b.blockId],
          message: `${describeBlock(b, ids)} references a Teaching Assignment that no longer exists.`,
        })
      } else if (!validateAssignment(a).valid) {
        conflicts.push({
          type: 'invalid-assignment',
          severity: 'error',
          blockIds: [b.blockId],
          message: `${describeBlock(b, ids)} references a Teaching Assignment that no longer passes curriculum validation.`,
        })
      }
    }
  }

  for (const row of computeCoverage({ assignments, blocks: list })) {
    if (row.status === 'over-allocated') {
      conflicts.push({
        type: 'over-allocation',
        severity: 'warning',
        blockIds: list.filter((b) => b.assignmentId === row.assignmentId).map((b) => b.blockId),
        message: `${row.label} has ${row.scheduled} scheduled periods but the Teaching Assignment requires ${row.required}.`,
      })
    }
  }

  return conflicts
}

// ── coverage + workload ─────────────────────────────────────────────────────

/**
 * Per-assignment coverage. A block contributes its EXPLICIT period count
 * (lengthInPeriods — a double counts as two), never "one per record".
 * Needs-review blocks don't count toward valid coverage.
 */
export function computeCoverage({ assignments = [], blocks = [] } = {}) {
  const list = (Array.isArray(blocks) ? blocks : []).map(normalizeTtBlock)
  return (Array.isArray(assignments) ? assignments : [])
    .filter((a) => a && a.id && normalizeAssignment(a).isActive)
    .map((a) => {
      const n = normalizeAssignment(a)
      const valid = validateAssignment(a).valid
      const scheduled = list
        .filter((b) => b.assignmentId === a.id && b.migrationState !== 'needs-review')
        .reduce((sum, b) => sum + b.lengthInPeriods, 0)
      const required = n.periodsPerWeek
      let status = 'not-scheduled'
      if (!valid) status = 'invalid'
      else if (required == null) status = scheduled > 0 ? 'complete' : 'not-scheduled'
      else if (scheduled === 0) status = 'not-scheduled'
      else if (scheduled < required) status = 'incomplete'
      else if (scheduled > required) status = 'over-allocated'
      else status = 'complete'
      return {
        assignmentId: a.id,
        label: assignmentLabel(n),
        curriculumType: n.curriculumType,
        durationMinutes: n.lessonDurationMinutes,
        required,
        scheduled,
        remaining: required == null ? null : required - scheduled,
        status,
      }
    })
}

/**
 * The weekly workload summary + §28-style validation rollup, recalculated
 * from the authoritative assignments and blocks (never trusted from storage).
 */
export function computeWorkload({ assignments = [], blocks = [] } = {}) {
  const list = (Array.isArray(blocks) ? blocks : []).map(normalizeTtBlock)
  const coverage = computeCoverage({ assignments, blocks: list })
  const conflicts = computeConflicts({ blocks: list, assignments })
  const needsReview = list.filter((b) => b.migrationState === 'needs-review')
  const countable = list.filter((b) => b.migrationState !== 'needs-review')

  // Invalid assignments are excluded from EVERY load figure — an assignment
  // that fails curriculum validation is a review item, not teaching load.
  const validCoverage = coverage.filter((c) => c.status !== 'invalid')
  const assignedPeriods = validCoverage.reduce((sum, c) => sum + (c.required ?? 0), 0)
  const scheduledPeriods = countable
    .filter((b) => b.assignmentId)
    .reduce((sum, b) => sum + b.lengthInPeriods, 0)
  const unscheduledPeriods = validCoverage
    .reduce((sum, c) => sum + Math.max(0, c.remaining ?? 0), 0)
  const overAllocatedPeriods = validCoverage
    .reduce((sum, c) => sum + Math.max(0, -(c.remaining ?? 0)), 0)

  const errorCount = conflicts.filter((c) => c.severity === 'error').length
  const invalidAssignmentCount = conflicts.filter((c) => c.type === 'invalid-assignment').length

  return {
    status: errorCount > 0 || needsReview.length > 0
      ? 'error'
      : conflicts.length > 0 || unscheduledPeriods > 0
        ? 'warning'
        : 'ok',
    assignedPeriods,
    scheduledPeriods,
    unscheduledPeriods,
    overAllocatedPeriods,
    teachingMinutes: countable.reduce((sum, b) => sum + (b.durationMinutes || 0), 0),
    manualPeriods: countable.filter((b) => b.sourceType === 'manual').length,
    linkedPeriods: countable.filter((b) => b.sourceType === 'class-timetable').length,
    legacyPeriods: countable.filter((b) => b.sourceType === 'legacy').length,
    doublePeriods: countable.filter((b) => b.blockType === 'double').length,
    conflictCount: conflicts.length,
    invalidAssignmentCount,
    needsReviewCount: needsReview.length,
    coverage,
    conflicts,
  }
}

// ── manual period validation ────────────────────────────────────────────────

/**
 * Gate for saving a manual/edited block. Errors block save; warnings don't.
 * Assignment validity is re-checked here (never trusted from the picker) and
 * overlaps against every other block are rejected outright.
 */
export function validateManualBlock({ block, blocks = [], assignments = [] } = {}) {
  const b = normalizeTtBlock(block)
  const errors = []
  const warnings = []
  const ids = byId(assignments)

  if (!b.assignmentId) errors.push('Choose a Teaching Assignment.')
  else {
    const a = ids[b.assignmentId]
    if (!a) errors.push('The selected Teaching Assignment no longer exists.')
    else {
      const v = validateAssignment(a)
      if (!v.valid) errors.push('The selected Teaching Assignment no longer passes curriculum validation. Review it in your Teaching Profile first.')
      warnings.push(...v.warnings)
    }
  }
  if (!b.startTime) errors.push('Enter a start time.')
  if (!b.endTime) errors.push('Enter an end time.')
  if (b.startTime && b.endTime && !blockRange(b)) errors.push('The end time must be after the start time.')

  if (blockRange(b)) {
    const others = (Array.isArray(blocks) ? blocks : [])
      .map(normalizeTtBlock)
      .filter((o) => o.blockId !== b.blockId)
    for (const o of others) {
      if (blocksOverlap(b, o)) {
        errors.push(`This period overlaps ${describeBlock(o, ids)}.`)
        break
      }
    }
  }

  if (b.assignmentId && ids[b.assignmentId]) {
    const cov = computeCoverage({
      assignments,
      blocks: [...(Array.isArray(blocks) ? blocks : []).filter((o) => obj(o).blockId !== b.blockId), b],
    }).find((c) => c.assignmentId === b.assignmentId)
    if (cov && cov.status === 'over-allocated') {
      warnings.push(`${cov.label} would have ${cov.scheduled} scheduled periods — more than its ${cov.required} periods/week allocation.`)
    }
  }

  return { valid: errors.length === 0, errors, warnings, block: b }
}

/** Deterministic id for a new block; suffixes on collision so ids stay stable. */
export function nextBlockId(blocks, day, startTime) {
  const base = `tb_${day}_${String(startTime || '').replace(':', '')}`
  const taken = new Set((Array.isArray(blocks) ? blocks : []).map((b) => obj(b).blockId))
  if (!taken.has(base)) return base
  let i = 2
  while (taken.has(`${base}_${i}`)) i += 1
  return `${base}_${i}`
}

// ── Class Timetable Studio sync ─────────────────────────────────────────────

/** Stable dedup key for a linked block. */
export function linkKey(block) {
  const b = obj(block)
  return b.classTimetableId && b.scheduleBlockId
    ? `${b.classTimetableId}:${b.scheduleBlockId}`
    : ''
}

const STUDIO_DAY_TO_TT = {
  monday: 'mon',
  tuesday: 'tue',
  wednesday: 'wed',
  thursday: 'thu',
  friday: 'fri',
}

/**
 * Turn a saved Class Timetable Studio generation into import candidates for
 * this teacher. Matching NEVER links by label alone — a candidate carries a
 * suggested assignment (exact subjectId hit, else a label hit as a weaker
 * suggestion) and the teacher confirms each one before import; after import
 * the link is held by stable ids (classTimetableId + scheduleBlockId), plus
 * teacherId/assignmentId when the studio block carries them.
 */
export function buildImportCandidates({ generation, assignments = [], teacherId = '' } = {}) {
  const g = obj(generation)
  const artifact = obj(g.output)
  const days = Array.isArray(artifact.days) ? artifact.days : []
  const periods = Array.isArray(artifact.periods) ? artifact.periods : []
  const lessonRows = periods.filter((p) => p && p.kind === 'lesson')
  const blocks = Array.isArray(artifact.blocks) ? artifact.blocks : []
  const active = (Array.isArray(assignments) ? assignments : [])
    .filter((a) => a && a.id && normalizeAssignment(a).isActive)

  const candidates = []
  for (const b of blocks) {
    if (!b || (b.type && b.type !== 'curriculum')) continue
    // The studio may serve schools whose blocks aren't this teacher's; when a
    // block DOES carry a teacherId, respect it strictly.
    if (b.teacherId && teacherId && b.teacherId !== teacherId) continue
    const day = STUDIO_DAY_TO_TT[String(b.day || '').toLowerCase()]
    if (!day) continue
    const startRow = lessonRows[b.startSlot - 1]
    const endRow = lessonRows[b.startSlot + (b.length || 1) - 2]
    if (!startRow?.start || !endRow?.end) continue

    let suggested = null
    let matchType = null
    if (b.assignmentId && active.some((a) => a.id === b.assignmentId)) {
      suggested = active.find((a) => a.id === b.assignmentId)
      matchType = 'id'
    } else if (b.subjectId) {
      const hit = active.filter((a) => normalizeAssignment(a).subject === b.subjectId)
      if (hit.length === 1) {
        suggested = hit[0]
        matchType = 'subject'
      }
    }
    if (!suggested && b.label) {
      const label = String(b.label).trim().toLowerCase()
      const hit = active.filter((a) => subjectLabel(normalizeAssignment(a).subject).toLowerCase() === label)
      if (hit.length === 1) {
        suggested = hit[0]
        matchType = 'label'
      }
    }

    candidates.push({
      classTimetableId: g.id || '',
      scheduleBlockId: b.blockId || '',
      day,
      startTime: startRow.start,
      endTime: endRow.end,
      lengthInPeriods: Math.max(1, Math.round(Number(b.length) || 1)),
      label: String(b.label || ''),
      subjectId: b.subjectId || null,
      room: b.room || '',
      suggestedAssignmentId: suggested ? suggested.id : '',
      matchType,
      sourceDays: days,
    })
  }
  return candidates
}

/** Materialise a confirmed import candidate as a linked schedule block. */
export function candidateToBlock(candidate, assignment) {
  const c = obj(candidate)
  const n = assignment ? normalizeAssignment(assignment) : null
  return normalizeTtBlock({
    blockId: `tb_link_${c.classTimetableId}_${c.scheduleBlockId}`,
    day: c.day,
    startTime: c.startTime,
    endTime: c.endTime,
    lengthInPeriods: c.lengthInPeriods,
    assignmentId: assignment?.id || '',
    sourceType: 'class-timetable',
    classTimetableId: c.classTimetableId,
    scheduleBlockId: c.scheduleBlockId,
    roomId: c.room || '',
    locked: true,
    syncState: 'synced',
    snapshot: n
      ? {
          label: assignmentLabel(n),
          grade: n.grade,
          subject: n.subject,
          className: n.className,
          curriculumType: n.curriculumType,
        }
      : { label: c.label, grade: '', subject: c.subjectId || '', className: '', curriculumType: '' },
  })
}

/**
 * Merge imported linked blocks into the current list. Re-importing UPDATES the
 * existing linked entry (matched on the stable linkKey) instead of creating a
 * copy; manual and legacy blocks are untouched.
 */
export function mergeImportedBlocks(current, imported) {
  const list = (Array.isArray(current) ? current : []).map(normalizeTtBlock)
  const byKey = new Map(list.map((b, i) => [linkKey(b) || `__idx_${i}`, i]))
  const out = [...list]
  for (const raw of Array.isArray(imported) ? imported : []) {
    const b = normalizeTtBlock(raw)
    const key = linkKey(b)
    if (key && byKey.has(key)) {
      const i = byKey.get(key)
      out[i] = { ...b, blockId: out[i].blockId } // keep the existing local id
    } else {
      out.push(b)
      if (key) byKey.set(key, out.length - 1)
    }
  }
  return out
}

/**
 * Reconcile linked blocks against their freshly-fetched source timetables.
 * sourcesById maps classTimetableId → generation doc (or null when the source
 * no longer exists). Where safe (linked blocks are read-only locally) the
 * change is applied automatically:
 *   • moved / re-timed / re-sized source block → block updated, 'source-updated'
 *   • source doc or source block gone          → kept, marked 'source-missing'
 *   • unchanged                                → 'synced'
 * Unfetched sources are left alone. Returns { blocks, changes: [msg] }.
 */
export function reconcileLinkedBlocks(blocks, sourcesById = {}) {
  const changes = []
  const out = (Array.isArray(blocks) ? blocks : []).map(normalizeTtBlock).map((b) => {
    if (b.sourceType !== 'class-timetable' || !b.classTimetableId) return b
    if (!(b.classTimetableId in obj(sourcesById))) return b
    const source = sourcesById[b.classTimetableId]
    const label = b.snapshot.label || 'Linked period'
    if (!source) {
      if (b.syncState !== 'source-missing') changes.push(`Source missing: the class timetable behind "${label}" was deleted.`)
      return { ...b, syncState: 'source-missing' }
    }
    const candidates = buildImportCandidates({ generation: source })
    const match = candidates.find((c) => c.scheduleBlockId === b.scheduleBlockId)
    if (!match) {
      if (b.syncState !== 'source-missing') changes.push(`Source missing: the linked class timetable block behind "${label}" no longer exists.`)
      return { ...b, syncState: 'source-missing' }
    }
    const moved =
      match.day !== b.day ||
      match.startTime !== b.startTime ||
      match.endTime !== b.endTime ||
      match.lengthInPeriods !== b.lengthInPeriods
    if (!moved) return { ...b, syncState: 'synced' }
    changes.push(`Source updated: "${label}" moved to ${TT_DAY_LABELS[match.day]} ${match.startTime}–${match.endTime}.`)
    return normalizeTtBlock({
      ...b,
      day: match.day,
      startTime: match.startTime,
      endTime: match.endTime,
      lengthInPeriods: match.lengthInPeriods,
      syncState: 'source-updated',
    })
  })
  return { blocks: out, changes }
}

// ── grid model ──────────────────────────────────────────────────────────────

/**
 * Pure render model shared by BOTH orientations and the list view: the same
 * schedule blocks in, sorted rows out. Switching layout or view NEVER changes
 * the blocks — it only changes how this model is drawn.
 * Returns { timeSlots: [{start,end}], days: ['mon',…], cell(day, slotIndex) }.
 */
export function buildTtGridModel(blocks) {
  const list = (Array.isArray(blocks) ? blocks : [])
    .map(normalizeTtBlock)
    .filter((b) => blockRange(b))
  const edges = new Set()
  for (const b of list) {
    edges.add(b.startTime)
    edges.add(b.endTime)
  }
  const sorted = [...edges].sort((x, y) => (timeToMin(x) ?? 0) - (timeToMin(y) ?? 0))
  const timeSlots = []
  for (let i = 0; i < sorted.length - 1; i += 1) {
    // Only keep slices some block actually covers, so gaps collapse.
    const s = timeToMin(sorted[i])
    const e = timeToMin(sorted[i + 1])
    if (list.some((b) => {
      const r = blockRange(b)
      return r.start <= s && r.end >= e
    })) {
      timeSlots.push({ start: sorted[i], end: sorted[i + 1] })
    }
  }
  const cell = (day, slotIndex) => {
    const slot = timeSlots[slotIndex]
    if (!slot) return { state: 'empty', block: null, span: 0 }
    const s = timeToMin(slot.start)
    const block = list.find((b) => {
      const r = blockRange(b)
      return b.day === day && r.start <= s && r.end > s
    })
    if (!block) return { state: 'empty', block: null, span: 0 }
    const r = blockRange(block)
    if (r.start === s) {
      // Span = number of consecutive slots this block covers.
      let span = 0
      for (let i = slotIndex; i < timeSlots.length; i += 1) {
        const si = timeToMin(timeSlots[i].start)
        const ei = timeToMin(timeSlots[i].end)
        if (si >= r.start && ei <= r.end) span += 1
        else break
      }
      return { state: 'start', block, span: Math.max(1, span) }
    }
    return { state: 'covered', block, span: 0 }
  }
  return { timeSlots, days: [...TIMETABLE_DAYS], cell }
}

/** Blocks grouped by day and sorted by start time — the list/day view model. */
export function blocksByDay(blocks) {
  const list = (Array.isArray(blocks) ? blocks : []).map(normalizeTtBlock)
  const out = {}
  for (const day of TIMETABLE_DAYS) {
    out[day] = list
      .filter((b) => b.day === day)
      .sort((a, b) => (timeToMin(a.startTime) ?? 0) - (timeToMin(b.startTime) ?? 0))
  }
  return out
}
