/**
 * Choosing one specific competence when a sub-topic holds several (CBC).
 *
 * The loaded sub-topic row carries `competences[]` (syllabus order). Everything
 * downstream — the prompt, the summary card, wizard validation, the review step,
 * the saved plan — reads `specificCompetence` / `learningActivities` /
 * `expectedStandard` off the row, so choosing a competence means returning the
 * row with THOSE three fields swapped, not teaching every reader a new shape.
 *
 * The choice is stored as the competence's own text (`topicData.competence`).
 * Text, not an index: it survives a syllabus edit that reorders rows, and a
 * stale value (the teacher changed sub-topic, or restored an old draft) simply
 * matches nothing and falls back to the first competence — which is exactly what
 * the studio did before there was a choice.
 */

/** @returns {Array<{specificCompetence:string, learningActivities:string[], expectedStandard:string}>} */
export function competencesOf(row) {
  return Array.isArray(row?.competences) ? row.competences : []
}

/**
 * @param {object|null} row     a CBC row from getSubtopicDetail
 * @param {string} [chosen]     the competence text the teacher picked
 * @returns {object|null}       the same row when there is nothing to swap
 */
export function applyCompetenceChoice(row, chosen) {
  const list = competencesOf(row)
  if (list.length < 2) return row
  const pick = list.find((c) => c.specificCompetence === chosen) ?? list[0]
  if (pick.specificCompetence === row.specificCompetence) return row
  return {
    ...row,
    specificCompetence: pick.specificCompetence,
    learningActivities: pick.learningActivities,
    expectedStandard: pick.expectedStandard,
  }
}
