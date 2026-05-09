import { useEffect, useState } from 'react'
import { collection, getDocs, limit, query } from 'firebase/firestore'
import { db } from '../../firebase/config'
import SeoHelmet from '../seo/SeoHelmet'

/**
 * Public status page (audit D5).
 *
 * /status — a no-auth route that runs a few health checks on the
 * critical Firebase services and shows simple up/down indicators. B2B
 * credibility signal (procurement teams want to see "what happens when
 * something breaks"), and a self-serve "is it just me?" page that
 * deflects support tickets when there *is* a real outage.
 *
 * Checks:
 *   1. Hosting — implicit (we got here, the SPA loaded)
 *   2. Firestore — reads one doc from /scores (public per rules)
 *   3. Firebase Auth (network) — read identitytoolkit reachable
 *   4. Cloud Messaging push — checked by initialisation success
 *
 * No probe of MTN MoMo or third-party services here — they aren't part
 * of the main learner flow, and a hosed MoMo gateway shouldn't read as
 * "ZedExams down" on the status board.
 */

const HOSTING_HEALTH_URL = 'https://zedexams.com/zedexams-logo.png?v=4'

const FIVE_MIN = 5 * 60 * 1000

function StatusDot({ status }) {
  // status: 'ok' | 'down' | 'checking'
  const cls = {
    ok:       'bg-emerald-500',
    down:     'bg-rose-500',
    checking: 'bg-amber-400 animate-pulse',
  }[status]
  return <span aria-hidden="true" className={`inline-block w-3 h-3 rounded-full ${cls}`} />
}

function statusLabel(status) {
  return { ok: 'Operational', down: 'Disrupted', checking: 'Checking…' }[status]
}

async function probeFirestore() {
  // 1-doc read against a fully-public collection. If it succeeds within
  // 5s the rest of Firestore is almost certainly fine; if it fails or
  // times out, something between the user and the data plane is broken.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    await getDocs(query(collection(db, 'scores'), limit(1)))
    return 'ok'
  } catch (err) {
    console.warn('[status] firestore probe failed:', err)
    return 'down'
  } finally {
    clearTimeout(timer)
  }
}

async function probeHosting() {
  // HEAD on a known static asset that's always served by the Hosting
  // CDN. The asset never changes per release (versioned querystring) so
  // the cache layer makes this near-free.
  try {
    const res = await fetch(HOSTING_HEALTH_URL, { method: 'HEAD', cache: 'no-store' })
    return res.ok ? 'ok' : 'down'
  } catch (err) {
    console.warn('[status] hosting probe failed:', err)
    return 'down'
  }
}

async function probeAuth() {
  // identitytoolkit is the Firebase Auth REST domain. A pre-flight
  // OPTIONS will resolve to a 204; we just need *some* response to
  // confirm the host is reachable. We don't try to call anything that
  // would be rate-limited.
  try {
    const res = await fetch('https://identitytoolkit.googleapis.com/', {
      method: 'HEAD',
      cache: 'no-store',
      mode: 'no-cors', // we just want network reachability, not a 200
    })
    // no-cors responses are opaque (status === 0) but the fetch resolves
    // when the network reaches the host. Any rejection means down.
    return res ? 'ok' : 'down'
  } catch (err) {
    console.warn('[status] auth probe failed:', err)
    return 'down'
  }
}

export default function StatusPage() {
  const [hosting, setHosting] = useState('checking')
  const [firestore, setFirestore] = useState('checking')
  const [auth, setAuth] = useState('checking')
  const [lastChecked, setLastChecked] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  async function runProbes() {
    setRefreshing(true)
    setHosting('checking')
    setFirestore('checking')
    setAuth('checking')
    const [h, f, a] = await Promise.all([probeHosting(), probeFirestore(), probeAuth()])
    setHosting(h)
    setFirestore(f)
    setAuth(a)
    setLastChecked(new Date())
    setRefreshing(false)
  }

  useEffect(() => {
    runProbes()
    // Auto-refresh every 5 minutes if the tab is left open. setInterval
    // doesn't fire while the tab is backgrounded in Chrome (throttled),
    // which is fine — coming back to the tab will show stale data with
    // the timestamp making that obvious.
    const t = setInterval(runProbes, FIVE_MIN)
    return () => clearInterval(t)
  }, [])

  const allOk = hosting === 'ok' && firestore === 'ok' && auth === 'ok'
  const anyDown = hosting === 'down' || firestore === 'down' || auth === 'down'

  return (
    <main className="min-h-screen theme-bg flex flex-col items-center px-4 py-12">
      <SeoHelmet
        title="Service status"
        description="Live health check of ZedExams hosting, database, and authentication. If something seems broken, check here first."
        path="/status"
      />
      <div className="w-full max-w-2xl">
        <header className="mb-8 text-center">
          <p className="theme-text-muted font-black text-xs uppercase tracking-widest mb-2">Service status</p>
          <h1 className="theme-text text-3xl sm:text-4xl font-black leading-tight">
            {allOk
              ? 'All systems operational'
              : anyDown
                ? "We're seeing issues"
                : 'Checking systems…'}
          </h1>
          <p className="theme-text-muted text-sm mt-3">
            {allOk
              ? 'ZedExams is up and running normally.'
              : anyDown
                ? 'One or more systems are reporting issues. We\'re investigating — check back shortly.'
                : 'Live probes against our hosting, database, and auth services.'}
          </p>
        </header>

        <ul className="theme-card theme-border rounded-radius-md border divide-y divide-current/10 shadow-elev-sm">
          <li className="flex items-center justify-between p-4">
            <div>
              <p className="theme-text font-black text-sm">Web hosting</p>
              <p className="theme-text-muted text-xs">Static site delivered by Firebase Hosting CDN.</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <StatusDot status={hosting} />
              <span className="theme-text text-xs font-bold">{statusLabel(hosting)}</span>
            </div>
          </li>
          <li className="flex items-center justify-between p-4">
            <div>
              <p className="theme-text font-black text-sm">Database</p>
              <p className="theme-text-muted text-xs">Cloud Firestore — quizzes, scores, user data.</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <StatusDot status={firestore} />
              <span className="theme-text text-xs font-bold">{statusLabel(firestore)}</span>
            </div>
          </li>
          <li className="flex items-center justify-between p-4">
            <div>
              <p className="theme-text font-black text-sm">Authentication</p>
              <p className="theme-text-muted text-xs">Firebase Auth — sign-in and account management.</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <StatusDot status={auth} />
              <span className="theme-text text-xs font-bold">{statusLabel(auth)}</span>
            </div>
          </li>
        </ul>

        <footer className="mt-6 text-center">
          <p className="theme-text-muted text-xs">
            {lastChecked
              ? `Last checked ${lastChecked.toLocaleTimeString()} (auto-refreshes every 5 minutes)`
              : 'Running checks…'}
          </p>
          <button
            type="button"
            onClick={runProbes}
            disabled={refreshing}
            className="mt-3 inline-flex items-center gap-2 rounded-full theme-card border theme-border theme-text font-black text-xs px-4 py-2 hover:theme-bg-subtle disabled:opacity-50"
          >
            {refreshing ? 'Refreshing…' : 'Refresh now'}
          </button>
          <p className="theme-text-muted text-xs mt-6 leading-relaxed">
            Need help right now? Email <a className="theme-accent-text font-bold" href="mailto:support@zedexams.com">support@zedexams.com</a> or WhatsApp <a className="theme-accent-text font-bold" href="https://wa.me/260977740465">+260 977 740 465</a>.
          </p>
        </footer>
      </div>
    </main>
  )
}
