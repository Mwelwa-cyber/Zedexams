/**
 * MarkEntryGrid — enter marks for one Class Register record.
 *
 * The roster is pre-loaded from the record's snapshot, so the teacher only
 * types marks — never names. Totals, percentage, CBC grade, position and the
 * class stats (average, highest, lowest, pass rate) recompute live as marks
 * are entered (src/utils/classRecordMath.js), then persist on Save.
 *
 * Wide by nature — uses overflow-x-auto so it scrolls horizontally on phones.
 */

import { useEffect, useMemo, useState } from 'react'
import { computeRecord, maxTotalOf } from '../../../utils/classRecordMath'
import { saveRecordMarks } from '../../../utils/classRecords'
import { convertSbaMark } from '../../../config/sba'
import { useToast } from '../../../components/ui/Toast'
import Button from '../../../components/ui/Button'
import { useMarkUnsaved } from './registerUnsavedGuard'

const GRADE_TONE = {
  Excellent: 'text-emerald-600',
  'Very Good': 'text-emerald-600',
  Good: 'text-blue-600',
  Developing: 'text-amber-600',
  'Needs Improvement': 'text-red-500',
}

function Stat({ label, value, suffix = '' }) {
  return (
    <div className="theme-card border theme-border rounded-radius-md px-3 py-2 text-center">
      <p className="theme-text font-display font-black text-lg leading-none">{value}{suffix}</p>
      <p className="theme-text-muted text-[10px] uppercase tracking-wider mt-1">{label}</p>
    </div>
  )
}

