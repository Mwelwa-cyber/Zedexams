// Teaching Profile — pure normalizers + validators (no Firebase, unit-testable).
//
// The Teaching Profile is the single source of truth for WHO a teacher teaches:
// their school level, the school calendar they follow (by reference, never a
// copy), and a list of discrete TEACHING ASSIGNMENTS — one per (grade, subject,
// class) responsibility, each carrying its own curriculum and weekly periods.
//
// Storage (dedicated collection, decided in Phase 2):
//   teacherProfiles/{uid}                      — the profile doc (this file's
//                                                normalizeTeachingProfile shape)
//   teacherProfiles/{uid}/assignments/{id}     — one doc per assignment
//
// Term / week / holiday status is DERIVED at read time from the referenced
// calendar (see ./calendarResolver.js) — it is never stored here, so a calendar
// change is reflected everywhere without a migration.
//
// All shaping is Firebase-free so plain `node` test scripts cover it. The IO
// layer is ./teachingProfileService.js.
//
// Run tests: npm run test:teaching-profile

import {
  TEACHER_GRADES,
  TEACHER_SUBJECTS,
  ECE_SUBJECTS,
  ECE_GRADE_CODES,
  isSubjectValidForGrade,
  isGradeInCurriculum,
  subjectExistsInCurriculum,
  canonicalSubjectValue,
  SPLIT_LEGACY_SUBJECTS,
  splitSubjectsAtGrade,
} from '../config/teacherTaxonomy.js'
import { canonicalMathsScienceLabel } from '../config/mathsScienceArea.js'

// ── value spaces ─────────────────────────────────────────────────────────────

// The three MoE school levels. Values are lowercase codes; labels match the
// setup-wizard copy ("Early Childhood Education" / "Primary" / "Secondary").
export const SCHOOL_LEVELS = [
  { value: 'ece', label: 'Early Childhood Education' },
  { value: 'primary', label: 'Primary' },
  { value: 'secondary', label: 'Secondary' },
]
const SCHOOL_LEVEL_VALUES = SCHOOL_LEVELS.map((l) => l.value)

// Where the referenced calendar comes from. 'national' is the only source that
// resolves today (the hardcoded MoE calendar) — 'school' / 'teacher' are the
// forward seam for the Level-2 / Level-3 hierarchy (see ./calendarResolver.js).
export const CALENDAR_SOURCES = ['national', 'school', 'teacher']

// Profile lifecycle. A baseline record created before the setup wizard runs is
// a 'draft' (onboardingCompleted stays false); the wizard flips it to 'active'
// only after the required steps are saved.
export const PROFILE_STATUSES = ['draft', 'active']

// Canonical curriculum codes. The rest of the app uses two encodings —
// 'cbc'/'previous' (teacherPreferences.curriculum) and 'CBC'/'previous'
// (lessonPlans docs). normalizeCurriculumType folds every spelling — "new",
// "CBC", "2023" → 'cbc'; "old", "OBC", "previous", "2013" → 'previous' — so the
// Teaching Profile has exactly ONE representation.
export const CURRICULUM_TYPES = ['cbc', 'previous']

// Bounds — periods across a whole week (a heavy secondary load can top 40), and
// a single lesson period length in minutes.
export const MAX_PERIODS_PER_WEEK = 60
export const MIN_LESSON_MINUTES = 5
export const MAX_LESSON_MINUTES = 240

const VALID_GRADE_VALUES = new Set([
  ...TEACHER_GRADES.filter((g) => g.value).map((g) => g.value),
  'ECE', // legacy band code still accepted by the backend
])
const VALID_SUBJECT_VALUES = new Set([
  ...TEACHER_SUBJECTS.filter((s) => s.value).map((s) => s.value),
  ...ECE_SUBJECTS.filter((s) => s.value).map((s) => s.value),
])

// ── coercion helpers (mirrors teacherSettingsCore.js) ────────────────────────

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
function bool(v, def) {
  return typeof v === 'boolean' ? v : def
}
function oneOf(v, allowed, def) {
  return allowed.includes(v) ? v : def
}

// ── curriculum type ──────────────────────────────────────────────────────────

/** Fold any spelling of the two curricula into 'cbc' | 'previous'. */
export function normalizeCurriculumType(v) {
  const s = String(v ?? '').trim().toLowerCase()
  if (['previous', 'obc', 'old', '2013'].includes(s)) return 'previous'
  // 'cbc', 'new', '2023', '' and anything unknown default to the current CBC.
  return 'cbc'
}

