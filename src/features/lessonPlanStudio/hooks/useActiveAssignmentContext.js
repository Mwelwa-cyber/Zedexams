import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { useTeachingProfile } from '../../teacherSettings'
import {
  resolveActiveAssignment,
  gradeToStudioFormat,
  pickPlannedDate,
} from '../../../utils/plannedTeachingMeta.js'
import { subjectLabel, gradeLabel } from '../../../utils/teachingProfileCore.js'
import { isEceGrade } from '../../../config/teacherTaxonomy.js'
import { getSubjectsForGrade } from '../../../shared/utils/curriculumDataService.js'
import { cleanSubjectName } from '../../../shared/utils/subjectName.js'
import { matchSubjectKey } from '../../../shared/utils/teacherPlanContext.js'

function todayLocalISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Value equality for the resolved seed. Used as an equality guard before
// setSeed so an async resolution that produces an equivalent seed returns the
// SAME object reference — React then bails out of the re-render instead of
// re-running this effect and looping.
function seedsEqual(a, b) {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.grade === b.grade &&
    a.subject === b.subject &&
    a.curriculumMode === b.curriculumMode &&
    a.date === b.date
  )
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
  // A compact, non-blocking notice when the active assignment could NOT be fully
  // applied (ECE grade not offered here, or a subject that maps to no syllabus
  // key). Null when everything mapped or there's no active assignment. The
  // assignment metadata is preserved regardless — this only tells the teacher to
  // pick the field manually.
  const [mappingNotice, setMappingNotice] = useState(null)

  // Depend on the primitive context fields pickPlannedDate actually reads, not
  // the whole `tp.context` object. Even though useTeachingProfile now memoises
  // context, keying the effect on primitives makes this hook immune to any future
  // identity churn in that object — the effect only re-runs when a value that
  // changes the planned date changes.
  const ctxStatus = tp.context?.status
  const ctxWeekBeginning = tp.context?.weekBeginning
  const ctxTermClose = tp.context?.termClose
  useEffect(() => {
    let cancelled = false
    if (!assignment) { setSeed(null); setMappingNotice(null); return undefined }
    const grade = gradeToStudioFormat(assignment.grade)
    const curriculumMode = assignment.curriculumType === 'previous' ? 'previous' : 'cbc'
    const date = pickPlannedDate({
      context: { status: ctxStatus, weekBeginning: ctxWeekBeginning, termClose: ctxTermClose },
      todayISO: todayLocalISO(),
    })
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
      if (cancelled) return
      // Equality guard: if the resolved seed is value-equal to the current one,
      // return the SAME reference so React skips the re-render. Without this, the
      // async write minted a new object every run and — combined with an unstable
      // context identity — spun the render loop that crashed the studio in
      // production ("Maximum update depth exceeded").
      const next = { grade, subject, curriculumMode, date }
      setSeed((prev) => (seedsEqual(prev, next) ? prev : next))
      // Build the notice from what failed to map.
      let notice = null
      if (!grade) {
        notice = isEceGrade(assignment.grade)
          ? 'Early Childhood Education is not yet mapped to this Lesson Plan format.'
          : `${gradeLabel(assignment.grade)} is not available in this Lesson Plan format.`
      } else if (!subject) {
        notice = `“${subjectLabel(assignment.subject)}” could not be matched to a syllabus subject.`
      }
      setMappingNotice((prev) => (prev === notice ? prev : notice))
    }
    run()
    return () => { cancelled = true }
  }, [assignment, ctxStatus, ctxWeekBeginning, ctxTermClose])

  return {
    loading: tp.loading,
    assignment,
    context: tp.context,
    seed,
    mappingNotice,
    calendarUnavailable: tp.context?.status !== 'ok',
  }
}
