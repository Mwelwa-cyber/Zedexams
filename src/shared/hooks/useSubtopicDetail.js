import { useState, useEffect } from 'react'
import { getSubtopicDetail } from '../utils/curriculumDataService.js'

/**
 * Fetches the full curriculum row for the selected subtopic.
 *
 * @param {string} subject
 * @param {string} grade
 * @param {string} topic
 * @param {string} subtopic
 * @param {'cbc'|'previous'|null} curriculumMode
 * @returns {{ subtopicRow: object|null, loading: boolean, error: string|null }}
 */
export function useSubtopicDetail(subject, grade, topic, subtopic, curriculumMode) {
  const [subtopicRow, setSubtopicRow] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!subject || !grade || !topic || !subtopic || !curriculumMode) {
      setSubtopicRow(null)
      setLoading(false)
      setError(null)
      return
    }

    let cancelled = false

    setLoading(true)
    setError(null)

    getSubtopicDetail(subject, grade, topic, subtopic, curriculumMode)
      .then((result) => {
        if (cancelled) return
        // result may be null when the subtopic is not found — that is valid
        setSubtopicRow(result)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setSubtopicRow(null)
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [subject, grade, topic, subtopic, curriculumMode])

  return { subtopicRow, loading, error }
}
