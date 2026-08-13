import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchAiLessonCount } from '../../../utils/aiLessonCount'

/**
 * Recommends how many lessons a CBC sub-topic should be taught over.
 *
 * The recommendation now comes from the `aiLessonCount` Cloud Function
 * (Claude Haiku): count + reason + a per-lesson breakdown (title/focus) that
 * seeds the Lesson Series builder. Historically the backend didn't exist and
 * the hook computed a deterministic "one lesson per syllabus activity"
 * heuristic client-side — which read as canned ("doesn't feel like AI"),
 * especially on "Get New Suggestion" where it just cycled adjacent counts.
 *
 * The heuristic survives below as the OFFLINE FALLBACK: any backend failure
 * (offline, quota, cold start timeout) falls back to it silently so Lesson
 * Series mode never blocks — the regression the old backendless design was
 * patched for. `recommendation.source` says which path produced the value
 * ('ai' | 'heuristic') so the panel can badge genuine AI suggestions.
 *
 * "Get New Suggestion" passes the counts already shown (`avoidCounts`) to the
 * backend so each press genuinely re-plans the pacing rather than re-rolling
 * the same number.
 *
 * Heuristic: roughly one lesson per syllabus learning activity, clamped to a
 * sensible 1–6, defaulting to a short 2-lesson series when the row lists none.
 * The `variant` argument cycles it through alternative counts (nearest the
 * base first) so repeated fallback presses still move the suggestion.
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

/**
 * @param {string} topic
 * @param {string} subtopic
 * @param {string[]} learningActivities
 * @param {string} expectedStandard
 * @param {'cbc'|'previous'|null} curriculumMode
 * @param {{ grade?: string, subject?: string, enabled?: boolean }} [context]
 *   grade/subject sharpen the AI pacing; `enabled` gates the backend call so
 *   the studio only spends a request when the teacher is actually in Lesson
 *   Series mode (the only surface that renders the recommendation).
 */
export function useAILessonCount(topic, subtopic, learningActivities, expectedStandard, curriculumMode, context = {}) {
  const { grade = '', subject = '', enabled = true } = context

  const [recommendation, setRecommendation] = useState(null)
  const [loading, setLoading] = useState(false)

  const activities = Array.isArray(learningActivities) ? learningActivities : []
  // learningActivities serialised as a joined string to avoid new-array-
  // reference churn from parent re-renders producing a fresh array each time.
  const activitiesKey = activities.join('||')

  // A suggestion is meaningful once we're in CBC mode with a chosen sub-topic.
  const isReady = curriculumMode === 'cbc' && Boolean(topic) && Boolean(subtopic)
  const contextKey = [curriculumMode, topic, subtopic, activitiesKey, grade, subject].join('§')

  // Latest inputs in a ref so load() stays referentially stable.
  const inputsRef = useRef({})
  inputsRef.current = { topic, subtopic, activities, expectedStandard, grade, subject }

  const seqRef = useRef(0) // stale-response guard across context changes
  const shownCountsRef = useRef([]) // counts already surfaced for this contextKey
  const variantRef = useRef(0) // heuristic fallback cycling
  const loadedKeyRef = useRef(null) // contextKey the current recommendation is for

  const load = useCallback(async (avoidCounts) => {
    const seq = ++seqRef.current
    setLoading(true)
    const inputs = inputsRef.current
    try {
      const rec = await fetchAiLessonCount({
        grade: inputs.grade,
        subject: inputs.subject,
        topic: inputs.topic,
        subtopic: inputs.subtopic,
        learningActivities: inputs.activities,
        expectedStandard: inputs.expectedStandard,
        avoidCounts,
      })
      if (seq !== seqRef.current) return
      shownCountsRef.current = [...shownCountsRef.current, rec.count].slice(-6)
      setRecommendation({ ...rec, source: 'ai' })
    } catch {
      if (seq !== seqRef.current) return
      // Backend unavailable (offline, quota, timeout) — fall back to the
      // deterministic heuristic so series mode never blocks. Repeated
      // presses still cycle counts via the variant.
      const fallback = suggestLessonCount(inputsRef.current.activities, variantRef.current)
      variantRef.current += 1
      shownCountsRef.current = [...shownCountsRef.current, fallback.count].slice(-6)
      setRecommendation({ ...fallback, breakdown: [], source: 'heuristic' })
    } finally {
      if (seq === seqRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isReady) {
      seqRef.current += 1
      loadedKeyRef.current = null
      shownCountsRef.current = []
      variantRef.current = 0
      setRecommendation(null)
      setLoading(false)
      return
    }
    if (loadedKeyRef.current === contextKey) return
    // Fresh sub-topic context: drop anything from the previous one so a
    // toggled-off panel never shows a stale suggestion.
    seqRef.current += 1
    loadedKeyRef.current = null
    shownCountsRef.current = []
    variantRef.current = 0
    setRecommendation(null)
    setLoading(false)
    if (!enabled) return
    loadedKeyRef.current = contextKey
    load([])
  }, [isReady, enabled, contextKey, load])

  // "Get New Suggestion" / Retry — re-plan, avoiding the counts already shown.
  const fetchRecommendation = useCallback(() => {
    if (!isReady) return
    loadedKeyRef.current = contextKey
    load([...shownCountsRef.current])
  }, [isReady, contextKey, load])

  // `error` is kept in the return shape for API compatibility with the Lesson
  // Progression panel, but failures degrade to the heuristic instead of
  // surfacing an error state — the panel must never block series mode.
  return { recommendation, loading, error: null, fetchRecommendation }
}
