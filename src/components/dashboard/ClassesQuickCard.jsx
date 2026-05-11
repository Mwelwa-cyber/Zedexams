/**
 * "My classes" quick card on GradeHub.
 *
 * Surfaces the /classes/join entry point from the learner dashboard so
 * that learners who receive an invite code from their teacher have a
 * discoverable place to enrol. Without this card the dashboard has no
 * link to /classes or /classes/join, leaving the teacher-side message
 * ("paste it into /classes/join from their dashboard") unfulfilled.
 *
 * Renders unconditionally (subject to auth) so that:
 *   - First-time learners always see the "Join a class" CTA, and
 *   - Already-enrolled learners get a quick roster summary + a way to
 *     join another class.
 *
 * Reads are best-effort: a failing query (e.g. missing index, rules)
 * still renders the join CTA rather than blocking the dashboard.
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { listLearnerClasses } from '../../utils/classes'
import { SUBJECTS } from '../../config/curriculum'
import SubjectIcon from '../ui/SubjectIcon'

const MAX_PREVIEW = 3

export default function ClassesQuickCard() {
  const { currentUser } = useAuth()
  const [classes, setClasses] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!currentUser) { setLoading(false); return }
    let cancelled = false
    listLearnerClasses(currentUser.uid)
      .then((rows) => { if (!cancelled) setClasses(rows || []) })
      .catch((err) => {
        console.warn('[ClassesQuickCard] load failed', err)
        if (!cancelled) setClasses([])
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [currentUser])

  if (loading) return null

  const hasClasses = classes.length > 0
  const preview = classes.slice(0, MAX_PREVIEW)

  return (
    <section
      role="region"
      aria-label="My classes"
      className="theme-card theme-border rounded-radius-md border p-4 shadow-elev-sm"
    >
      <div className="flex items-center justify-between mb-3">
        <p className="theme-text font-black text-sm flex items-center gap-2">
          <span aria-hidden="true">🎒</span>
          My classes
        </p>
        {hasClasses && (
          <Link to="/classes" className="text-xs font-bold theme-accent-text hover:underline">
            View all
          </Link>
        )}
      </div>

      {hasClasses ? (
        <>
          <ul className="divide-y divide-current/10">
            {preview.map((klass) => {
              const subjectMeta = SUBJECTS.find((s) => s.id === klass.subject)
              const memberCount = Array.isArray(klass.learners) ? klass.learners.length : 0
              return (
                <li key={klass.id}>
                  <Link
                    to={`/classes/${klass.id}`}
                    className="flex items-start gap-3 py-3 hover:theme-bg-subtle -mx-2 px-2 rounded-radius-md transition-colors"
                  >
                    <SubjectIcon subject={subjectMeta} size="sm" className="flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="theme-text font-bold text-sm truncate">{klass.name}</p>
                      <p className="theme-text-muted text-xs mt-0.5 truncate">
                        Grade {klass.grade}
                        {subjectMeta ? ` · ${subjectMeta.label}` : ''}
                        {` · ${memberCount} learner${memberCount === 1 ? '' : 's'}`}
                      </p>
                    </div>
                    <span className="theme-accent-text text-xs font-black uppercase tracking-wider self-center">Open →</span>
                  </Link>
                </li>
              )
            })}
          </ul>
          <div className="mt-3 flex items-center justify-between gap-3 border-t theme-border pt-3">
            <p className="theme-text-muted text-xs">Got another invite code?</p>
            <Link
              to="/classes/join"
              className="theme-accent-fill theme-on-accent rounded-full px-3 py-1.5 text-xs font-black hover:opacity-90"
            >
              Join a class
            </Link>
          </div>
        </>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1">
            <p className="theme-text font-bold text-sm">Got an invite code from your teacher?</p>
            <p className="theme-text-muted text-xs mt-1">
              Paste your 8-character code to join your class and get assigned work.
            </p>
          </div>
          <Link
            to="/classes/join"
            className="theme-accent-fill theme-on-accent rounded-full px-4 py-2 text-sm font-black hover:opacity-90 text-center whitespace-nowrap"
          >
            Join a class
          </Link>
        </div>
      )}
    </section>
  )
}
