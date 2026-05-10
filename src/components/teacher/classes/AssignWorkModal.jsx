/**
 * Modal: pick a published quiz/exam → assign it to the current class.
 * Audit A10 PR 3.
 *
 * Shows the most recent published quizzes for the class's grade
 * (defaulting to all subjects when the class is multi-subject). The
 * teacher can search by title, optionally set a due date, and hit
 * "Assign". The Cloud Function does the actual write + denormalises
 * the title onto the assignment doc.
 *
 * Kept simple — no pagination, no sorting controls. The 50-quiz cap
 * + most-recent ordering covers the common case; teachers needing to
 * find an older assignment can search by title or paste the quiz id.
 */

import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs, limit as fsLimit, orderBy, query, where } from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { createClassAssignment } from '../../../utils/assignments'
import { SUBJECTS } from '../../../config/curriculum'
import Skeleton from '../../ui/Skeleton'
import SubjectIcon from '../../ui/SubjectIcon'

async function fetchAssignableQuizzes({ grade, subject }) {
  // Pull recent published quizzes that match the class's grade.
  // We don't strictly filter by subject because a "Grade 5" class
  // might span all subjects — but if the class is subject-specific,
  // we surface that subject first.
  const filters = [where('isPublished', '==', true)]
  if (grade) filters.push(where('grade', '==', String(grade)))
  if (subject) filters.push(where('subject', '==', subject))
  try {
    const q = query(
      collection(db, 'quizzes'),
      ...filters,
      orderBy('updatedAt', 'desc'),
      fsLimit(50),
    )
    const snap = await getDocs(q)
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  } catch (err) {
    // The composite index for grade+isPublished+updatedAt may not exist
    // yet in older deployments. Fallback: drop the orderBy and let the
    // client sort. Less fancy but works against any deployed schema.
    console.warn('[AssignWorkModal] indexed query failed; using fallback', err)
    const q2 = query(
      collection(db, 'quizzes'),
      ...filters,
      fsLimit(50),
    )
    const snap = await getDocs(q2)
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0))
  }
}

export default function AssignWorkModal({ open, classId, classGrade, classSubject, onClose, onAssigned }) {
  const [quizzes, setQuizzes] = useState([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [dueAt, setDueAt] = useState('') // datetime-local string
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError('')
    fetchAssignableQuizzes({ grade: classGrade, subject: classSubject })
      .then((rows) => { if (!cancelled) setQuizzes(rows) })
      .catch((err) => {
        console.warn('[AssignWorkModal] load failed', err)
        if (!cancelled) setError('Could not load published quizzes. Please try again.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, classGrade, classSubject])

  // Reset on close/open
  useEffect(() => {
    if (!open) {
      setSearch('')
      setSelectedId(null)
      setDueAt('')
      setError('')
    }
  }, [open])

  // Esc closes
  useEffect(() => {
    if (!open) return
    function onKey(e) { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const filtered = useMemo(() => {
    if (!search) return quizzes
    const needle = search.toLowerCase().trim()
    return quizzes.filter((q) =>
      (q.title || '').toLowerCase().includes(needle)
      || (q.subject || '').toLowerCase().includes(needle)
      || (q.topic || '').toLowerCase().includes(needle),
    )
  }, [quizzes, search])

  async function handleSubmit() {
    if (!selectedId) { setError('Pick a quiz first.'); return }
    setBusy(true); setError('')
    try {
      const dueAtDate = dueAt ? new Date(dueAt) : null
      const result = await createClassAssignment({
        classId,
        resourceType: 'quiz',
        resourceId: selectedId,
        dueAt: dueAtDate,
      })
      onAssigned?.(result)
      onClose?.()
    } catch (err) {
      console.error('[AssignWorkModal] assign failed', err)
      setError(err?.message || 'Could not assign that quiz. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <>
      <div
        aria-hidden="true"
        onClick={() => !busy && onClose?.()}
        className="fixed inset-0 bg-black/40 z-40 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Assign work to class"
        className="fixed inset-x-0 bottom-0 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 z-50 sm:max-w-lg sm:w-[calc(100vw-2rem)] max-h-[90vh] theme-card rounded-t-3xl sm:rounded-radius-md shadow-elev-lg border theme-border overflow-hidden flex flex-col"
      >
        <header className="p-4 border-b theme-border flex items-center justify-between">
          <div>
            <p className="theme-text font-black text-base">Assign a quiz</p>
            <p className="theme-text-muted text-xs mt-0.5">Pick a published quiz to share with this class.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="theme-text-muted hover:theme-text rounded-full p-2"
          >
            ✕
          </button>
        </header>

        <div className="p-4 space-y-3 border-b theme-border">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${classGrade ? `Grade ${classGrade} ` : ''}quizzes…`}
            className="w-full rounded-xl border-2 theme-border theme-input px-3 py-2 text-sm"
          />
        </div>

        <div className="flex-1 overflow-y-auto theme-bg">
          {loading ? (
            <div className="p-4 space-y-2">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 rounded-radius-md" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-sm theme-text-muted">
              {search
                ? 'No quizzes match that search.'
                : `No published Grade ${classGrade} quizzes yet.`}
            </div>
          ) : (
            <ul className="divide-y divide-current/10">
              {filtered.map((q) => {
                const subjectMeta = SUBJECTS.find((s) => s.id === q.subject)
                const isSelected = selectedId === q.id
                return (
                  <li key={q.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(q.id)}
                      className={`w-full text-left flex items-start gap-3 p-3 transition-colors ${
                        isSelected ? 'theme-accent-bg' : 'hover:theme-bg-subtle'
                      }`}
                    >
                      <SubjectIcon subject={subjectMeta} size="sm" className="flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="theme-text font-bold text-sm truncate">{q.title || 'Untitled quiz'}</p>
                        <p className="theme-text-muted text-xs mt-0.5 truncate">
                          {subjectMeta?.label || q.subject || ''}
                          {q.topic ? ` · ${q.topic}` : ''}
                          {q.questionCount ? ` · ${q.questionCount} q` : ''}
                          {q.duration ? ` · ${q.duration} min` : ''}
                        </p>
                      </div>
                      {isSelected && (
                        <span aria-hidden="true" className="theme-accent-text font-black text-xs">✓</span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="p-4 border-t theme-border space-y-3">
          <label className="block">
            <span className="block text-xs font-black theme-text-muted uppercase tracking-widest mb-1.5">
              Due date <span className="text-xs font-normal opacity-70 normal-case">(optional)</span>
            </span>
            <input
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              className="w-full rounded-xl border-2 theme-border theme-input px-3 py-2 text-sm"
            />
          </label>

          {error && (
            <p role="alert" className="text-sm font-bold text-rose-700">{error}</p>
          )}

          <div className="flex flex-wrap gap-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="theme-card border theme-border rounded-full px-4 py-2 text-sm font-black hover:theme-bg-subtle disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={busy || !selectedId}
              className="theme-accent-fill theme-on-accent rounded-full px-4 py-2 text-sm font-black hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Assigning…' : 'Assign'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
