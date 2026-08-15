/**
 * TeachingAssignmentChangeNotice — a compact, non-blocking banner shown when the
 * teacher changed their active assignment on the Dashboard (in another tab or
 * on another device) while this studio is open. It names BOTH assignments
 * exactly and offers Switch / Keep. It never changes the form on its own —
 * switching is the teacher's explicit choice, and Switch only re-seeds the
 * curriculum selector (the details already typed into other fields stay).
 *
 * Three-way variant: when the studio reports in-progress draft content
 * (`onSaveAndSwitch` provided), the primary action becomes "Save draft &
 * switch" — the draft is flushed first so the pre-switch state is snapshotted
 * — with "Switch without saving" as the plain path.
 *
 * `compatibilityMessage` (optional) flags structured fields the new assignment
 * can't fill in this studio (grade not offered / subject unmatched). It warns,
 * never blocks.
 *
 * When the studio is editing an existing document, its stored assignment is
 * authoritative, so the notice shows an informational message instead of Switch.
 */

export default function TeachingAssignmentChangeNotice({
  fromLabel,
  toLabel,
  existingDocument = false,
  compatibilityMessage = '',
  onSwitch,
  onSaveAndSwitch,
  onKeep,
}) {
  if (!toLabel) return null

  if (existingDocument) {
    return (
      <div
        className="rounded-xl border-2 px-4 py-3 mb-4"
        style={{ borderColor: '#c7d2fe', background: '#eef2ff', color: '#3730a3' }}
        role="status"
      >
        <span aria-hidden="true">📌 </span>
        You are editing an existing {fromLabel || 'saved'} document. Its teaching assignment stays unchanged.
      </div>
    )
  }

  const threeWay = typeof onSaveAndSwitch === 'function'

  return (
    <div
      className="rounded-xl border-2 px-4 py-3 mb-4"
      style={{ borderColor: '#fcd34d', background: '#fffbeb', color: '#92400e' }}
      role="status"
    >
      <div className="font-bold">Your active teaching assignment has changed</div>
      <p className="text-sm mt-1">
        The Dashboard is now using <b>{toLabel}</b>. This studio is still using <b>{fromLabel || 'its current assignment'}</b>.
      </p>
      {/* Honest about what Switch does: free text is kept; structured selections
          reset to the new assignment's valid options. Never claims "saved". */}
      <p className="text-sm mt-1">
        If you switch, your typed content will remain, but the grade, subject, topic and curriculum selections will update to the new assignment.
      </p>
      {compatibilityMessage && (
        <p className="text-sm mt-1 font-semibold">
          <span aria-hidden="true">⚠️ </span>
          {compatibilityMessage}
        </p>
      )}
      <div className="flex flex-wrap gap-2 mt-3">
        {threeWay ? (
          <>
            <button type="button" className="studio-btn-primary" onClick={onSaveAndSwitch}>
              Save draft &amp; switch to {toLabel}
            </button>
            <button type="button" className="studio-btn-ghost" onClick={onSwitch}>
              Switch without saving
            </button>
          </>
        ) : (
          <button type="button" className="studio-btn-primary" onClick={onSwitch}>
            Switch to {toLabel}
          </button>
        )}
        <button type="button" className="studio-btn-ghost" onClick={onKeep}>
          Keep {fromLabel || 'current'}
        </button>
      </div>
    </div>
  )
}
