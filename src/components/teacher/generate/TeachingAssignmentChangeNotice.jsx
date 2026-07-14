/**
 * TeachingAssignmentChangeNotice — a compact, non-blocking banner shown when the
 * teacher changed their active assignment on the Dashboard (in another tab)
 * while this studio is open. It names BOTH assignments exactly and offers
 * Switch / Keep. It never changes the form on its own — Switch is the teacher's
 * explicit choice, and Switch only re-seeds the curriculum selector (the details
 * already typed into other fields stay).
 *
 * When the studio is editing an existing document, its stored assignment is
 * authoritative, so the notice shows an informational message instead of Switch.
 */

export default function TeachingAssignmentChangeNotice({
  fromLabel,
  toLabel,
  existingDocument = false,
  onSwitch,
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
      <div className="flex flex-wrap gap-2 mt-3">
        <button type="button" className="studio-btn-primary" onClick={onSwitch}>
          Switch to {toLabel}
        </button>
        <button type="button" className="studio-btn-ghost" onClick={onKeep}>
          Keep {fromLabel || 'current'}
        </button>
      </div>
    </div>
  )
}
