import { useState, useEffect } from 'react'
import { getTopicsForSubject } from '../utils/curriculumDataService.js'

/**
 * Fetches topics for the selected subject + grade + curriculum mode.
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

  useEffect(() => {
    if (!subject || !grade || !curriculumMode) {
      setTopics([])
      setLoading(false)
      setError(null)
      return
    }

    let cancelled = false

    setLoading(true)
    setError(null)

    getTopicsForSubject(subject, grade, curriculumMode)
      .then((result) => {
        if (cancelled) return
        setTopics(result)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setTopics([])
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [subject, grade, curriculumMode])

  return { topics, loading, error }
}
