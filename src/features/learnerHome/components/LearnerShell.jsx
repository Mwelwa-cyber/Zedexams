/**
 * LearnerShell — the shared scaffold for learner surfaces: scoped design
 * system (`.lhx`, prototype-v3 indigo/coral look), page column, offline
 * indicator and the persistent 4-tab navigation (bottom bar on phones,
 * left sidebar on desktop).
 *
 * Headers are per-page on purpose — the prototype shows the glass topbar
 * on Home and back-rows everywhere else — so this component carries no
 * header of its own. Mount it once as a layout route via LearnerLayout
 * so the navigation never remounts between tab changes.
 */
import '../../../shared/styles/learnerTheme.css'
import LearnerBottomNav from './LearnerBottomNav'
import { OfflineBadge } from './LearnerPrimitives'
import { useNetworkStatus } from '../../../hooks/useNetworkStatus'

export default function LearnerShell({ children }) {
  const online = useNetworkStatus()
  const offline = online === false

  return (
    <div className="lhx">
      <div className="lhx-page">
        {offline && <OfflineBadge />}
        {children}
      </div>
      <LearnerBottomNav />
    </div>
  )
}
