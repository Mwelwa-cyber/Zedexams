/**
 * SBA tab — record School-Based Assessment marks against a Class Register.
 *
 * The teacher picks subject + term + task type; the class roster auto-loads, so
 * they only enter marks/ratings. Stored as a record of type 'sba'. (The ECZ
 * 10%-per-grade OMES conversion stays in the dedicated SBA Mark Tracker; this
 * surface is about marking the class you already have.)
 */

import { useState } from 'react'
import { createRecordFromRoster } from '../../../utils/classRecords'
import { useAuth } from '../../../contexts/AuthContext'
import { SBA_SUBJECTS, getSbaTaskTypes } from '../../../config/sba'
import { useToast } from '../../ui/Toast'
import Button from '../../ui/Button'
import ClassRecordsPanel from './ClassRecordsPanel'
import MarkColumnsEditor, { cleanColumns } from './MarkColumnsEditor'

const TERMS = ['Term 1', 'Term 2', 'Term 3']

function CreateForm({ register, roster, onCreated, onCancel }) {
  const { currentUser } = useAuth()
  const toast = useToast()
  const [subject, setSubject] = useState(SBA_SUBJECTS[0]?.value || '')
  const [term, setTerm] = useState(register.term || 'Term 1')
  const [taskType, setTaskType] = useState('')
  const [columns, setColumns] = useState([{ label: 'Task', max: 20 }])
  const [saving, setSaving] = useState(false)
  const activeCount = roster.filter((r) => r.status === 'active').length
  const taskTypes = getSbaTaskTypes(subject)

  async function handleCreate() {
    const cols = cleanColumns(columns)
    if (cols.length === 0) { toast.error('Add at least one mark column with a maximum.'); return }
    if (activeCount === 0) { toast.error('This class has no active learners yet.'); return }
    const subjLabel = SBA_SUBJECTS.find((s) => s.value === subject)?.label || subject
    const taskLabel = taskTypes.find((t) => t.value === taskType)?.label
    const title = `SBA — ${subjLabel}${taskLabel ? ` · ${taskLabel}` : ''} (${term})`
    setSaving(true)
    try {
      const id = await createRecordFromRoster({
        classId: register.id, teacherUid: currentUser.uid, type: 'sba',
        title, subject, term, year: register.year,
        assessmentType: taskType || 'sba_task', columns: cols, roster,
      })
      onCreated(id)
    } catch (err) {
      toast.error(`Could not create SBA record: ${err.message || 'unexpected error'}`)
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'rounded-radius-md border theme-border theme-card theme-text px-2.5 py-2 text-sm'
  return (
    <div className="theme-card border theme-border rounded-radius-md p-4 space-y-3">
      <h3 className="theme-text font-black">New SBA record</h3>
      <div className="grid sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-black theme-text-muted uppercase tracking-wider mb-1">Subject</label>
          <select className={`${inputCls} w-full`} value={subject} onChange={(e) => { setSubject(e.target.value); setTaskType('') }}>
            {SBA_SUBJECTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-black theme-text-muted uppercase tracking-wider mb-1">Term</label>
          <select className={`${inputCls} w-full`} value={term} onChange={(e) => setTerm(e.target.value)}>
            {TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-black theme-text-muted uppercase tracking-wider mb-1">Task type</label>
          <select className={`${inputCls} w-full`} value={taskType} onChange={(e) => setTaskType(e.target.value)}>
            <option value="">— Select —</option>
            {taskTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
      </div>
      <MarkColumnsEditor columns={columns} setColumns={setColumns} />
      <p className="theme-text-muted text-xs">{activeCount} active learner{activeCount === 1 ? '' : 's'} will be added automatically.</p>
      <div className="flex gap-2">
        <Button onClick={handleCreate} loading={saving}>Create &amp; enter marks</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

export default function SbaTab({ register }) {
  return (
    <ClassRecordsPanel
      register={register}
      type="sba"
      newLabel="+ New SBA record"
      intro="School-Based Assessment records for this class."
      emptyIcon="📝"
      emptyTitle="No SBA records yet"
      emptyText="Pick a subject, term and task type — your class list loads automatically so you just enter marks."
      renderCreate={(props) => <CreateForm {...props} />}
    />
  )
}
