import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { resolveTeacherPlan, PLAN_LABELS } from '../../../utils/teacherPlans'
import { capture } from '../../../utils/analytics'
import SeoHelmet from '../../seo/SeoHelmet'
import UsageReminderBanner from '../../subscription/UsageReminderBanner'
import StudioUnavailableNotice from '../StudioUnavailableNotice'
import { resolveGreeting } from './dashboardV2Core'
import useTeacherDashboardData from './useTeacherDashboardData'
import DashboardView from './DashboardView'

/**
 * The LIVE /teacher dashboard — Dashboard V2 wired to real data. Renders
 * inside TeacherLayout like every other teacher page; the sidebar, mobile
 * chrome and logout belong to the shell, not to this page.
 */
export default function TeacherDashboardLive() {
  const { userProfile } = useAuth()
  const navigate = useNavigate()
  const data = useTeacherDashboardData()
  // Display-only plan badge for the mobile hero ('Free' | 'Pro' | 'Max') —
  // resolved from the SAME authoritative teacher-plan entitlement that
  // StudioGate and useTeacherUsage gate on (users.teacherPlan via
  // resolveTeacherPlan), not the learner-oriented subscriptionPlan. Otherwise
  // a teacher on Pro/Max studio quotas could see "Free Plan" here. Purely
  // presentational — it gates nothing.
  const teacherPlan = resolveTeacherPlan(userProfile)
  const planLabel = PLAN_LABELS[teacherPlan] || PLAN_LABELS.free

  useEffect(() => {
    capture('teacher_dashboard_viewed', { version: 'v2' })
  }, [])

  // Greeting follows the local clock; re-checked each minute so a dashboard
  // left open across noon/18:00 updates itself.
  const [hour, setHour] = useState(() => new Date().getHours())
  useEffect(() => {
    const t = setInterval(() => setHour(new Date().getHours()), 60_000)
    return () => clearInterval(t)
  }, [])

  const greeting = resolveGreeting({ hour, firstName: data.teacher.firstName })

  const handleContinue = () => {
    navigate(data.lastOpened ? data.lastOpened.to : '/teacher/lesson-plans/new')
  }

  return (
    <>
      <SeoHelmet
        title="Teacher Dashboard | ZedExams"
        description="Plan lessons, build tests and track your teaching week."
        noIndex
      />
      <DashboardView
        termChip={data.termChip}
        hero={{ ...data.hero, plan: { tier: teacherPlan, label: `${planLabel} Plan` } }}
        greeting={greeting}
        lastOpened={data.lastOpened}
        onContinue={handleContinue}
        recommendations={data.recommendations}
        banner={(
          <>
            {/* Why a studio the teacher just tried to open sent them here. */}
            <StudioUnavailableNotice />
            <UsageReminderBanner />
          </>
        )}
        documents={data.documents}
        savedCounts={data.savedCounts}
        launcherWarnings={data.launcherWarnings}
        checklist={data.checklist}
        feed={data.feed}
        activity={data.activity}
        loading={data.loading}
        onRetryFeed={data.reload}
      />
    </>
  )
}
