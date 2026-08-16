/**
 * /teacher/register/new and /teacher/register/:classId/edit — Class Management
 * → Edit Class.
 *
 * A CLASS is an academic group (Grade 4A, Form 1B) that exists for the whole
 * academic year. That is the entire content of this form:
 *
 *   class name · curriculum · grade/form · class/stream · academic year ·
 *   class teacher · school · status
 *
 * Two fields this screen used to carry are deliberately NOT here:
 *
 *   Subject — belongs to a teaching assignment (/teacher/settings → Teaching
 *     assignments), never to a class. One class has ONE learner list however
 *     many subjects are taught to it; a subject on the class is what produced
 *     a separate "Grade 4A Mathematics" roster beside "Grade 4A English", with
 *     the same eighty children typed twice.
 *   Term — a class runs the full year and its register carries Term 1, 2 and 3
 *     (§13, §14). The term is chosen when you OPEN attendance, reports or
 *     assessments.
 *
 * Neither field is deleted from documents that already carry one: the values
 * are preserved and reported by scripts/migrate-class-subjects.mjs, which is
 * what moves them to teaching assignments. This form simply stops writing
 * them, so nothing new is created wrong while the migration is validated.
 */

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { createRegister, getRegister, updateRegister } from '../../../utils/classRegister'
import { getSchoolProfile } from '../../../utils/schoolProfileService'
import {
  CLASS_REGISTER_GRADE_OPTIONS,
  CLASS_REGISTER_GRADES,
  formatClassGrade,
  suggestClassName,
} from '../../../shared/schemas/classRegister'
import { normalizeCurriculum } from '../../../config/paperTerminology'
import { useToast } from '../../../shared/components/Toast'
import Button from '../../../shared/components/Button'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import Skeleton from '../../../shared/components/Skeleton'

// The register's grade set is its OWN data model (the full school ladder,
// Nursery through Form 4 — see CLASS_REGISTER_GRADE_OPTIONS): every grade the
// schema can store is offered, and nothing unmappable ever appears.
const ECE_GRADE_VALUES = new Set(['nursery', 'reception'])
function gradeGroup(value) {
  if (ECE_GRADE_VALUES.has(value)) return 'Early childhood'
  return /^\d+$/.test(value) ? 'Primary' : 'Secondary'
}
const GRADE_GROUPS = ['Early childhood', 'Primary', 'Secondary']

const CURRICULA = [
  { value: 'cbc', label: 'Competency-Based Curriculum' },
  { value: 'previous', label: '2013 Curriculum' },
]

// Common Zambian stream letters, plus free text for schools that name streams
// differently (Blue/Gold, North/South).
const COMMON_STREAMS = ['A', 'B', 'C', 'D', 'E', 'F']

const CLASS_STATUS_OPTIONS = [
  { value: 'active', label: 'Active', hint: 'In use this academic year.' },
  { value: 'archived', label: 'Archived', hint: 'Kept for records, out of your active list.' },
]

