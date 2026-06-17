/**
 * Mark Schedules tab — create and mark schedules for one Class Register.
 *
 * "New schedule" snapshots the class roster (only active learners) into a
 * record, so every learner is pre-loaded and the teacher only enters marks.
 * Selecting a schedule opens MarkEntryGrid.
 */

import { useEffect, useState } from 'react'
import { listRoster } from '../../../utils/classRoster'
import {
  listRecords,
  getRecord,
  createRecordFromRoster,
  deleteRecord,
} from '../../../utils/classRecords'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../ui/Toast'
import Button from '../../ui/Button'
import ConfirmDialog from '../../ui/ConfirmDialog'
import Skeleton from '../../ui/Skeleton'
import MarkEntryGrid from './MarkEntryGrid'

// The five subjects most Zambian primary schedules use, as a one-tap preset.
const CBC_PRESET = [
  { key: 'maths', label: 'Maths', max: 50 },
  { key: 'english', label: 'English', max: 50 },
  { key: 'science', label: 'Science', max: 50 },
  { key: 'social', label: 'Social Studies', max: 50 },
  { key: 'cts', label: 'C.T.S', max: 50 },
]

function slugKey(label, i) {
  const base = String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  return base ? `${base}_${i}` : `col_${i}`
}

function CreateForm({ register, roster, onCreated, onCancel }) {
  const { currentUser } = useAuth()
  const toast = useToast()
  const [title, setTitle] = useState('')
  const [columns, setColumns] = useState([{ label: 'Test', max: 100 }])
  const [saving, setSaving] = useState(false)

  const activeCount = roster.filter((r) => r.status === 'active').length
  const setCol = (i, key) => (e) => setColumns((cols) => cols.map((c, j) => (j === i ? { ...c, [key]: e.target.value } : c)))
  const addCol = () => setColumns((cols) => [...cols, { label: '', max: 50 }])
  const removeCol = (i) => setColumns((cols) => cols.filter((_, j) => j !== i))

  async function handleCreate() {
    if (!title.trim()) { toast.error('Give the schedule a title (e.g. "Mid-term Test").'); return }
    const cleanCols = columns
      .map((c, i) => ({ key: slugKey(c.label, i), label: c.label.trim(), max: Number(c.max) || 0 }))
      .filter((c) => c.label && c.max > 0)
    if (cleanCols.length === 0) { toast.error('Add at least one mark column with a maximum.'); return }
    if (activeCount === 0) { toast.error('This class has no active learners yet.'); return }
    setSaving(true)
    try {
      const id = await createRecordFromRoster({
        classId: register.id,
        teacherUid: currentUser.uid,
        type: 'mark_schedule',
        title: title.trim(),
        subject: register.subject || null,
        term: register.term || '',
        year: register.year,
        columns: cleanCols,
        roster,
      })
      onCreated(id)
    } catch (err) {
      toast.error(`Could not create schedule: ${err.message || 'unexpected error'}`)
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'rounded-radius-md border theme-border theme-card theme-text px-2.5 py-2 text-sm'

  return (
    <div className="theme-card border theme-border rounded-radius-md p-4 space-y-3">
      <h3 className="theme-text font-black">New mark schedule</h3>
      <input className={`${inputCls} w-full`} placeholder="Title — e.g. Mid-term Test" value={title}
        onChange={(e) => setTitle(e.target.value)} maxLength={160} autoFocus />

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-black theme-text-muted uppercase tracking-wider">Mark columns</p>
          <button type="button" onClick={() => setColumns(CBC_PRESET.map((c) => ({ label: c.label, max: c.max })))}
            className="theme-accent-text text-xs font-black">Use 5 CBC subjects</button>
        </div>
        {columns.map((c, i) => (
          <div key={i} className="flex items-center gap-2">
            <input className={`${inputCls} flex-1`} placeholder="Column label" value={c.label} onChange={setCol(i, 'label')} maxLength={80} />
            <span className="theme-text-muted text-xs">out of</span>
            <input className={`${inputCls} w-20`} type="number" min={1} max={1000} value={c.max} onChange={setCol(i, 'max')} />
            {columns.length > 1 && (
              <button type="button" onClick={() => removeCol(i)} className="text-red-500 text-sm font-black px-1" aria-label="Remove column">×</button>
            )}
          </div>
        ))}
        <button type="button" onClick={addCol} className="theme-accent-text text-xs font-black">+ Add column</button>
      </div>

      <p className="theme-text-muted text-xs">
        {activeCount} active learner{activeCount === 1 ? '' : 's'} will be added automatically.
      </p>
      <div className="flex gap-2">
        <Button onClick={handleCreate} loading={saving}>Create &amp; enter marks</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

export default function MarkSchedulesTab({ register }) {
  const classId = register.id
  const toast = useToast()
  const [roster, setRoster] = useState([])
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [openRecord, setOpenRecord] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)

  async function refresh() {
    setLoading(true)
    try {
      const [r, recs] = await Promise.all([
        listRoster(classId),
        listRecords(classId, { type: 'mark_schedule' }),
      ])
      setRoster(r)
      setRecords(recs)
    } catch (err) {
      console.warn('[MarkSchedulesTab] load failed', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [classId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function openGrid(recordId) {
    try {
      const rec = await getRecord(classId, recordId)
      if (rec) setOpenRecord(rec)
    } catch (err) {
      toast.error(`Could not open schedule: ${err.message || 'unexpected error'}`)
    }
  }

  async function handleDelete() {
    try {
      await deleteRecord(classId, deleteTarget.id)
      toast.success('Schedule deleted.')
      refresh()
    } catch (err) {
      toast.error(`Could not delete: ${err.message || 'unexpected error'}`)
    } finally {
      setDeleteTarget(null)
    }
  }

  if (openRecord) {
    return (
      <MarkEntryGrid
        classId={classId}
        record={openRecord}
        onClose={() => { setOpenRecord(null); refresh() }}
        onSaved={() => refresh()}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="theme-text-muted text-sm">Mark schedules for this class.</p>
        {!creating && <Button size="sm" onClick={() => setCreating(true)}>+ New schedule</Button>}
      </div>

      {creating && (
        <CreateForm
          register={register}
          roster={roster}
          onCreated={(id) => { setCreating(false); openGrid(id) }}
          onCancel={() => setCreating(false)}
        />
      )}

      {loading ? (
        <Skeleton className="h-24 rounded-radius-md" />
      ) : records.length === 0 && !creating ? (
        <div className="theme-card border theme-border rounded-radius-md p-8 text-center">
          <div className="text-4xl mb-2">📊</div>
          <p className="theme-text font-black">No mark schedules yet</p>
          <p className="theme-text-muted text-sm mt-1">
            Create one — every learner on the class list is added automatically, so you just enter marks.
          </p>
        </div>
      ) : (
        <ul className="theme-card border theme-border rounded-radius-md divide-y divide-current/10 overflow-hidden">
          {records.map((rec) => (
            <li key={rec.id} className="flex items-center gap-3 p-4">
              <button type="button" onClick={() => openGrid(rec.id)} className="flex-1 min-w-0 text-left">
                <p className="theme-text font-black text-sm truncate">{rec.title}</p>
                <p className="theme-text-muted text-xs mt-1">
                  {(rec.rosterSnapshot?.length || 0)} learners
                  {` · ${(rec.columns?.length || 0)} column${rec.columns?.length === 1 ? '' : 's'}`}
                  {rec.stats?.count ? ` · avg ${rec.stats.classAverage}% · pass ${rec.stats.passRate}%` : ' · not marked yet'}
                </p>
              </button>
              <button type="button" onClick={() => openGrid(rec.id)} className="theme-accent-text text-xs font-black whitespace-nowrap">Enter marks →</button>
              <button type="button" onClick={() => setDeleteTarget(rec)} className="theme-text-muted hover:text-red-500 text-xs font-black">Delete</button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete this schedule?"
        message={deleteTarget ? `"${deleteTarget.title}" and its marks will be permanently deleted.` : ''}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
