/**
 * LearnerShell — the shared scaffold for learner-home surfaces: scoped
 * design system (`.lhx`), page column, offline indicator and the
 * persistent bottom navigation. Header is opt-in per page (the subject
 * page renders its own back-header instead).
 */
import '../learnerHome.css'
import LearnerBottomNav from './LearnerBottomNav'
import LearnerHeader from './LearnerHeader'
import { OfflineBadge } from './LearnerPrimitives'
import { useNetworkStatus } from '../../../hooks/useNetworkStatus'

export default function LearnerShell({ children, header = true, greeting = true, activeTerm = null, hasNotifications = false }) {
  const online = useNetworkStatus()
  const offline = online === false

  return (
    <div className="lhx">
      <div className="lhx-page">
        {offline && <OfflineBadge />}
        {header && (
          <LearnerHeader activeTerm={activeTerm} showGreeting={greeting} hasNotifications={hasNotifications} />
        )}
        {children}
      </div>
      <LearnerBottomNav />
    </div>
  )
}
