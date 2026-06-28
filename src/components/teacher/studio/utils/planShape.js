/**
 * planShape — helpers for reading and writing the Lesson Plan Studio's plan
 * JSON in a single canonical shape, so the manual/AI editor, the on-screen
 * preview (renderPlanHtml) and the Word export (lessonPlanToDocx) all agree.
 *
 * Why this exists: the studio's generated plan can carry stage activities under
 * either field-name family depending on what the model emitted —
 *   - renderPlanHtml reads string fields:  stage.teacher / stage.pupils /
 *     stage.assessment  (+ stage.duration), and
 *   - lessonPlanToDocx (v3) reads array fields: stage.teacherActivities /
 *     stage.learnerActivities / stage.assessmentCriteria (+ durationMinutes).
 * These never agreed, so a plan that rendered on screen could export with empty
 * stage cells (and vice-versa). normalizePlanShape() makes every stage carry
 * BOTH families with the same content, and the editor reads/writes through the
 * same helpers — so an edited plan renders and exports identically.
 *
 * Pure ES module, no React / browser deps, so it is unit-testable under `node`.
 */

/** Coerce a value to a trimmed, non-empty string[] (tolerates strings). */
export function toLines(value) {
  if (Array.isArray(value)) {
    return value.map((x) => String(x == null ? '' : x).trim()).filter(Boolean)
  }
  return String(value == null ? '' : value)
    .split(/\n|;\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Join a string[] (or string) into a newline-separated string. */
export function linesToText(value) {
  return toLines(value).join('\n')
}

/** Best-effort minutes from a stage's duration ("10 minutes", "10 min", 10). */
export function parseDurationMinutes(stage) {
  if (!stage) return 0
  const n = Number(stage.durationMinutes)
  if (Number.isFinite(n) && n > 0) return Math.round(n)
  const m = String(stage.duration || '').match(/\d+/)
  return m ? Number(m[0]) : 0
}

/**
 * Read a raw stage (either field family) into the canonical editor shape.
 * @returns {{name:string, durationMinutes:number, teacherActivities:string[],
 *   learnerActivities:string[], assessmentCriteria:string[]}}
 */
export function readStage(stage) {
  const s = stage && typeof stage === 'object' ? stage : {}
  return {
    name: String(s.name || '').trim(),
    durationMinutes: parseDurationMinutes(s),
    teacherActivities: toLines(s.teacherActivities != null ? s.teacherActivities : s.teacher),
    learnerActivities: toLines(
      s.learnerActivities != null ? s.learnerActivities :
        (s.pupils != null ? s.pupils : s.learners),
    ),
    assessmentCriteria: toLines(s.assessmentCriteria != null ? s.assessmentCriteria : s.assessment),
  }
}

/**
 * Write a canonical stage back into a plain stage object carrying BOTH field
 * families. Any unrecognised fields on `original` (e.g. the old-curriculum
 * CONTENT / METHODS columns) are preserved.
 */
export function writeStage(canonical, original = {}) {
  const c = canonical || {}
  const teacherActivities = toLines(c.teacherActivities)
  const learnerActivities = toLines(c.learnerActivities)
  const assessmentCriteria = toLines(c.assessmentCriteria)
  const minutes = Number(c.durationMinutes) || 0
  return {
    ...original,
    name: String(c.name || '').trim(),
    durationMinutes: minutes,
    duration: minutes ? `${minutes} min` : '',
    teacherActivities,
    teacher: teacherActivities.join('\n'),
    learnerActivities,
    pupils: learnerActivities.join('\n'),
    assessmentCriteria,
    assessment: assessmentCriteria.join('\n'),
  }
}

/**
 * Return a shallow clone of the plan whose stages each carry both field
 * families with identical content. Non-object input is returned unchanged.
 */
export function normalizePlanShape(plan) {
  if (!plan || typeof plan !== 'object') return plan
  if (!Array.isArray(plan.stages)) return { ...plan }
  return {
    ...plan,
    stages: plan.stages.map((s) => writeStage(readStage(s), s)),
  }
}

/** The canonical stages array for the editor. */
export function stagesForEditing(plan) {
  if (!plan || !Array.isArray(plan.stages)) return []
  return plan.stages.map(readStage)
}
