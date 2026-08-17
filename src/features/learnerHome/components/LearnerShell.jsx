/**
 * LearnerShell — the shared scaffold for learner surfaces: scoped design
 * system (`.lhx`, prototype-v3 indigo/coral look), page column, offline
 * indicator, the back-online toast and the persistent 4-tab navigation
 * (bottom bar on phones, left sidebar on desktop).
 *
 * Headers are per-page on purpose — the prototype shows the glass topbar
 * on Home and back-rows everywhere else — so this component carries no
 * header of its own. Mount it once as a layout route via LearnerLayout
 * so the navigation never remounts between tab changes.
 */
import { useEffect, useRef, useState } from 'react'
import '../../../shared/styles/learnerTheme.css'
import LearnerBottomNav from './LearnerBottomNav'
import { OfflineBadge } from './LearnerPrimitives'
import { useNetworkStatus } from '../../../hooks/useNetworkStatus'

const BACK_ONLINE_MS = 4000

export default function LearnerShell({ children }) {
  const online = useNetworkStatus()
  const offline = online === false

  // "Back online" toast — only after a real offline→online transition, never
  // on first mount (being online is the normal state, not news). "Syncing" is
  // a claim Firestore backs: writes queue offline and replay on reconnect.
  const wasOffline = useRef(false)
  const [backOnline, setBackOnline] = useState(false)
  useEffect(() => {
    if (offline) {
      wasOffline.current = true
      setBackOnline(false)
      return undefined
    }
    if (!wasOffline.current) return undefined
    wasOffline.current = false
    setBackOnline(true)
    const t = setTimeout(() => setBackOnline(false), BACK_ONLINE_MS)
    return () => clearTimeout(t)
  }, [offline])

  return (
    <div className="lhx">
      <div className="lhx-page">
        {offline && <OfflineBadge />}
        {backOnline && (
          <div className="lhx-online-toast" role="status">
            ✅ Back online — your progress is syncing.
          </div>
        )}
        {children}
      </div>
      <LearnerBottomNav />
    </div>
  )
}
