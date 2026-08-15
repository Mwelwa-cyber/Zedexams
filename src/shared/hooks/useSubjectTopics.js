import { useState, useEffect } from 'react'
import { getTopicsForSubject } from '../utils/curriculumDataService.js'
import { toDisplayMessage } from '../../utils/requestControl.js'
import { useAbortableRequest } from '../../hooks/useAbortableRequest.js'

/**
 * Fetches topics for the selected subject + grade + curriculum mode.
 *
 * Uses `useAbortableRequest` so a fast subject/grade/curriculum-mode change
 * cancels/ignores whatever was previously in flight — a slow response for
 * the PREVIOUS selection can never land after a newer selection has already
 * resolved (see the "curriculum and picker protection" requirement: CBC and
 * OBC topic lists must never mix).
 *
 * @param {string} subject - e.g. "Food & Nutrition Syllabus (Forms 1-4)"
 * @param {string} grade   - e.g. "Form 1" or "Grade 4"
 * @param {'cbc'|'previous'|null} curriculumMode
 * @returns {{ topics: Array<{label: string, subtopics: string[]}>, loading: boolean, error: string|null }}
 */
export function useSubjectTopics(subject, grade, curriculumMode) {
  const [topics, setTopics] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const { run, cancel } = useAbortableRequest({ timeoutMs: 10_000 })

  useEffect(() => {
    if (!subject || !grade || !curriculumMode) {
      setTopics([])
      setLoading(false)
      setError(null)
      return cancel
    }

    setLoading(true)
    setError(null)

    run(() => getTopicsForSubject(subject, grade, curriculumMode)).then((result) => {
      if (result.status === 'success') {
        setTopics(result.data)
        setLoading(false)
      } else if (result.status === 'error') {
        setError(toDisplayMessage(result.error))
        setTopics([])
        setLoading(false)
      }
      // 'stale' / 'aborted' — a newer subject/grade/curriculumMode change
      // already owns loading/error state; nothing to do here.
    }).catch(() => {}) // run() resolves a status object and never rejects; guards regardless

    return cancel
  }, [subject, grade, curriculumMode, run, cancel])

  return { topics, loading, error }
}
