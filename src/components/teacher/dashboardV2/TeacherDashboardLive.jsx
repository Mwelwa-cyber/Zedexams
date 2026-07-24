import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { useSubscription } from '../../../hooks/useSubscription'
import { capture } from '../../../utils/analytics'
import SeoHelmet from '../../seo/SeoHelmet'
import UsageReminderBanner from '../../subscription/UsageReminderBanner'
import { resolveGreeting } from './dashboardV2Core'
import useTeacherDashboardData from './useTeacherDashboardData'
import DashboardView from './DashboardView'

/**
 * The LIVE /teacher dashboard — Dashboard V2 wired to real data. Auth is
 * enforced by the route (ProtectedRoute requiredRole="teacher"); this page
 * brings its own chrome (V2 sidebar/header), so it is intentionally NOT
 * wrapped in TeacherLayout.
 */
export default function TeacherDashboardLive() {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const data = useTeacherDashboardData()
  // Display-only plan badge for the mobile hero ('Free' | 'Pro' | 'Max') —
  // read from the existing subscription state, never gating anything here.
  const { planTier, tierLabel } = useSubscription()

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

  const handleConfirmLogout = async ({ showToast }) => {
    try {
      await logout()
      navigate('/login')
    } catch {
      showToast('error', 'Could not sign out. Check your connection and try again.')
    }
  }

  return (
    <>
      <SeoHelmet
        title="Teacher Dashboard | ZedExams"
        description="Plan lessons, build tests and track your teaching week."
        noIndex
      />
      <DashboardView
        teacher={data.teacher}
        termChip={data.termChip}
        hero={{ ...data.hero, plan: { tier: planTier, label: `${tierLabel} Plan` } }}
        greeting={greeting}
        lastOpened={data.lastOpened}
        onContinue={handleContinue}
        recommendations={data.recommendations}
        banner={<UsageReminderBanner />}
        documents={data.documents}
        savedCounts={data.savedCounts}
        launcherWarnings={data.launcherWarnings}
        checklist={data.checklist}
        feed={data.feed}
        activity={data.activity}
        loading={data.loading}
        onRetryFeed={data.reload}
        onConfirmLogout={handleConfirmLogout}
      />
    </>
  )
}
