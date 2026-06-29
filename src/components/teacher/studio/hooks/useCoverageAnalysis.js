import { useEffect, useState } from 'react'
import { listMyGenerations } from '../../../../utils/teacherLibraryService'
import { getTopicsForSubject } from '../utils/curriculumDataService.js'
import { coveredSubtopicSet, computeCoverage } from '../utils/coverageAnalysis.js'

/**
 * useCoverageAnalysis — for the selected grade+subject, work out how much of the
 * syllabus the teacher has already planned (from their saved lesson plans), the
 * % covered, the gaps, and the next subtopic to plan.
 *
 * Reuses the same syllabi data the studio's dropdowns read
 * (getTopicsForSubject) and the library reader (listMyGenerations), then runs
 * the pure calculator in utils/coverageAnalysis.js. Refetches only when
 * grade / subject / mode change. Fails closed to `{ coverage: null }` on any
 * error (offline, Firestore unavailable in tests) so the panel just stays idle.
 *
 * @param {string|null} uid
 * @param {string} grade            studio grade value (e.g. "Grade 4")
 * @param {string} subject          studio subject key
 * @param {'cbc'|'previous'|null} curriculumMode
 * @returns {{ coverage: object|null, loading: boolean, error: string|null }}
 */
export function useCoverageAnalysis(uid, grade, subject, curriculumMode) {
  const [state, setState] = useState({ coverage: null, loading: false, error: null })

  useEffect(() => {
    if (!uid || !grade || !subject || !curriculumMode) {
      setState({ coverage: null, loading: false, error: null })
      return undefined
    }

    let cancelled = false
    setState({ coverage: null, loading: true, error: null })

    ;(async () => {
      try {
        const [topics, plans] = await Promise.all([
          getTopicsForSubject(subject, grade, curriculumMode),
          listMyGenerations({ uid, tool: 'lesson_plan' }),
        ])
        const covered = coveredSubtopicSet(plans, grade, subject)
        const coverage = computeCoverage(topics, covered)
        if (!cancelled) setState({ coverage, loading: false, error: null })
      } catch (err) {
        if (!cancelled) {
          setState({ coverage: null, loading: false, error: err instanceof Error ? err.message : String(err) })
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [uid, grade, subject, curriculumMode])

  return state
}