export default function ClassRegisterEditor() {
  const { classId } = useParams()
  const editing = Boolean(classId)
  const { currentUser, userProfile } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()

  const currentYear = new Date().getFullYear()
  const [form, setForm] = useState({
    className: '',
    curriculum: 'cbc',
    grade: '',
    stream: '',
    year: currentYear,
    classTeacherName: '',
    school: '',
    status: 'active',
  })
  // True until the teacher types a class name of their own. While it holds,
  // the name tracks grade + stream, so picking "Grade 4" and "A" fills in
  // "Grade 4A" without anyone typing it — and typing over it stops the
  // tracking rather than fighting the teacher for the field.
  const [nameIsAuto, setNameIsAuto] = useState(!editing)
  const [loading, setLoading] = useState(editing)
  // null = no error; 'notfound' = register resolved null; 'error' = load rejected
  const [loadError, setLoadError] = useState(null)
  const [saving, setSaving] = useState(false)
  // Retained so an existing class keeps values this form no longer edits.
  const [legacy, setLegacy] = useState({ term: '', subject: null })

  useEffect(() => {
    let cancelled = false
    if (!editing) {
      // Seed a new class from the teacher's own school + name, which is the
      // answer for both fields in every case but a teacher registering a class
      // at a second school.
      getSchoolProfile(currentUser?.uid)
        .catch(() => null)
        .then((school) => {
          if (cancelled) return
          setForm((f) => ({
            ...f,
            school: f.school || school?.schoolName || '',
            classTeacherName: f.classTeacherName || userProfile?.displayName || '',
          }))
        })
        // The .catch above covers the lookup — this one terminates the chain so
        // a throw from the seeding callback surfaces as a missing seed (which
        // the teacher can simply type over) rather than an unhandled rejection.
        .catch(() => {})
      return () => { cancelled = true }
    }
    setLoading(true)
    getRegister(classId)
      .then((reg) => {
        if (cancelled) return
        if (!reg) { setLoadError('notfound'); return }
        setForm({
          className: reg.className || '',
          curriculum: normalizeCurriculum(reg.curriculum) === 'obc' ? 'previous' : 'cbc',
          grade: reg.grade || '',
          stream: reg.stream || '',
          year: reg.year || currentYear,
          classTeacherName: reg.classTeacherName || '',
          school: reg.school || '',
          status: reg.status || 'active',
        })
        setLegacy({ term: reg.term || '', subject: reg.subject || null })
        setNameIsAuto(false)
      })
      .catch((err) => {
        console.warn('[ClassRegisterEditor] load failed', err)
        if (!cancelled) setLoadError('error')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [classId, editing, currentYear, currentUser?.uid, userProfile?.displayName])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  // Grade/stream changes flow into the name only while it is still automatic.
  function setGradeOrStream(key) {
    return (e) => {
      const value = e.target.value
      setForm((f) => {
        const next = { ...f, [key]: value }
        if (nameIsAuto && next.grade) next.className = suggestClassName(next.grade, next.stream)
        return next
      })
    }
  }

  const yearOptions = useMemo(() => {
    const years = new Set([currentYear - 1, currentYear, currentYear + 1])
    if (Number(form.year)) years.add(Number(form.year))
    return [...years].sort((a, b) => a - b)
  }, [currentYear, form.year])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.className.trim()) {
      toast.error('Give the class a name (for example "Grade 4A").')
      return
    }
    if (!form.grade || !CLASS_REGISTER_GRADES.includes(form.grade)) {
      toast.error('Choose the grade or form this class is in.')
      return
    }
    setSaving(true)
    try {
      const fields = {
        className: form.className.trim(),
        grade: form.grade,
        stream: form.stream.trim() || null,
        year: Number(form.year),
        curriculum: form.curriculum === 'previous' ? 'previous' : 'cbc',
        classTeacherName: form.classTeacherName.trim() || null,
        classTeacherUid: currentUser?.uid || null,
        school: form.school.trim() || null,
        status: form.status,
        // Written back verbatim so editing a class does not quietly discard a
        // value the migration has not moved yet.
        term: legacy.term,
        subject: legacy.subject,
      }
      if (editing) {
        await updateRegister(classId, fields)
        toast.success('Class updated.')
        navigate(`/teacher/register/${classId}`)
      } else {
        const newId = await createRegister({ teacherUid: currentUser.uid, fields })
        toast.success('Class created. Now build its class list.')
        navigate(`/teacher/register/${newId}`)
      }
    } catch (err) {
      console.warn('[ClassRegisterEditor] save failed', err)
      toast.error(`Could not save: ${err.message || 'unexpected error'}`)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="space-y-3 max-w-2xl"><Skeleton className="h-10" /><Skeleton className="h-96" /></div>
  }

  if (loadError) {
    return (
      <div className="max-w-2xl space-y-5">
        <SeoHelmet title="Edit class" path="/teacher/register/new" noIndex />
        <div role="alert" className="theme-card border border-red-300 rounded-radius-md p-6 text-center">
          <p className="theme-text font-black">
            {loadError === 'notfound'
              ? 'This class could not be found.'
              : 'We couldn’t load this class — refresh and try again.'}
          </p>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="theme-accent-text text-sm font-black mt-2 inline-block"
          >
            ← Go back
          </button>
        </div>
      </div>
    )
  }

  const labelCls = 'block text-xs font-black theme-text-muted uppercase tracking-wider mb-1'
  const inputCls = 'w-full rounded-radius-md border theme-border theme-card theme-text px-3 py-2.5 text-sm min-h-[44px]'
  const hintCls = 'theme-text-muted text-xs mt-1'

  return (
    <div className="max-w-2xl space-y-5">
      <SeoHelmet title={editing ? 'Edit class' : 'New class'} path="/teacher/register/new" noIndex />
      <div>
        <p className="text-xs font-black theme-text-muted uppercase tracking-widest">Class Management</p>
        <h1 className="theme-text font-display font-black text-2xl">{editing ? 'Edit Class' : 'New Class'}</h1>
        <p className="theme-text-muted text-sm mt-1 max-w-prose">
          A class is an academic group that runs for the whole year. Subjects are set under
          Teaching Assignments, and the term is chosen when you open attendance or reports.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="theme-card border theme-border rounded-radius-lg p-5 space-y-4">
        <div>
          <label className={labelCls} htmlFor="className">Class name</label>
          <input
            id="className"
            className={inputCls}
            value={form.className}
            onChange={(e) => { setNameIsAuto(false); set('className')(e) }}
            placeholder="e.g. Grade 4A"
            maxLength={120}
            autoFocus
          />
        </div>

        <div>
          <label className={labelCls} htmlFor="curriculum">Curriculum</label>
          <select id="curriculum" className={inputCls} value={form.curriculum} onChange={set('curriculum')}>
            {CURRICULA.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="grade">Grade / Form</label>
            <select id="grade" className={inputCls} value={form.grade} onChange={setGradeOrStream('grade')} required>
              <option value="">Choose a level…</option>
              {GRADE_GROUPS.map((group) => (
                <optgroup key={group} label={group}>
                  {CLASS_REGISTER_GRADE_OPTIONS
                    .filter((o) => gradeGroup(o.value) === group)
                    .map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="stream">Class / Stream</label>
            <input
              id="stream"
              className={inputCls}
              value={form.stream}
              onChange={setGradeOrStream('stream')}
              placeholder="A"
              list="class-stream-suggestions"
              maxLength={20}
            />
            <datalist id="class-stream-suggestions">
              {COMMON_STREAMS.map((s) => <option key={s} value={s} />)}
            </datalist>
            <p className={hintCls}>
              The letter or name that separates this class from others in {form.grade ? formatClassGrade(form.grade) : 'the same grade'}.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="year">Academic year</label>
            <select id="year" className={inputCls} value={form.year} onChange={set('year')}>
              {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <p className={hintCls}>The class runs for this whole year — all three terms.</p>
          </div>
          <div>
            <label className={labelCls} htmlFor="classTeacherName">Class teacher</label>
            <input id="classTeacherName" className={inputCls} value={form.classTeacherName}
              onChange={set('classTeacherName')} placeholder="Full name" maxLength={120} />
          </div>
        </div>

        <div>
          <label className={labelCls} htmlFor="school">School</label>
          <input id="school" className={inputCls} value={form.school} onChange={set('school')}
            placeholder="School name" maxLength={200} />
        </div>

        <div>
          <label className={labelCls} htmlFor="status">Status</label>
          <select id="status" className={inputCls} value={form.status} onChange={set('status')}>
            {CLASS_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <p className={hintCls}>
            {CLASS_STATUS_OPTIONS.find((o) => o.value === form.status)?.hint}
          </p>
        </div>

        {(legacy.subject || legacy.term) && (
          <div className="rounded-radius-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 space-y-1">
            <p className="font-black">This class still carries older settings.</p>
            <p>
              {legacy.subject ? `Subject "${legacy.subject}"` : ''}
              {legacy.subject && legacy.term ? ' and ' : ''}
              {legacy.term ? `term "${legacy.term}"` : ''}
              {' '}
              {legacy.subject && legacy.term ? 'were' : 'was'} saved on the class itself. Nothing is lost —
              subjects belong to your teaching assignments and terms are chosen when you open the register,
              so these values stay on the record until they have been moved.
            </p>
          </div>
        )}

        <div className="flex items-center gap-3 pt-1">
          <Button type="submit" loading={saving}>{editing ? 'Save changes' : 'Create class'}</Button>
          <Button type="button" variant="ghost" onClick={() => navigate(-1)}>Cancel</Button>
        </div>
      </form>
    </div>
  )
}
