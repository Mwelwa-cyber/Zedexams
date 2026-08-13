import { Link } from 'react-router-dom'
import { Calendar, CheckCircleIcon, ChevronRight } from '../../../components/ui/icons'
import Icon from '../../../components/ui/Icon'
import { buildStudyPlan } from './TodayStudyPlan'

/**
 * Slim dashboard entry point for the study plan. Shows the exam countdown and
 * live task progress, then links to the full /study-plan page. Keeps the
 * dashboard tidy on mobile where the full plan felt cramped.
 *
 * Accepts the same data props as <TodayStudyPlan> so it can be dropped in
 * wherever that data already lives, with no extra fetches.
 */
export default function StudyPlanCard({
  results = [],
  weakTopics = [],
  grade,
  dailyGoal = { done: 0, total: 0 },
  aiNotesOn = false,
  loading = false,
}) {
  const { countdown, doneCount, total, progress } = buildStudyPlan({
    results,
    weakTopics,
    grade,
    dailyGoal,
    aiNotesOn,
  })

  return (
    <Link
      to="/study-plan"
      aria-label="Open today's study plan"
      className="zx-card theme-card group block overflow-hidden rounded-3xl border theme-border shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="bg-[linear-gradient(135deg,rgba(16,185,129,0.12),rgba(14,165,233,0.10))] p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-white/80 text-emerald-700 ring-1 ring-emerald-200">
            <Icon as={Calendar} size="md" strokeWidth={2.2} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="theme-text text-base font-black leading-tight">Today&apos;s Study Plan</p>
            <p className="theme-text-muted truncate text-xs font-bold">
              {loading ? 'Loading your plan…' : countdown.label}
            </p>
          </div>
          <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-white/80 px-2.5 py-1 text-xs font-black text-emerald-700 ring-1 ring-emerald-200">
            <Icon as={CheckCircleIcon} size="xs" strokeWidth={2.4} />
            {doneCount}/{total}
          </span>
          <Icon
            as={ChevronRight}
            size="sm"
            strokeWidth={2.4}
            className="theme-text-muted flex-shrink-0 transition-transform group-hover:translate-x-0.5"
          />
        </div>

        <div className="mt-3 h-2 overflow-hidden rounded-full bg-current/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-sky-500 transition-[width] duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </Link>
  )
}
