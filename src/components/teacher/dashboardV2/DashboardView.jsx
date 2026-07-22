import { useCallback, useEffect, useRef, useState } from 'react'
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
import { Toast } from './PreviewChrome'
import './dashboardV2.css'

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
  notificationCount = 0,
  lastOpened,
  ctaState = 'default',
  onContinue,
  recommendation,
  documents,
  savedCounts,
  checklist,
  feed,
  activity,
  series,
  loading = false,
  onRetryFeed,
  onConfirmLogout,
  renderExtras,
}) {
  const [logoutOpen, setLogoutOpen] = useState(false)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)

  const showToast = useCallback((kind, message) => {
    clearTimeout(toastTimer.current)
    setToast({ kind, message })
    toastTimer.current = setTimeout(() => setToast(null), 3200)
  }, [])
  useEffect(() => () => clearTimeout(toastTimer.current), [])

  const openLogout = useCallback(() => setLogoutOpen(true), [])

  return (
    <div className="tdv2">
      <Sidebar teacher={teacher} onRequestLogout={openLogout} />

      <div className="tdv2-main">
        <TopHeader teacher={teacher} termChip={termChip} notificationCount={notificationCount} />
        <main className="tdv2-content">
          <GreetingHero
            greeting={greeting}
            lastOpened={lastOpened}
            ctaState={ctaState}
            onContinue={onContinue}
          />

          <div className="tdv2-row-1">
            <QuickCreateCard />
            <AiRecommendationsCard recommendation={recommendation} />
          </div>

          <div className="tdv2-row-2">
            <RecentDocumentsCard documents={documents} loading={loading} />
            <WorkspaceCard savedCounts={savedCounts} />
          </div>

          <div className="tdv2-row-3">
            <ChecklistCard items={checklist} loading={loading} />
            <FeedStatusCard items={feed} onRetry={() => onRetryFeed?.({ showToast })} />
            <RecentActivityCard items={activity} />
            <PerformanceSnapshotCard series={series} />
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
      {renderExtras ? renderExtras({ openLogout, showToast }) : null}
    </div>
  )
}
