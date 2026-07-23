import { useCallback, useEffect, useRef, useState } from 'react'
import Sidebar from './Sidebar'
import TopHeader from './TopHeader'
import GreetingHero from './GreetingHero'
import QuickCreateCard from './QuickCreateCard'
import AiRecommendationsCard from './AiRecommendationsCard'
import TeacherAppLauncher from './launcher/TeacherAppLauncher'
import { ChecklistCard, FeedStatusCard, RecentActivityCard } from './InsightCards'
import PerformanceSnapshotCard from './PerformanceSnapshotCard'
import LogoutDialog from './LogoutDialog'
import OnboardingTour from './OnboardingTour'
import { Toast } from './PreviewChrome'
import useDashboardTheme from './useDashboardTheme'
import useIsMobile from './useIsMobile'
import MobileDashboardView from './MobileDashboardView'
import ensureDashboardFonts from './dashboardFonts'
import './dashboardV2.css'

ensureDashboardFonts()

/**
 * Presentational shell for Teacher Dashboard V2 — shared by the live
 * /teacher dashboard (real data) and /teacher/dashboard-preview (mock data).
 * Owns only page-level chrome state (logout dialog, toast); everything
 * rendered comes from props.
 *
 * renderExtras({ openLogout, showToast }) lets the preview page mount its
 * banner + control panel with access to the same chrome controls.
 */
export default function DashboardView({
  teacher,
  termChip,
  greeting,
  lastOpened,
  ctaState = 'default',
  onContinue,
  recommendations,
  savedCounts,
  checklist,
  feed,
  activity,
  series,
  classPerformance = null,
  loading = false,
  onRetryFeed,
  onConfirmLogout,
  banner = null,
  renderExtras,
}) {
  const [logoutOpen, setLogoutOpen] = useState(false)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)
  const workspaceRef = useRef(null)
  const { dark, toggleTheme } = useDashboardTheme()

  // Quick Create's "View all teacher tools" brings the app launcher into
  // view — every tool lives there, on this page, not behind a route.
  const viewAllTools = useCallback(() => {
    workspaceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const showToast = useCallback((kind, message) => {
    clearTimeout(toastTimer.current)
    setToast({ kind, message })
    toastTimer.current = setTimeout(() => setToast(null), 3200)
  }, [])
  useEffect(() => () => clearTimeout(toastTimer.current), [])

  const openLogout = useCallback(() => setLogoutOpen(true), [])
  const isMobile = useIsMobile()

  // Below 768px the dashboard swaps to its dedicated mobile information
  // architecture — own header, drawer, bottom nav — never the desktop
  // sidebar squeezed down. Page-level chrome (logout dialog, toast,
  // preview extras) is shared between the two layouts.
  if (isMobile) {
    return (
      <div className={`tdv2 tdv2-is-mobile ${dark ? 'is-dark' : ''}`}>
        <MobileDashboardView
          teacher={teacher}
          greeting={greeting}
          lastOpened={lastOpened}
          ctaState={ctaState}
          onContinue={onContinue}
          recommendations={recommendations}
          savedCounts={savedCounts}
          checklist={checklist}
          feed={feed}
          activity={activity}
          series={series}
          classPerformance={classPerformance}
          loading={loading}
          onRetryFeed={onRetryFeed}
          dark={dark}
          onToggleTheme={toggleTheme}
          onRequestLogout={openLogout}
          showToast={showToast}
          banner={banner}
        />
        {logoutOpen ? (
          <LogoutDialog
            onCancel={() => setLogoutOpen(false)}
            onConfirm={() => {
              setLogoutOpen(false)
              onConfirmLogout({ showToast })
            }}
          />
        ) : null}
        <Toast toast={toast} />
        <OnboardingTour isMobile loading={loading} />
        {renderExtras ? renderExtras({ openLogout, showToast }) : null}
      </div>
    )
  }

  return (
    <div className={`tdv2 ${dark ? 'is-dark' : ''}`}>
      <Sidebar
        teacher={teacher}
        onRequestLogout={openLogout}
        dark={dark}
        onToggleTheme={toggleTheme}
      />

      <div className="tdv2-main">
        <TopHeader termChip={termChip} />
        <main className="tdv2-content">
          {banner}
          <GreetingHero
            greeting={greeting}
            lastOpened={lastOpened}
            ctaState={ctaState}
            onContinue={onContinue}
          />

          <div className="tdv2-row-1">
            <QuickCreateCard onViewAllTools={viewAllTools} />
            <AiRecommendationsCard recommendations={recommendations} />
          </div>

          <div className="tdv2-launcher-block" ref={workspaceRef}>
            <TeacherAppLauncher savedCounts={savedCounts} loading={loading} />
          </div>

          <div className="tdv2-row-3">
            <ChecklistCard items={checklist} loading={loading} />
            <FeedStatusCard items={feed} onRetry={() => onRetryFeed?.({ showToast })} />
            <RecentActivityCard items={activity} />
            <PerformanceSnapshotCard series={series} classPerformance={classPerformance} dark={dark} />
          </div>
        </main>
      </div>

      {logoutOpen ? (
        <LogoutDialog
          onCancel={() => setLogoutOpen(false)}
          onConfirm={() => {
            setLogoutOpen(false)
            onConfirmLogout({ showToast })
          }}
        />
      ) : null}

      <Toast toast={toast} />
      <OnboardingTour loading={loading} />
      {renderExtras ? renderExtras({ openLogout, showToast }) : null}
    </div>
  )
}
