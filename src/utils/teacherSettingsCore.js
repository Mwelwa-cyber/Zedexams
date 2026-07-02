// Teacher Settings — pure normalizers (no Firebase, unit-testable).
//
// The redesigned Teacher Settings page stores four maps on users/{uid}:
//   teacherProfile      — personal info (phone, TS number, qualification, …)
//   teaching            — assigned grades/subjects/streams + weekly load
//   teacherPreferences  — AI prefs + curriculum defaults + advanced toggles
//   timetable           — simple weekly period grid
//
// These helpers coerce whatever is stored (legacy / partial / tampered) into
// the canonical shapes the panels render and the studios consume. All writes
// go through AuthContext.updateProfileFields, which replaces a whole map, so
// panels ALWAYS normalize the latest userProfile value, merge their edits, and
// save the full map — never a partial one.
//
// Run tests: node src/utils/teacherSettingsCore.test.js

import { TEACHING_LANGUAGE_VALUES } from '../config/zambia.js'

// Value spaces shared with the studios. planDetail mirrors
// useStudioState.formatOptions.detail exactly so a saved preference can seed
// the Lesson Plan Studio without translation.
export const PLAN_DETAIL_VALUES = ['simplified', 'standard', 'detailed']
export const ENGLISH_VARIANTS = ['british', 'american']
export const DIFFICULTY_VALUES = ['easy', 'mixed', 'hard']
export const EXPORT_FORMAT_VALUES = ['pdf', 'docx', 'both']
export const CURRICULUM_VALUES = ['cbc', 'previous']
export const TIMETABLE_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri']
export const MAX_PERIODS_PER_DAY = 12

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

function strArray(v, { max, maxLen, allowed = null } = {}) {
  if (!Array.isArray(v)) return []
  const out = []
  for (const item of v) {
    const s = str(item, maxLen)
    if (!s) continue
    if (allowed && !allowed.includes(s)) continue
    if (!out.includes(s)) out.push(s)
    if (out.length >= max) break
  }
  return out
}

// ── teacherProfile ──────────────────────────────────────────────────────────

export function normalizeTeacherProfile(data = {}) {
  const d = data && typeof data === 'object' ? data : {}
  return {
    phone: str(d.phone, 20),
    tsNumber: str(d.tsNumber, 40),
    qualification: str(d.qualification, 40),
    yearsExperience: intInRange(d.yearsExperience, 0, 60),
    languages: strArray(d.languages, { max: 8, maxLen: 20, allowed: TEACHING_LANGUAGE_VALUES }),
    bio: typeof d.bio === 'string' ? d.bio.slice(0, 1000) : '',
    photoUrl: str(d.photoUrl, 2000),
    photoPath: str(d.photoPath, 500),
    // NOTE: the teacher's signature image lives on schoolProfiles/{uid}
    // (teacherSignatureUrl) with the other document-branding assets, since the
    // paper/plan exporters read that doc — see src/utils/schoolProfile.js.
  }
}

// ── teaching ────────────────────────────────────────────────────────────────

export function normalizeTeaching(data = {}) {
  const d = data && typeof data === 'object' ? data : {}
  return {
    grades: strArray(d.grades, { max: 16, maxLen: 10 }),
    subjects: strArray(d.subjects, { max: 20, maxLen: 40 }),
    streams: strArray(d.streams, { max: 12, maxLen: 20 }),
    classTeacherOf: str(d.classTeacherOf, 40),
    department: str(d.department, 80),
    weeklyLoadPeriods: intInRange(d.weeklyLoadPeriods, 0, 60),
  }
}

// ── teacherPreferences ──────────────────────────────────────────────────────

export function normalizeAiPreferences(data = {}) {
  const d = data && typeof data === 'object' ? data : {}
  const inc = d.include && typeof d.include === 'object' ? d.include : {}
  return {
    planDetail: oneOf(d.planDetail, PLAN_DETAIL_VALUES, 'standard'),
    teachingLanguage: oneOf(d.teachingLanguage, TEACHING_LANGUAGE_VALUES, 'english'),
    preferredEnglish: oneOf(d.preferredEnglish, ENGLISH_VARIANTS, 'british'),
    homeworkDifficulty: oneOf(d.homeworkDifficulty, DIFFICULTY_VALUES, 'mixed'),
    assessmentDifficulty: oneOf(d.assessmentDifficulty, DIFFICULTY_VALUES, 'mixed'),
    rememberLastUsed: bool(d.rememberLastUsed, true),
    include: {
      competencies: bool(inc.competencies, true),
      specificOutcomes: bool(inc.specificOutcomes, true),
      teachingAids: bool(inc.teachingAids, true),
      homework: bool(inc.homework, true),
      exercises: bool(inc.exercises, true),
      reflection: bool(inc.reflection, true),
    },
  }
}

export function normalizeCurriculumDefaults(data = {}) {
  const d = data && typeof data === 'object' ? data : {}
  return {
    curriculum: oneOf(d.curriculum, CURRICULUM_VALUES, 'cbc'),
    grade: str(d.grade, 10),
    subject: str(d.subject, 40),
    academicYear: str(d.academicYear, 10),
    term: str(d.term, 20),
  }
}

export function normalizeAdvancedPreferences(data = {}) {
  const d = data && typeof data === 'object' ? data : {}
  return {
    autosave: bool(d.autosave, true),
    offlineMode: bool(d.offlineMode, false),
    defaultDownloadFormat: oneOf(d.defaultDownloadFormat, EXPORT_FORMAT_VALUES, 'pdf'),
    performanceMode: bool(d.performanceMode, false),
  }
}

export function normalizeTeacherPreferences(data = {}) {
  const d = data && typeof data === 'object' ? data : {}
  return {
    ai: normalizeAiPreferences(d.ai),
    curriculum: normalizeCurriculumDefaults(d.curriculum),
    advanced: normalizeAdvancedPreferences(d.advanced),
  }
}

// ── timetable ───────────────────────────────────────────────────────────────

// 'HH:MM' 24h, or ''. Anything else → ''.
function timeStr(v) {
  return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v.trim()) ? v.trim() : ''
}

function normalizeTimetableEntry(entry) {
  const e = entry && typeof entry === 'object' ? entry : {}
  return {
    start: timeStr(e.start),
    end: timeStr(e.end),
    subject: str(e.subject, 40),
    grade: str(e.grade, 10),
    label: str(e.label, 60),
  }
}

// An entry with no content at all is dropped (keeps the doc small and the
// grid honest when a row was added then cleared).
function isEmptyTimetableEntry(e) {
  return !e.start && !e.end && !e.subject && !e.grade && !e.label
}

export function normalizeTimetable(data = {}) {
  const d = data && typeof data === 'object' ? data : {}
  const rawDays = d.days && typeof d.days === 'object' ? d.days : {}
  const days = {}
  for (const day of TIMETABLE_DAYS) {
    const list = Array.isArray(rawDays[day]) ? rawDays[day] : []
    days[day] = list
      .slice(0, MAX_PERIODS_PER_DAY)
      .map(normalizeTimetableEntry)
      .filter((e) => !isEmptyTimetableEntry(e))
  }
  return {
    periodMinutes: intInRange(d.periodMinutes, 5, 240) ?? 40,
    days,
  }
}

// Total periods across the week — surfaced next to the Teaching panel's
// weekly-load field so the timetable and the stated load can be compared.
export function timetableWeeklyLoad(timetable) {
  const t = normalizeTimetable(timetable)
  return TIMETABLE_DAYS.reduce((sum, day) => sum + t.days[day].length, 0)
}
