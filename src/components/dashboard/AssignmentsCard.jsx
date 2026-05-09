/**
 * "From your teacher" card on GradeHub. Audit A10 PR 3.
 *
 * Reads the learner's classes and the active assignments across them,
 * then renders the most recent N as a friendly list. Each row links
 * straight to the quiz/exam runner so a tap takes the learner from
 * dashboard → into the assigned work in one step.
 *
 * Self-hides when:
 *   - The user isn't signed in (covered by parent route guard, but
 *     defended-in-depth here too).
 *   - The user has no classes.
 *   - The user has classes but no active assignments yet.
 *
 * Both reads degrade gracefully — a missing index or rule rejection
 * just renders nothing rather than blocking the rest of the dashboard.
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { listLearnerClasses } from '../../utils/classes'
import { listAssignmentsForLearner } from '../../utils/assignments'
import { SUBJECTS } from '../../config/curriculum'

const MAX_ROWS = 5

function dueLabel(dueAt) {
  if (!dueAt) return null
  const d = dueAt?.toDate?.() ?? new Date(dueAt)
  if (Number.isNaN(d?.getTime?.())) return null
  const ms = d.getTime() - Date.now()
  if (ms < 0) return 'overdue'
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000))
  if (days === 0) return 'due today'
  if (days === 1) return 'due tomorrow'
  if (days < 7) return `due in ${days} days`
  return `due ${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`
}

export default function AssignmentsCard() {
  const { currentUser } = useAuth()
  const [assignments, setAssignments] = useState([])
  const [classNamesById, setClassNamesById] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!currentUser) { setLoading(false); return }
    let cancelled = false
    ;(async () => {
      try {
        const classes = await listLearnerClasses(currentUser.uid).catch(() => [])
        if (cancelled) return
        if (!classes || classes.length === 0) {
          setAssignments([])
          setLoading(false)
          return
        }
        const names = Object.fromEntries(classes.map((c) => [c.id, c.name]))
        setClassNamesById(names)
        const rows = await listAssignmentsForLearner(
          classes.map((c) => c.id),
          { limit: MAX_ROWS },
        ).catch(() => [])
        if (!cancelled) setAssignments(rows)
      } catch (err) {
        console.warn('[AssignmentsCard] load failed', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [currentUser])

  // Self-hide while loading + when there's nothing to show. We don't
  // want a blank "From your teacher" header sitting above the cards
  // for the 99% of learners with no assignments yet.
  if (loading || assignments.length === 0) return null

  return (
    <section
      role="region"
      aria-label="Assigned work from your teachers"
      className="theme-card theme-border rounded-radius-md border p-4 shadow-elev-sm"
    >
      <div className="flex items-center justify-between mb-3">
        <p className="theme-text font-black text-sm flex items-center gap-2">
          <span aria-hidden="true">🍎</span>
          From your teacher
        </p>
        <Link to="/classes" className="text-xs font-bold theme-accent-text hover:underline">
          My classes
        </Link>
      </div>

      <ul className="divide-y divide-current/10">
        {assignments.map((a) => {
          const subjectMeta = SUBJECTS.find((s) => s.id === a.subject)
          const due = dueLabel(a.dueAt)
          const targetPath = a.resourceType === 'exam'
            ? `/exam/${a.resourceId}`
            : `/quiz/${a.resourceId}`
          return (
            <li key={a.id}>
              <Link
                to={targetPath}
                className="flex items-start gap-3 py-3 hover:theme-bg-subtle -mx-2 px-2 rounded-radius-md transition-colors"
              >
                <div className="flex-shrink-0 w-9 h-9 rounded-lg theme-bg-subtle flex items-center justify-center text-base">
                  <span aria-hidden="true">{subjectMeta?.icon || '📝'}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="theme-text font-bold text-sm truncate">{a.resourceTitle}</p>
                  <p className="theme-text-muted text-xs mt-0.5 truncate">
                    {classNamesById[a.classId] || 'Class'}
                    {subjectMeta ? ` · ${subjectMeta.label}` : ''}
                    {due ? ` · ${due}` : ''}
                  </p>
                </div>
                <span className="theme-accent-text text-xs font-black uppercase tracking-wider self-center">Start →</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
