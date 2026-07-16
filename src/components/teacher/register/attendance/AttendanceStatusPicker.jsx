/**
 * AttendanceStatusPicker — the P/A/S/L/E/– control for one learner.
 * Large touch targets (min 40px) for one-thumb marking on a phone; every
 * label/symbol/colour comes from attendanceConstants so no surface drifts.
 */

import { ATTENDANCE_STATUSES, MARKABLE_STATUSES } from '../../../../utils/attendanceConstants'

export default function AttendanceStatusPicker({
  value,
  onChange,
  disabled = false,
  statuses = MARKABLE_STATUSES,
  compact = false,
}) {
  return (
    <div className="flex gap-1" role="radiogroup" aria-label="Attendance status">
      {statuses.map((id) => {
        const cfg = ATTENDANCE_STATUSES[id]
        const active = value === id
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={cfg.label}
            title={cfg.label}
            disabled={disabled}
            onClick={() => { if (!disabled && !active) onChange(id) }}
            className={`${compact ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-sm'} rounded-radius-md border font-black transition-colors
              ${active ? cfg.activeClass : 'theme-card theme-border theme-text-muted hover:theme-text'}
              ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            {cfg.symbol}
          </button>
        )
      })}
    </div>
  )
}