export default function MarkEntryGrid({ classId, record, onClose, onSaved }) {
  const toast = useToast()
  const columns = useMemo(() => record.columns || [], [record.columns])
  const snapshot = useMemo(() => record.rosterSnapshot || [], [record.rosterSnapshot])
  const [marks, setMarks] = useState(() => ({ ...(record.marks || {}) }))
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  const { rows, stats } = useMemo(
    () => computeRecord({ snapshot, columns, marks }),
    [snapshot, columns, marks],
  )
  const rowByRoster = useMemo(() => new Map(rows.map((r) => [r.rosterId, r])), [rows])

  // ECZ School-Based Assessment: a learner's marks across the grade's tasks
  // convert to a mark out of 10 (10% of the grade) — obtained ÷ total × 10.
  // Shown only for SBA records; the column maximums sum to the grade total.
  const isSba = record.type === 'sba'
  const isSbaFinal = record.type === 'sba_final'
  const sbaMax = useMemo(() => maxTotalOf(columns), [columns])
  const sba10 = (total) => convertSbaMark(total, sbaMax).rounded
  const sbaClassAvg = useMemo(() => {
    if (!isSba || rows.length === 0) return 0
    return Math.round(rows.reduce((sum, r) => sum + sba10(r.total), 0) / rows.length)
  }, [isSba, rows, sbaMax]) // eslint-disable-line react-hooks/exhaustive-deps

  // Marks live only in local state until Save, so warn before a tab close /
  // reload discards typed-but-unsaved marks.
  useEffect(() => {
    if (!dirty) return undefined
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  // Publish the dirty flag to the Class Register shell so its tab links, the
  // "← Class List" / "Edit" links and Archive confirm before an SPA navigation
  // unmounts this grid and discards the marks. No-op when opened outside the
  // shell (the grid's own Back button + beforeunload still cover those paths).
  useMarkUnsaved(dirty)

  function setMark(rosterId, colKey, raw, max) {
    setDirty(true)
    setMarks((prev) => {
      const next = { ...prev, [rosterId]: { ...(prev[rosterId] || {}) } }
      if (raw === '') {
        delete next[rosterId][colKey]
      } else {
        let n = Number(raw)
        if (!Number.isFinite(n)) return prev
        n = Math.max(0, Math.min(Number(max) || 0, n))
        next[rosterId][colKey] = n
      }
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    try {
      const savedStats = await saveRecordMarks(classId, record.id, { marks, snapshot, columns })
      setDirty(false)
      toast.success('Marks saved.')
      if (onSaved) onSaved(savedStats)
    } catch (err) {
      toast.error(`Could not save marks: ${err.message || 'unexpected error'}`)
    } finally {
      setSaving(false)
    }
  }

  const cellInput = 'w-16 rounded border theme-border theme-card theme-text px-1.5 py-1 text-sm text-center'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <button
            type="button"
            onClick={() => {
              if (!dirty || window.confirm('You have unsaved marks. Leave without saving?')) onClose()
            }}
            className="theme-text-muted text-xs font-black uppercase tracking-wider hover:theme-accent-text"
          >
            ← Back to mark schedules
          </button>
          <h3 className="theme-text font-display font-black text-xl mt-1">{record.title}</h3>
        </div>
        <Button onClick={handleSave} loading={saving} disabled={!dirty}>
          {dirty ? 'Save marks' : 'Saved'}
        </Button>
      </div>

      {/* Live class stats */}
      <div className={`grid grid-cols-3 gap-2 ${isSba ? 'sm:grid-cols-6' : 'sm:grid-cols-5'}`}>
        <Stat label="Learners" value={stats.count} />
        <Stat label="Class avg" value={stats.classAverage} suffix="%" />
        <Stat label="Highest" value={stats.highest} />
        <Stat label="Lowest" value={stats.lowest} />
        <Stat label="Pass rate" value={stats.passRate} suffix="%" />
        {isSba && <Stat label="SBA avg" value={sbaClassAvg} suffix="/10" />}
      </div>
      {isSba && (
        <p className="theme-text-muted text-xs -mt-1">
          ECZ School-Based Assessment — each learner&apos;s total converts to a mark out of 10
          (their 10% for this grade), ready for the OMES portal.
        </p>
      )}

      {snapshot.length === 0 ? (
        <div className="theme-card border theme-border rounded-radius-md p-6 text-center theme-text-muted text-sm">
          This record has no learners. Add learners to the class list, then create a new schedule.
        </div>
      ) : (
        <div className="overflow-x-auto theme-card border theme-border rounded-radius-md">
          <table className="w-full text-sm">
            <thead>
              <tr className="theme-text-muted text-[11px] uppercase tracking-wider text-left border-b theme-border">
                <th className="px-2 py-2 w-10">#</th>
                <th className="px-2 py-2 min-w-[140px]">Learner</th>
                {columns.map((c) => (
                  <th key={c.key} className="px-2 py-2 text-center whitespace-nowrap">
                    {c.label}<span className="theme-text-muted font-normal"> /{c.max}</span>
                  </th>
                ))}
                <th className="px-2 py-2 text-center whitespace-nowrap">{isSbaFinal ? 'Final /30' : 'Total'}</th>
                <th className="px-2 py-2 text-center">%</th>
                {isSba && <th className="px-2 py-2 text-center whitespace-nowrap">SBA /10</th>}
                {!isSbaFinal && <th className="px-2 py-2 text-center">Grade</th>}
                <th className="px-2 py-2 text-center">Pos</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.map((s, i) => {
                const r = rowByRoster.get(s.rosterId) || {}
                return (
                  <tr key={s.rosterId} className="border-b theme-border last:border-0">
                    <td className="px-2 py-1.5 theme-text-muted">{s.learnerNumber || i + 1}</td>
                    <td className="px-2 py-1.5 theme-text font-bold whitespace-nowrap">{s.fullName}</td>
                    {columns.map((c) => (
                      <td key={c.key} className="px-2 py-1.5 text-center">
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={c.max}
                          value={marks[s.rosterId]?.[c.key] ?? ''}
                          onChange={(e) => setMark(s.rosterId, c.key, e.target.value, c.max)}
                          className={cellInput}
                          aria-label={`${c.label} mark for ${s.fullName}`}
                        />
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-center theme-text font-black">{r.total}</td>
                    <td className="px-2 py-1.5 text-center theme-text-muted">{r.percentage}%</td>
                    {isSba && <td className="px-2 py-1.5 text-center theme-accent-text font-black">{sba10(r.total)}</td>}
                    {!isSbaFinal && (
                      <td className={`px-2 py-1.5 text-center text-xs font-black ${GRADE_TONE[r.gradeLabel] || 'theme-text-muted'}`}>
                        {r.gradeLabel}
                      </td>
                    )}
                    <td className="px-2 py-1.5 text-center theme-text font-black">{r.position}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
