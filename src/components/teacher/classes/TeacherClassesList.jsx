/**
 * /teacher/classes — list of classes the teacher owns. Audit A10.
 *
 * Foundation page: a teacher can see their classes, the per-class
 * member count, and the live invite code at a glance, plus jump to
 * the detail page for member management or hit "New class".
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { listTeacherClasses } from '../../../utils/classes'
import { SUBJECTS } from '../../../config/curriculum'
import SeoHelmet from '../../seo/SeoHelmet'
import Skeleton from '../../ui/Skeleton'
import SubjectIcon from '../../ui/SubjectIcon'

function ClassRow({ klass }) {
  const subjectMeta = SUBJECTS.find((s) => s.id === klass.subject)
  const learnerCount = Array.isArray(klass.learners) ? klass.learners.length : 0
  return (
    <li>
      <Link
        to={`/teacher/classes/${klass.id}`}
        className="flex flex-wrap sm:flex-nowrap items-start gap-3 p-4 hover:theme-bg-subtle transition-colors"
      >
        <SubjectIcon subject={subjectMeta} size="sm" className="flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="theme-text font-black text-sm truncate">{klass.name}</p>
          <p className="theme-text-muted text-xs mt-1">
            Grade {klass.grade}
            {subjectMeta ? ` · ${subjectMeta.label}` : ''}
            {klass.school ? ` · ${klass.school}` : ''}
          </p>
          <p className="theme-text-muted text-[11px] mt-1">
            {learnerCount} learner{learnerCount === 1 ? '' : 's'}
            {klass.inviteCode ? ` · code ${klass.inviteCode}` : ' · no invite code yet'}
          </p>
        </div>
        <span className="theme-accent-text text-xs font-black uppercase tracking-wider self-center">Open →</span>
      </Link>
    </li>
  )
}

export default function TeacherClassesList() {
  const { currentUser } = useAuth()
  const [classes, setClasses] = useState([])
  const [loading, setLoading] = useState(true)
  const [errored, setErrored] = useState(false)

  useEffect(() => {
    if (!currentUser) return
    let cancelled = false
    setLoading(true)
    listTeacherClasses(currentUser.uid, { includeArchived: false, limit: 100 })
      .then((rows) => { if (!cancelled) setClasses(rows) })
      .catch((err) => {
        console.warn('[TeacherClassesList] load failed', err)
        if (!cancelled) setErrored(true)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [currentUser])

  return (
    <div className="space-y-5">
      <SeoHelmet title="Classes" path="/teacher/classes" noIndex />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-black theme-text-muted uppercase tracking-widest">Roster</p>
          <h1 className="theme-text font-display font-black text-2xl sm:text-3xl">My classes</h1>
          <p className="theme-text-muted text-sm mt-1 max-w-prose">
            Create a class, share the invite code with your learners, and
            keep the roster in one place. Assigning quizzes and seeing
            class-level progress lands in a follow-up.
          </p>
        </div>
        <Link
          to="/teacher/classes/new"
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
          <div className="text-5xl mb-3">🎒</div>
          <h2 className="theme-text font-black text-lg">No classes yet</h2>
          <p className="theme-text-muted text-sm mt-2 max-w-md mx-auto">
            Create your first class to start building a private roster.
            You&apos;ll get an invite code learners can paste in their
            dashboard to join.
          </p>
          <Link
            to="/teacher/classes/new"
            className="mt-4 inline-block theme-accent-fill theme-on-accent rounded-full px-5 py-2.5 text-sm font-black hover:opacity-90"
          >
            Create my first class
          </Link>
        </div>
      ) : (
        <ul className="theme-card border theme-border rounded-radius-md divide-y divide-current/10 overflow-hidden">
          {classes.map((k) => <ClassRow key={k.id} klass={k} />)}
        </ul>
      )}
    </div>
  )
}
