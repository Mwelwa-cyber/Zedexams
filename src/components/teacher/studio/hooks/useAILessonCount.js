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
 * @param {string} topic
 * @param {string} subtopic
 * @param {string[]} learningActivities
 * @param {string} expectedStandard
 * @param {'cbc'|'previous'|null} curriculumMode
 * @returns {{
 *   recommendation: {count: number, reason: string}|null,
 *   loading: boolean,
 *   error: string|null,
 *   fetchRecommendation: () => void
 * }}
 */
export function suggestLessonCount(learningActivities) {
  const n = Array.isArray(learningActivities) ? learningActivities.length : 0
  const count = n > 0 ? Math.max(1, Math.min(6, n)) : 2
  const reason = n > 0
    ? `Based on the ${n} learning activit${n === 1 ? 'y' : 'ies'} the syllabus lists for this sub-topic. Adjust the count to fit your class.`
    : 'A typical sub-topic is taught over a short series. Adjust the count to fit your class.'
  return { count, reason }
}

export function useAILessonCount(topic, subtopic, learningActivities, expectedStandard, curriculumMode) {
  const [recommendation, setRecommendation] = useState(null)
  // Bumped by fetchRecommendation to force a recompute (e.g. "Get new suggestion").
  const [nonce, setNonce] = useState(0)

  // A suggestion is meaningful once we're in CBC mode with a chosen sub-topic.
  // (We no longer gate on learningActivities/expectedStandard so the suggestion
  // shows even for sparse syllabus rows; the count heuristic still uses the
  // activities when present.)
  const isReady = curriculumMode === 'cbc' && Boolean(topic) && Boolean(subtopic)

  const fetchRecommendation = useCallback(() => {
    if (isReady) setNonce((c) => c + 1)
  }, [isReady])

  useEffect(() => {
    if (!isReady) {
      setRecommendation(null)
      return
    }
    setRecommendation(suggestLessonCount(learningActivities))
    // learningActivities serialised as a joined string to avoid new-array-
    // reference churn from parent re-renders producing a fresh array each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic, subtopic, learningActivities?.join('||'), curriculumMode, nonce])

  // loading/error are kept in the return shape for API compatibility with the
  // Lesson Progression panel, but the deterministic path never produces them.
  return { recommendation, loading: false, error: null, fetchRecommendation }
}
