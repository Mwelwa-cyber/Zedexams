import { useCallback, useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../../../firebase/config'
import SeoHelmet from '../../../components/seo/SeoHelmet'
import {
  STATUS,
  computeStatusView,
  overallHeadline,
  statusLabel,
  statusTone,
} from '../../../utils/systemStatus'

/**
 * Public status page (/status).
 *
 * TRUTHFUL by construction: it renders the server-written `publicStatus/current`
 * document produced hourly by Vigil (functions/agents/publicStatusCore.js) from
 * its REAL health checks — website, database/storage, quiz content, images,
 * daily exams, Android billing — with per-component streaks and states
 * (operational / degraded / partial / major outage). The previous version ran
 * three shallow in-browser probes and claimed "all systems operational" whenever
 * they passed, even while backend services were failing; that is gone.
 *
 * Two independent signals so the page never lies:
 *   1. The Vigil status doc (authoritative component health). If it hasn't been
 *      refreshed recently, computeStatusView down-grades it to UNKNOWN rather
 *      than showing a stale "operational". If Firestore itself is down we can't
 *      read the doc → UNKNOWN (never "operational").
 *   2. A lightweight, independent CDN reachability probe (a HEAD on a static
 *      asset) shown separately as "your connection" — a second signal that does
 *      NOT depend on the same Firestore data plane the doc lives in.
 */

const HOSTING_HEALTH_URL = 'https://zedexams.com/zedexams-logo.png?v=5'
const REFRESH_MS = 5 * 60 * 1000

const TONE_DOT = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-400',
  down: 'bg-rose-500',
  unknown: 'bg-slate-400',
}

function StatusDot({ tone }) {
  return <span aria-hidden="true" className={`inline-block w-3 h-3 rounded-full ${TONE_DOT[tone] || TONE_DOT.unknown}`} />
}

function ComponentRow({ label, status, recovering, hint }) {
  const tone = statusTone(status)
  return (
    <li className="flex items-center justify-between p-4">
      <div>
        <p className="theme-text font-black text-sm">{label}</p>
        {hint ? <p className="theme-text-muted text-xs">{hint}</p> : null}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <StatusDot tone={tone} />
        <span className="theme-text text-xs font-bold">
          {statusLabel(status)}{recovering ? ' (recovering)' : ''}
        </span>
      </div>
    </li>
  )
}

const HINTS = {
  pages: 'Public web app and sign-in pages.',
  firebase: 'Cloud Firestore + Storage — quizzes, results, files.',
  quizzes: 'Published quiz content integrity.',
  images: 'Generated question / passage diagrams.',
  dailyExams: 'Daily exam scheduling.',
  playBilling: 'Android in-app subscription verification.',
}

function ageLabel(ageMs) {
  if (ageMs == null) return 'never'
  const min = Math.round(ageMs / 60000)
  if (min < 1) return 'just now'
  if (min === 1) return '1 minute ago'
  if (min < 60) return `${min} minutes ago`
  const hr = Math.round(min / 60)
  return hr === 1 ? '1 hour ago' : `${hr} hours ago`
}

export default function StatusPage() {
  const [view, setView] = useState(null)      // computeStatusView result
  const [connection, setConnection] = useState('checking') // independent CDN probe
  const [loadError, setLoadError] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const refresh = useCallback(async () => {
    setRefreshing(true)
    // 1) Authoritative status doc (Vigil). A failed read → null → UNKNOWN.
    let docData = null
    let readFailed = false
    try {
      const snap = await getDoc(doc(db, 'publicStatus', 'current'))
      docData = snap.exists() ? snap.data() : null
    } catch (err) {
      console.warn('[status] publicStatus read failed:', err)
      readFailed = true
    }
    setLoadError(readFailed)
    setView(computeStatusView(docData, Date.now()))

    // 2) Independent connectivity probe — does NOT touch Firestore, so it still
    // reports even when the data plane (and the doc read) is down.
    try {
      const res = await fetch(HOSTING_HEALTH_URL, { method: 'HEAD', cache: 'no-store' })
      setConnection(res.ok ? 'ok' : 'down')
    } catch {
      setConnection('down')
    }
    setRefreshing(false)
  }, [])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(t)
  }, [refresh])

  const overall = view ? view.overall : STATUS.UNKNOWN
  const stale = view ? view.stale : true
  const headline = view ? overallHeadline(overall) : 'Checking systems…'

  return (
    <main className="min-h-screen theme-bg flex flex-col items-center px-4 py-12">
      <SeoHelmet
        title="Service status"
        description="Live health of ZedExams — website, database, quizzes, images, daily exams, and payments. If something seems broken, check here first."
        path="/status"
      />
      <div className="w-full max-w-2xl">
        <header className="mb-8 text-center">
          <p className="theme-text-muted font-black text-xs uppercase tracking-widest mb-2">Service status</p>
          <h1 className="theme-text text-3xl sm:text-4xl font-black leading-tight">{headline}</h1>
          <p className="theme-text-muted text-sm mt-3">
            {!view
              ? 'Loading the latest health report…'
              : stale
                ? 'Our monitoring data is out of date, so we can’t confirm current status. If something is broken, contact us below.'
                : overall === STATUS.OPERATIONAL
                  ? 'ZedExams is up and running normally.'
                  : 'One or more systems are reporting issues. We’re investigating.'}
          </p>
        </header>

        <ul className="theme-card theme-border rounded-radius-md border divide-y divide-current/10 shadow-elev-sm">
          {(view ? view.components : []).map((c) => (
            <ComponentRow
              key={c.key}
              label={c.label}
              status={c.status}
              recovering={c.recovering}
              hint={HINTS[c.key]}
            />
          ))}
          {/* Independent second signal — reachability of the CDN, not from Firestore. */}
          <ComponentRow
            label="Your connection"
            status={connection === 'ok' ? STATUS.OPERATIONAL : connection === 'down' ? STATUS.MAJOR_OUTAGE : STATUS.UNKNOWN}
            hint="Can your device reach the ZedExams CDN right now?"
          />
        </ul>

        <footer className="mt-6 text-center">
          <p className="theme-text-muted text-xs">
            {view && view.generatedAt
              ? `Last monitor check ${ageLabel(view.ageMs)}${stale ? ' — data is stale, showing “unknown”.' : ''}`
              : loadError
                ? 'Could not reach our monitoring data.'
                : 'No monitoring data yet.'}
          </p>
          <button
            type="button"
            onClick={refresh}
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
