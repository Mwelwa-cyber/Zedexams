import { useState, useEffect, useCallback } from 'react'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../../../../firebase/config.js'

const functions = getFunctions(app, 'us-central1')

/**
 * Calls the `aiLessonCount` Cloud Function to get an AI-recommended lesson
 * count for a given CBC topic/subtopic.
 *
 * Only fires when ALL of: topic, subtopic, learningActivities.length > 0,
 * expectedStandard are truthy AND curriculumMode === 'cbc'.
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
export function useAILessonCount(topic, subtopic, learningActivities, expectedStandard, curriculumMode) {
  const [recommendation, setRecommendation] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [retryCounter, setRetryCounter] = useState(0)

  const isReady =
    curriculumMode === 'cbc' &&
    Boolean(topic) &&
    Boolean(subtopic) &&
    Array.isArray(learningActivities) &&
    learningActivities.length > 0 &&
    Boolean(expectedStandard)

  // Bumping retryCounter re-triggers the effect — single fetch path, single cleanup.
  const fetchRecommendation = useCallback(() => {
    if (isReady) setRetryCounter((c) => c + 1)
  }, [isReady])

  useEffect(() => {
    if (!isReady) {
      setRecommendation(null)
      setLoading(false)
      setError(null)
      return
    }

    let cancelled = false

    setLoading(true)
    setError(null)

    const fn = httpsCallable(functions, 'aiLessonCount')
    fn({ topic, subtopic, learningActivities, expectedStandard })
      .then((result) => {
        if (cancelled) return
        const { count, reason } = result.data
        setRecommendation({ count, reason })
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
    // learningActivities serialised as joined string to avoid new-array-reference
    // churn from parent re-renders producing a fresh array each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic, subtopic, learningActivities?.join('||'), expectedStandard, curriculumMode, retryCounter])

  return { recommendation, loading, error, fetchRecommendation }
}
