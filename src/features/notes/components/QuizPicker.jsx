// src/features/notes/components/QuizPicker.jsx
//
// Modal for linking a study note's quiz block to a published ZedExams quiz.
// Lists published quizzes for the note's grade (subject-matched by default,
// with a toggle to see all subjects), searchable. Picking one returns
// { quizId, quizTitle, questionCount } to the caller. Styled to match the
// notes-studio (neutral) aesthetic.

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Search } from '../../../components/ui/icons'
import { fetchPublishedQuizzes, quizMatchesSubject } from '../lib/quizzes'

export function QuizPicker({ open, grade, subject, currentQuizId, onPick, onClose }) {
  const [quizzes, setQuizzes] = useState([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [onlySubject, setOnlySubject] = useState(true)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true); setSearch('')
    fetchPublishedQuizzes({ grade })
      .then((rows) => { if (!cancelled) setQuizzes(rows) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, grade])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const filtered = useMemo(() => {
    let rows = quizzes
    if (onlySubject && subject) rows = rows.filter((q) => quizMatchesSubject(q, subject))
    const needle = search.trim().toLowerCase()
    if (needle) {
      rows = rows.filter((q) =>
        (q.title || '').toLowerCase().includes(needle)
        || (q.topic || '').toLowerCase().includes(needle)
        || (q.subject || '').toLowerCase().includes(needle))
    }
    return rows
  }, [quizzes, onlySubject, subject, search])

  if (!open) return null

  return (
    <div role="dialog" aria-modal="true" aria-label="Link a practice quiz" className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
      <div aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative w-full sm:max-w-lg max-h-[90vh] bg-white border border-neutral-200 rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col">
        <header className="p-4 border-b border-neutral-100 flex items-center justify-between gap-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Practice quiz</p>
            <h3 className="font-display text-xl text-neutral-900 mt-0.5">Link a published quiz</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-neutral-400 hover:text-neutral-700 rounded-full p-2 text-lg leading-none">✕</button>
        </header>

        <div className="p-4 border-b border-neutral-100 space-y-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              type="search" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search Grade ${grade || ''} quizzes…`}
              className="w-full rounded-xl border border-neutral-200 pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
            />
          </div>
          {subject && (
            <label className="flex items-center gap-2 text-xs text-neutral-600">
              <input type="checkbox" checked={onlySubject} onChange={(e) => setOnlySubject(e.target.checked)} />
              Only show {subject}
            </label>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-10 flex items-center justify-center text-neutral-400"><Loader2 size={18} className="animate-spin" /></div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-neutral-500">
              {search ? 'No quizzes match that search.'
                : onlySubject && subject ? `No published Grade ${grade} ${subject} quizzes. Untick the filter to see other subjects.`
                : `No published Grade ${grade} quizzes yet.`}
            </div>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {filtered.map((q) => {
                const isCurrent = q.id === currentQuizId
                return (
                  <li key={q.id}>
                    <button
                      type="button"
                      onClick={() => onPick?.({ quizId: q.id, quizTitle: q.title || 'Practice quiz', questionCount: q.questionCount ?? null })}
                      className="w-full text-left flex items-start gap-3 p-3 hover:bg-neutral-50 transition-colors"
                    >
                      <span className="text-lg mt-0.5" aria-hidden>🧪</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-neutral-900 truncate">{q.title || 'Untitled quiz'}</p>
                        <p className="text-xs text-neutral-500 mt-0.5 truncate">
                          {q.subject || ''}{q.topic ? ` · ${q.topic}` : ''}{q.questionCount ? ` · ${q.questionCount} q` : ''}{q.duration ? ` · ${q.duration} min` : ''}
                        </p>
                      </div>
                      <span className="self-center text-[11px] font-bold uppercase tracking-wider text-[var(--accent)]">
                        {isCurrent ? 'Linked' : 'Link →'}
                      </span>
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

export default QuizPicker
