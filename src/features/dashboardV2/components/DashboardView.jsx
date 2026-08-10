import { useCallback, useEffect, useRef, useState } from 'react'
import TopHeader from './TopHeader'
import GreetingHero from './GreetingHero'
import QuickCreateCard from './QuickCreateCard'
import AiRecommendationsCard from './AiRecommendationsCard'
import RecentDocumentsCard from './RecentDocumentsCard'
import TeacherWorkspaceSection from './TeacherWorkspaceSection'
import { ChecklistCard, FeedStatusCard, RecentActivityCard } from './InsightCards'
import OnboardingTour from './OnboardingTour'
import { Toast } from './PreviewChrome'
import useIsMobile from '../../../shared/hooks/useIsMobile'
import MobileDashboardContent from './MobileDashboardView'
import ensureDashboardFonts from '../lib/dashboardFonts'
import '../../../components/teacher/dashboardV2/dashboardV2.css'

ensureDashboardFonts()

/**
 * Teacher Dashboard V2 page CONTENT — shared by the live /teacher dashboard
 * (real data) and /teacher/dashboard-preview (mock data). Everything
 * rendered comes from props.
 *
 * This used to be the dashboard's own shell: it mounted its own Sidebar, its
 * own mobile header/drawer/dock and its own logout dialog, which is what made
 * the teacher area two shells wearing the same components. All of that now
 * comes from TeacherLayout, and this renders only the page.
 *
 * renderExtras({ showToast }) lets the preview page mount its banner +
 * control panel with access to the same toast.
 */
export default function DashboardView({
  termChip,
  hero = null,
  greeting,
  lastOpened,
  ctaState = 'default',
  onContinue,
  recommendations,
  documents,
  savedCounts,
  launcherWarnings = [],
  checklist,
  feed,
  activity,
  loading = false,
  onRetryFeed,
  banner = null,
  renderExtras,
}) {
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)
  const workspaceRef = useRef(null)
  const [allToolsOpen, setAllToolsOpen] = useState(false)

  // Quick Create's "View all teacher tools" expands the workspace's extra
  // tools and brings the section into view — the tools live on this page,
  // not behind a route.
  const viewAllTools = useCallback(() => {
    setAllToolsOpen(true)
    workspaceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const showToast = useCallback((kind, message) => {
    clearTimeout(toastTimer.current)
    setToast({ kind, message })
    toastTimer.current = setTimeout(() => setToast(null), 3200)
  }, [])
  useEffect(() => () => clearTimeout(toastTimer.current), [])

  const isMobile = useIsMobile()

  // Below 768px the dashboard swaps to a dedicated mobile information
  // architecture — hero, compact checklist, app-style tool tiles — rather
  // than the desktop cards squeezed down. This is a CONTENT decision; the
  // navigation around it is TeacherLayout's either way, which is why the
  // swap no longer drags a second header, drawer and dock along with it.
  if (isMobile) {
    return (
      <>
        <MobileDashboardContent
          greeting={greeting}
          hero={hero}
          recommendations={recommendations}
          savedCounts={savedCounts}
          launcherWarnings={launcherWarnings}
          checklist={checklist}
          loading={loading}
          banner={banner}
        />
        <Toast toast={toast} />
        <OnboardingTour isMobile loading={loading} />
        {renderExtras ? renderExtras({ showToast }) : null}
      </>
    )
  }

  return (
    <>
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

          <RecentDocumentsCard documents={documents} loading={loading} />

          <div ref={workspaceRef}>
            <TeacherWorkspaceSection
              savedCounts={savedCounts}
              warnings={launcherWarnings}
              loading={loading}
              allToolsOpen={allToolsOpen}
              onToggleAllTools={setAllToolsOpen}
            />
          </div>

          <div className="tdv2-row-3">
            <ChecklistCard items={checklist} loading={loading} />
            <FeedStatusCard items={feed} onRetry={() => onRetryFeed?.({ showToast })} />
            <RecentActivityCard items={activity} />
          </div>
        </main>
      </div>

      <Toast toast={toast} />
      <OnboardingTour loading={loading} />
      {renderExtras ? renderExtras({ showToast }) : null}
    </>
  )
}