/** Human label for a curriculum type — matches the wizard's radio copy. */
export function curriculumTypeLabel(v) {
  return normalizeCurriculumType(v) === 'previous'
    ? 'Old Curriculum (OBC)'
    : 'New Curriculum (CBC)'
}

// ── grade / subject / school-level helpers ───────────────────────────────────

/** Display label for a grade value (e.g. 'G4' → 'Grade 4'), else the raw value. */
export function gradeLabel(value) {
  const found = TEACHER_GRADES.find((g) => g.value === value)
  return found ? found.label : String(value ?? '')
}

/**
 * Display label for a subject slug (e.g. 'integrated_science' → 'Integrated
 * Science').
 *
 * `grade` is optional and only changes the combined maths/science area, which
 * TEACHER_SUBJECTS and ECE_SUBJECTS both carry under the `numeracy` slug under
 * two different names — without the grade the first list wins, which is right
 * for Grades 1-4 and wrong for Nursery/Reception.
 */
export function subjectLabel(value, grade) {
  const found =
    TEACHER_SUBJECTS.find((s) => s.value === value) ||
    ECE_SUBJECTS.find((s) => s.value === value)
  if (!found) return String(value ?? '')
  return canonicalMathsScienceLabel(found.label, grade) || found.label
}

/** Which school level a grade belongs to: ECE / primary (G1–G7) / secondary (G8+). */
export function schoolLevelForGrade(grade) {
  const g = String(grade ?? '').toUpperCase()
  if (ECE_GRADE_CODES.includes(g)) return 'ece'
  const m = g.match(/^G(\d{1,2})$/)
  if (m) return Number(m[1]) <= 7 ? 'primary' : 'secondary'
  return ''
}

// ── assignment ───────────────────────────────────────────────────────────────

/**
 * Coerce a stored/partial/tampered assignment into the canonical shape. Note
 * the `id` is NOT part of this shape — it's the Firestore doc id, carried
 * alongside by the service layer.
 */
export function normalizeAssignment(data = {}) {
  const d = obj(data)
  return {
    grade: str(d.grade, 12),
    // Fold a pre-split subject spelling ('accounts', 'food_nutrition') onto its
    // canonical key on read, so an assignment saved before the split keeps
    // resolving without waiting for the migration to run.
    subject: canonicalSubjectValue(str(d.subject, 40)),
    className: str(d.className, 40),
    curriculumType: normalizeCurriculumType(d.curriculumType),
    periodsPerWeek: intInRange(d.periodsPerWeek, 0, MAX_PERIODS_PER_WEEK),
    lessonDurationMinutes: intInRange(d.lessonDurationMinutes, MIN_LESSON_MINUTES, MAX_LESSON_MINUTES),
    isDefault: bool(d.isDefault, false),
    isActive: bool(d.isActive, true),
  }
}

/** Partial normalizer for merge-writes: only shapes the keys actually present. */
export function normalizeAssignmentPartial(data = {}) {
  const d = obj(data)
  const out = {}
  if ('grade' in d) out.grade = str(d.grade, 12)
  if ('subject' in d) out.subject = canonicalSubjectValue(str(d.subject, 40))
  if ('className' in d) out.className = str(d.className, 40)
  if ('curriculumType' in d) out.curriculumType = normalizeCurriculumType(d.curriculumType)
  if ('periodsPerWeek' in d) out.periodsPerWeek = intInRange(d.periodsPerWeek, 0, MAX_PERIODS_PER_WEEK)
  if ('lessonDurationMinutes' in d)
    out.lessonDurationMinutes = intInRange(d.lessonDurationMinutes, MIN_LESSON_MINUTES, MAX_LESSON_MINUTES)
  if ('isDefault' in d) out.isDefault = bool(d.isDefault, false)
  if ('isActive' in d) out.isActive = bool(d.isActive, true)
  return out
}

/**
 * Stable identity of an assignment for duplicate detection — grade + subject +
 * class (case-insensitive). Two assignments with the same key are "the same
 * teaching responsibility" (section 12: prevent duplicate assignments).
 */
export function assignmentKey(a) {
  const n = normalizeAssignment(a)
  return `${n.grade}::${n.subject}::${n.className.toLowerCase()}`
}

/** A short human label for an assignment card / selector ("Grade 4 · Mathematics"). */
export function assignmentLabel(a) {
  const n = normalizeAssignment(a)
  const parts = [gradeLabel(n.grade), subjectLabel(n.subject, n.grade)]
  if (n.className) parts.push(n.className)
  return parts.filter(Boolean).join(' · ')
}

