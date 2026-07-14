import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../../../contexts/AuthContext'
import { useTeachingProfile } from '../../../../features/teacherSettings/lib/useTeachingProfile'
import {
  resolveActiveAssignment,
  gradeToStudioFormat,
  pickPlannedDate,
} from '../../../../utils/plannedTeachingMeta.js'
import { subjectLabel } from '../../../../utils/teachingProfileCore.js'
import { getSubjectsForGrade } from '../utils/curriculumDataService.js'
import { cleanSubjectName } from '../utils/subjectName.js'
import { matchSubjectKey } from '../utils/teacherPlanContext.js'

function todayLocalISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * useActiveAssignmentContext — resolves the teacher's ACTIVE Teaching Profile
 * assignment into the Lesson Plan Studio's own field values, so a new plan can
 * open pre-filled from the profile (not just the weekly forecast).
 *
 * The active assignment is the persisted dashboard choice (localStorage
 * zedexams:prep-assignment:{uid}) → the profile default → the first active
 * assignment. Grade + subject are resolved against the SAME syllabi data the
 * studio's dropdowns use (getSubjectsForGrade / matchSubjectKey) and only
 * returned when they map to a real option — so prefilling can't leave an invalid
 * selection. Fail-closed: any gap resolves to a null/empty seed and the studio
 * behaves exactly as before.
 *
 * Returns `assignment` + `context` (the derived calendar context) too, so the
 * caller can build the planned-teaching metadata at save time.
 */
export function useActiveAssignmentContext() {
  const { currentUser } = useAuth()
  const uid = currentUser?.uid || null
  const tp = useTeachingProfile()

  const activeAssignments = useMemo(
    () => tp.assignments.filter((a) => a.isActive),
    [tp.assignments],
  )

  const assignment = useMemo(() => {
    let storedId = ''
    try { storedId = uid ? (localStorage.getItem(`zedexams:prep-assignment:${uid}`) || '') : '' } catch { /* private mode */ }
    return resolveActiveAssignment(activeAssignments, tp.effectiveDefaultId, storedId)
  }, [activeAssignments, tp.effectiveDefaultId, uid])

  const [seed, setSeed] = useState(null)

  useEffect(() => {
    let cancelled = false
    if (!assignment) { setSeed(null); return undefined }
    const grade = gradeToStudioFormat(assignment.grade)
    const curriculumMode = assignment.curriculumType === 'previous' ? 'previous' : 'cbc'
    const date = pickPlannedDate({ context: tp.context, todayISO: todayLocalISO() })
    async function run() {
      let subject = ''
      if (grade) {
        try {
          const keys = await getSubjectsForGrade(grade, curriculumMode)
          if (Array.isArray(keys) && keys.length) {
            subject = matchSubjectKey(subjectLabel(assignment.subject), keys, cleanSubjectName) || ''
          }
        } catch { subject = '' }
      }
      if (!cancelled) setSeed({ grade, subject, curriculumMode, date })
    }
    run()
    return () => { cancelled = true }
  }, [assignment, tp.context])

  return {
    loading: tp.loading,
    assignment,
    context: tp.context,
    seed,
    calendarUnavailable: tp.context?.status !== 'ok',
  }
}
