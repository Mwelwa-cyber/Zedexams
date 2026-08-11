/**
 * /teacher/register — "My Classes": the teacher's Class Registers.
 *
 * Each register is one official class (e.g. "Grade 4 Blue") whose roster
 * drives SBA, Assessment Studio, mark schedules, reports, and progress.
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { listTeacherRegisters } from '../../../utils/classRegister'
import { SUBJECTS } from '../../../config/curriculum'
import { formatClassGrade } from '../../../schemas/classRegister'
import SeoHelmet from '../../../components/seo/SeoHelmet'
import Skeleton from '../../../components/ui/Skeleton'
import { Users } from '../../../components/ui/icons'

function RegisterRow({ klass }) {
  const subjectMeta = SUBJECTS.find((s) => s.id === klass.subject || s.label === klass.subject)
  return (
    <li>
      <Link
        to={`/teacher/register/${klass.id}`}
        className="flex flex-wrap sm:flex-nowrap items-start gap-3 p-4 hover:theme-bg-subtle transition-colors"
      >
        <span className="flex-shrink-0 w-10 h-10 rounded-xl theme-accent-fill theme-on-accent grid place-items-center">
          <Users size={20} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="theme-text font-black text-sm truncate">{klass.className}</p>
          <p className="theme-text-muted text-xs mt-1">
            {formatClassGrade(klass.grade)}
            {klass.term ? ` · ${klass.term}` : ''}
            {klass.year ? ` · ${klass.year}` : ''}
            {subjectMeta ? ` · ${subjectMeta.label}` : (klass.subject ? ` · ${klass.subject}` : '')}
          </p>
          <p className="theme-text-muted text-[11px] mt-1">
            {klass.learnerCount || 0} learner{klass.learnerCount === 1 ? '' : 's'}
            {klass.school ? ` · ${klass.school}` : ''}
          </p>
        </div>
        <span className="theme-accent-text text-xs font-black uppercase tracking-wider self-center">Open →</span>
      </Link>
    </li>
  )
}

export default function ClassRegisterList() {
  const { currentUser } = useAuth()
  const [classes, setClasses] = useState([])
  const [loading, setLoading] = useState(true)
  const [errored, setErrored] = useState(false)

  useEffect(() => {
    if (!currentUser) return undefined
    let cancelled = false
    setLoading(true)
    listTeacherRegisters(currentUser.uid, { status: 'active', limit: 100 })
      .then((rows) => { if (!cancelled) setClasses(rows) })
      .catch((err) => {
        console.warn('[ClassRegisterList] load failed', err)
        if (!cancelled) setErrored(true)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [currentUser])

  return (
    <div className="space-y-5">
      <SeoHelmet title="Class Register" path="/teacher/register" noIndex />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="theme-text font-display font-black text-2xl sm:text-3xl">Class List</h1>
          <p className="theme-text-muted text-sm mt-1 max-w-prose">
            Build one official class list per class. Enter it once — then SBA,
            mark schedules, results, and reports load every learner for you, so
            you never type names twice.
          </p>
        </div>
        <Link
          to="/teacher/register/new"
          className="theme-accent-fill theme-on-accent rounded-full px-4 py-2 text-sm font-black hover:opacity-90"
        >
          + New class
        </Link>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-radius-md" />)}
        </div>
      ) : errored ? (
        <div role="alert" className="theme-card border theme-border rounded-radius-md p-6 text-center text-sm theme-text-muted">
          We couldn&apos;t load your classes. Please refresh and try again.
        </div>
      ) : classes.length === 0 ? (
        <div className="theme-card border theme-border rounded-radius-md p-8 text-center">
          <div className="text-5xl mb-3">📋</div>
          <h2 className="theme-text font-black text-lg">No classes yet</h2>
          <p className="theme-text-muted text-sm mt-2 max-w-md mx-auto">
            Create your first class — for example &ldquo;Grade 4 Blue&rdquo; — then
            add learners by typing, pasting, uploading a CSV/Excel file, or
            importing existing accounts.
          </p>
          <Link
            to="/teacher/register/new"
            className="mt-4 inline-block theme-accent-fill theme-on-accent rounded-full px-5 py-2.5 text-sm font-black hover:opacity-90"
          >
            Create my first class
          </Link>
        </div>
      ) : (
        <ul className="theme-card border theme-border rounded-radius-md divide-y divide-current/10 overflow-hidden">
          {classes.map((k) => <RegisterRow key={k.id} klass={k} />)}
        </ul>
      )}
    </div>
  )
}
