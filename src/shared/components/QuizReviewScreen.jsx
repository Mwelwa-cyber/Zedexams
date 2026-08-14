import { useEffect, useMemo, useRef, useState } from 'react'
import {
  buildReviewEntries,
  filterReviewEntries,
  reviewCounts,
} from '../../utils/quizReviewStatus'

/**
 * QuizReviewScreen — the final review before submitting a quiz/exam.
 *
 * Lists every question with its status (answered / unanswered / bookmarked,
 * plus correct / incorrect where the quiz mode has ALREADY revealed feedback —
 * see quizReviewStatus.js), filter chips, tap-to-jump back to any question,
 * and the Finish button. Replaces the bare "Submit? N unanswered" confirm
 * modal in QuizRunnerV2 and DailyExamRunner.
 *
 * Correctness never leaks: entries only carry correct/incorrect when the
 * runner revealed that question (practice mode). In exam mode every chip is
 * neutral until submission.
 */

function BookmarkGlyph({ className = '' }) {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
    </svg>
  )
}

function chipStyle(entry) {
  if (entry.correctness === 'correct') return 'border-emerald-600 bg-emerald-50 text-emerald-900'
  if (entry.correctness === 'incorrect') return 'border-rose-600 bg-rose-50 text-rose-900'
  if (entry.answered) return 'border-slate-900 bg-white text-slate-900'
  return 'border-dashed border-slate-400 bg-slate-50 text-slate-500'
}

function chipStatus(entry) {
  if (entry.correctness === 'correct') return { icon: '✓', label: 'Correct' }
  if (entry.correctness === 'incorrect') return { icon: '✗', label: 'Incorrect' }
  if (entry.answered) return { icon: '●', label: 'Answered' }
  return { icon: '–', label: 'Unanswered' }
}

export default function QuizReviewScreen({
  open,
  onClose,
  onJumpToSection,
  onFinish,
  submitting = false,
  sections,
  answers,
  flagged,
  revealed,
  aiResults,
}) {
  const [filter, setFilter] = useState('all')
  const closeRef = useRef(null)

  const entries = useMemo(
    () => buildReviewEntries({ sections, answers, flagged, revealed, aiResults }),
    [sections, answers, flagged, revealed, aiResults],
  )
  const counts = useMemo(() => reviewCounts(entries), [entries])
  const visible = useMemo(() => filterReviewEntries(entries, filter), [entries, filter])

  useEffect(() => {
    if (!open) return
    setFilter('all')
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const t = setTimeout(() => closeRef.current?.focus(), 0)
    return () => {
      document.removeEventListener('keydown', onKey)
      clearTimeout(t)
    }
  }, [open, onClose])

  if (!open) return null

  const filters = [
    { id: 'all', label: `All (${counts.total})` },
    { id: 'unanswered', label: `Unanswered (${counts.unanswered})` },
    { id: 'bookmarked', label: `Bookmarked (${counts.bookmarked})` },
    // Only offered when the quiz mode has revealed feedback (practice) —
    // in exam mode no correctness exists, so the filter would be misleading.
    ...(counts.hasCorrectness ? [{ id: 'incorrect', label: `Incorrect (${counts.incorrect})` }] : []),
  ]

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm motion-safe:animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="quiz-review-title"
        className="relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl motion-safe:animate-slide-up sm:max-h-[85vh] sm:rounded-3xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 id="quiz-review-title" className="text-lg font-black text-slate-900">Review your answers</h2>
            <p className="text-sm text-slate-500">
              {counts.answered} of {counts.total} answered
              {counts.bookmarked ? ` · ${counts.bookmarked} bookmarked` : ''}
              {counts.hasCorrectness ? ` · ${counts.correct} correct · ${counts.incorrect} incorrect` : ''}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close review"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 border-slate-300 text-slate-600 hover:bg-slate-100"
          >
            <span aria-hidden="true" className="text-lg leading-none">×</span>
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 border-b border-slate-200 px-5 py-3" role="group" aria-label="Filter questions">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              className={`min-h-[36px] rounded-full border-2 px-3 py-1 text-xs font-bold transition-colors ${
                filter === f.id
                  ? 'border-orange-500 bg-orange-50 text-orange-700'
                  : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Question grid */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {visible.length ? (
            <div className="grid grid-cols-5 gap-2 sm:grid-cols-8">
              {visible.map((entry) => {
                const status = chipStatus(entry)
                return (
                  <button
                    key={entry.questionId}
                    type="button"
                    onClick={() => {
                      onJumpToSection?.(entry.sectionIndex)
                      onClose()
                    }}
                    aria-label={`Question ${entry.number}: ${status.label}${entry.bookmarked ? ', bookmarked' : ''}. Go to this question.`}
                    className={`relative flex min-h-[52px] flex-col items-center justify-center rounded-xl border-2 text-sm font-black transition-transform active:translate-y-0.5 ${chipStyle(entry)}`}
                  >
                    <span>{entry.number}</span>
                    <span aria-hidden="true" className="text-[10px] font-bold leading-none opacity-80">{status.icon}</span>
                    {entry.bookmarked && (
                      <span className="absolute right-1 top-1 text-amber-500" aria-hidden="true">
                        <BookmarkGlyph />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="py-8 text-center text-sm font-semibold text-slate-500">
              Nothing matches this filter — you’re all caught up here.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 px-5 py-3">
          {counts.unanswered > 0 && (
            <p className="mb-2 text-center text-xs font-bold text-orange-700">
              {counts.unanswered} unanswered question{counts.unanswered === 1 ? '' : 's'} will be marked incorrect.
            </p>
          )}
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="zx-sb zx-sb-secondary flex-1">
              ← Keep going
            </button>
            <button
              type="button"
              onClick={onFinish}
              disabled={submitting}
              className="zx-sb zx-sb-primary flex-1"
            >
              {submitting ? 'Submitting…' : 'Finish quiz ✓'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
