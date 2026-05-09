/**
 * /teacher/classes/new — create a class form. Audit A10.
 *
 * The minimum-viable create flow: name, grade, optional subject and
 * school. Invite-code generation is a separate step from the detail
 * page (admins / non-owners shouldn't be able to mint codes via this
 * form; the Cloud Function gates that).
 */

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { createClass } from '../../../utils/classes'
import { SUBJECTS } from '../../../config/curriculum'
import SeoHelmet from '../../seo/SeoHelmet'

const GRADES = ['4', '5', '6', '7']

function inputCls() {
  return 'w-full rounded-xl border-2 theme-border theme-input px-3 py-2 text-sm focus:outline-none disabled:opacity-50'
}

export default function TeacherClassEditor() {
  const { currentUser, userProfile } = useAuth()
  const navigate = useNavigate()

  const [form, setForm] = useState({
    name: '',
    description: '',
    grade: '5',
    subject: '',
    school: userProfile?.school || '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(key, value) { setForm((f) => ({ ...f, [key]: value })) }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!form.name.trim()) { setError('Give your class a name.'); return }
    if (!currentUser) { setError('Sign in to create a class.'); return }
    setSaving(true)
    try {
      const id = await createClass({
        teacherUid: currentUser.uid,
        fields: {
          name: form.name.trim().slice(0, 200),
          description: form.description.trim().slice(0, 1000) || null,
          grade: form.grade,
          subject: form.subject || null,
          school: form.school.trim().slice(0, 200) || null,
        },
      })
      navigate(`/teacher/classes/${id}`)
    } catch (err) {
      console.error('[TeacherClassEditor] create failed', err)
      setError(err?.message || 'Could not create the class. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <SeoHelmet title="New class" path="/teacher/classes/new" noIndex />

      <div>
        <Link to="/teacher/classes" className="text-xs font-bold theme-text-muted hover:theme-text">
          ← All classes
        </Link>
        <h1 className="theme-text font-display font-black text-2xl sm:text-3xl mt-1">New class</h1>
        <p className="theme-text-muted text-sm mt-1 max-w-prose">
          Set up a class roster. You&apos;ll generate an invite code from
          the class detail page once it&apos;s created.
        </p>
      </div>

      {error && (
        <div role="alert" className="border-l-4 border-rose-500 bg-rose-50 text-rose-900 text-sm rounded-r-lg p-3 font-bold">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-xs font-black theme-text-muted uppercase tracking-widest mb-1.5">
            Class name <span className="text-rose-700">*</span>
          </label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            required
            className={inputCls()}
            placeholder="Mr. Banda's Grade 5 Mathematics"
            maxLength={200}
          />
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-black theme-text-muted uppercase tracking-widest mb-1.5">
              Grade <span className="text-rose-700">*</span>
            </label>
            <select value={form.grade} onChange={(e) => set('grade', e.target.value)} className={inputCls()}>
              {GRADES.map((g) => <option key={g} value={g}>Grade {g}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-black theme-text-muted uppercase tracking-widest mb-1.5">
              Subject <span className="text-xs font-normal opacity-70 normal-case">(optional)</span>
            </label>
            <select value={form.subject} onChange={(e) => set('subject', e.target.value)} className={inputCls()}>
              <option value="">All subjects</option>
              {SUBJECTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-black theme-text-muted uppercase tracking-widest mb-1.5">
            School <span className="text-xs font-normal opacity-70 normal-case">(optional)</span>
          </label>
          <input
            type="text"
            value={form.school}
            onChange={(e) => set('school', e.target.value)}
            className={inputCls()}
            placeholder="Munali Boys' Secondary"
            maxLength={200}
          />
        </div>

        <div>
          <label className="block text-xs font-black theme-text-muted uppercase tracking-widest mb-1.5">
            Description <span className="text-xs font-normal opacity-70 normal-case">(optional)</span>
          </label>
          <textarea
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            rows={3}
            className={inputCls()}
            placeholder="A note for yourself — when this class meets, term focus, etc."
            maxLength={1000}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2 border-t theme-border">
          <button
            type="submit"
            disabled={saving}
            className="theme-accent-fill theme-on-accent rounded-full px-5 py-2 text-sm font-black hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Creating…' : 'Create class'}
          </button>
          <Link to="/teacher/classes" className="text-sm font-bold theme-text-muted hover:theme-text">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  )
}
