/**
 * /classes — list of classes the learner belongs to. Audit A10 (PR 2).
 *
 * Reads via classes/learners array-contains. Empty state nudges to
 * /classes/join with the invite-code form. Each card links to the
 * learner-side class detail page.
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { listLearnerClasses } from '../../utils/classes'
import { SUBJECTS } from '../../config/curriculum'
import SeoHelmet from '../seo/SeoHelmet'
import Skeleton from '../ui/Skeleton'

function ClassCard({ klass }) {
  const subjectMeta = SUBJECTS.find((s) => s.id === klass.subject)
  const memberCount = Array.isArray(klass.learners) ? klass.learners.length : 0
  return (
    <Link
      to={`/classes/${klass.id}`}
      className="theme-card border theme-border rounded-radius-md p-4 flex items-start gap-3 hover:theme-bg-subtle transition-colors"
    >
      <div className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-xl theme-bg-subtle">
        <span aria-hidden="true">{subjectMeta?.icon || '🎒'}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="theme-text font-black text-sm truncate">{klass.name}</p>
        <p className="theme-text-muted text-xs mt-1">
          Grade {klass.grade}
          {subjectMeta ? ` · ${subjectMeta.label}` : ''}
          {klass.school ? ` · ${klass.school}` : ''}
        </p>
        <p className="theme-text-muted text-[11px] mt-1">{memberCount} learner{memberCount === 1 ? '' : 's'}</p>
      </div>
      <span className="theme-accent-text text-xs font-black uppercase tracking-wider self-center">Open →</span>
    </Link>
  )
}

export default function LearnerClassesList() {
  const { currentUser } = useAuth()
  const [classes, setClasses] = useState([])
  const [loading, setLoading] = useState(true)
  const [errored, setErrored] = useState(false)

  useEffect(() => {
    if (!currentUser) return
    let cancelled = false
    setLoading(true)
    listLearnerClasses(currentUser.uid)
      .then((rows) => { if (!cancelled) setClasses(rows) })
      .catch((err) => {
        console.warn('[LearnerClassesList] load failed', err)
        if (!cancelled) setErrored(true)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [currentUser])

  return (
    <div className="min-h-screen theme-bg pb-20">
      <SeoHelmet title="My classes" path="/classes" noIndex />

      <header className="theme-hero px-4 pt-6 pb-12" data-bg-gradient="true">
        <div className="max-w-3xl mx-auto">
          <p className="text-white/80 font-black text-xs uppercase tracking-widest">Roster</p>
          <h1 className="text-white text-2xl sm:text-3xl font-black mt-1">My classes</h1>
          <p className="text-white/80 text-sm mt-2 max-w-2xl">
            Classes your teachers have added you to. Tap one for class info,
            classmates, and (soon) work assigned to your class.
          </p>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 -mt-6 space-y-4">
        <div className="theme-card border theme-border rounded-radius-md p-3 flex items-center justify-between gap-3">
          <p className="theme-text-muted text-sm">Got an invite code?</p>
          <Link
            to="/classes/join"
            className="theme-accent-fill theme-on-accent rounded-full px-3 py-1.5 text-xs font-black hover:opacity-90"
          >
            Join a class
          </Link>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[0, 1].map((i) => <Skeleton key={i} className="h-20 rounded-radius-md" />)}
          </div>
        ) : errored ? (
          <div role="alert" className="theme-card border theme-border rounded-radius-md p-6 text-center text-sm theme-text-muted">
            We couldn&apos;t load your classes. Please refresh and try again.
          </div>
        ) : classes.length === 0 ? (
          <div className="theme-card border theme-border rounded-radius-md p-8 text-center">
            <div className="text-5xl mb-3">🎒</div>
            <h2 className="theme-text font-black text-lg">You&apos;re not in any classes yet</h2>
            <p className="theme-text-muted text-sm mt-2 max-w-md mx-auto">
              Once your teacher shares an invite code with you, paste it on the
              join page and you&apos;ll see your class here.
            </p>
            <Link
              to="/classes/join"
              className="mt-4 inline-block theme-accent-fill theme-on-accent rounded-full px-5 py-2.5 text-sm font-black hover:opacity-90"
            >
              Paste an invite code
            </Link>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {classes.map((k) => <ClassCard key={k.id} klass={k} />)}
          </div>
        )}
      </div>
    </div>
  )
}
