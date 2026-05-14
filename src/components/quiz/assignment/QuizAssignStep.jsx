/**
 * Step 3 of the editor — inline panel that shows existing assignments
 * for this quiz and a CTA that opens the AssignmentWizard modal.
 *
 * Read-only inline view + modal-driven mutations is the same pattern
 * used by the class detail page; keeps the editor pane uncluttered.
 */

import { useCallback, useEffect, useState } from 'react'
import { SUBJECTS } from '../../../config/curriculum'
import { listAssignmentsForResource } from '../../../utils/quizAssignments'
import { removeClassAssignment } from '../../../utils/assignments'
import AssignmentWizard from './AssignmentWizard'
import QuizStatusBadge from './QuizStatusBadge'

function fmtDate(value) {
  if (!value) return null
  const d = value?.toDate?.() ?? new Date(value)
  if (Number.isNaN(d.getTime?.() ?? NaN)) return null
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function QuizAssignStep({ quiz, dirty, onAssignmentsChanged }) {
  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(true)
  const [showWizard, setShowWizard] = useState(false)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)

  const refresh = useCallback(async () => {
    if (!quiz?.id) {
      setAssignments([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const rows = await listAssignmentsForResource(quiz.id)
      setAssignments(rows)
    } catch (err) {
      console.warn('[QuizAssignStep] load failed', err)
      setAssignments([])
    } finally {
      setLoading(false)
    }
  }, [quiz?.id])

  useEffect(() => { refresh() }, [refresh])

  async function handleRemove(assignmentId) {
    setBusy(true); setToast(null)
    try {
      await removeClassAssignment(assignmentId)
      setToast({ kind: 'ok', text: 'Assignment removed.' })
      await refresh()
      onAssignmentsChanged?.()
    } catch (err) {
      setToast({ kind: 'err', text: err?.message || 'Could not remove that assignment.' })
    } finally {
      setBusy(false)
    }
  }

  const isPublished = Boolean(quiz?.isPublished)

  return (
    <div className="space-y-4">
      <section className="surface space-y-4 p-4 sm:p-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-eyebrow">Step 3 of 4</p>
            <h2 className="theme-text text-display-md mt-1 flex items-center gap-2">
              <span aria-hidden="true">🎯</span> Assign quiz
            </h2>
            <p className="theme-text-muted text-body-sm mt-1 max-w-prose">
              Share this quiz with one of your classes or fan it out to
              every Grade {quiz?.grade || '?'} learner you teach.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowWizard(true)}
            disabled={!isPublished || busy || dirty}
            className="theme-accent-fill theme-on-accent rounded-full px-4 py-2.5 text-sm font-black hover:opacity-90 disabled:opacity-50 min-h-[44px]"
            title={!isPublished ? 'Publish the quiz first.' : dirty ? 'Save your changes first.' : ''}
          >
            + Assign to classes
          </button>
        </header>

        {!isPublished && (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">
            ⚠️ This quiz isn&apos;t published yet. Finish Step 4 to publish, then come back to assign it.
          </p>
        )}
        {dirty && (
          <p className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm font-bold text-orange-900">
            ⚠️ You have unsaved changes. Save the quiz before assigning it.
          </p>
        )}

        {toast && (
          <p role="status" className={`rounded-2xl border px-3 py-2 text-sm font-bold ${
            toast.kind === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-rose-200 bg-rose-50 text-rose-900'
          }`}>
            {toast.text}
          </p>
        )}
      </section>

      <section className="surface overflow-hidden p-0">
        <header className="flex items-center justify-between gap-3 p-4 border-b theme-border">
          <p className="theme-text font-black text-sm">
            Active assignments ({assignments.length})
          </p>
          <p className="theme-text-muted text-xs">
            {assignments.length === 0 ? 'No one has this quiz yet.' : 'Live with learners now.'}
          </p>
        </header>
        {loading ? (
          <p className="p-6 text-center text-sm theme-text-muted">Loading assignments…</p>
        ) : assignments.length === 0 ? (
          <div className="p-8 text-center space-y-3">
            <p className="text-4xl" aria-hidden="true">🪄</p>
            <p className="theme-text font-black text-sm">No assignments yet</p>
            <p className="theme-text-muted text-xs max-w-xs mx-auto">
              Click <strong>Assign to classes</strong> above and pick how
              you want to share this quiz with your learners.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-current/10">
            {assignments.map((a) => {
              const subjectMeta = SUBJECTS.find((s) => s.id === a.subject)
              const dueLabel = fmtDate(a.dueAt)
              const openLabel = fmtDate(a.openAt)
              return (
                <li key={a.id} className="p-4 flex flex-wrap items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="theme-text font-bold text-sm truncate">
                        {a.resourceTitle || 'Quiz'}
                      </p>
                      <QuizStatusBadge status={a.status || 'active'} size="sm" />
                      {a.assignmentMode === 'automatic' && (
                        <span className="rounded-full bg-indigo-100 text-indigo-800 px-2 py-0.5 text-[10px] font-black">⚡ Auto</span>
                      )}
                    </div>
                    <p className="theme-text-muted text-xs mt-1">
                      {subjectMeta?.label || a.subject || ''}
                      {a.grade ? ` · Grade ${a.grade}` : ''}
                      {openLabel ? ` · opens ${openLabel}` : ''}
                      {dueLabel ? ` · due ${dueLabel}` : ''}
                      {Array.isArray(a.learnerUids) && a.learnerUids.length > 0
                        ? ` · ${a.learnerUids.length} learner${a.learnerUids.length === 1 ? '' : 's'}`
                        : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemove(a.id)}
                    disabled={busy}
                    className="text-xs font-bold text-rose-700 hover:underline disabled:opacity-50"
                  >
                    Remove
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <AssignmentWizard
        open={showWizard}
        quiz={quiz}
        resourceType="quiz"
        onClose={() => setShowWizard(false)}
        onAssigned={() => {
          setShowWizard(false)
          refresh()
          onAssignmentsChanged?.()
        }}
      />
    </div>
  )
}
