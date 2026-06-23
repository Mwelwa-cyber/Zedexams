/**
 * SBA tab — record School-Based Assessment marks against a Class Register, with
 * the ECZ conversions built in.
 *
 * Two record kinds, chosen in the create form:
 *   • Year marks (/10) — pick an SBA subject; the official ECZ task blueprint
 *     for the class's grade loads as the mark columns and the roster auto-loads,
 *     so the teacher only enters marks. Each learner's running total converts to
 *     a mark out of 10 (their 10% for this grade) — shown in MarkEntryGrid.
 *   • Final SBA (/30) — combines a learner's Grade 5 + 6 + 7 /10 marks into the
 *     final /30 the OMES portal wants. The current grade's column can be
 *     pre-filled from this class's year-long SBA record; the earlier grades are
 *     typed in from the learner's prior records.
 */

import { useState } from 'react'
import { createRecordFromRoster } from '../../../utils/classRecords'
import { maxTotalOf, computeRecordRows } from '../../../utils/classRecordMath'
import { useAuth } from '../../../contexts/AuthContext'
import {
  SBA_SUBJECTS, SBA_GRADE_VALUES, getSbaBlueprint, getSbaGradeTotal, convertSbaMark, SBA_MAX_FINAL_MARK,
} from '../../../config/sba'
import { useToast } from '../../ui/Toast'
import Button from '../../ui/Button'
import ClassRecordsPanel from './ClassRecordsPanel'
import MarkColumnsEditor, { cleanColumns } from './MarkColumnsEditor'

// The SBA tab lists both year-long marks and the final /30 combiner.
const SBA_TYPES = ['sba', 'sba_final']

// Fixed /30 columns — explicit keys so the G7 pre-fill can target the column.
const FINAL_COLUMNS = [
  { key: 'g5', label: 'Grade 5 (/10)', max: 10 },
  { key: 'g6', label: 'Grade 6 (/10)', max: 10 },
  { key: 'g7', label: 'Grade 7 (/10)', max: 10 },
]

function sbaGradeFor(grade) {
  const g = `G${String(grade || '').trim()}`
  return SBA_GRADE_VALUES.includes(g) ? g : null
}

function blueprintColumns(subject, sbaGrade) {
  const bp = sbaGrade ? getSbaBlueprint(subject, sbaGrade) : null
  if (!bp) return null
  return bp.columns.map((c) => ({
    label: `${String(c.group || '').replace('Term ', 'T')} ${c.label}`.trim(),
    max: c.max,
  }))
}

/** Per-rosterId /10 mark from a year-long SBA record (for the Final pre-fill). */
function sbaTenByRoster(sbaRecord) {
  const max = maxTotalOf(sbaRecord.columns || [])
  const rows = computeRecordRows({
    snapshot: sbaRecord.rosterSnapshot || [],
    columns: sbaRecord.columns || [],
    marks: sbaRecord.marks || {},
  })
  const map = {}
  rows.forEach((r) => { map[r.rosterId] = convertSbaMark(r.total, max).rounded })
  return map
}

