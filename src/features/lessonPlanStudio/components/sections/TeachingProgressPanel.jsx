import { useState } from 'react'
import { ChartBarIcon } from '../../../../shared/components/icons'

/**
 * TeachingProgressPanel — collapsible sidebar section showing CBC lesson series progress.
 *
 * Props:
 *   lessonBreakdown:  LessonBreakdownItem[]  — [{ lessonNumber, title, focus, status }]
 *   completedCount:   number
 *   completedLessons: string[]               — lessonNumber strings that are done
 *   seriesLoading:    boolean
 *   onContinue:       () => void             — called when "Continue Next Lesson" clicked
 *   onViewCompleted:  () => void             — called when "View Completed" clicked
 *
 * CBC-only: parent renders this conditionally; component does not check curriculumMode.
 */
export function TeachingProgressPanel({
  lessonBreakdown,
  completedCount,
  completedLessons,
  seriesLoading,
  onContinue,
  onViewCompleted,
}) {
  const [open, setOpen] = useState(true)

  const total     = lessonBreakdown.length
  const hasSeries = total > 0
  const isDone    = completedCount > 0
  const progress  = hasSeries ? (completedCount / total) * 100 : 0

  // Determine the first pending lesson (next to teach)
  const completedSet = new Set(completedLessons)
  const nextPendingNumber = hasSeries
    ? (lessonBreakdown.find((item) => !completedSet.has(String(item.lessonNumber)))?.lessonNumber ?? null)
    : null

  return (
    <div className="border-b border-[#e5ddd0]">
      {/* Section header — always visible */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-[13px] font-semibold text-[#3d3529]">
          {/* Status dot */}
          <span
            className={[
              'inline-block h-2 w-2 rounded-full flex-shrink-0',
              isDone ? 'bg-green-500' : 'bg-[#c9c0b0]',
            ].join(' ')}
            aria-hidden="true"
          />
          <ChartBarIcon size={15} className="text-[#a99e8b]" aria-hidden="true" />
          Teaching Progress
        </span>

        {/* Chevron */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={[
            'text-[#a39d8e] transition-transform',
            open ? 'rotate-180' : '',
          ].join(' ')}
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Collapsible body */}
      {open && (
        <div className="px-4 pb-4 space-y-3">

          {/* Empty state */}
          {!hasSeries && (
            <p className="text-[12px] text-[#a39d8e]">No lesson series started yet.</p>
          )}

          {hasSeries && (
            <>
              {/* Loading spinner */}
              {seriesLoading && (
                <div className="flex items-center justify-center py-2" aria-label="Loading">
                  <svg
                    className="animate-spin h-4 w-4 text-[#a39d8e]"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v8H4z"
                    />
                  </svg>
                </div>
              )}

              {/* Progress summary */}
              <div>
                <p className="text-[12px] text-[#7a6d5d] mb-1.5">
                  {completedCount} of {total} lessons completed
                </p>
                {/* Progress bar */}
                <div className="h-1.5 w-full rounded-full bg-[#e5ddd0] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-green-500 transition-all"
                    style={{ width: `${progress}%` }}
                    role="progressbar"
                    aria-valuenow={completedCount}
                    aria-valuemin={0}
                    aria-valuemax={total}
                  />
                </div>
              </div>

              {/* Per-lesson status list */}
              <ul className="space-y-1">
                {lessonBreakdown.map((item) => {
                  const lessonNum = String(item.lessonNumber)
                  const isCompleted = completedSet.has(lessonNum)
                  const isNext = !isCompleted && String(nextPendingNumber) === lessonNum

                  return (
                    <li key={lessonNum} className="flex items-center gap-2 text-[12px]">
                      {isCompleted ? (
                        <span className="text-green-500 font-bold flex-shrink-0" aria-label="Completed">
                          ✓
                        </span>
                      ) : isNext ? (
                        <span className="text-blue-500 flex-shrink-0" aria-label="Next lesson">
                          ▶
                        </span>
                      ) : (
                        <span className="text-[#c9c0b0] flex-shrink-0" aria-label="Pending">
                          ○
                        </span>
                      )}
                      <span className="text-[#3d3529] truncate">{item.title}</span>
                    </li>
                  )
                })}
              </ul>

              {/* Action buttons */}
              <div className="flex flex-col gap-2 pt-1">
                <button
                  type="button"
                  onClick={onContinue}
                  disabled={seriesLoading}
                  className="w-full rounded-lg bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Continue Next Lesson
                </button>

                {completedCount > 0 && (
                  <button
                    type="button"
                    onClick={onViewCompleted}
                    disabled={seriesLoading}
                    className="w-full rounded-lg border border-[#d9cfbe] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#3d3529] hover:bg-[#f5f0e8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    View Completed
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
