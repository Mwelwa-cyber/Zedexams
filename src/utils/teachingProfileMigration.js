// Teaching Profile — migration inference (pure, no Firebase, unit-testable).
//
// Existing teachers have lesson plans, schemes, weekly forecasts, test papers
// and settings but no Teaching Profile. These helpers INFER candidate teaching
// assignments and profile defaults from that existing work so the setup wizard
// can show "We found these teaching assignments from your existing work"
// (section 26). They only SUGGEST — the teacher confirms before anything is
// saved, and no existing document is ever modified.
//
// Raw candidates flow through detectedAssignments.js, which canonicalises
// grades ("4" → G4) and subjects ("Mathematics Syllabus (Grades 4–6)" →
// Mathematics), dedupes on grade + subject + curriculum + class, and merges
// source-document lists — so the onboarding screen never shows the same
// teaching responsibility twice under different document titles.
//
// Everything is defensive: inputs come from heterogeneous, possibly-legacy
// Firestore docs, so every field access is guarded.
//
// Run tests: npm run test:teaching-profile · npm run test:detected-assignments

import {
  normalizeCurriculumType,
  assignmentKey,
  schoolLevelForGrade,
} from './teachingProfileCore.js'
import { normalizeDetectedAssignments } from './detectedAssignments.js'

function s(v) {
  return typeof v === 'string' ? v.trim() : ''
}

// Human labels for the document types that back a suggestion (source detail
// rows). Falls back to a title-cased version of the raw tool id.
const SOURCE_TYPE_LABELS = {
  lesson_plan: 'Lesson Plan',
  'lesson-plan': 'Lesson Plan',
  worksheet: 'Worksheet',
  flashcards: 'Flashcards',
  scheme_of_work: 'Scheme of Work',
  weekly_forecast: 'Weekly Forecast',
  record_of_work: 'Record of Work',
  mark_schedule: 'Mark Schedule',
  class_timetable: 'Class Timetable',
  rubric: 'Rubric',
  notes: 'Notes',
  homework: 'Homework',
  assessment: 'Test Paper',
  exam_paper: 'Exam Paper',
  sba_task: 'SBA Task',
  sba_plan: 'SBA Plan',
  sba_mark_sheet: 'SBA Mark Sheet',
  full_lesson: 'Lesson',
  lesson_activities: 'Lesson Activities',
  generation: 'Document',
  lessonPlan: 'Lesson Plan',
  document: 'Document',
}

export function sourceTypeLabel(raw) {
  const v = s(raw)
  if (!v) return 'Document'
  if (SOURCE_TYPE_LABELS[v]) return SOURCE_TYPE_LABELS[v]
  return v
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
}

// Best-effort millis from the timestamp shapes Firestore docs carry: a
// Timestamp ({seconds}/toMillis), a Date, an ISO string, or epoch millis.
function toMillis(v) {
  if (v == null) return null
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (v instanceof Date) return v.getTime()
  if (typeof v.toMillis === 'function') {
    try { return v.toMillis() } catch { /* fall through */ }
  }
  if (typeof v.seconds === 'number') return v.seconds * 1000
  if (typeof v === 'string') {
    const t = Date.parse(v)
    return Number.isFinite(t) ? t : null
  }
  return null
}

// A short human title for the backing document — NEVER a Firestore id.
function sourceTitle(d, inputs, header, fallback) {
  return (
    s(header.title) ||
    s(d.title) ||
    s(d.name) ||
    s(inputs.topic) ||
    fallback
  )
}

// Pull a (grade, subject, curriculumType, className) tuple out of one document,
// tolerating the several shapes the audit found across collections:
//   aiGenerations: inputs.{grade,subject,curriculum}, output.header.subject
//   assessments:   grade|targetGrade, subject, curriculumType
//   lessonPlans:   grade, subject, curriculumType|curriculumId
// Also captures WHICH document backed the candidate (id/title/type/date, for
// the expandable "Detected from" rows) and whether the curriculum came from a
// structured metadata field — a curriculum is never inferred from a title.
function extractCandidate(docLike, sourceTag) {
  const d = docLike && typeof docLike === 'object' ? docLike : {}
  const inputs = d.inputs && typeof d.inputs === 'object' ? d.inputs : {}
  const header =
    d.output && typeof d.output === 'object' && d.output.header && typeof d.output.header === 'object'
      ? d.output.header
      : {}

  const grade = s(d.grade) || s(d.targetGrade) || s(inputs.grade) || s(header.grade)
  const subject = s(d.subject) || s(inputs.subject) || s(header.subject)
  if (!grade || !subject) return null

  const rawCurriculum =
    s(d.curriculumType) || s(d.curriculumId) || s(inputs.curriculum) || s(header.curriculum)
  const className = s(d.className) || s(inputs.className) || s(d.stream) || ''

  const docType = s(d.tool) || sourceTag
  return {
    grade,
    subject,
    className,
    curriculumType: normalizeCurriculumType(rawCurriculum),
    // Structured metadata only — an empty field stays "not confirmed" rather
    // than defaulting to a guessed curriculum.
    curriculumSource: rawCurriculum ? 'structured' : '',
    sources: [
      {
        id: s(d.id),
        title: sourceTitle(d, inputs, header, sourceTypeLabel(docType)),
        typeLabel: sourceTypeLabel(docType),
        dateMs: toMillis(d.updatedAt) ?? toMillis(d.createdAt),
        sourceTag,
      },
    ],
  }
}

