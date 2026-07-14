// Teaching Profile — migration inference (pure, no Firebase, unit-testable).
//
// Existing teachers have lesson plans, schemes, weekly forecasts, test papers
// and settings but no Teaching Profile. These helpers INFER candidate teaching
// assignments and profile defaults from that existing work so the setup wizard
// can show "We found these teaching assignments from your existing work"
// (section 26). They only SUGGEST — the teacher confirms before anything is
// saved, and no existing document is ever modified.
//
// Everything is defensive: inputs come from heterogeneous, possibly-legacy
// Firestore docs, so every field access is guarded.
//
// Run tests: npm run test:teaching-profile

import {
  normalizeCurriculumType,
  assignmentKey,
  schoolLevelForGrade,
} from './teachingProfileCore.js'

function s(v) {
  return typeof v === 'string' ? v.trim() : ''
}

// Pull a (grade, subject, curriculumType, className) tuple out of one document,
// tolerating the several shapes the audit found across collections:
//   aiGenerations: inputs.{grade,subject,curriculum}, output.header.subject
//   assessments:   grade|targetGrade, subject, curriculumType
//   lessonPlans:   grade, subject, curriculumType|curriculumId
function extractCandidate(docLike) {
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

  return {
    grade,
    subject,
    className,
    curriculumType: normalizeCurriculumType(rawCurriculum),
  }
}

/**
 * Infer suggested assignments from a teacher's existing documents. Pass any mix
 * of arrays (generations, assessments, lessonPlans, …) — order sets recency
 * (most-recent-first is fine; the first occurrence of a key wins its
 * curriculum). Deduped by grade+subject+class. Returns suggestions with a
 * `source` tag and a `count` of how many documents backed each one, sorted by
 * count desc so the strongest signals surface first.
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
  const byKey = new Map()
  for (const [source, list] of groups) {
    if (!Array.isArray(list)) continue
    for (const docLike of list) {
      const cand = extractCandidate(docLike)
      if (!cand) continue
      const key = assignmentKey(cand)
      if (byKey.has(key)) {
        byKey.get(key).count += 1
      } else {
        byKey.set(key, { ...cand, source, count: 1 })
      }
    }
  }
  return Array.from(byKey.values()).sort((a, b) => b.count - a.count)
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
