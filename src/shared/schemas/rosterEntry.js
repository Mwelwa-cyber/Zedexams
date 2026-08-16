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
import { GENDERS } from '../../utils/rosterImport.js'
import { LEARNER_STATUS_VALUES, normalizeLearnerStatus } from '../../utils/learnerStatus.js'
import { REVIEW_REASONS } from '../../utils/learnerStatus.js'

const emptyableString = (max) =>
  z.preprocess((v) => (v == null ? '' : v), z.string().max(max))

// 'YYYY-MM-DD' or null — enrolment-window dates for the attendance register.
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null)

const REVIEW_REASON_KEYS = Object.keys(REVIEW_REASONS)

/**
 * How this record got onto the class list. Kept because the review queue, the
 * audit trail and the import summary all need to say where a learner came
 * from, and reconstructing it from timestamps afterwards is guesswork.
 */
export const LEARNER_SOURCES = ['manual', 'paste', 'file', 'capture', 'account', 'unknown']

export const rosterEntryWriteSchema = z
  .object({
    classId: z.string().min(1).max(200),
    teacherUid: z.string().min(1).max(200),

    // ── identity ─────────────────────────────────────────────────
    // The learner's PERMANENT identity, stable across academic years. This
    // roster doc is one class ENROLMENT (§8): promoting Grade 4A/2026 into
    // Grade 5A/2027 writes a new enrolment carrying the same learnerId, so
    // the learner's history joins up without any document being rewritten.
    // Nullable because every roster row written before this field existed has
    // none, and back-filling one would be inventing an identity we cannot
    // verify.
    learnerId: z.string().max(200).nullable().default(null),
    // Position on the printed list ("1", "2", …) — NOT an identifier.
    learnerNumber: emptyableString(20),
    // The school's permanent identifier for the learner ("ADM-001").
    admissionNumber: z.string().max(40).nullable().default(null),
    fullName: z.string().min(1).max(120),
    // null is a first-class value (gender unknown), so accept it explicitly.
    gender: z.enum(GENDERS).nullable().default(null),
    dateOfBirth: isoDate,
    parentPhone: z.string().max(40).nullable().default(null),

    // ── enrolment ────────────────────────────────────────────────
    status: z.preprocess(
      (v) => (v == null ? v : normalizeLearnerStatus(v)),
      z.enum(LEARNER_STATUS_VALUES),
    ).default('active'),
    // The date the school admitted this learner into this class. Register days
    // before it show N/A (§9). `joinedClassOn` below is the value the
    // attendance calculator actually reads; the two are written together so
    // there is one date to fill in and one date to enforce.
    admissionDate: isoDate,
    previousSchool: z.string().max(200).nullable().default(null),
    leavingReason: z.string().max(200).nullable().default(null),
    destinationSchool: z.string().max(200).nullable().default(null),
    // Set only when the entry was imported from / linked to a learner account.
    linkedUid: z.string().max(200).nullable().default(null),
    order: z.number().int().min(0).max(100000).default(0),
    // Attendance eligibility window (Class Register Studio). null = whole term:
    // legacy learners without enrolment dates stay fully eligible.
    joinedClassOn: isoDate,
    leftClassOn: isoDate,

    // ── review ───────────────────────────────────────────────────
    // True while an imported record has not been confirmed by a human. It is
    // ORTHOGONAL to status: a captured learner is normally Active AND
    // unconfirmed. See src/utils/learnerStatus.js.
    needsReview: z.boolean().default(false),
    reviewReasons: z.array(z.enum(REVIEW_REASON_KEYS)).max(8).default([]),
    source: z.enum(LEARNER_SOURCES).default('manual'),
    // The capture/import session this row came out of, so a teacher reviewing
    // a name months later can still open the page it was read from.
    importSessionId: z.string().max(200).nullable().default(null),
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

function safeIso(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null
}
function nullableString(v) {
  return v == null ? null : (safeString(v) || null)
}

export function coerceRosterEntry(raw) {
  if (!isPlainObject(raw)) return null
  const gender = GENDERS.includes(raw.gender) ? raw.gender : null
  // Read-permissive: a row stored under the retired 'inactive' status must
  // still open (as Withdrawn) rather than silently reading back as Active,
  // which would put a departed learner back on tomorrow's register.
  const status = normalizeLearnerStatus(raw.status)
  const admissionDate = safeIso(raw.admissionDate)
  const joinedClassOn = safeIso(raw.joinedClassOn)
  return {
    ...raw,
    learnerId: nullableString(raw.learnerId),
    learnerNumber: safeString(raw.learnerNumber),
    admissionNumber: nullableString(raw.admissionNumber),
    fullName: safeString(raw.fullName),
    gender,
    dateOfBirth: safeIso(raw.dateOfBirth),
    parentPhone: nullableString(raw.parentPhone),
    status,
    // The two dates are written together, but rows predating `admissionDate`
    // carry only `joinedClassOn`. Reading each from the other keeps ONE
    // enrolment start on screen and in the eligibility check, instead of a
    // blank admission date beside a register that already shows N/A.
    admissionDate: admissionDate || joinedClassOn,
    previousSchool: nullableString(raw.previousSchool),
    leavingReason: nullableString(raw.leavingReason),
    destinationSchool: nullableString(raw.destinationSchool),
    linkedUid: nullableString(raw.linkedUid),
    order: safeNumber(raw.order, 0),
    joinedClassOn: joinedClassOn || admissionDate,
    leftClassOn: safeIso(raw.leftClassOn),
    needsReview: raw.needsReview === true,
    reviewReasons: Array.isArray(raw.reviewReasons)
      ? raw.reviewReasons.filter((r) => REVIEW_REASON_KEYS.includes(r)).slice(0, 8)
      : [],
    source: LEARNER_SOURCES.includes(raw.source) ? raw.source : 'unknown',
    importSessionId: nullableString(raw.importSessionId),
  }
}

export const ROSTER_GENDERS = GENDERS
export const ROSTER_ENTRY_STATUSES = LEARNER_STATUS_VALUES
