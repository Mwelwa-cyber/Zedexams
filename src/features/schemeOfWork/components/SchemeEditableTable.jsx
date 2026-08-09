/**
 * SchemeEditableTable — the teacher's editable draft of a scheme of work.
 *
 * The teacher is never locked into the AI version: every cell is editable, and
 * whole weekly rows can be added, deleted, split, merged, or moved to another
 * week. It renders one card per week (readable on a phone, where wide 9-column
 * grids are unusable) with a labelled field per column. Columns come from
 * `schemeColumns(curriculum)` so CBC shows 9 fields and OBC 7 — the exact same
 * source the read-only view + exporters use.
 *
 * Pure presentation over the pure `schemeEditing` ops: it never mutates its
 * `scheme` prop, only calls `onChange(nextScheme)`. Reused by the studio
 * hand-off and the library "Edit Scheme" flow.
 */

import { schemeColumns, schemeCurriculum, curriculumLabel } from '../../../utils/schemeFormat'
import {
  updateCell,
  addRow,
  deleteRow,
  splitRow,
  mergeRows,
  moveTopicToWeek,
} from '../lib/schemeEditing'
import ListTextarea from '../../../components/ui/ListTextarea'

const LIST_KEYS = new Set(['specificCompetences', 'learningActivities', 'methods', 'tlAids'])

function FieldLabel({ children }) {
  return (
    <label className="block text-[11px] font-black uppercase tracking-wide mb-1" style={{ color: 'var(--zt-text-muted)' }}>
      {children}
    </label>
  )
}

function WeekCard({ week, index, columns, weekCount, onChange }) {
  const editableCols = columns.filter((c) => c.type !== 'week')

  return (
    <div className="rounded-xl border theme-border p-4" style={{ background: 'var(--zt-card)' }}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg font-black text-white" style={{ background: '#0e2a32' }}>
            {week.week}
          </span>
          <span className="text-sm font-black" style={{ color: 'var(--zt-text)' }}>Week {week.week}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <label className="text-[11px] flex items-center gap-1" style={{ color: 'var(--zt-text-muted)' }}>
            Move to week
            <select
              value={week.week}
              onChange={(e) => onChange(moveTopicToWeek, Number(e.target.value))}
              className="studio-input py-1 px-2 text-xs"
              style={{ width: 64 }}
            >
              {Array.from({ length: weekCount }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => onChange(splitRow)} className="studio-btn-ghost text-xs py-1 px-2" title="Split into two weeks">✂️ Split</button>
          {index < weekCount - 1 && (
            <button type="button" onClick={() => onChange(mergeRows)} className="studio-btn-ghost text-xs py-1 px-2" title="Merge with the next week">⬇️ Merge</button>
          )}
          <button type="button" onClick={() => onChange(addRow)} className="studio-btn-ghost text-xs py-1 px-2" title="Add a week after this one">➕ Add</button>
          <button
            type="button"
            onClick={() => onChange(deleteRow)}
            className="text-xs py-1 px-2 rounded-lg font-bold"
            style={{ color: '#b91c1c', border: '1.5px solid #fecaca', background: 'var(--zt-card)' }}
            title="Delete this week"
          >🗑️</button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {editableCols.map((col) => {
          const isList = LIST_KEYS.has(col.key)
          const wide = col.key === 'topic' || col.key === 'specificCompetences' || col.key === 'learningActivities'
          return (
            <div key={col.key} className={wide ? 'sm:col-span-2' : ''}>
              <FieldLabel>{col.label}{isList ? ' (one per line)' : ''}</FieldLabel>
              {isList ? (
                <ListTextarea
                  value={Array.isArray(week[col.key]) ? week[col.key] : []}
                  onChange={(list) => onChange((s, i) => updateCell(s, i, col.key, list))}
                  rows={3}
                  className="studio-input resize-y w-full text-sm"
                  placeholder={col.label}
                />
              ) : (
                <textarea
                  value={week[col.key] || ''}
                  onChange={(e) => onChange((s, i) => updateCell(s, i, col.key, e.target.value))}
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
  )
}

export default function SchemeEditableTable({ scheme, onChange }) {
  if (!scheme) return null
  const curriculum = schemeCurriculum(scheme)
  const columns = schemeColumns(curriculum)
  const weeks = Array.isArray(scheme.weeks) ? scheme.weeks : []

  // Each card action is an `(op, ...args)` applied at that card's index; we
  // curry the index here so the card doesn't need to know its own position.
  const runAt = (index) => (op, ...args) => onChange(op(scheme, index, ...args))

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs" style={{ color: 'var(--zt-text-muted)' }}>
          {curriculumLabel(curriculum)} format · {weeks.length} week{weeks.length === 1 ? '' : 's'} ·
          edit any field, or add / delete / split / merge / move weeks. Changes aren't saved until you press Save.
        </p>
        <button type="button" onClick={() => onChange(addRow(scheme, weeks.length - 1))} className="studio-btn-ghost text-xs">
          ➕ Add week
        </button>
      </div>

      {weeks.map((w, i) => (
        <WeekCard
          key={i}
          week={w}
          index={i}
          columns={columns}
          weekCount={weeks.length}
          onChange={runAt(i)}
        />
      ))}

      {weeks.length === 0 && (
        <div className="rounded-xl border theme-border p-6 text-center text-sm" style={{ color: 'var(--zt-text-muted)' }}>
          No weeks yet.
          <button type="button" onClick={() => onChange(addRow(scheme, -1))} className="studio-btn-ghost ml-2 text-xs">➕ Add the first week</button>
        </div>
      )}
    </div>
  )
}
