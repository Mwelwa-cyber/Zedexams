import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { SubtopicLessonsPanel } from '../sections/SubtopicLessonsPanel.jsx'
import { CoveragePanel } from '../sections/CoveragePanel.jsx'
import { TeachingProgressPanel } from '../sections/TeachingProgressPanel.jsx'

/**
 * ProgressPanel — Saved Lessons + Curriculum Coverage (+ series progress),
 * moved OUT of the creation flow into an on-demand overlay: a bottom sheet on
 * phones, a right-hand side panel at md+ (see .lpw-sheet in lessonStudio.css).
 *
 * The content is mounted only while open, so the live Firestore-fed panels
 * cost nothing until the teacher asks for them.
 *
 * Props:
 *   open           : boolean
 *   onClose        : () => void
 *   lessonMemory   : props bundle for SubtopicLessonsPanel (see LessonPlanStudio)
 *   coverageState  : { loading, coverage } from useCoverageAnalysis
 *   grade, subject : current selection (gates CoveragePanel)
 *   onSelectGap    : (topic, subtopic) => void — jump the form to a gap
 *   seriesProgress : null | { lessonBreakdown, completedCount, completedLessons,
 *                    seriesLoading, onContinue, onViewCompleted } (CBC series only)
 */
export function ProgressPanel({
  open,
  onClose,
  lessonMemory = {},
  coverageState = {},
  grade = '',
  subject = '',
  onSelectGap,
  seriesProgress = null,
}) {
  const closeRef = useRef(null)

  // Escape closes; focus moves into the panel on open.
  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    function onKey(e) {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const hasSelection = Boolean(grade && subject)

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Your progress">
      {/* Scrim */}
      <button
        type="button"
        aria-label="Close progress panel"
        onClick={onClose}
        className="absolute inset-0 h-full w-full bg-black/45"
      />

      <div className="lpw-sheet">
        <div className="flex items-center justify-between border-b-2 border-line px-4 py-3">
          <h2 className="font-display text-[15px] font-extrabold text-ink">Your progress</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-11 w-11 place-items-center rounded-xl text-ink-muted hover:bg-card"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
          {!hasSelection ? (
            <p className="px-4 py-6 text-center text-[13px] font-semibold text-ink-muted">
              Pick a class and subject in Lesson Setup to see your saved
              lessons and curriculum coverage.
            </p>
          ) : (
            <>
              {/* Saved lessons for the selected subtopic (hidden inside the
                  panel until a subtopic is chosen). */}
              <SubtopicLessonsPanel {...lessonMemory} />
              {!lessonMemory.subtopicName && (
                <p className="px-4 pt-3 text-[12px] font-semibold text-ink-muted">
                  Choose a topic and subtopic to see the lessons you have
                  already created for it.
                </p>
              )}

              {/* Syllabus coverage + gaps for the selected grade + subject. */}
              <CoveragePanel
                grade={grade}
                subject={subject}
                loading={coverageState.loading}
                coverage={coverageState.coverage}
                onSelectGap={(topic, subtopic) => {
                  onSelectGap?.(topic, subtopic)
                  onClose?.()
                }}
              />

              {/* Series teaching progress (CBC series mode only). */}
              {seriesProgress && (
                <TeachingProgressPanel
                  lessonBreakdown={seriesProgress.lessonBreakdown}
                  completedCount={seriesProgress.completedCount}
                  completedLessons={seriesProgress.completedLessons}
                  seriesLoading={seriesProgress.seriesLoading}
                  onContinue={seriesProgress.onContinue}
                  onViewCompleted={seriesProgress.onViewCompleted}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
