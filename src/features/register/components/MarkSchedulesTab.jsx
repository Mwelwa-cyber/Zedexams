/**
 * Mark Schedules tab — create and mark schedules for one Class Register.
 * Thin wrapper over ClassRecordsPanel (type 'mark_schedule') with a create
 * form that defines the mark columns and snapshots the roster.
 */

import { useState } from 'react'
import { createRecordFromRoster } from '../../../utils/classRecords'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../../components/ui/Toast'
import Button from '../../../components/ui/Button'
import ClassRecordsPanel from './ClassRecordsPanel'
import MarkColumnsEditor, { cleanColumns } from './MarkColumnsEditor'

const CBC_PRESET = [
  { label: 'Maths', max: 50 },
  { label: 'English', max: 50 },
  { label: 'Science', max: 50 },
  { label: 'Social Studies', max: 50 },
  { label: 'C.T.S', max: 50 },
]

function CreateForm({ register, roster, onCreated, onCancel }) {
  const { currentUser } = useAuth()
  const toast = useToast()
  const [title, setTitle] = useState('')
  const [columns, setColumns] = useState([{ label: 'Test', max: 100 }])
  const [saving, setSaving] = useState(false)
  const activeCount = roster.filter((r) => r.status === 'active').length

  async function handleCreate() {
    if (!title.trim()) { toast.error('Give the schedule a title (e.g. "Mid-term Test").'); return }
    const cols = cleanColumns(columns)
    if (cols.length === 0) { toast.error('Add at least one mark column with a maximum.'); return }
    if (activeCount === 0) { toast.error('This class has no active learners yet.'); return }
    setSaving(true)
    try {
      const id = await createRecordFromRoster({
        classId: register.id, teacherUid: currentUser.uid, type: 'mark_schedule',
        title: title.trim(), subject: register.subject || null,
        term: register.term || '', year: register.year, columns: cols, roster,
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
      <MarkColumnsEditor
        columns={columns}
        setColumns={setColumns}
        presetButton={(
          <button type="button" onClick={() => setColumns(CBC_PRESET)} className="theme-accent-text text-xs font-black">
            Use 5 CBC subjects
          </button>
        )}
      />
      <p className="theme-text-muted text-xs">{activeCount} active learner{activeCount === 1 ? '' : 's'} will be added automatically.</p>
      <div className="flex gap-2">
        <Button onClick={handleCreate} loading={saving}>Create &amp; enter marks</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

export default function MarkSchedulesTab({ register }) {
  return (
    <ClassRecordsPanel
      register={register}
      type="mark_schedule"
      newLabel="+ New schedule"
      intro="Mark schedules for this class."
      emptyIcon="📊"
      emptyTitle="No mark schedules yet"
      emptyText="Create one — every learner on the class list is added automatically, so you just enter marks."
      renderCreate={(props) => <CreateForm {...props} />}
    />
  )
}
