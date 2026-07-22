import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import SeoHelmet from '../../seo/SeoHelmet'
import { resolveGreeting } from './dashboardV2Core'
import { TEACHER } from './mockData'
import Sidebar from './Sidebar'
import TopHeader from './TopHeader'
import GreetingHero from './GreetingHero'
import QuickCreateCard from './QuickCreateCard'
import AiRecommendationsCard from './AiRecommendationsCard'
import RecentDocumentsCard from './RecentDocumentsCard'
import WorkspaceCard from './WorkspaceCard'
import { ChecklistCard, FeedStatusCard, RecentActivityCard } from './InsightCards'
import PerformanceSnapshotCard from './PerformanceSnapshotCard'
import LogoutDialog from './LogoutDialog'
import { PreviewBanner, PreviewControlPanel, Toast } from './PreviewChrome'
import './dashboardV2.css'

/**
 * Teacher Dashboard V2 — premium desktop/large-tablet dashboard, currently
 * a PREVIEW surface at /teacher/dashboard-preview. Everything renders from
 * mockData.js (no Firestore) so the design and interactions can be reviewed
 * before it is approved to replace the live /teacher dashboard.
 */
export default function TeacherDashboardV2() {
  const navigate = useNavigate()
  const [greetingOverride, setGreetingOverride] = useState(null)
  const [ctaState, setCtaState] = useState('default')
  const [logoutOpen, setLogoutOpen] = useState(false)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)

  // Greeting follows the browser's local clock (re-checked each minute so a
  // dashboard left open across noon/6pm updates itself).
  const [hour, setHour] = useState(() => new Date().getHours())
  useEffect(() => {
    const t = setInterval(() => setHour(new Date().getHours()), 60_000)
    return () => clearInterval(t)
  }, [])

  const greeting = resolveGreeting({
    hour,
    override: greetingOverride,
    firstName: TEACHER.firstName,
  })

  const showToast = useCallback((kind, message) => {
    clearTimeout(toastTimer.current)
    setToast({ kind, message })
    toastTimer.current = setTimeout(() => setToast(null), 3200)
  }, [])
  useEffect(() => () => clearTimeout(toastTimer.current), [])

  // "Continue plan" demo flow: loading → success → back to default.
  const continueTimers = useRef([])
  const handleContinue = useCallback(() => {
    setCtaState('loading')
    continueTimers.current.push(
      setTimeout(() => setCtaState('success'), 1200),
      setTimeout(() => setCtaState('default'), 2600),
    )
  }, [])
  useEffect(() => () => continueTimers.current.forEach(clearTimeout), [])

  const handleLogoutConfirm = useCallback(() => {
    setLogoutOpen(false)
    showToast('success', 'Signed out (preview only — no real session ended).')
    navigate('/login')
  }, [navigate, showToast])

  return (
    <div className="tdv2">
      <SeoHelmet
        title="Teacher Dashboard Preview | ZedExams"
        description="Preview of the redesigned ZedExams teacher dashboard."
        noIndex
      />
      <PreviewBanner />

      <Sidebar onRequestLogout={() => setLogoutOpen(true)} />

      <div className="tdv2-main">
        <TopHeader />
        <main className="tdv2-content">
          <GreetingHero greeting={greeting} ctaState={ctaState} onContinue={handleContinue} />

          <div className="tdv2-row-1">
            <QuickCreateCard />
            <AiRecommendationsCard />
          </div>

          <div className="tdv2-row-2">
            <RecentDocumentsCard />
            <WorkspaceCard />
          </div>

          <div className="tdv2-row-3">
            <ChecklistCard />
            <FeedStatusCard
              onRetry={() => showToast('error', 'Still couldn’t save — check your connection.')}
            />
            <RecentActivityCard />
            <PerformanceSnapshotCard />
          </div>
        </main>
      </div>

      {logoutOpen ? (
        <LogoutDialog onCancel={() => setLogoutOpen(false)} onConfirm={handleLogoutConfirm} />
      ) : null}

      <Toast toast={toast} />
      <PreviewControlPanel
        greetingOverride={greetingOverride}
        onGreetingOverride={setGreetingOverride}
        ctaState={ctaState}
        onCtaState={setCtaState}
        onShowErrorToast={() => showToast('error', 'Couldn’t save changes. Check your connection.')}
        onOpenLogout={() => setLogoutOpen(true)}
      />
    </div>
  )
}