/**
 * Validate an assignment for saving. Grade + subject are required, and the
 * (curriculum, grade, subject) trio must be a possible combination:
 *   • a grade the selected curriculum does not offer at all (Grade 7 / Grade 12
 *     under the CBC, the ECE bands under the 2013 set) is a hard ERROR,
 *   • a subject that exists exclusively in the OTHER curriculum (Principles of
 *     Accounts under the CBC, the combined Mathematics and Science area under
 *     the 2013 set) is a hard ERROR,
 *   • a within-curriculum grade-range mismatch stays a soft WARNING (the static
 *     map is a floor — the live syllabus catalog is the finer-grained picker
 *     source and may legitimately lead it).
 * Returns { valid, errors[], warnings[] }.
 */
export function validateAssignment(data = {}) {
  const n = normalizeAssignment(data)
  const errors = []
  const warnings = []
  if (!n.grade) errors.push('Choose a grade or form.')
  else if (!VALID_GRADE_VALUES.has(n.grade)) warnings.push(`Unrecognised grade "${n.grade}".`)
  else if (!isGradeInCurriculum(n.grade, n.curriculumType)) {
    errors.push(`${gradeLabel(n.grade)} is not offered in the ${curriculumTypeLabel(n.curriculumType)}. Choose a grade or form from that curriculum.`)
  }
  if (!n.subject) errors.push('Choose a subject.')
  // A subject that used to bundle two subjects can't be silently reinterpreted —
  // ask the teacher which one this assignment is. A hard error so
  // assignmentNeedsReview() surfaces it instead of it passing quietly.
  else if (SPLIT_LEGACY_SUBJECTS[n.subject]) {
    const options = SPLIT_LEGACY_SUBJECTS[n.subject].map((k) => subjectLabel(k)).join(' or ')
    errors.push(`${subjectLabel(n.subject, n.grade)} is now two separate subjects. Choose ${options}.`)
  }
  // Still a real subject elsewhere, but not at this grade — Home Economics is
  // three separate syllabi at CBC Forms 1-4. Same hard error for the same reason:
  // nothing can infer which one the assignment meant.
  else if (splitSubjectsAtGrade(n.subject, n.grade, n.curriculumType)) {
    const options = splitSubjectsAtGrade(n.subject, n.grade, n.curriculumType).map((k) => subjectLabel(k))
    const list = `${options.slice(0, -1).join(', ')} or ${options[options.length - 1]}`
    errors.push(`${subjectLabel(n.subject, n.grade)} is not one subject at ${gradeLabel(n.grade)} in the ${curriculumTypeLabel(n.curriculumType)}. Choose ${list}.`)
  }
  else if (!VALID_SUBJECT_VALUES.has(n.subject)) warnings.push(`Unrecognised subject "${n.subject}".`)
  else if (!subjectExistsInCurriculum(n.subject, n.curriculumType)) {
    errors.push('The selected subject does not belong to the selected curriculum and grade.')
  }
  if (n.grade && n.subject && VALID_GRADE_VALUES.has(n.grade) && VALID_SUBJECT_VALUES.has(n.subject) && errors.length === 0) {
    if (!isSubjectValidForGrade(n.subject, n.grade, n.curriculumType)) {
      warnings.push(`${subjectLabel(n.subject, n.grade)} is not usually taught at ${gradeLabel(n.grade)} in the ${curriculumTypeLabel(n.curriculumType)}.`)
    }
  }
  return { valid: errors.length === 0, errors, warnings }
}

/**
 * Review flag for an EXISTING assignment: true when its stored
 * (curriculum, grade, subject) trio is no longer a valid combination (stale
 * local data, a curriculum migration, or an old generic-list selection). The
 * caller shows the stored values and asks the teacher to re-select — the
 * assignment is never silently rewritten. Returns { needsReview, reasons[] }.
 */
export function assignmentNeedsReview(data = {}) {
  const v = validateAssignment(data)
  return { needsReview: !v.valid, reasons: v.errors }
}

/**
 * Find an existing assignment that duplicates `candidate` (same key), ignoring
 * the assignment with id === exceptId (so editing an assignment doesn't clash
 * with itself). Returns the duplicate or null. `assignments` items may carry an
 * `id`.
 */
export function findDuplicateAssignment(assignments, candidate, exceptId = null) {
  if (!Array.isArray(assignments)) return null
  const key = assignmentKey(candidate)
  return (
    assignments.find((a) => a && a.id !== exceptId && assignmentKey(a) === key) || null
  )
}

// ── profile ──────────────────────────────────────────────────────────────────

