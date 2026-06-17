/**
 * src/schemas/classRegister.js
 *
 * Shape of a Class Register document (classRegisters/{classId}).
 *
 * A class register is the teacher-owned official class — its roster lives in
 * the classRegisters/{classId}/roster subcollection, and marking records in
 * classRegisters/{classId}/records (added in a later phase). This is a NEW
 * collection, deliberately separate from the invite-code `classes` feature
 * (src/utils/classes.js): a register holds non-account learners (manual / CSV
 * / Excel) plus optional links to learner accounts.
 *
 * Write-strict / read-permissive, per src/schemas/quiz.js.
 */

import { z } from 'zod'
import { normalizeSubject } from '../config/curriculum.js'

const CLASS_STATUSES = ['active', 'archived']
const GRADES = ['4', '5', '6', '7']

export const classRegisterWriteSchema = z
  .object({
    className: z.string().min(1).max(120),
    // Grade arrives as '5' or 5 depending on the form; coerce to string.
    grade: z.preprocess(
      (v) => (v == null ? v : String(v)),
      z.enum(GRADES),
    ),
    term: z.string().max(40).default(''),
    // Academic year, e.g. 2026. Bounded so a typo can't write a wild value.
    year: z.number().int().min(2000).max(2100),
    school: z.string().max(200).nullable().default(null),
    subject: z.preprocess(
      (v) => (typeof v === 'string' && v ? normalizeSubject(v) : v),
      z.string().max(100).nullable().default(null),
    ),
    teacherUid: z.string().min(1).max(200),
    status: z.enum(CLASS_STATUSES).default('active'),
    learnerCount: z.number().int().min(0).max(100000).default(0),
  })
  .passthrough()

export const classRegisterUpdateSchema = classRegisterWriteSchema.partial()

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

export function coerceClassRegister(raw) {
  if (!isPlainObject(raw)) return null
  const grade = GRADES.includes(String(raw.grade)) ? String(raw.grade) : null
  const status = CLASS_STATUSES.includes(raw.status) ? raw.status : 'active'
  return {
    ...raw,
    className: safeString(raw.className),
    grade,
    term: safeString(raw.term),
    year: safeNumber(raw.year, new Date().getFullYear()),
    school: raw.school == null ? null : safeString(raw.school),
    subject: raw.subject == null ? null : safeString(raw.subject),
    status,
    learnerCount: safeNumber(raw.learnerCount, 0),
  }
}

export const CLASS_REGISTER_STATUSES = CLASS_STATUSES
export const CLASS_REGISTER_GRADES = GRADES
