/**
 * Pure restore sequence for the Lesson Plan Studio draft.
 *
 * The Lesson Plan Studio's curriculum picker has several cascade-reset effects
 * that will WIPE a naive restore. This function encodes the exact setter order
 * that defeats them, so the ordering contract is unit-testable in isolation
 * (see restoreLessonPlan.test.js) rather than buried inside the component.
 *
 * Order and rationale:
 *   1. curriculumMode FIRST — so a restored grade is already valid for the
 *      mode's grade list (CBC vs Previous differ); defeats the mode-change
 *      "clear out-of-list grade" effect.
 *   2. lessonDetails as a WHOLE object (raw setter) — grade/subject are the raw
 *      syllabi keys, so the "subjects resolved → clear unknown subject" effect
 *      leaves them alone.
 *   3. topicData as a WHOLE object via the RAW setter — bypasses setTopicField's
 *      cascade (which resets subtopic/subtopicRow and clears outcomes), so
 *      topic + subtopic + subtopicRow land atomically and outcomes survive.
 *   4. selectedOutcomes AFTER topicData (defence-in-depth; step 3 doesn't touch
 *      them since it avoids setTopicField).
 *   5. learningEnvironments ONLY for CBC — Previous force-clears them, so
 *      restoring them there is pointless.
 *   6/7. lessonSeries / lessonBreakdown / formatOptions as whole objects.
 *
 * @param {object} s        the studioState setters (setCurriculumMode, setLessonDetails,
 *                          setTopicData, setSelectedOutcomes, setLearningEnvironments,
 *                          setLessonSeries, setLessonBreakdown, setFormatOptions)
 * @param {object|null} payload  a persisted lesson-plan draft payload
 */
export function applyLessonPlanRestore(s, payload) {
  if (!s || !payload) return
  if (payload.curriculumMode) s.setCurriculumMode(payload.curriculumMode)
  if (payload.lessonDetails) s.setLessonDetails(payload.lessonDetails)
  if (payload.topicData) s.setTopicData(payload.topicData)
  if (Array.isArray(payload.selectedOutcomes)) s.setSelectedOutcomes(payload.selectedOutcomes)
  if (payload.curriculumMode === 'cbc' && Array.isArray(payload.learningEnvironments)) {
    s.setLearningEnvironments(payload.learningEnvironments)
  }
  if (payload.lessonSeries) s.setLessonSeries(payload.lessonSeries)
  if (payload.lessonBreakdown) s.setLessonBreakdown(payload.lessonBreakdown)
  if (payload.formatOptions) s.setFormatOptions(payload.formatOptions)
}
