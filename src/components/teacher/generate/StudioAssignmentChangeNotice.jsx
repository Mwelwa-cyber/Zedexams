/**
 * StudioAssignmentChangeNotice — drop-in container that gives any studio the
 * open-studio assignment-change notice with a single line of JSX. It owns the
 * cross-tab listener (useTeachingAssignmentChangeNotice) and renders the
 * non-blocking Switch / Keep banner. Mount it unconditionally near the top of
 * the studio; it renders nothing until a change is detected.
 *
 *   <StudioAssignmentChangeNotice
 *     uid={currentUser?.uid}
 *     currentSeed={{ grade, subject, curriculum }}   // what the studio uses now
 *     onApply={(seed) => { setSelectorSeed(seed); setSelectorKey(k => k+1); setCurr({}) }}
 *   />
 *
 * Switch re-seeds the curriculum selector to the new assignment (topic/subtopic
 * reset to the new context); details typed into other fields are untouched.
 * Nothing is applied automatically — the teacher chooses.
 */

import useTeachingAssignmentChangeNotice from '../../../hooks/useTeachingAssignmentChangeNotice'
import { seedLabel } from './teachingAssignmentChangeNoticeCore'
import TeachingAssignmentChangeNotice from './TeachingAssignmentChangeNotice'

export default function StudioAssignmentChangeNotice({ uid, currentSeed, onApply, existingDocument = false }) {
  const { pending, keep, clear } = useTeachingAssignmentChangeNotice(uid, currentSeed)
  if (!pending) return null
  return (
    <TeachingAssignmentChangeNotice
      fromLabel={seedLabel(currentSeed)}
      toLabel={seedLabel(pending)}
      existingDocument={existingDocument}
      onKeep={keep}
      onSwitch={() => { onApply?.(pending); clear() }}
    />
  )
}