/**
 * Coerce the stored/partial/tampered teacher profile into the canonical shape.
 * Calendar is a REFERENCE (calendarId + source), never a copy of dates.
 */
export function normalizeTeachingProfile(data = {}) {
  const d = obj(data)
  return {
    schoolId: str(d.schoolId, 128),
    schoolLevel: oneOf(d.schoolLevel, SCHOOL_LEVEL_VALUES, ''),
    calendarId: str(d.calendarId, 64),
    calendarSource: oneOf(d.calendarSource, CALENDAR_SOURCES, 'national'),
    calendarInheritedFromSchool: bool(d.calendarInheritedFromSchool, false),
    academicYear: str(d.academicYear, 10),
    defaultAssignmentId: str(d.defaultAssignmentId, 64),
    // The assignment most recently selected ACROSS DEVICES (distinct from
    // defaultAssignmentId, the teacher's preferred first assignment). Written by
    // the dashboard when the teacher switches context, so a second device opens
    // on the same assignment. '' until the teacher picks one.
    activeAssignmentId: str(d.activeAssignmentId, 64),
    profileStatus: oneOf(d.profileStatus, PROFILE_STATUSES, 'draft'),
    onboardingCompleted: bool(d.onboardingCompleted, false),
    // A stored snapshot for cheap display; the live value is always recomputable
    // via computeProfileCompletion(), which is what the settings card should use.
    profileCompletion: intInRange(d.profileCompletion, 0, 100) ?? 0,
  }
}

/** Partial normalizer for merge-writes: only shapes the keys actually present. */
export function normalizeTeachingProfilePartial(data = {}) {
  const d = obj(data)
  const out = {}
  if ('schoolId' in d) out.schoolId = str(d.schoolId, 128)
  if ('schoolLevel' in d) out.schoolLevel = oneOf(d.schoolLevel, SCHOOL_LEVEL_VALUES, '')
  if ('calendarId' in d) out.calendarId = str(d.calendarId, 64)
  if ('calendarSource' in d) out.calendarSource = oneOf(d.calendarSource, CALENDAR_SOURCES, 'national')
  if ('calendarInheritedFromSchool' in d)
    out.calendarInheritedFromSchool = bool(d.calendarInheritedFromSchool, false)
  if ('academicYear' in d) out.academicYear = str(d.academicYear, 10)
  if ('defaultAssignmentId' in d) out.defaultAssignmentId = str(d.defaultAssignmentId, 64)
  if ('activeAssignmentId' in d) out.activeAssignmentId = str(d.activeAssignmentId, 64)
  if ('profileStatus' in d) out.profileStatus = oneOf(d.profileStatus, PROFILE_STATUSES, 'draft')
  if ('onboardingCompleted' in d) out.onboardingCompleted = bool(d.onboardingCompleted, false)
  if ('profileCompletion' in d) out.profileCompletion = intInRange(d.profileCompletion, 0, 100) ?? 0
  return out
}

/**
 * The completion checklist shown on the Teaching Profile settings card
 * (section 9). Recomputed from live data so it never drifts from the stored
 * snapshot. `assignments` items may carry an `id` (needed for the default
 * check).
 *
 * REQUIRED items drive the percentage — a complete core profile reaches 100%
 * WITHOUT a Class Timetable (a timetable is an optional enhancement, never a
 * requirement). RECOMMENDED items (timetable, scheme, lesson duration, extra
 * classes) improve planning accuracy but are NOT counted in the percentage.
 *
 * `teachingPeriodResolved` is true when the connected calendar resolves a live
 * term/week for the reference date (context.status === 'ok') — the caller
 * passes it because the resolver lives outside this pure module.
 *
 * Returns { percent, complete, items:[required], recommended:[…] }.
 */
