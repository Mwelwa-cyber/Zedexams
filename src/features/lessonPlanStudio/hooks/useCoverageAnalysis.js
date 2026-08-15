import { useEffect, useMemo, useState } from 'react'
import { getTopicsForSubject } from '../../../shared/utils/curriculumDataService.js'
import { coveredSubtopicKeySet, computeCoverageByKey } from '../lib/coverageAnalysis.js'
import { buildGradeSubjectKey, curriculumTypeLabel } from '../../../shared/utils/lessonMemory.js'

/**
 * useCoverageAnalysis — for the selected grade+subject, work out how much of the
 * syllabus the teacher has already planned, the % covered, the gaps, and the
 * next subtopic to plan.
 *
 * Coverage is now computed from the teacher's persistent lesson memory
 * (`lessonPlans`, passed in as `memoryPlans`) rather than the saved library, so
 * the Coverage panel and the per-subtopic Saved Lessons panel are driven by the
 * SAME source and never disagree — a freshly generated lesson bumps coverage
 * immediately, with no "save to library" step required. Matching is by the
 * deterministic subtopic key both sides build, so syllabus labels carrying
 * embedded codes (e.g. "O.1.2.1 …") still line up.
 *
 * The syllabus topics are fetched once per grade/subject/mode change; the
 * coverage itself is derived synchronously (memoised) so it tracks live memory
 * updates without refetching. Fails closed to `{ coverage: null }` on any error
 * (offline, syllabi unavailable in tests) so the panel just stays idle.
 *
 * @param {string|null} uid
 * @param {string} grade            studio grade value (e.g. "Grade 4")
 * @param {string} subject          studio subject key
 * @param {'cbc'|'previous'|null} curriculumMode
 * @param {object[]} [memoryPlans]  the teacher's lessonPlans memory records
 * @param {string} [currentTopic]   bias the "plan next" suggestion to this topic
 * @returns {{ coverage: object|null, loading: boolean, error: string|null }}
 */
export function useCoverageAnalysis(uid, grade, subject, curriculumMode, memoryPlans = [], currentTopic = '') {
  const [topicsState, setTopicsState] = useState({ topics: null, loading: false, error: null })

  useEffect(() => {
    if (!uid || !grade || !subject || !curriculumMode) {
      setTopicsState({ topics: null, loading: false, error: null })
      return undefined
    }

    let cancelled = false
    setTopicsState({ topics: null, loading: true, error: null })

    ;(async () => {
      try {
        const topics = await getTopicsForSubject(subject, grade, curriculumMode)
        if (!cancelled) setTopicsState({ topics, loading: false, error: null })
      } catch (err) {
        if (!cancelled) {
          setTopicsState({ topics: null, loading: false, error: err instanceof Error ? err.message : String(err) })
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [uid, grade, subject, curriculumMode])

  const coverage = useMemo(() => {
    if (!topicsState.topics || !grade || !subject || !curriculumMode) return null
    const curriculumType = curriculumTypeLabel(curriculumMode)
    const gradeSubjectKey = buildGradeSubjectKey({ curriculumType, grade, subject })
    const coveredKeys = coveredSubtopicKeySet(memoryPlans, gradeSubjectKey)
    return computeCoverageByKey(topicsState.topics, coveredKeys, { curriculumType, grade, subject, currentTopic })
  }, [topicsState.topics, memoryPlans, grade, subject, curriculumMode, currentTopic])

  return { coverage, loading: topicsState.loading, error: topicsState.error }
}
