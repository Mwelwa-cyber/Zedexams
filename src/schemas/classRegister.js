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
import { CANONICAL_GRADES } from '../config/canonicalEducation.js'

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
 *
 * DERIVED from the canonical ladder (src/config/canonicalEducation.js) rather
 * than listed here, so the register cannot again offer a different set of
 * grades from the studios — it stopped at Form 4 while the product claimed to
 * serve Forms 1-6. What stays local is the register's own STORED value scheme
 * ('nursery', '4', 'form-1'), which existing documents depend on.
 */
export const CLASS_REGISTER_GRADE_OPTIONS = CANONICAL_GRADES.map((rung) => {
  if (rung.stage === 'ece') {
    return { value: rung.properName.toLowerCase(), label: rung.properName, short: rung.properName }
  }
  if (rung.formNumber != null) {
    const label = `Form ${rung.formNumber}`
    return { value: `form-${rung.formNumber}`, label, short: label }
  }
  const n = String(rung.gradeNumber)
  return { value: n, label: `Grade ${n}`, short: n }
})

const GRADES = CLASS_REGISTER_GRADE_OPTIONS.map((o) => o.value)

/**
 * Early-childhood values this register used to store, and the level they are
 * now. Zambian early childhood has TWO levels on a printed register — Nursery
 * and Reception — and the picker offers only those.
 *
 * They are still accepted, in both directions, because registers exist that
 * were saved under them: a teacher opening one must see a level the picker
 * offers rather than a raw `baby`, and saving it must not be refused. So a read
 * displays Nursery and a write normalises to `nursery`, which quietly retires
 * the old value the next time the register is touched. No migration, no
 * in-place rewrite of anyone's data.
 */
const LEGACY_ECE_GRADES = { baby: 'nursery', middle: 'nursery' }

/** The canonical stored value for a grade, accepting the retired spellings. */
export function normalizeClassGrade(grade) {
  const key = grade == null ? '' : String(grade)
  return LEGACY_ECE_GRADES[key] || key
}
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
  const key = normalizeClassGrade(grade)
  return GRADE_LABELS[key] ?? `Grade ${key}`
}

/**
 * Grade label without the "Grade " prefix, for report headers that already
 * caption the field themselves ("4", "Form 1", "Nursery").
 */
export function classGradeShortLabel(grade) {
  const key = normalizeClassGrade(grade)
  return GRADE_SHORT[key] ?? key
}

export const classRegisterWriteSchema = z
  .object({
    className: z.string().min(1).max(120),
    // Grade arrives as '5' or 5 depending on the form; coerce to string.
    grade: z.preprocess(
      (v) => (v == null ? v : normalizeClassGrade(v)),
      z.enum(GRADES),
    ),
    /**
     * DEPRECATED — a class exists for the WHOLE academic year (§13). A term is
     * chosen when opening attendance, reports or assessments, never stored on
     * the class. Kept in the schema, and kept on documents that already carry
     * it, because §28 forbids destroying the field before the migration that
     * moves it has been validated. Nothing writes it any more; the register's
     * term comes from the studio's term selector.
     */
    term: z.string().max(40).default(''),
    // Academic year, e.g. 2026. Bounded so a typo can't write a wild value.
    year: z.number().int().min(2000).max(2100),
    school: z.string().max(200).nullable().default(null),
    /**
     * The stream / class letter — the "A" of "Grade 4A". Separate from the
     * grade because two streams of the same grade are two classes with two
     * class lists and two registers, and separate from className because a
     * teacher may name the class anything ("Grade 4 Blue").
     */
    stream: z.string().max(20).nullable().default(null),
    /**
     * The class teacher of record, printed on the register and shown in the
     * class header. `classTeacherUid` is set when the class teacher holds a
     * ZedExams account; the name is stored either way, because a printed
     * register must name a person even where the school has one account.
     */
    classTeacherName: z.string().max(120).nullable().default(null),
    classTeacherUid: z.string().max(200).nullable().default(null),
    /**
     * DEPRECATED — subjects are a property of a TEACHING ASSIGNMENT, not of a
     * class (§7, §9). One class has one learner list regardless of how many
     * subjects are taught to it; storing a subject here is what produced a
     * separate "Grade 4A Mathematics" list beside "Grade 4A English". Retained
     * for the same migration reason as `term`, and reported by
     * scripts/migrate-class-subjects.mjs rather than deleted in place.
     */
    subject: z.preprocess(
      (v) => (typeof v === 'string' && v ? normalizeSubject(v) : v),
      z.string().max(100).nullable().default(null),
    ),
    // Curriculum framework the class follows ('cbc' | 'previous') — persisted
    // so the editor's seeded curriculum → grade → subject cascade re-opens on
    // the right framework. Optional: registers created before the
    // standardized selector lack it (the selector seed defaults those to CBC).
    curriculum: z.enum(['cbc', 'previous']).nullable().default(null),
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
  // Read-permissive: a register stored under a retired early-childhood value
  // must still open, as Nursery, rather than coming back with no grade at all.
  const canonical = normalizeClassGrade(raw.grade)
  const grade = GRADES.includes(canonical) ? canonical : null
  const status = CLASS_STATUSES.includes(raw.status) ? raw.status : 'active'
  return {
    ...raw,
    className: safeString(raw.className),
    grade,
    term: safeString(raw.term),
    year: safeNumber(raw.year, new Date().getFullYear()),
    school: raw.school == null ? null : safeString(raw.school),
    stream: raw.stream == null ? null : (safeString(raw.stream) || null),
    classTeacherName: raw.classTeacherName == null ? null : (safeString(raw.classTeacherName) || null),
    classTeacherUid: raw.classTeacherUid == null ? null : (safeString(raw.classTeacherUid) || null),
    subject: raw.subject == null ? null : safeString(raw.subject),
    curriculum: raw.curriculum === 'cbc' || raw.curriculum === 'previous' ? raw.curriculum : null,
    status,
    learnerCount: safeNumber(raw.learnerCount, 0),
  }
}

export const CLASS_REGISTER_STATUSES = CLASS_STATUSES
export const CLASS_REGISTER_GRADES = GRADES

/**
 * The name a class gets when the teacher has picked a grade and a stream but
 * not typed a name — "Grade 4" + "A" → "Grade 4A", "Form 1" + "B" → "Form 1B".
 *
 * Streams are printed with no space after a numbered level, which is how
 * Zambian schools write them, and with a space after a worded one ("Reception
 * A") where running them together would read as a single word.
 */
export function suggestClassName(grade, stream) {
  const level = formatClassGrade(grade)
  const s = String(stream ?? '').trim()
  if (!s) return level
  return /\d$/.test(level) ? `${level}${s}` : `${level} ${s}`
}

/**
 * How a class is identified in a heading, a printed register and a class
 * switcher. The teacher's own name for the class wins — they named it — and
 * the grade+stream form is the fallback for a class saved without one.
 */
export function classDisplayName(register) {
  const typed = String(register?.className ?? '').trim()
  if (typed) return typed
  return suggestClassName(register?.grade, register?.stream)
}
