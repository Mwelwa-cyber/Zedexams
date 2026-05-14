/**
 * Class-detail-side picker that bridges into the redesigned
 * AssignmentWizard. Replaces the legacy AssignWorkModal.
 *
 * UX: open the picker → search & pick a published quiz → wizard
 * opens with the current class pre-selected. The teacher can still
 * fan the same quiz out to other classes from the wizard if they
 * want.
 */

import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs, limit as fsLimit, orderBy, query, where } from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { coerceQuiz } from '../../../schemas/quiz.js'
import { SUBJECTS } from '../../../config/curriculum'
import Skeleton from '../../ui/Skeleton'
import SubjectIcon from '../../ui/SubjectIcon'
import AssignmentWizard from '../../quiz/assignment/AssignmentWizard'

async function fetchAssignableQuizzes({ grade, subject }) {
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
    return snap.docs.map((d) => coerceQuiz({ id: d.id, ...d.data() })).filter(Boolean)
  } catch (err) {
    console.warn('[ClassAssignmentPicker] indexed query failed; using fallback', err)
    const q2 = query(collection(db, 'quizzes'), ...filters, fsLimit(50))
    const snap = await getDocs(q2)
    return snap.docs
      .map((d) => coerceQuiz({ id: d.id, ...d.data() }))
      .filter(Boolean)
      .sort((a, b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0))
  }
}

export default function ClassAssignmentPicker({
  open,
  classId,
  classGrade,
  classSubject,
  onClose,
  onAssigned,
}) {
  const [quizzes, setQuizzes] = useState([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [pickedQuiz, setPickedQuiz] = useState(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setPickedQuiz(null)
    setSearch('')
    fetchAssignableQuizzes({ grade: classGrade, subject: classSubject })
      .then((rows) => { if (!cancelled) setQuizzes(rows) })
      .catch((err) => {
        console.warn('[ClassAssignmentPicker] load failed', err)
        if (!cancelled) setQuizzes([])
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, classGrade, classSubject])

  useEffect(() => {
    if (!open) return
    function onKey(event) { if (event.key === 'Escape') onClose?.() }
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

  if (!open) return null

  // Once a quiz is picked, defer to the new wizard for the rich
  // assignment flow. Closing the wizard returns here (picker reopens).
  if (pickedQuiz) {
    return (
      <AssignmentWizard
        open
        quiz={pickedQuiz}
        resourceType="quiz"
        initialClassId={classId}
        onClose={() => setPickedQuiz(null)}
        onAssigned={(result) => {
          setPickedQuiz(null)
          onAssigned?.(result)
          onClose?.()
        }}
      />
    )
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Pick a quiz to assign" className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      />
      <div className="relative w-full sm:max-w-lg max-h-[90vh] theme-card theme-border border rounded-t-3xl sm:rounded-3xl shadow-elev-xl overflow-hidden flex flex-col">
        <header className="p-4 border-b theme-border flex items-center justify-between gap-2">
          <div>
            <p className="text-eyebrow">Assign a quiz</p>
            <p className="theme-text font-black text-base mt-0.5">Pick a published quiz to share</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="theme-text-muted hover:theme-text rounded-full p-2 min-h-[44px] min-w-[44px]"
          >
            ✕
          </button>
        </header>

        <div className="p-4 border-b theme-border">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
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
                return (
                  <li key={q.id}>
                    <button
                      type="button"
                      onClick={() => setPickedQuiz(q)}
                      className="w-full text-left flex items-start gap-3 p-3 hover:theme-bg-subtle transition-colors min-h-[64px]"
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
                      <span className="theme-accent-text text-xs font-black uppercase tracking-widest self-center">Assign →</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
