/**
 * Choosing which syllabus learning activities a lesson focuses on (CBC).
 *
 * A specific competence usually lists several learning activities, more than
 * one 40-minute lesson can cover. The teacher may tick the ones THIS lesson is
 * about; the generator then builds the lesson around those and does not try to
 * squeeze every activity in.
 *
 * The choice is stored as the activities' own text (`topicData.focusActivities`),
 * for the same reason the competence choice is (see competenceChoice.js): text
 * survives a syllabus edit that reorders rows. It is never trusted on its own.
 * Every read intersects it with the activities of the row currently loaded, so
 * an entry left over from another sub-topic or competence, or from an old draft,
 * matches nothing and drops out. Nothing ticked means "no focus chosen", and the
 * plan draws on every activity, which is what the studio did before.
 */

/**
 * @param {object|null} row        the effective CBC row (competence already applied)
 * @param {string[]} [chosen]      the activity texts the teacher ticked
 * @returns {string[]}             the chosen activities still on this row, in syllabus order
 */
export function resolveFocusActivities(row, chosen) {
  const activities = Array.isArray(row?.learningActivities) ? row.learningActivities : []
  if (!Array.isArray(chosen) || chosen.length === 0) return []
  const picked = new Set(chosen)
  return activities.filter((a) => picked.has(a))
}

/**
 * Tick or untick one activity. Returns a new list scoped to the row, so a toggle
 * also clears entries left over from another sub-topic.
 *
 * @param {object|null} row
 * @param {string[]} [chosen]
 * @param {string} activity
 * @returns {string[]}
 */
export function toggleFocusActivity(row, chosen, activity) {
  const current = resolveFocusActivities(row, chosen)
  const next = current.includes(activity)
    ? current.filter((a) => a !== activity)
    : [...current, activity]
  return resolveFocusActivities(row, next)
}

/**
 * The prompt lines describing the focus, or [] when nothing is chosen.
 *
 * @param {object|null} row
 * @param {string[]} [chosen]
 * @returns {string[]}
 */
export function focusActivityPromptLines(row, chosen) {
  const focus = resolveFocusActivities(row, chosen)
  if (focus.length === 0) return []
  return [
    `Focus Learning Activities for THIS lesson (chosen by the teacher): ${focus.join(' | ')}`,
  ]
}

export const FOCUS_ACTIVITY_INSTRUCTION =
  'The teacher has chosen the focus learning activities for this lesson. Build the lesson development stage, the teacher\'s and learners\' activities and the assessment around those activities only. Do not try to cover the other syllabus activities in this lesson.'
