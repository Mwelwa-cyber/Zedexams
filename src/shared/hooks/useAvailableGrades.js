import { useState, useEffect } from 'react'
import { getGradesWithSubjects } from '../utils/curriculumDataService.js'

/**
 * Resolve which of a candidate grade list actually has subjects in the loaded
 * syllabi for the active curriculum mode — so the Class picker never offers a
 * grade that resolves to an empty subject list (the "grades with no subjects"
 * bug). Sourced from the SAME data the subject/topic dropdowns read, so the
 * picker stays in sync with whatever the Syllabi Studio has ingested.
 *
 * Returns `available === null` until the first resolve completes, OR if the
 * data load failed. Callers should treat `null` as "fall back to the full
 * candidate list" rather than "hide every grade" — a transient load error must
 * never empty the picker.
 *
 * @param {string[]} candidateGrades   grade values, e.g. ["Grade 4", "Form 1"]
 * @param {'cbc'|'previous'|null} curriculumMode
 * @returns {{ available: string[]|null, loading: boolean }}
 */
export function useAvailableGrades(candidateGrades, curriculumMode) {
  const [available, setAvailable] = useState(null)
  const [loading, setLoading] = useState(false)

  // Stable primitive key so the effect doesn't refire on a fresh array identity
  // every render (the caller typically derives candidateGrades inline).
  const key = (candidateGrades || []).join('|')

  useEffect(() => {
    if (!curriculumMode || !key) {
      setAvailable(null)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)

    getGradesWithSubjects(key.split('|'), curriculumMode)
      .then((result) => {
        if (cancelled) return
        setAvailable(Array.isArray(result) ? result : [])
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        // Fall back to "unknown" so the picker shows the full candidate list
        // rather than hiding every grade on a transient data-load failure.
        setAvailable(null)
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [key, curriculumMode])

  return { available, loading }
}
