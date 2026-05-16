/**
 * /admin/app-check — App Check enforcement readiness.
 *
 * Cloud Functions run App Check in soft-verify mode and write per-day
 * attestation counters to appCheckHealth/{date}. This page surfaces
 * them so the APPCHECK_ENFORCE=1 flip is a data-backed decision rather
 * than a guess: enforcement hard-denies every call without a valid
 * token, so it's only safe once unattested traffic from real clients
 * (web + native) is ~0.
 *
 * Reads are admin-only per Firestore rules; the page is route-gated by
 * AdminRoute too.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  listAppCheckHealth,
  summarise,
  enforcementReadiness,
} from '../../utils/appCheckHealth'
import SeoHelmet from '../seo/SeoHelmet'
import Skeleton from '../ui/Skeleton'

const numFmt = new Intl.NumberFormat('en-ZM')

function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

function pctLabel(v) {
  return v == null ? '—' : `${v}%`
}

function KpiCell({ value, label, hint, tone = 'neutral' }) {
  const toneCls = tone === 'warn'
    ? 'border-rose-300 bg-rose-50'
    : tone === 'good'
      ? 'border-emerald-300 bg-emerald-50'
      : 'theme-bg-subtle'
  return (
    <div className={`rounded-radius-md border-2 border-transparent p-4 text-center min-w-0 ${toneCls}`}>
      <p className="theme-text font-display font-black text-2xl tabular-nums leading-none">
        {value}
      </p>
      <p className="theme-text-muted text-[11px] uppercase tracking-wider font-bold mt-1.5">
        {label}
      </p>
      {hint && <p className="theme-text-muted text-[10px] mt-0.5">{hint}</p>}
    </div>
  )
}

function EndpointTable({ rows }) {
  if (rows.length === 0) {
    return <p className="theme-text-muted text-sm">No App Check telemetry in this window yet.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="theme-text-muted text-[11px] uppercase tracking-wider">
            <th className="text-left font-bold py-2">Endpoint</th>
            <th className="text-right font-bold py-2">Calls</th>
            <th className="text-right font-bold py-2">Valid</th>
            <th className="text-right font-bold py-2">Missing</th>
            <th className="text-right font-bold py-2">Invalid</th>
            <th className="text-right font-bold py-2">Valid %</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-current/10">
          {rows.map((r) => {
            const clean = r.attempts > 0 && r.unattested === 0
            return (
              <tr key={r.label}>
                <td className="py-2 theme-text font-bold font-mono truncate">{r.label}</td>
                <td className="py-2 text-right tabular-nums theme-text">{numFmt.format(r.attempts)}</td>
                <td className="py-2 text-right tabular-nums theme-text">{numFmt.format(r.valid)}</td>
                <td className={`py-2 text-right tabular-nums ${r.missing > 0 ? 'text-rose-600 font-bold' : 'theme-text-muted'}`}>
                  {numFmt.format(r.missing)}
                </td>
                <td className={`py-2 text-right tabular-nums ${r.invalid > 0 ? 'text-rose-600 font-bold' : 'theme-text-muted'}`}>
                  {numFmt.format(r.invalid)}
                </td>
                <td className={`py-2 text-right tabular-nums font-black ${clean ? 'text-emerald-600' : 'theme-text'}`}>
                  {pctLabel(r.validPct)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function AdminAppCheck() {
  const [rawDays, setRawDays] = useState([])
  const [loading, setLoading] = useState(true)
  const [errored, setErrored] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setErrored(false)
    listAppCheckHealth({ days: 14 })
      .then((rows) => { if (!cancelled) setRawDays(rows) })
      .catch((err) => {
        console.warn('[AdminAppCheck] load failed', err)
        if (!cancelled) setErrored(true)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const today = todayKey()
  const todaySummary = useMemo(
    () => summarise(rawDays.filter((d) => d.date === today)),
    [rawDays, today],
  )
  const weekSummary = useMemo(
    () => summarise(rawDays.slice(-7)),
    [rawDays],
  )
  const readiness = useMemo(
    () => enforcementReadiness(weekSummary),
    [weekSummary],
  )

  return (
    <div className="space-y-5">
      <SeoHelmet title="App Check readiness" path="/admin/app-check" noIndex />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-black theme-text-muted uppercase tracking-widest">Operations</p>
          <h1 className="theme-text font-display font-black text-2xl sm:text-3xl">App Check readiness</h1>
          <p className="theme-text-muted text-sm mt-1 max-w-prose">
            App Check runs in soft-verify mode: tokens are checked and
            counted but nothing is blocked. Enforcing
            (<code className="font-mono text-xs">APPCHECK_ENFORCE=1</code> in{' '}
            <code className="font-mono text-xs">functions/.env.examsprepzambia</code>)
            hard-denies every call below — only safe once
            missing + invalid from real clients is ~0.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-radius-md" />)}
          </div>
          <Skeleton className="h-40 rounded-radius-md" />
        </div>
      ) : errored ? (
        <div role="alert" className="theme-card border theme-border rounded-radius-md p-6 text-center text-sm theme-text-muted">
          We couldn&apos;t load App Check telemetry. Please refresh.
        </div>
      ) : (
        <>
          <section className="theme-card border theme-border rounded-radius-md p-4 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <KpiCell
                value={pctLabel(todaySummary.overall.validPct)}
                label="Valid today"
                hint={`${numFmt.format(todaySummary.overall.attempts)} call${todaySummary.overall.attempts === 1 ? '' : 's'}`}
              />
              <KpiCell
                value={pctLabel(weekSummary.overall.validPct)}
                label="Valid (7 days)"
                hint={`${numFmt.format(weekSummary.overall.attempts)} call${weekSummary.overall.attempts === 1 ? '' : 's'}`}
              />
              <KpiCell
                value={numFmt.format(weekSummary.overall.unattested)}
                label="Unattested (7d)"
                hint="missing + invalid"
                tone={weekSummary.overall.unattested > 0 ? 'warn' : 'good'}
              />
              <KpiCell
                value={readiness.ready ? '✓' : '⚠️'}
                label="Enforce?"
                hint={readiness.ready ? 'ready' : 'not yet'}
                tone={readiness.ready ? 'good' : 'warn'}
              />
            </div>
            <div
              role="status"
              className={`rounded-radius-md p-3 text-sm border-2 ${
                readiness.tone === 'ready'
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                  : readiness.tone === 'block'
                    ? 'border-rose-300 bg-rose-50 text-rose-900'
                    : 'theme-bg-subtle theme-text'
              }`}
            >
              <span className="font-black uppercase text-[11px] tracking-wider mr-2">
                {readiness.ready ? 'Ready' : 'Hold'}
              </span>
              {readiness.reason}
            </div>
          </section>

          <section className="theme-card border theme-border rounded-radius-md p-4">
            <p className="theme-text-muted text-[11px] uppercase tracking-wider font-bold mb-2">
              By endpoint — last 7 days
            </p>
            <EndpointTable rows={weekSummary.rows} />
            <p className="theme-text-muted text-[11px] mt-3 max-w-prose">
              Callables fold &ldquo;no token&rdquo; and &ldquo;bad token&rdquo;
              into <span className="font-mono">missing</span> (the runtime can&apos;t
              distinguish them at the telemetry layer); only the HTTP
              <span className="font-mono"> apiAiChat</span> path reports
              <span className="font-mono"> invalid</span> separately.
              Native clients show as unattested until the Capacitor
              FirebaseAppCheck plugin is registered and attesting.
            </p>
          </section>
        </>
      )}
    </div>
  )
}
