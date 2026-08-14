import { useState } from 'react'
import { ChartBarIcon } from '../../../../shared/components/icons'

/**
 * CoveragePanel — collapsible sidebar card showing how much of the syllabus the
 * teacher has planned for the selected grade+subject, the gaps, and a one-tap
 * "plan this next". Driven by useCoverageAnalysis (the parent owns the hook and
 * passes its result in). Matches the TeachingProgressPanel card style.
 *
 * Props:
 *   grade, subject : current studio selection (panel is hidden until both set)
 *   loading        : boolean
 *   coverage       : null | { totalSubtopics, coveredCount, percent, gaps[], nextSuggestion }
 *   onSelectGap    : (topic, subtopic) => void  — jump the form to a gap
 */

const GAP_PREVIEW = 5

/** Status-dot + progress-bar colour by coverage %. Static classes for Tailwind. */
function statusFor(percent) {
  if (percent >= 100) return { dot: 'bg-green-500', bar: 'bg-green-500' }
  if (percent >= 50) return { dot: 'bg-amber-500', bar: 'bg-amber-500' }
  if (percent > 0) return { dot: 'bg-blue-500', bar: 'bg-blue-500' }
  return { dot: 'bg-[#c9c0b0]', bar: 'bg-[#c9c0b0]' }
}

export function CoveragePanel({ grade, subject, loading, coverage, onSelectGap }) {
  const [open, setOpen] = useState(true)
  const [showAllGaps, setShowAllGaps] = useState(false)

  // Only meaningful once a grade + subject are chosen.
  if (!grade || !subject) return null

  const percent = coverage ? coverage.percent : 0
  const status = statusFor(percent)
  const gaps = coverage?.gaps ?? []
  const visibleGaps = showAllGaps ? gaps : gaps.slice(0, GAP_PREVIEW)

  return (
    <div className="border-b border-[#e5ddd0]">
      {/* Section header */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-[13px] font-semibold text-[#3d3529]">
          <span className={['inline-block h-2 w-2 flex-shrink-0 rounded-full', status.dot].join(' ')} aria-hidden="true" />
          <ChartBarIcon size={15} className="text-[#a99e8b]" aria-hidden="true" />
          Curriculum Coverage
          {coverage && (
            <span className="rounded-full bg-[#f0ebe2] px-2 py-0.5 text-[10px] font-bold text-[#7a6d5d]">
              {percent}%
            </span>
          )}
        </span>
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
          className={['text-[#a39d8e] transition-transform', open ? 'rotate-180' : ''].join(' ')}
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Body */}
      {open && (
        <div className="lps-section-enter px-4 pb-4">
          {loading && !coverage && (
            <p className="text-[12px] text-[#a39d8e]">Checking your coverage…</p>
          )}

          {!loading && !coverage && (
            <p className="text-[12px] text-[#a39d8e]">Coverage will appear here once it loads.</p>
          )}

          {coverage && (
            <div className="space-y-3">
              {/* Progress */}
              <div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#e5ddd0]">
                  <div
                    className={['h-full rounded-full transition-all', status.bar].join(' ')}
                    style={{ width: `${percent}%` }}
                    role="progressbar"
                    aria-valuenow={percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  />
                </div>
                <p className="mt-1.5 text-[12px] text-[#7a6d5d]">
                  {coverage.coveredCount} of {coverage.totalSubtopics} subtopics planned
                </p>
                <p className="text-[10.5px] text-[#a39d8e]">Based on your saved lesson plans.</p>
              </div>

              {/* Gaps */}
              {gaps.length > 0 ? (
                <div>
                  <p className="mb-1.5 text-[12px] font-semibold text-[#3d3529]">Not planned yet</p>
                  <ul className="space-y-1">
                    {visibleGaps.map((g) => (
                      <li key={`${g.topic}|${g.subtopic}`}>
                        <button
                          type="button"
                          onClick={() => typeof onSelectGap === 'function' && onSelectGap(g.topic, g.subtopic)}
                          className="flex w-full items-start gap-2 rounded-lg px-2 py-1 text-left text-[12px] text-[#3d3529] transition-colors hover:bg-[#f5f0e8]"
                        >
                          <span className="mt-0.5 flex-shrink-0 text-[#c9c0b0]" aria-hidden="true">○</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{g.subtopic}</span>
                            <span className="block truncate text-[10.5px] text-[#a39d8e]">{g.topic}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {gaps.length > GAP_PREVIEW && !showAllGaps && (
                    <button
                      type="button"
                      onClick={() => setShowAllGaps(true)}
                      className="mt-1 px-2 text-[11px] font-semibold text-blue-600 hover:text-blue-700"
                    >
                      Show all {gaps.length} gaps
                    </button>
                  )}
                </div>
              ) : (
                <p className="text-[12px] font-medium text-green-700">
                  🎉 Every subtopic has a lesson plan. Nice work!
                </p>
              )}

              {/* Next suggestion */}
              {coverage.nextSuggestion && (
                <button
                  type="button"
                  onClick={() =>
                    typeof onSelectGap === 'function' &&
                    onSelectGap(coverage.nextSuggestion.topic, coverage.nextSuggestion.subtopic)
                  }
                  className="lps-lift w-full rounded-xl px-3 py-2 text-left text-[12px] font-semibold text-white lps-brand-gradient lps-soft-shadow transition-all hover:brightness-105"
                >
                  Plan next: {coverage.nextSuggestion.subtopic}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
