import { useState, useEffect, useCallback } from 'react'

/**
 * Suggests how many lessons a CBC sub-topic should be taught over.
 *
 * This used to call an `aiLessonCount` Cloud Function — but that function was
 * never created on the backend, so the call always failed, the recommendation
 * stayed null, and (because the only way to set a lesson count lived inside the
 * recommendation panel) Lesson Series mode could never build a breakdown and
 * the Generate button stayed disabled. The suggestion is now computed
 * deterministically on the client from the syllabus learning activities — no
 * backend round-trip, no failing call, instant, and free. Teachers can always
 * override the count in the Lesson Progression panel.
 *
 * Heuristic: roughly one lesson per syllabus learning activity, clamped to a
 * sensible 1–6, defaulting to a short 2-lesson series when the row lists none.
 *
 * "Get New Suggestion": the base heuristic is deterministic, so naively
 * recomputing it returned the identical count + reason every press and the
 * button looked dead. The `variant` argument fixes that — it cycles the
 * suggestion through the other plausible lesson counts (fanning out around the
 * base, nearest first, full 1–6 span) so each press offers a genuinely
 * different alternative pace. `variant === 0` is always the base suggestion.
 *
 * @param {string[]} learningActivities
 * @param {number} [variant=0] which alternative to surface (0 = base heuristic)
 * @returns {{ count: number, reason: string }}
 */
export function suggestLessonCount(learningActivities, variant = 0) {
  const n = Array.isArray(learningActivities) ? learningActivities.length : 0
  const base = n > 0 ? Math.max(1, Math.min(6, n)) : 2

  // Candidate counts: the base first, then every other count in 1–6 ordered by
  // distance from the base (preferring the longer series when equidistant).
  const candidates = [1, 2, 3, 4, 5, 6].sort((a, b) => {
    const da = Math.abs(a - base)
    const db = Math.abs(b - base)
    return da !== db ? da - db : b - a
  })

  const idx = ((variant % candidates.length) + candidates.length) % candidates.length
  const count = candidates[idx]

  let reason
  if (idx === 0) {
    reason = n > 0
      ? `Based on the ${n} learning activit${n === 1 ? 'y' : 'ies'} the syllabus lists for this sub-topic. Adjust the count to fit your class.`
      : 'A typical sub-topic is taught over a short series. Adjust the count to fit your class.'
  } else if (count > base) {
    reason = `An alternative pace — ${count} shorter lessons give learners more time to practise. Adjust the count to fit your class.`
  } else {
    reason = `A tighter pace — cover the sub-topic in ${count} lesson${count === 1 ? '' : 's'}. Adjust the count to fit your class.`
  }

  return { count, reason }
}

export function useAILessonCount(topic, subtopic, learningActivities, expectedStandard, curriculumMode) {
  const [recommendation, setRecommendation] = useState(null)
  // Bumped by fetchRecommendation to surface the next alternative suggestion
  // (e.g. "Get New Suggestion"). Fed to suggestLessonCount as the variant.
  const [variant, setVariant] = useState(0)

  // learningActivities serialised as a joined string to avoid new-array-
  // reference churn from parent re-renders producing a fresh array each time.
  const activitiesKey = (Array.isArray(learningActivities) ? learningActivities : []).join('||')

  // A suggestion is meaningful once we're in CBC mode with a chosen sub-topic.
  // (We no longer gate on learningActivities/expectedStandard so the suggestion
  // shows even for sparse syllabus rows; the count heuristic still uses the
  // activities when present.)
  const isReady = curriculumMode === 'cbc' && Boolean(topic) && Boolean(subtopic)

  const fetchRecommendation = useCallback(() => {
    if (isReady) setVariant((c) => c + 1)
  }, [isReady])

  // Reset to the base suggestion whenever the sub-topic context changes, so a
  // freshly selected sub-topic starts from the base — not wherever the last
  // "Get New Suggestion" cycle happened to leave off.
  useEffect(() => {
    setVariant(0)
  }, [topic, subtopic, activitiesKey, curriculumMode])

  useEffect(() => {
    if (!isReady) {
      setRecommendation(null)
      return
    }
    setRecommendation(suggestLessonCount(learningActivities, variant))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic, subtopic, activitiesKey, curriculumMode, variant])

  // loading/error are kept in the return shape for API compatibility with the
  // Lesson Progression panel, but the deterministic path never produces them.
  return { recommendation, loading: false, error: null, fetchRecommendation }
}
