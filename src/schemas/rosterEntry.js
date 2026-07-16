/**
 * src/schemas/rosterEntry.js
 *
 * Shape of one learner in a class register's official roster
 * (classRegisters/{classId}/roster/{rosterId}).
 *
 * Mirrors the project's write-strict / read-permissive convention (see
 * src/schemas/quiz.js): rosterEntryWriteSchema validates before any
 * addDoc/updateDoc; coerceRosterEntry normalises a doc on read so a legacy
 * or partially-broken row never blanks the roster table.
 */

import { z } from 'zod'
import { GENDERS, ROSTER_STATUSES } from '../utils/rosterImport.js'

const emptyableString = (max) =>
  z.preprocess((v) => (v == null ? '' : v), z.string().max(max))

// 'YYYY-MM-DD' or null — enrolment-window dates for the attendance register.
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null)

export const rosterEntryWriteSchema = z
  .object({
    classId: z.string().min(1).max(200),
    teacherUid: z.string().min(1).max(200),
    learnerNumber: emptyableString(20),
    fullName: z.string().min(1).max(120),
    // null is a first-class value (gender unknown), so accept it explicitly.
    gender: z.enum(GENDERS).nullable().default(null),
    parentPhone: z.string().max(40).nullable().default(null),
    status: z.enum(ROSTER_STATUSES).default('active'),
    // Set only when the entry was imported from / linked to a learner account.
    linkedUid: z.string().max(200).nullable().default(null),
    order: z.number().int().min(0).max(100000).default(0),
    // Attendance eligibility window (Class Register Studio). null = whole term:
    // legacy learners without enrolment dates stay fully eligible.
    joinedClassOn: isoDate,
    leftClassOn: isoDate,
  })
  .passthrough()

export const rosterEntryUpdateSchema = rosterEntryWriteSchema.partial()

// ── Read-side coercion ───────────────────────────────────────────

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}
function safeString(v, fallback = '') {
  if (v == null) return fallback
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return fallback
}
function safeNumber(v, fallback = 0) {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return fallback
}

export function coerceRosterEntry(raw) {
  if (!isPlainObject(raw)) return null
  const gender = GENDERS.includes(raw.gender) ? raw.gender : null
  const status = ROSTER_STATUSES.includes(raw.status) ? raw.status : 'active'
  return {
    ...raw,
    learnerNumber: safeString(raw.learnerNumber),
    fullName: safeString(raw.fullName),
    gender,
    parentPhone: raw.parentPhone == null ? null : safeString(raw.parentPhone),
    status,
    linkedUid: raw.linkedUid == null ? null : safeString(raw.linkedUid),
    order: safeNumber(raw.order, 0),
    joinedClassOn: /^\d{4}-\d{2}-\d{2}$/.test(raw.joinedClassOn || '') ? raw.joinedClassOn : null,
    leftClassOn: /^\d{4}-\d{2}-\d{2}$/.test(raw.leftClassOn || '') ? raw.leftClassOn : null,
  }
}

export const ROSTER_GENDERS = GENDERS
export const ROSTER_ENTRY_STATUSES = ROSTER_STATUSES
