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

/**
 * Grade levels the Class Register can organise — the full Zambian school
 * ladder from early-childhood through lower-secondary, NOT just the CBC
 * Upper-Primary band the learner-facing app ships content for.
 *
 * The register is an organisational tool (roster, marks, reports), so a
 * teacher must be able to register any class they teach even where the
 * platform has no quizzes/lessons for that grade yet. Each option carries:
 *  - value  the stored wire value. Numeric grades stay as bare digit strings
 *           ('4'..'7') so existing registers remain valid unchanged.
 *  - label  full display label for register UI ("Grade 4", "Form 1").
 *  - short  label minus the redundant "Grade " prefix, for surfaces that
 *           already print their own "GRADE:" caption (the report cards).
 */
export const CLASS_REGISTER_GRADE_OPTIONS = [
  { value: 'baby',      label: 'Baby Class',    short: 'Baby Class' },
  { value: 'middle',    label: 'Middle Class',  short: 'Middle Class' },
  { value: 'reception', label: 'Reception',     short: 'Reception' },
  { value: '1', label: 'Grade 1', short: '1' },
  { value: '2', label: 'Grade 2', short: '2' },
  { value: '3', label: 'Grade 3', short: '3' },
  { value: '4', label: 'Grade 4', short: '4' },
  { value: '5', label: 'Grade 5', short: '5' },
  { value: '6', label: 'Grade 6', short: '6' },
  { value: '7', label: 'Grade 7', short: '7' },
  { value: 'form-1', label: 'Form 1', short: 'Form 1' },
  { value: 'form-2', label: 'Form 2', short: 'Form 2' },
  { value: 'form-3', label: 'Form 3', short: 'Form 3' },
  { value: 'form-4', label: 'Form 4', short: 'Form 4' },
]

const GRADES = CLASS_REGISTER_GRADE_OPTIONS.map((o) => o.value)
const GRADE_LABELS = Object.fromEntries(
  CLASS_REGISTER_GRADE_OPTIONS.map((o) => [o.value, o.label]),
)
const GRADE_SHORT = Object.fromEntries(
  CLASS_REGISTER_GRADE_OPTIONS.map((o) => [o.value, o.short]),
)

/**
 * Full display label for a stored register grade value ("4" → "Grade 4",
 * "form-1" → "Form 1"). Unknown values fall back to "Grade {value}" so a
 * legacy/odd value still renders something sensible.
 */
export function formatClassGrade(grade) {
  const key = grade == null ? '' : String(grade)
  return GRADE_LABELS[key] ?? `Grade ${key}`
}

/**
 * Grade label without the "Grade " prefix, for report headers that already
 * caption the field themselves ("4", "Form 1", "Baby Class").
 */
export function classGradeShortLabel(grade) {
  const key = grade == null ? '' : String(grade)
  return GRADE_SHORT[key] ?? key
}

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