export function computeProfileCompletion({
  profile = {},
  assignments = [],
  teachingPeriodResolved = false,
  timetableConnected = false,
  schemeConnected = false,
} = {}) {
  const p = normalizeTeachingProfile(profile)
  const list = (Array.isArray(assignments) ? assignments : []).map((a) => ({
    id: a?.id,
    ...normalizeAssignment(a),
  }))
  const hasActive = list.some((a) => a.isActive)
  const defaultOk =
    !!p.defaultAssignmentId && list.some((a) => a.id === p.defaultAssignmentId && a.isActive)

  // Required — the core profile. A timetable is deliberately absent here so a
  // complete profile reaches 100% without one.
  const items = [
    { key: 'calendar', label: 'School Calendar selected', done: !!p.calendarId },
    { key: 'academicYear', label: 'Academic year set', done: !!p.academicYear },
    { key: 'period', label: 'Current teaching period resolved', done: !!teachingPeriodResolved },
    { key: 'assignments', label: 'Teaching assignment added', done: hasActive },
    { key: 'default', label: 'Default assignment selected', done: defaultOk },
  ]
  const done = items.filter((i) => i.done).length
  const percent = Math.round((done / items.length) * 100)

  // Recommended — enhancements NOT counted in the percentage.
  const lessonDurationAdded = list.some((a) => a.isActive && a.lessonDurationMinutes != null)
  const additionalClasses = list.filter((a) => a.isActive).length > 1
  const recommended = [
    { key: 'timetable', label: 'Class Timetable connected', done: !!timetableConnected },
    { key: 'scheme', label: 'Scheme of Work connected', done: !!schemeConnected },
    { key: 'lessonDuration', label: 'Lesson duration added', done: lessonDurationAdded },
    { key: 'additionalClasses', label: 'Additional classes added', done: additionalClasses },
  ]

  return { percent, complete: percent === 100, items, recommended }
}

/**
 * Compare the profile's stored academic year with the year the calendar
 * actually resolved for the current reference date. A mismatch (e.g. profile
 * says 2026 but the live term is 2027) is surfaced NON-blockingly so the
 * teacher can review it — never silently combined. Returns
 * { mismatch, profileYear, resolvedYear }.
 */
export function academicYearMismatch(profile = {}, resolvedYear = null) {
  const p = normalizeTeachingProfile(profile)
  // Guard truthiness first — Number('') is 0, which would falsely "mismatch".
  const stored = p.academicYear ? Number(p.academicYear) : NaN
  const resolved = resolvedYear === null || resolvedYear === '' ? NaN : Number(resolvedYear)
  if (!Number.isFinite(stored) || !Number.isFinite(resolved)) {
    return { mismatch: false, profileYear: p.academicYear || null, resolvedYear: resolvedYear ?? null }
  }
  return { mismatch: stored !== resolved, profileYear: stored, resolvedYear: resolved }
}

/**
 * Given the current assignment list and a profile, decide which assignment id
 * is the effective default: the stored default if it still points at an active
 * assignment, else the first active assignment, else null. Used by the
 * dashboard context selector so a removed/deactivated default degrades safely.
 */
export function resolveDefaultAssignmentId(profile = {}, assignments = []) {
  const p = normalizeTeachingProfile(profile)
  const list = Array.isArray(assignments) ? assignments : []
  const stored = list.find((a) => a && a.id === p.defaultAssignmentId && normalizeAssignment(a).isActive)
  if (stored) return stored.id
  const firstActive = list.find((a) => a && normalizeAssignment(a).isActive)
  return firstActive ? firstActive.id : null
}

/**
 * Resolve which assignment is ACTIVE, in the cross-device source-of-truth order:
 *   1. deviceId            — this device's last selection (localStorage cache)
 *   2. profile.activeAssignmentId — the last selection synced from any device
 *   3. effective default   — stored default → first/only active
 *   4. '' — none resolvable (the UI should ask the teacher to choose)
 * Every candidate must still point at an ACTIVE assignment, so a deleted or
 * deactivated reference degrades safely instead of wedging a stale id.
 *
 * `storedInvalid` flags that profile.activeAssignmentId is set but no longer
 * points at an active assignment — the caller can repair it (write the resolved
 * id back) so other devices stop inheriting a dangling reference.
 *
 * @returns {{ id: string, source: string, storedInvalid: boolean }}
 */
export function resolveActiveAssignmentId(profile = {}, assignments = [], { deviceId = '' } = {}) {
  const p = normalizeTeachingProfile(profile)
  const list = (Array.isArray(assignments) ? assignments : []).filter(
    (a) => a && normalizeAssignment(a).isActive,
  )
  const has = (id) => !!id && list.some((a) => a.id === id)
  const storedActive = p.activeAssignmentId
  const storedInvalid = !!storedActive && !has(storedActive)

  let id = ''
  let source = 'none'
  if (has(deviceId)) {
    id = deviceId
    source = 'device'
  } else if (has(storedActive)) {
    id = storedActive
    source = 'profile-active'
  } else {
    // Effective default → first active (resolveDefaultAssignmentId already
    // falls back to the first/only active), so a lone assignment is covered here.
    const def = resolveDefaultAssignmentId(p, list)
    if (has(def)) {
      id = def
      source = 'profile-default'
    }
  }
  return { id, source, storedInvalid }
}
