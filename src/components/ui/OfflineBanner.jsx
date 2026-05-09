import { useNetworkStatus } from '../../hooks/useNetworkStatus'

/**
 * Top-of-viewport banner shown while the browser reports offline.
 * Slides in via CSS transition, doesn't block any layout, and
 * reassures the learner that work won't be lost — Firestore queues
 * writes locally (config.js → enableMultiTabIndexedDbPersistence)
 * and replays them on reconnect.
 *
 * Print-hidden via the existing data-print="hide" attribute (per
 * src/index.css print rules). Renders nothing when online.
 */
export default function OfflineBanner() {
  const online = useNetworkStatus()
  if (online) return null

  return (
    <div
      role="status"
      aria-live="polite"
      data-print="hide"
      className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-center text-sm font-bold text-white shadow-lg"
    >
      <span aria-hidden="true">📡</span>
      <span>You're offline — your work will sync when you reconnect.</span>
    </div>
  )
}