function YearMarksForm({ register, roster, onCreated, onCancel }) {
  const { currentUser } = useAuth()
  const toast = useToast()
  const sbaGrade = sbaGradeFor(register.grade)
  const [subject, setSubject] = useState(SBA_SUBJECTS[0]?.value || '')
  const [columns, setColumns] = useState(() => blueprintColumns(SBA_SUBJECTS[0]?.value, sbaGrade) || [{ label: 'Task', max: 20 }])
  const [saving, setSaving] = useState(false)
  const activeCount = roster.filter((r) => r.status === 'active').length
  const gradeTotal = sbaGrade ? getSbaGradeTotal(subject, sbaGrade) : 0

  function pickSubject(value) {
    setSubject(value)
    const cols = blueprintColumns(value, sbaGrade)
    if (cols) setColumns(cols)
  }

  async function handleCreate() {
    const cols = cleanColumns(columns)
    if (cols.length === 0) { toast.error('Add at least one mark column with a maximum.'); return }
    if (activeCount === 0) { toast.error('This class has no active learners yet.'); return }
    const subjLabel = SBA_SUBJECTS.find((s) => s.value === subject)?.label || subject
    setSaving(true)
    try {
      const id = await createRecordFromRoster({
        classId: register.id, teacherUid: currentUser.uid, type: 'sba',
        title: `SBA — ${subjLabel} (Grade ${register.grade} · ${register.year})`,
        subject, term: '', year: register.year,
        assessmentType: 'sba', columns: cols, roster,
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
    <>
      {!sbaGrade && (
        <p className="text-amber-600 text-xs">
          ECZ SBA runs in Grades 5–7. This class is Grade {register.grade}, so no official
          blueprint loads — you can still record marks with custom columns.
        </p>
      )}
      <div>
        <label className="block text-xs font-black theme-text-muted uppercase tracking-wider mb-1">Subject</label>
        <select className={`${inputCls} w-full sm:w-72`} value={subject} onChange={(e) => pickSubject(e.target.value)}>
          {SBA_SUBJECTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>
      {gradeTotal > 0 && (
        <p className="theme-text-muted text-xs">
          Official ECZ blueprint loaded · <span className="theme-text font-black">{gradeTotal} marks</span> total
          → converts to a mark out of 10 (the grade&apos;s 10%).
        </p>
      )}
      <MarkColumnsEditor columns={columns} setColumns={setColumns} />
      <p className="theme-text-muted text-xs">{activeCount} active learner{activeCount === 1 ? '' : 's'} will be added automatically.</p>
      <div className="flex gap-2">
        <Button onClick={handleCreate} loading={saving}>Create &amp; enter marks</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </>
  )
}

function FinalForm({ register, roster, records, onCreated, onCancel }) {
  const { currentUser } = useAuth()
  const toast = useToast()
  const [sourceId, setSourceId] = useState('') // which year-long SBA record pre-fills G7
  const [saving, setSaving] = useState(false)
  const activeCount = roster.filter((r) => r.status === 'active').length
  const sbaRecords = (records || []).filter((r) => r.type === 'sba')

  async function handleCreate() {
    if (activeCount === 0) { toast.error('This class has no active learners yet.'); return }
    // Pre-seed Grade 7 from the chosen SBA record's /10, matched by rosterId.
    let marks = {}
    if (sourceId) {
      const src = sbaRecords.find((r) => r.id === sourceId)
      if (src) {
        const ten = sbaTenByRoster(src)
        marks = Object.fromEntries(
          roster.filter((r) => r.status === 'active' && ten[r.id] != null).map((r) => [r.id, { g7: ten[r.id] }]),
        )
      }
    }
    setSaving(true)
    try {
      const id = await createRecordFromRoster({
        classId: register.id, teacherUid: currentUser.uid, type: 'sba_final',
        title: `Final SBA (/30) — ${register.className} (${register.year})`,
        subject: register.subject || null, term: '', year: register.year,
        assessmentType: 'sba_final', columns: FINAL_COLUMNS, roster, marks,
      })
      onCreated(id)
    } catch (err) {
      toast.error(`Could not create Final SBA record: ${err.message || 'unexpected error'}`)
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'rounded-radius-md border theme-border theme-card theme-text px-2.5 py-2 text-sm'
  return (
    <>
      <p className="theme-text-muted text-xs">
        Combines each learner&apos;s Grade 5 + 6 + 7 SBA marks (each out of 10) into the
        final mark out of {SBA_MAX_FINAL_MARK} entered on the ECZ OMES portal.
      </p>
      <div>
        <label className="block text-xs font-black theme-text-muted uppercase tracking-wider mb-1">
          Pre-fill Grade 7 from (optional)
        </label>
        <select className={`${inputCls} w-full sm:w-96`} value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
          <option value="">— Don&apos;t pre-fill (enter all three manually) —</option>
          {sbaRecords.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
        </select>
        {sbaRecords.length === 0 && (
          <p className="theme-text-muted text-[11px] mt-1">No year-long SBA records yet — create one first to auto-fill Grade 7.</p>
        )}
      </div>
      <p className="theme-text-muted text-xs">{activeCount} active learner{activeCount === 1 ? '' : 's'} will be added automatically.</p>
      <div className="flex gap-2">
        <Button onClick={handleCreate} loading={saving}>Create &amp; enter marks</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </>
  )
}

function CreateForm(props) {
  const [mode, setMode] = useState('marks')
  return (
    <div className="theme-card border theme-border rounded-radius-md p-4 space-y-3">
      <div className="flex gap-1 border-b theme-border">
        {[['marks', 'Year marks (/10)'], ['final', 'Final SBA (/30)']].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setMode(key)}
            className={`px-3 py-2 text-sm font-black border-b-2 ${mode === key ? 'theme-accent-text border-current' : 'theme-text-muted border-transparent'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === 'marks' ? <YearMarksForm {...props} /> : <FinalForm {...props} />}
    </div>
  )
}

function describeSbaRecord(rec) {
  const learners = rec.rosterSnapshot?.length || 0
  if (rec.type === 'sba_final') {
    const avg = rec.stats?.count ? `class avg ${rec.stats.classAverageMark}/${30}` : 'not marked yet'
    return `Final /30 · ${learners} learners · ${avg}`
  }
  const max = maxTotalOf(rec.columns || [])
  if (!rec.stats?.count) return `${learners} learners · /${max} → /10 · not marked yet`
  const avg10 = convertSbaMark(rec.stats.classAverageMark, max).rounded
  return `${learners} learners · class avg ${avg10}/10 · ${rec.stats.classAverage}%`
}

export default function SbaTab({ register }) {
  return (
    <ClassRecordsPanel
      register={register}
      type={SBA_TYPES}
      periodScoped={false}
      newLabel="+ New SBA record"
      intro="School-Based Assessment — marks convert to the ECZ 10% per grade, and combine to /30."
      emptyIcon="📝"
      emptyTitle="No SBA records yet"
      emptyText="Pick a subject — the official ECZ blueprint and your class list load automatically, so you just enter marks."
      describeRecord={describeSbaRecord}
      renderCreate={(props) => <CreateForm {...props} />}
    />
  )
}
