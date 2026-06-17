/**
 * /teacher/register/new and /teacher/register/:classId/edit — create or edit a
 * Class Register's metadata (name, grade, term, year, subject, school).
 */

import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { createRegister, getRegister, updateRegister } from '../../../utils/classRegister'
import { GRADES, SUBJECTS } from '../../../config/curriculum'
import { useToast } from '../../ui/Toast'
import Button from '../../ui/Button'
import SeoHelmet from '../../seo/SeoHelmet'
import Skeleton from '../../ui/Skeleton'

const TERMS = ['Term 1', 'Term 2', 'Term 3']

export default function ClassRegisterEditor() {
  const { classId } = useParams()
  const editing = Boolean(classId)
  const { currentUser } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()

  const currentYear = new Date().getFullYear()
  const [form, setForm] = useState({
    className: '',
    grade: '5',
    term: 'Term 1',
    year: currentYear,
    subject: '',
    school: '',
  })
  const [loading, setLoading] = useState(editing)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!editing) return undefined
    let cancelled = false
    setLoading(true)
    getRegister(classId)
      .then((reg) => {
        if (cancelled || !reg) return
        setForm({
          className: reg.className || '',
          grade: String(reg.grade || '5'),
          term: reg.term || 'Term 1',
          year: reg.year || currentYear,
          subject: reg.subject || '',
          school: reg.school || '',
        })
      })
      .catch((err) => console.warn('[ClassRegisterEditor] load failed', err))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [classId, editing, currentYear])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.className.trim()) {
      toast.error('Give the class a name (e.g. "Grade 4 Blue").')
      return
    }
    setSaving(true)
    try {
      const fields = {
        className: form.className.trim(),
        grade: String(form.grade),
        term: form.term,
        year: Number(form.year),
        subject: form.subject || null,
        school: form.school.trim() || null,
      }
      if (editing) {
        await updateRegister(classId, fields)
        toast.success('Class updated.')
        navigate(`/teacher/register/${classId}`)
      } else {
        const newId = await createRegister({ teacherUid: currentUser.uid, fields })
        toast.success('Class created. Now add your learners.')
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
    return <div className="space-y-3 max-w-xl"><Skeleton className="h-10" /><Skeleton className="h-40" /></div>
  }

  const labelCls = 'block text-xs font-black theme-text-muted uppercase tracking-wider mb-1'
  const inputCls = 'w-full rounded-radius-md border theme-border theme-card theme-text px-3 py-2.5 text-sm'

  return (
    <div className="max-w-xl space-y-5">
      <SeoHelmet title={editing ? 'Edit class' : 'New class'} path="/teacher/register/new" noIndex />
      <div>
        <p className="text-xs font-black theme-text-muted uppercase tracking-widest">Class Register</p>
        <h1 className="theme-text font-display font-black text-2xl">{editing ? 'Edit class' : 'New class'}</h1>
      </div>

      <form onSubmit={handleSubmit} className="theme-card border theme-border rounded-radius-md p-5 space-y-4">
        <div>
          <label className={labelCls} htmlFor="className">Class name</label>
          <input id="className" className={inputCls} value={form.className} onChange={set('className')}
            placeholder="e.g. Grade 4 Blue" maxLength={120} autoFocus />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls} htmlFor="grade">Grade</label>
            <select id="grade" className={inputCls} value={form.grade} onChange={set('grade')}>
              {GRADES.map((g) => <option key={g} value={String(g)}>Grade {g}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="term">Term</label>
            <select id="term" className={inputCls} value={form.term} onChange={set('term')}>
              {TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls} htmlFor="year">Year</label>
            <input id="year" type="number" className={inputCls} value={form.year} onChange={set('year')}
              min={2000} max={2100} />
          </div>
          <div>
            <label className={labelCls} htmlFor="subject">Subject (optional)</label>
            <select id="subject" className={inputCls} value={form.subject} onChange={set('subject')}>
              <option value="">— Any / not set —</option>
              {SUBJECTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className={labelCls} htmlFor="school">School (optional)</label>
          <input id="school" className={inputCls} value={form.school} onChange={set('school')}
            placeholder="School name" maxLength={200} />
        </div>

        <div className="flex items-center gap-3 pt-1">
          <Button type="submit" loading={saving}>{editing ? 'Save changes' : 'Create class'}</Button>
          <Button type="button" variant="ghost" onClick={() => navigate(-1)}>Cancel</Button>
        </div>
      </form>
    </div>
  )
}
