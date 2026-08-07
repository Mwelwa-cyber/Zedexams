/**
 * TimetableLayoutPanel — the old "Timetable layout" section, now a small
 * drawer opened from the workspace overflow menu. Display preference only:
 * switching never moves a lesson, changes times or breaks a double period.
 */

import { TIMETABLE_LAYOUTS, PERIOD_LABEL_MODES } from '../../../../utils/classTimetable'
import { FieldWrapper } from '../studioFields'

export default function TimetableLayoutPanel({ displayPreferences, setPref }) {
  return (
    <div className="space-y-3">
      <p className="text-xs" style={{ color: 'var(--zt-text-muted)' }}>
        A display preference only — switching never moves a lesson, changes times or breaks a double period.
        It applies to the editor, the preview, printing and every export.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        {TIMETABLE_LAYOUTS.map((l) => {
          const on = displayPreferences.timetableLayout === l.id
          return (
            <button key={l.id} type="button" onClick={() => setPref('timetableLayout', l.id)}
              aria-pressed={on}
              className={`flex-1 rounded-xl border px-3 py-2.5 text-left transition-all ${on ? 'theme-accent-fill theme-on-accent border-transparent' : 'theme-border bg-white'}`}>
              <div className="text-xs font-black">{l.label}</div>
              {/* Tiny visual preview of the orientation */}
              <div className="mt-1.5 grid gap-0.5" style={{ gridTemplateColumns: 'repeat(5, 1fr)', width: 90 }}>
                {Array.from({ length: 15 }).map((_, i) => (
                  <div key={i} style={{
                    height: 5,
                    borderRadius: 1,
                    background: on ? 'rgba(255,255,255,0.7)' : '#c9c2ae',
                    opacity: l.id === 'days-as-columns'
                      ? (i % 5 === 0 ? 1 : 0.45)
                      : (i < 5 ? 1 : 0.45),
                  }} />
                ))}
              </div>
            </button>
          )
        })}
      </div>
      <FieldWrapper label="Time & period labels">
        <div className="theme-border inline-flex overflow-hidden rounded-xl border text-xs font-black">
          {PERIOD_LABEL_MODES.map((m) => {
            const on = displayPreferences.periodLabelMode === m.id
            return (
              <button key={m.id} type="button" onClick={() => setPref('periodLabelMode', m.id)}
                aria-pressed={on}
                className={`px-3 py-2 transition-all ${on ? 'theme-accent-fill theme-on-accent' : 'theme-text-muted bg-white hover:theme-text'}`}>
                {m.label}
              </button>
            )
          })}
        </div>
      </FieldWrapper>
    </div>
  )
}
