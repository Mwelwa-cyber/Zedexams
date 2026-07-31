/**
 * WeeklyForecastEditableTable — reopen a saved weekly forecast for editing.
 *
 * Renders one card per teaching day with a labelled field per column, driven
 * by `forecastColumns(curriculum)` so an OBC forecast hides the Learning
 * Activity + Expected Standard fields (and labels Specific Outcome). Pure
 * presentation over its `forecast` prop — never mutates it, only calls
 * `onChange(nextForecast)`. Used by the library "Edit forecast" flow.
 */

import { forecastColumns, forecastCurriculum, curriculumLabel } from '../../../utils/schemeFormat'
import ListTextarea from '../../ui/ListTextarea'

const LIST_KEYS = new Set(['learningActivities', 'resources'])

function FieldLabel({ children }) {
  return (
    <label className="block text-[11px] font-black uppercase tracking-wide mb-1" style={{ color: 'var(--zt-text-muted)' }}>
      {children}
    </label>
  )
}

export default function WeeklyForecastEditableTable({ forecast, onChange }) {
  if (!forecast) return null
  const curriculum = forecastCurriculum(forecast)
  const columns = forecastColumns(curriculum).filter((c) => c.key !== 'day')
  const days = Array.isArray(forecast.days) ? forecast.days : []

  function updateDay(index, key, value) {
    const next = days.map((d, i) => {
      if (i !== index) return d
      return { ...d, [key]: value }
    })
    onChange({ ...forecast, days: next })
  }

  return (
    <div className="space-y-3">
      <p className="text-xs" style={{ color: 'var(--zt-text-muted)' }}>
        {curriculumLabel(curriculum)} forecast · {days.length} day{days.length === 1 ? '' : 's'} ·
        edit any field. Changes aren't saved until you press Save.
      </p>
      {days.map((d, i) => (
        <div key={i} className="rounded-xl border theme-border p-4" style={{ background: 'var(--zt-card)' }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-flex items-center justify-center px-3 h-8 rounded-lg font-black text-white" style={{ background: '#0e2a32' }}>
              {d.day || `Day ${i + 1}`}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {columns.map((col) => {
              const isList = LIST_KEYS.has(col.key)
              const wide = col.key === 'topic' || col.key === 'specificCompetence' || col.key === 'learningActivities'
              return (
                <div key={col.key} className={wide ? 'sm:col-span-2' : ''}>
                  <FieldLabel>{col.label}{isList ? ' (one per line)' : ''}</FieldLabel>
                  {isList ? (
                    <ListTextarea
                      value={Array.isArray(d[col.key]) ? d[col.key] : []}
                      onChange={(list) => updateDay(i, col.key, list)}
                      rows={3}
                      className="studio-input resize-y w-full text-sm"
                      placeholder={col.label}
                    />
                  ) : (
                    <textarea
                      value={d[col.key] || ''}
                      onChange={(e) => updateDay(i, col.key, e.target.value)}
                      rows={2}
                      className="studio-input resize-y w-full text-sm"
                      placeholder={col.label}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
