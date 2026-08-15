import { useState, useEffect } from 'react'
import { getSubjectsForGrade } from '../utils/curriculumDataService.js'
import { toDisplayMessage } from '../../utils/requestControl.js'
import { useAbortableRequest } from '../../hooks/useAbortableRequest.js'

/**
 * Fetches the subjects available for a grade + curriculum mode, sourced from
 * the SAME syllabi data the Topic/Subtopic dropdowns read (getMergedSyllabi /
 * the 2013 file). This is what keeps the studio connected to the Syllabi
 * Studio: the subject value the teacher picks is the exact syllabi subject key
 * (e.g. "Mathematics Syllabus (Grades 4-6)") that getTopicsForSubject() looks
 * up — so topics and subtopics actually load. Feeding it a static label like
 * "Mathematics" returns zero topics.
 *
 * Uses `useAbortableRequest` so switching grade/curriculum mode mid-flight
 * (a teacher tapping CBC Grade 4 then OBC Grade 7 before the first request
 * lands) can never let the stale first response overwrite the fresh one —
 * only the request that's still current when it resolves updates state.
 *
 * @param {string} grade   - e.g. "Grade 4", "Form 1"
 * @param {'cbc'|'previous'|null} curriculumMode
 * @returns {{ subjects: string[], loading: boolean, error: string|null }}
 */
export function useSubjectsForGrade(grade, curriculumMode) {
  const [subjects, setSubjects] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const { run, cancel } = useAbortableRequest({ timeoutMs: 10_000 })

  useEffect(() => {
    if (!grade || !curriculumMode) {
      setSubjects([])
      setLoading(false)
      setError(null)
      return cancel
    }

    setLoading(true)
    setError(null)

    run(() => getSubjectsForGrade(grade, curriculumMode)).then((result) => {
      if (result.status === 'success') {
        setSubjects(Array.isArray(result.data) ? result.data : [])
        setLoading(false)
      } else if (result.status === 'error') {
        setError(toDisplayMessage(result.error))
        setSubjects([])
        setLoading(false)
      }
      // 'stale' / 'aborted' — a newer grade/curriculumMode change already
      // owns loading/error state; nothing to do here.
    }).catch(() => {}) // run() resolves a status object and never rejects; guards regardless

    return cancel
  }, [grade, curriculumMode, run, cancel])

  return { subjects, loading, error }
}
