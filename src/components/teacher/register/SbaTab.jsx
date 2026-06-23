/**
 * SBA tab — record School-Based Assessment marks against a Class Register, with
 * the ECZ 10%-per-grade conversion built in.
 *
 * The teacher picks the SBA subject; the official ECZ task blueprint for the
 * class's grade loads as the mark columns, and the class roster auto-loads — so
 * they only enter marks. An SBA record spans the whole year (all term tasks), so
 * each learner's running total converts to a mark out of 10 (their 10% for the
 * grade, ready for the OMES portal). MarkEntryGrid shows that SBA /10 column.
 */

import { useState } from 'react'
import { createRecordFromRoster } from '../../../utils/classRecords'
import { maxTotalOf } from '../../../utils/classRecordMath'
import { useAuth } from '../../../contexts/AuthContext'
import {
  SBA_SUBJECTS, SBA_GRADE_VALUES, getSbaBlueprint, getSbaGradeTotal, convertSbaMark,
} from '../../../config/sba'
import { useToast } from '../../ui/Toast'
import Button from '../../ui/Button'
import ClassRecordsPanel from './ClassRecordsPanel'
import MarkColumnsEditor, { cleanColumns } from './MarkColumnsEditor'

/** Class grade ('5'|'6'|'7') → ECZ SBA grade ('G5'…). SBA is upper primary. */
function sbaGradeFor(grade) {
  const g = `G${String(grade || '').trim()}`
  return SBA_GRADE_VALUES.includes(g) ? g : null
}

/** Blueprint tasks → editable mark columns (term-tagged labels). */
function blueprintColumns(subject, sbaGrade) {
  const bp = sbaGrade ? getSbaBlueprint(subject, sbaGrade) : null
  if (!bp) return null
  return bp.columns.map((c) => ({
    label: `${String(c.group || '').replace('Term ', 'T')} ${c.label}`.trim(),
    max: c.max,
  }))
}

function CreateForm({ register, roster, onCreated, onCancel }) {
  const { currentUser } = useAuth()
  const toast = useToast()
  const sbaGrade = sbaGradeFor(register.grade)
  const [subject, setSubject] = useState(SBA_SUBJECTS[0]?.value || '')
  const [columns, setColumns] = useState(() => blueprintColumns(SBA_SUBJECTS[0]?.value, sbaGrade) || [{ label: 'Task', max: 20 }])
  const [saving, setSaving] = useState(false)
  const activeCount = roster.filter((r) => r.status === 'active').length

  const gradeTotal = sbaGrade ? getSbaGradeTotal(subject, sbaGrade) : 0
  const hasBlueprint = gradeTotal > 0

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
    const title = `SBA — ${subjLabel} (Grade ${register.grade} · ${register.year})`
    setSaving(true)
    try {
      const id = await createRecordFromRoster({
        classId: register.id, teacherUid: currentUser.uid, type: 'sba',
        title, subject,
        term: '', // SBA spans the whole year — not term-scoped
        year: register.year,
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
    <div className="theme-card border theme-border rounded-radius-md p-4 space-y-3">
      <h3 className="theme-text font-black">New SBA record</h3>
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
      {hasBlueprint && (
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
    </div>
  )
}

/** Record-row blurb including the class SBA average out of 10. */
function describeSbaRecord(rec) {
  const learners = rec.rosterSnapshot?.length || 0
  const max = maxTotalOf(rec.columns || [])
  if (!rec.stats?.count) return `${learners} learners · /${max} → /10 · not marked yet`
  const avg10 = convertSbaMark(rec.stats.classAverageMark, max).rounded
  return `${learners} learners · class avg ${avg10}/10 · ${rec.stats.classAverage}%`
}

export default function SbaTab({ register }) {
  return (
    <ClassRecordsPanel
      register={register}
      type="sba"
      periodScoped={false}
      newLabel="+ New SBA record"
      intro="School-Based Assessment — marks convert to the ECZ 10% per grade."
      emptyIcon="📝"
      emptyTitle="No SBA records yet"
      emptyText="Pick a subject — the official ECZ blueprint and your class list load automatically, so you just enter marks."
      describeRecord={describeSbaRecord}
      renderCreate={(props) => <CreateForm {...props} />}
    />
  )
}
