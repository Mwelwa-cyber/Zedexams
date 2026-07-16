/**
 * AttendanceLearnerRow — one learner in the mobile daily register:
 * register number · name · admission number · status picker · optional note ·
 * unsaved indicator. Memoised: the daily list re-renders only rows that change.
 */

import { memo, useState } from 'react'
import AttendanceStatusPicker from './AttendanceStatusPicker'
import { ATTENDANCE_STATUSES } from '../../../../utils/attendanceConstants'
import { ATTENDANCE_NOTE_MAX } from '../../../../utils/attendanceDayCore'

function AttendanceLearnerRow({
  position,
  learner,
  record,
  onStatus,
  onNote,
  disabled = false,
  pending = false,
}) {
  const [noteOpen, setNoteOpen] = useState(false)
  const status = record?.status || null
  const cfg = status ? ATTENDANCE_STATUSES[status] : null

  return (
    <li className={`theme-card border rounded-radius-md p-3 ${pending ? 'border-amber-300' : 'theme-border'}`}>
      <div className="flex items-center gap-3">
        <span className="theme-text-muted text-xs font-black w-6 text-right shrink-0">
          {String(position).padStart(2, '0')}
        </span>
        <div className="min-w-0 flex-1">
          <p className="theme-text font-bold text-sm truncate">{learner.fullName}</p>
          <p className="theme-text-muted text-xs">
            {learner.learnerNumber ? `ADM ${learner.learnerNumber}` : 'No admission no.'}
            {cfg && <span className="ml-2">{cfg.label}</span>}
            {pending && <span className="ml-2 text-amber-600 font-bold">Unsaved</span>}
          </p>
        </div>
        <button
          type="button"
          aria-label={noteOpen ? 'Hide note' : (record?.note ? 'Edit note' : 'Add note')}
          onClick={() => setNoteOpen((v) => !v)}
          disabled={disabled || !status}
          className={`text-xs font-black px-2 py-1 rounded-radius-md border theme-border shrink-0
            ${record?.note ? 'theme-accent-text' : 'theme-text-muted'} ${(!status || disabled) ? 'opacity-40' : ''}`}
        >
          ✎
        </button>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <AttendanceStatusPicker value={status} onChange={(s) => onStatus(learner.id, s)} disabled={disabled} />
      </div>
      {noteOpen && status && (
        <input
          type="text"
          value={record?.note || ''}
          onChange={(e) => onNote(learner.id, e.target.value)}
          disabled={disabled}
          maxLength={ATTENDANCE_NOTE_MAX}
          placeholder="Note (e.g. sick note received)"
          className="mt-2 w-full rounded-radius-md border theme-border theme-card theme-text px-2.5 py-2 text-sm"
        />
      )}
    </li>
  )
}

export default memo(AttendanceLearnerRow)
