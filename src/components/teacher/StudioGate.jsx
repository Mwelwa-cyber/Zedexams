/**
 * StudioGate — route-level gate for the teacher generator studios.
 *
 * Capability-based (dashboard redesign §12): a Free teacher opens any studio
 * whose tool has a Free allowance in the plan catalogue
 * (PLAN_LIMITS.free[tool] > 0 — lesson plans, worksheets, homework, short
 * tests, 2-week scheme previews); the generators enforce the preview shape
 * and the usage meter enforces the caps server-side. Studios still at 0
 * render <LockedStudio> (a read-only sample + upgrade CTA) in place of the
 * real studio, so the studio's own component never mounts. Pro/Max teachers
 * — and super-admins, who resolve to 'max' — get every studio unchanged.
 *
 * Gating at the route boundary (rather than inside each studio) keeps the
 * studios untouched and avoids conditional-hook pitfalls: the locked branch
 * simply renders a different element.
 */

import { lazy, Suspense } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { resolveTeacherPlan, PLAN_LIMITS } from '../../utils/teacherPlans'
import PageLoader from '../ui/PageLoader'
import { UsageReminderBanner } from '../../features/subscription'

const LockedStudio = lazy(() => import('./LockedStudio'))

/** Route slugs ('exam-paper') → plan-catalogue keys ('exam_paper'). Tools
 *  absent from the catalogue (client-side utilities gated as Pro features:
 *  weekly_forecast, record_of_work, mark_schedule, class_timetable,
 *  sba_tracker, sba_planner) resolve to 0 and stay locked for Free. */
export function freeAllowanceFor(tool) {
  const key = String(tool || '').replace(/-/g, '_')
  return PLAN_LIMITS.free[key] ?? 0
}

export default function StudioGate({ tool, children }) {
  const { userProfile } = useAuth()

  if (resolveTeacherPlan(userProfile) === 'free' && freeAllowanceFor(tool) === 0) {
    return (
      <Suspense fallback={<PageLoader />}>
        <LockedStudio tool={tool} />
      </Suspense>
    )
  }
  return (
    <>
      {/* Soft usage reminder (~80% of this studio's allowance) — a slim
          dismissible strip, so a paying teacher approaching a cap is warned
          BEFORE the contextual paywall interrupts a generation. */}
      <UsageReminderBanner tool={tool} className="mt-3 px-1 sm:px-2" />
      {children}
    </>
  )
}
