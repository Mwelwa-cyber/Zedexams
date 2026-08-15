/**
 * StudioAssignmentChangeNotice — drop-in container that gives any studio the
 * open-studio assignment-change notice with a single line of JSX. It owns the
 * shared listener (useTeachingAssignmentChangeNotice — cross-tab storage events
 * AND the cross-device sync event) and renders the non-blocking banner. Mount
 * it unconditionally near the top of the studio; it renders nothing until a
 * change is detected.
 *
 * The full save-and-switch contract, all optional — a studio passes what it has:
 *
 *   <StudioAssignmentChangeNotice
 *     uid={currentUser?.uid}
 *     currentSeed={{ grade, subject, curriculum }}   // what the studio uses now
 *     onApply={(seed) => { … }}                       // applyAssignment
 *     hasUnsavedChanges={draft.status !== 'idle'}     // in-progress input this session
 *     saveDraft={draft.flush}                         // snapshot before switching
 *   />
 *
 * With `hasUnsavedChanges` + `saveDraft` the banner offers the three-way
 * choice: Save draft & switch / Switch without saving / Keep. Without them it
 * stays the original two-way Switch / Keep.
 *
 * validateAssignmentCompatibility is built in: the pending seed's grade +
 * subject are checked against the SAME syllabus data this studio's curriculum
 * selector reads (useSubjectsForGrade), and an incompatibility renders as a
 * warning line — it flags, never blocks. Switch re-seeds the curriculum
 * selector to the new assignment (topic/subtopic reset to the new context);
 * details typed into other fields are untouched. Nothing is applied
 * automatically — the teacher chooses.
 */

import useTeachingAssignmentChangeNotice from '../../hooks/useTeachingAssignmentChangeNotice'
import { seedLabel, compatibilityNotice } from '../utils/teachingAssignmentChangeNoticeCore'
import TeachingAssignmentChangeNotice from './TeachingAssignmentChangeNotice'
import { useSubjectsForGrade } from '../hooks/useSubjectsForGrade'
import { gradeToStudioFormat } from '../../utils/plannedTeachingMeta'
import { subjectLabel } from '../../utils/teachingProfileCore'
import { matchSubjectKey } from '../utils/teacherPlanContext'
import { cleanSubjectName } from '../utils/subjectName'

export default function StudioAssignmentChangeNotice({
  uid,
  currentSeed,
  onApply,
  existingDocument = false,
  hasUnsavedChanges = false,
  saveDraft = null,
}) {
  const { pending, keep, clear } = useTeachingAssignmentChangeNotice(uid, currentSeed)

  // Compatibility check (hooks run unconditionally; the fetch no-ops on '').
  // Only relevant when a Switch will actually be offered.
  const pendingGradeLabel =
    pending && !existingDocument ? gradeToStudioFormat(pending.grade) : ''
  const curriculumMode = pending?.curriculum === 'previous' ? 'previous' : 'cbc'
  const { subjects, loading: subjectsLoading } = useSubjectsForGrade(
    pendingGradeLabel,
    pendingGradeLabel ? curriculumMode : null,
  )

  if (!pending) return null

  const subjectsLoaded = Boolean(pendingGradeLabel) && !subjectsLoading && subjects.length > 0
  const subjectMatched = subjectsLoaded
    ? Boolean(matchSubjectKey(subjectLabel(pending.subject), subjects, cleanSubjectName))
    : false
  const compatibilityMessage = compatibilityNotice({
    seed: pending,
    gradeMapped: Boolean(pendingGradeLabel),
    subjectsLoaded,
    subjectMatched,
  })

  const apply = () => { onApply?.(pending); clear() }
  const saveAndApply = async () => {
    // Snapshot the pre-switch inputs first. Best-effort: autosave has almost
    // certainly persisted them already, and typed content survives the switch
    // in the form itself — so a failed flush must not cancel the teacher's
    // explicit choice to switch.
    try { await saveDraft() } catch { /* draft flush is belt-and-braces */ }
    apply()
  }
  const threeWay = hasUnsavedChanges && typeof saveDraft === 'function'

  return (
    <TeachingAssignmentChangeNotice
      fromLabel={seedLabel(currentSeed)}
      toLabel={seedLabel(pending)}
      existingDocument={existingDocument}
      compatibilityMessage={compatibilityMessage}
      onKeep={keep}
      onSwitch={apply}
      onSaveAndSwitch={threeWay ? saveAndApply : undefined}
    />
  )
}
