/**
 * Assessment Results tab — turn a test/exam into a class mark schedule.
 *
 * The teacher can link one of their existing assessments (from Assessment
 * Studio) or just enter a title, pick the assessment type + term, and the
 * class roster auto-loads for marking. Stored as a record of type 'assessment'
 * with sourceAssessmentId when linked. This is the "generate a mark schedule
 * from the selected class list" flow, living on the class so names never get
 * retyped.
 */

import { useEffect, useState } from 'react'
import { createRecordFromRoster } from '../../../utils/classRecords'
import { useAuth } from '../../../contexts/AuthContext'
import { useFirestore } from '../../../hooks/useFirestore'
import { useToast } from '../../ui/Toast'
import Button from '../../ui/Button'
import ClassRecordsPanel from './ClassRecordsPanel'
import MarkColumnsEditor, { cleanColumns } from './MarkColumnsEditor'

const TERMS = ['Term 1', 'Term 2', 'Term 3']
const ASSESSMENT_TYPES = [
  { value: 'topic', label: 'Topic Test' },
  { value: 'monthly', label: 'Monthly Test' },
  { value: 'midterm', label: 'Midterm Test' },
  { value: 'end_of_term', label: 'End of Term Test' },
  { value: 'exam', label: 'Exam' },
]

function CreateForm({ register, roster, onCreated, onCancel }) {
  const { currentUser } = useAuth()
  const { getMyAssessments } = useFirestore()
  const toast = useToast()
  const [assessments, setAssessments] = useState([])
  // True when the load threw (network blip, permission failure) — shown as a
  // retryable notice rather than silently hiding the "link an assessment" picker.
  const [assessmentsError, setAssessmentsError] = useState(false)
  const [assessmentsReloadKey, setAssessmentsReloadKey] = useState(0)
  const [sourceId, setSourceId] = useState('')
  const [title, setTitle] = useState('')
  const [assessmentType, setAssessmentType] = useState('topic')
  const [term, setTerm] = useState(register.term || 'Term 1')
  const [columns, setColumns] = useState([{ label: 'Score', max: 100 }])
  const [saving, setSaving] = useState(false)
  const activeCount = roster.filter((r) => r.status === 'active').length

  useEffect(() => {
    if (!currentUser) return
    setAssessmentsError(false)
    getMyAssessments(currentUser.uid)
      .then((rows) => setAssessments(Array.isArray(rows) ? rows : []))
      .catch((err) => {
        console.warn('[AssessmentResultsTab] assessments load failed', err)
        setAssessmentsError(true)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, getMyAssessments, assessmentsReloadKey])

  function pickAssessment(id) {
    setSourceId(id)
    const a = assessments.find((x) => x.id === id)
    if (a) {
      setTitle(a.title || '')
      if (a.assessmentType) setAssessmentType(a.assessmentType)
      const max = Number(a.totalMarks) > 0 ? Number(a.totalMarks) : 100
      setColumns([{ label: 'Score', max }])
    }
  }

  async function handleCreate() {
    if (!title.trim()) { toast.error('Enter a title or pick an assessment.'); return }
    const cols = cleanColumns(columns)
    if (cols.length === 0) { toast.error('Add at least one mark column with a maximum.'); return }
    if (activeCount === 0) { toast.error('This class has no active learners yet.'); return }
    const linked = assessments.find((x) => x.id === sourceId)
    setSaving(true)
    try {
      const id = await createRecordFromRoster({
        classId: register.id, teacherUid: currentUser.uid, type: 'assessment',
        title: title.trim(),
        subject: linked?.subject || register.subject || null,
        term, year: register.year,
        assessmentType,
        sourceAssessmentId: sourceId || null,
        columns: cols, roster,
      })
      onCreated(id)
    } catch (err) {
      toast.error(`Could not create record: ${err.message || 'unexpected error'}`)
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'rounded-radius-md border theme-border theme-card theme-text px-2.5 py-2 text-sm'
  return (
    <div className="theme-card border theme-border rounded-radius-md p-4 space-y-3">
      <h3 className="theme-text font-black">New assessment result</h3>

      {assessmentsError ? (
        <p className="text-xs theme-text-muted" role="alert">
          Couldn't load your assessment papers.{' '}
          <button
            type="button"
            className="underline cursor-pointer theme-text-muted"
            style={{ background: 'none', border: 'none', padding: 0, font: 'inherit' }}
            onClick={() => setAssessmentsReloadKey((k) => k + 1)}
          >
            Try again
          </button>
        </p>
      ) : assessments.length > 0 && (
        <div>
          <label className="block text-xs font-black theme-text-muted uppercase tracking-wider mb-1">Link an assessment (optional)</label>
          <select className={`${inputCls} w-full`} value={sourceId} onChange={(e) => pickAssessment(e.target.value)}>
            <option value="">— None (enter manually) —</option>
            {assessments.map((a) => <option key={a.id} value={a.id}>{a.title}{a.totalMarks ? ` (/${a.totalMarks})` : ''}</option>)}
          </select>
        </div>
      )}

      <input className={`${inputCls} w-full`} placeholder="Title — e.g. End of Term Maths Exam" value={title}
        onChange={(e) => setTitle(e.target.value)} maxLength={160} />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-black theme-text-muted uppercase tracking-wider mb-1">Type</label>
          <select className={`${inputCls} w-full`} value={assessmentType} onChange={(e) => setAssessmentType(e.target.value)}>
            {ASSESSMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-black theme-text-muted uppercase tracking-wider mb-1">Term</label>
          <select className={`${inputCls} w-full`} value={term} onChange={(e) => setTerm(e.target.value)}>
            {TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
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

export default function AssessmentResultsTab({ register }) {
  return (
    <ClassRecordsPanel
      register={register}
      type="assessment"
      newLabel="+ New assessment result"
      intro="Test & exam results for this class."
      emptyIcon="🎯"
      emptyTitle="No assessment results yet"
      emptyText="Link a test from the Assessment Paper Studio (or enter a title) — your class list loads automatically for marking."
      renderCreate={(props) => <CreateForm {...props} />}
    />
  )
}
