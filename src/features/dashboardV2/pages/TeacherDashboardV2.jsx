import { useEffect, useRef, useState } from 'react'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import { resolveGreeting } from '../lib/dashboardV2Core'
import DashboardView from '../components/DashboardView'
import { PreviewBanner, PreviewControlPanel } from '../components/PreviewChrome'
import useStudioAvailability from '../../../hooks/useStudioAvailability'
import {
  ACTIVITY_ITEMS,
  AI_RECOMMENDATION,
  CHECKLIST_ITEMS,
  FEED_ITEMS,
  HERO,
  LAST_OPENED,
  RECENT_DOCUMENTS,
  SAVED_COUNTS,
  TEACHER,
  TERM_CHIP,
} from '../lib/mockData'

/**
 * Teacher Dashboard V2 PREVIEW — the mock-data surface at
 * /teacher/dashboard-preview. Renders the exact same DashboardView the live
 * /teacher dashboard uses, but from mockData.js, with the preview banner
 * and (outside production builds) the interaction-state control panel.
 */
export default function TeacherDashboardV2() {
  // The preview page is unguarded and its data is fixtures, but its links are
  // real — a checklist row for a withdrawn studio would still be a doorway.
  const { filterEntries } = useStudioAvailability()
  const [greetingOverride, setGreetingOverride] = useState(null)
  const [ctaState, setCtaState] = useState('default')

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

  // "Continue plan" demo flow: loading → success → back to default.
  const continueTimers = useRef([])
  const handleContinue = () => {
    setCtaState('loading')
    continueTimers.current.push(
      setTimeout(() => setCtaState('success'), 1200),
      setTimeout(() => setCtaState('default'), 2600),
    )
  }
  useEffect(() => () => continueTimers.current.forEach(clearTimeout), [])

  return (
    <>
      <SeoHelmet
        title="Teacher Dashboard Preview | ZedExams"
        description="Preview of the redesigned ZedExams teacher dashboard."
        noIndex
      />
      <PreviewBanner />
      <DashboardView
        termChip={TERM_CHIP}
        hero={HERO}
        greeting={greeting}
        lastOpened={LAST_OPENED}
        ctaState={ctaState}
        onContinue={handleContinue}
        recommendations={filterEntries([AI_RECOMMENDATION])}
        documents={RECENT_DOCUMENTS}
        savedCounts={SAVED_COUNTS}
        checklist={filterEntries(CHECKLIST_ITEMS)}
        feed={FEED_ITEMS}
        activity={ACTIVITY_ITEMS}
        onRetryFeed={({ showToast }) => showToast('error', 'Still couldn’t save — check your connection.')}
        renderExtras={({ showToast }) => (
          <PreviewControlPanel
            greetingOverride={greetingOverride}
            onGreetingOverride={setGreetingOverride}
            ctaState={ctaState}
            onCtaState={setCtaState}
            onShowErrorToast={() => showToast('error', 'Couldn’t save changes. Check your connection.')}
          />
        )}
      />
    </>
  )
}
