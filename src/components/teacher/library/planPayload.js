/**
 * Resolve the plan JSON a library item can export (.docx) / share.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The server generation pipeline stores a tool's document under `output`. The
 * Lesson Plan Studio is the exception: it assembles the plan in the browser and
 * saves it under `data` (never `output`), because firestore.rules only lets the
 * owner CREATE a `lesson_plan` doc with the studio field set
 * (`inputs/meta/data/html/studioFormat`) — `output` is reserved for the server
 * pipeline + in-place library edits. See saveLessonPlanGeneration().
 *
 * So EVERY studio-saved lesson plan has `data` but no `output`. Exporters and
 * the share flow that keyed off `item.output` alone therefore silently no-oped
 * on lesson plans (Word download + Share broke together while PDF, which
 * already fell back to `data`, worked). `data` is the same validated
 * lesson-plan JSON the DOCX/PDF exporters and the public share viewer's
 * LessonPlanView all consume, so falling back to it is safe.
 *
 * We only apply the `data` fallback for lesson plans: for every other tool
 * `output` is authoritative, and a stray `data` (if any) is not an exportable
 * plan.
 *
 * @param {{tool?: string, output?: unknown, data?: unknown}|null|undefined} item
 * @returns {object|null} the plan payload, or null when there's nothing to export.
 */
export function resolvePlanPayload(item) {
  if (!item || typeof item !== 'object') return null
  if (item.output && typeof item.output === 'object') return item.output
  if (item.tool === 'lesson_plan' && item.data && typeof item.data === 'object') return item.data
  return null
}
