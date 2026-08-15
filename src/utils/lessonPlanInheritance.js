// Lesson Plan → Worksheet/Homework inheritance (pure, unit-testable).
//
// Turns a SAVED lesson plan (as loaded from the library) into the teaching
// context a companion Worksheet/Homework studio should open on, so the teacher
// never re-enters grade / subject / topic / week. The plan is authoritative; a
// fallback seed (the active Teaching Profile assignment) fills only the fields a
// legacy plan is missing.
//
// Source-of-truth order per field: plan.meta.planned → plan.inputs → fallback
// seed. Grade/subject come from meta.planned first because it stores them in the
// StudioCurriculumSelector's own value-space ('G4' / 'mathematics'), whereas the
// studio's inputs use display labels.
//
// The returned `coords` feed buildGeneratorQueryString (whitelisted keys only),
// so they round-trip through the URL into the destination studio's selector seed
// + form. `instructions` grounds the generation in the lesson's CBC anchors via
// the shared buildAlignmentInstructions helper.
//
// Run tests: npm run test:lesson-plan-inheritance

import { buildAlignmentInstructions } from '../shared/utils/teacherPlanContext.js'
import { gradeLabel, subjectLabel, normalizeCurriculumType } from './teachingProfileCore.js'

/** The plan's structured body: studio-saved plans use `data`, server plans `output`. */
export function planBody(plan) {
  if (!plan || typeof plan !== 'object') return null
  if (plan.data && typeof plan.data === 'object') return plan.data
  if (plan.output && typeof plan.output === 'object') return plan.output
  return null
}

function termNumber(v) {
  const n = Math.round(Number(v))
  return n >= 1 && n <= 3 ? n : null
}

function intOrNull(v) {
  return Number.isFinite(Number(v)) ? Math.round(Number(v)) : null
}

/**
 * Build the "Grade 4 · Mathematics · Fractions · Term 2, Week 8" summary shown
 * in the destination studio's "Created from Lesson Plan" notice. Human labels;
 * skips any part it can't resolve.
 */
export function lessonPlanSourceLabel({ grade = '', subject = '', topic = '', term = null, schoolWeek = null } = {}) {
  const parts = []
  const g = gradeLabel(grade)
  if (g) parts.push(g)
  const s = subjectLabel(subject)
  if (s && s !== g) parts.push(s)
  if (topic) parts.push(String(topic))
  const tw = []
  const t = termNumber(term)
  if (t) tw.push(`Term ${t}`)
  const w = intOrNull(schoolWeek)
  if (w && w >= 1) tw.push(`Week ${w}`)
  if (tw.length) parts.push(tw.join(', '))
  return parts.join(' · ')
}

/**
 * Resolve the inherited teaching context from a saved lesson plan.
 * @param {object} plan          a normalised library generation (needs an `id`)
 * @param {object} [fallbackSeed] { curriculum, grade, subject } — the active
 *                                assignment seed, used ONLY for fields the plan
 *                                lacks (source-of-truth rule 2).
 * @returns {{ coords, sourceLessonPlanId, planned, label } | null}
 *   coords — for buildGeneratorQueryString (grade/subject/topic/subtopic/
 *            curriculum/term/plannedDate/className/schoolWeek/instructions/
 *            sourceLessonPlanId); null when `plan` carries no usable id.
 */
export function inheritFromLessonPlan(plan, fallbackSeed = null) {
  if (!plan || typeof plan !== 'object' || !plan.id) return null
  const planned = plan.meta && typeof plan.meta.planned === 'object' ? plan.meta.planned : {}
  const inputs = plan.inputs && typeof plan.inputs === 'object' ? plan.inputs : {}
  const fb = fallbackSeed && typeof fallbackSeed === 'object' ? fallbackSeed : {}

  const grade = planned.grade || inputs.grade || fb.grade || ''
  const subject = planned.subject || inputs.subject || fb.subject || ''
  const topic = inputs.topic || ''
  const subtopic = inputs.subtopic || ''
  // Plan curriculum wins; a legacy plan without one falls back to the seed.
  const currSource = planned.curriculumType || fb.curriculum || ''
  const curriculum = normalizeCurriculumType(currSource) === 'previous' ? 'previous' : 'cbc'
  const term = termNumber(inputs.term) || termNumber(planned.termNumber)
  const schoolWeek = intOrNull(planned.schoolWeek)
  const plannedDate = planned.plannedDate || ''
  const className = planned.className || ''
  const instructions = buildAlignmentInstructions(planBody(plan)) || ''

  const coords = {
    sourceLessonPlanId: plan.id,
    curriculum,
    ...(grade ? { grade } : {}),
    ...(subject ? { subject } : {}),
    ...(topic ? { topic } : {}),
    ...(subtopic ? { subtopic } : {}),
    ...(term ? { term } : {}),
    ...(schoolWeek && schoolWeek >= 1 ? { schoolWeek } : {}),
    ...(plannedDate ? { plannedDate } : {}),
    ...(className ? { className } : {}),
    ...(instructions ? { instructions } : {}),
  }

  return {
    coords,
    sourceLessonPlanId: plan.id,
    planned,
    label: lessonPlanSourceLabel({ grade, subject, topic, term, schoolWeek }),
  }
}