/**
 * Infer suggested assignments from a teacher's existing documents. Pass any mix
 * of arrays (generations, assessments, lessonPlans, …) — order sets recency
 * (most-recent-first is fine). Candidates are canonicalised + deduped by
 * grade + subject + curriculum + class (see detectedAssignments.js), merging
 * document source counts. Returns suggestions sorted by count desc so the
 * strongest signals surface first. Each suggestion carries BOTH the save shape
 * ({grade, subject, className, curriculumType, count, source}) and the display
 * shape ({gradeLabel, subjectLabel, curriculumLabel, curriculumConfirmed,
 * sourceCount, sources[], key}).
 *
 * @param {Object} sources  { generations?, assessments?, lessonPlans?, other? }
 */
export function inferAssignments(sources = {}) {
  const groups = [
    ['generation', sources.generations],
    ['assessment', sources.assessments],
    ['lessonPlan', sources.lessonPlans],
    ['document', sources.other],
  ]
  const candidates = []
  for (const [sourceTag, list] of groups) {
    if (!Array.isArray(list)) continue
    for (const docLike of list) {
      const cand = extractCandidate(docLike, sourceTag)
      if (cand) candidates.push(cand)
    }
  }

  return normalizeDetectedAssignments(candidates).map((n) => ({
    // Save shape (matches teacherProfiles/{uid}/assignments docs).
    grade: n.gradeId,
    subject: n.subjectId,
    className: n.className,
    // Saving needs a concrete value; unconfirmed folds to the platform default
    // (the teacher confirms in the wizard) — the UI shows "not confirmed".
    curriculumType: n.curriculumId || normalizeCurriculumType(''),
    count: n.sourceCount,
    // Legacy tag: which group first contributed this bucket (sources keep
    // insertion order through merges).
    source: n.sources[0]?.sourceTag || 'document',
    // Display shape (gradeLabel, subjectLabel, curriculumLabel,
    // curriculumConfirmed, sourceCount, sourceDocumentIds, sources, key).
    ...n,
  }))
}

/**
 * Infer profile defaults (school level, academic year, default curriculum) from
 * settings + the inferred assignments, to pre-fill the wizard. Never guesses a
 * calendar it can't back — calendarId is left to the resolver's default and the
 * teacher confirms it.
 *
 * @param {Object} args
 *   teacherPreferences  users/{uid}.teacherPreferences (curriculum defaults)
 *   assignments         output of inferAssignments (for a school-level vote)
 */
export function inferProfileDefaults({ teacherPreferences = {}, assignments = [] } = {}) {
  const prefs = teacherPreferences && typeof teacherPreferences === 'object' ? teacherPreferences : {}
  const curr = prefs.curriculum && typeof prefs.curriculum === 'object' ? prefs.curriculum : {}

  // School level: majority vote across inferred grades, else derive from the
  // preferred default grade, else blank (the teacher picks it).
  const levelVotes = {}
  for (const a of Array.isArray(assignments) ? assignments : []) {
    const lvl = schoolLevelForGrade(a && a.grade)
    if (lvl) levelVotes[lvl] = (levelVotes[lvl] || 0) + (a.count || 1)
  }
  let schoolLevel = Object.entries(levelVotes).sort((a, b) => b[1] - a[1])[0]?.[0] || ''
  if (!schoolLevel) schoolLevel = schoolLevelForGrade(s(curr.grade))

  return {
    schoolLevel,
    academicYear: s(curr.academicYear),
    defaultCurriculumType: normalizeCurriculumType(curr.curriculum),
  }
}

/**
 * Drop inferred suggestions the teacher already has as a saved assignment
 * (matched on grade+subject+class), so a partially-migrated teacher is never
 * re-offered a duplicate.
 */
export function suggestNewAssignments(inferred = [], existingAssignments = []) {
  const existing = new Set(
    (Array.isArray(existingAssignments) ? existingAssignments : []).map((a) => assignmentKey(a)),
  )
  return (Array.isArray(inferred) ? inferred : []).filter((sug) => !existing.has(assignmentKey(sug)))
}

/**
 * One call the onboarding surface uses: infer assignments from existing work,
 * drop any the teacher already has, and infer profile defaults. Pure — pass the
 * already-loaded document lists in.
 *
 * @returns {{ suggestions: object[], defaults: object }}
 */
export function buildMigrationPlan({
  generations, assessments, lessonPlans, other,
  teacherPreferences = {}, existingAssignments = [],
} = {}) {
  const inferred = inferAssignments({ generations, assessments, lessonPlans, other })
  return {
    suggestions: suggestNewAssignments(inferred, existingAssignments),
    defaults: inferProfileDefaults({ teacherPreferences, assignments: inferred }),
  }
}
