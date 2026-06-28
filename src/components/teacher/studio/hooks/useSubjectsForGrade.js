import { useState, useEffect } from 'react'
import { getSubjectsForGrade } from '../utils/curriculumDataService.js'

/**
 * Fetches the subjects available for a grade + curriculum mode, sourced from
 * the SAME syllabi data the Topic/Subtopic dropdowns read (getMergedSyllabi /
 * the 2013 file). This is what keeps the studio connected to the Syllabi
 * Studio: the subject value the teacher picks is the exact syllabi subject key
 * (e.g. "Mathematics Syllabus (Grades 4-6)") that getTopicsForSubject() looks
 * up — so topics and subtopics actually load. Feeding it a static label like
 * "Mathematics" returns zero topics.
 *
 * @param {string} grade   - e.g. "Grade 4", "Form 1"
 * @param {'cbc'|'previous'|null} curriculumMode
 * @returns {{ subjects: string[], loading: boolean, error: string|null }}
 */
export function useSubjectsForGrade(grade, curriculumMode) {
  const [subjects, setSubjects] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!grade || !curriculumMode) {
      setSubjects([])
      setLoading(false)
      setError(null)
      return
    }

    let cancelled = false

    setLoading(true)
    setError(null)

    getSubjectsForGrade(grade, curriculumMode)
      .then((result) => {
        if (cancelled) return
        setSubjects(Array.isArray(result) ? result : [])
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setSubjects([])
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [grade, curriculumMode])

  return { subjects, loading, error }
}
