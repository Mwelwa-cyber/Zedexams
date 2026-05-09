/**
 * /admin/ai-costs — AI spend dashboard (audit B4).
 *
 * Three blocks:
 *   1. Headline KPIs — today's USD, 7-day total, 30-day total,
 *      anomaly badge (today > 2× median of last 7 days).
 *   2. Daily bar chart — last 30 days. Pure inline SVG so no new
 *      chart-library dependency lands.
 *   3. Today's per-tool breakdown + top consumers (per-uid).
 *
 * Reads are admin-only per Firestore rules; the page is route-gated
 * by AdminRoute too.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  getDayUsage,
  isAnomalous,
  listDailyUsage,
  listToolsForDate,
  listTopUsersForDate,
} from '../../utils/aiCosts'
import SeoHelmet from '../seo/SeoHelmet'
import Skeleton from '../ui/Skeleton'

const usdFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
})
const numFmt = new Intl.NumberFormat('en-ZM')

function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

function KpiCell({ value, label, hint, tone = 'neutral' }) {
  const toneCls = tone === 'warn'
    ? 'border-rose-300 bg-rose-50'
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

function CostChart({ days }) {
  // Pure inline SVG bar chart — no chart-lib dep. Heights normalised
  // to the largest day in the window.
  const max = Math.max(0.0001, ...days.map((d) => d.totalCostUsd || 0))
  const W = 600
  const H = 140
  const PAD = 18
  const innerW = W - PAD * 2
  const innerH = H - PAD * 2
  const barW = days.length > 0 ? innerW / days.length : 0

  return (
    <div className="overflow-x-auto">
      <svg
        role="img"
        aria-label="Daily AI spend, last 30 days"
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full max-w-full h-32"
      >
        {/* Top axis label */}
        <text x={PAD} y={12} className="text-[10px] fill-current theme-text-muted">
          {usdFmt.format(max)}
        </text>
        {/* Bottom axis (zero line) */}
        <line
          x1={PAD} x2={W - PAD}
          y1={H - PAD} y2={H - PAD}
          stroke="currentColor"
          strokeWidth="1"
          className="theme-text-muted opacity-30"
        />
        {days.map((d, i) => {
          const v = d.totalCostUsd || 0
          const h = max > 0 ? (v / max) * innerH : 0
          const x = PAD + i * barW + 1
          const y = H - PAD - h
          const w = Math.max(2, barW - 2)
          return (
            <g key={d.date}>
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                className="theme-accent-fill"
                opacity="0.85"
              >
                <title>{d.date}: {usdFmt.format(v)}</title>
              </rect>
            </g>
          )
        })}
      </svg>
      <div className="flex justify-between text-[10px] theme-text-muted px-1">
        <span>{days[0]?.date || ''}</span>
        <span>{days[days.length - 1]?.date || ''}</span>
      </div>
    </div>
  )
}

export default function AdminAiCosts() {
  const [daily, setDaily] = useState([])
  const [today, setToday] = useState(null)
  const [tools, setTools] = useState([])
  const [topUsers, setTopUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [errored, setErrored] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setErrored(false)
    const date = todayKey()

    Promise.all([
      listDailyUsage({ days: 30 }).catch((err) => {
        console.warn('[AdminAiCosts] daily list failed', err)
        return []
      }),
      getDayUsage(date).catch(() => null),
      listToolsForDate(date).catch(() => []),
      listTopUsersForDate(date).catch(() => []),
    ]).then(([dailyRows, todayDoc, toolRows, userRows]) => {
      if (cancelled) return
      setDaily(dailyRows)
      setToday(todayDoc)
      setTools(toolRows)
      setTopUsers(userRows)
    }).catch((err) => {
      console.warn('[AdminAiCosts] load failed', err)
      if (!cancelled) setErrored(true)
    }).finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [])

  const sevenDayTotal = useMemo(() => {
    return daily.slice(-7).reduce((sum, d) => sum + (d.totalCostUsd || 0), 0)
  }, [daily])
  const thirtyDayTotal = useMemo(() => {
    return daily.reduce((sum, d) => sum + (d.totalCostUsd || 0), 0)
  }, [daily])
  const anomaly = useMemo(() => isAnomalous(today, daily), [today, daily])

  return (
    <div className="space-y-5">
      <SeoHelmet title="AI costs" path="/admin/ai-costs" noIndex />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-black theme-text-muted uppercase tracking-widest">Operations</p>
          <h1 className="theme-text font-display font-black text-2xl sm:text-3xl">AI costs</h1>
          <p className="theme-text-muted text-sm mt-1 max-w-prose">
            Per-day Claude spend across every callable. Numbers update on
            each successful AI call (token counts come straight from
            Anthropic&apos;s response).
          </p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-radius-md" />)}
          </div>
          <Skeleton className="h-32 rounded-radius-md" />
        </div>
      ) : errored ? (
        <div role="alert" className="theme-card border theme-border rounded-radius-md p-6 text-center text-sm theme-text-muted">
          We couldn&apos;t load AI cost data. Please refresh.
        </div>
      ) : (
        <>
          <section className="theme-card border theme-border rounded-radius-md p-4 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <KpiCell
                value={usdFmt.format(today?.totalCostUsd || 0)}
                label="Today"
                hint={`${numFmt.format(today?.callCount || 0)} call${today?.callCount === 1 ? '' : 's'}`}
                tone={anomaly ? 'warn' : 'neutral'}
              />
              <KpiCell
                value={usdFmt.format(sevenDayTotal)}
                label="Last 7 days"
              />
              <KpiCell
                value={usdFmt.format(thirtyDayTotal)}
                label="Last 30 days"
              />
              <KpiCell
                value={anomaly ? '⚠️' : '✓'}
                label="Health"
                hint={anomaly ? '> 2× median' : 'within normal'}
                tone={anomaly ? 'warn' : 'neutral'}
              />
            </div>
            <div>
              <p className="theme-text-muted text-[11px] uppercase tracking-wider font-bold mb-2">
                Last 30 days
              </p>
              <CostChart days={daily} />
            </div>
          </section>

          <section className="grid sm:grid-cols-2 gap-4">
            <div className="theme-card border theme-border rounded-radius-md p-4">
              <p className="theme-text-muted text-[11px] uppercase tracking-wider font-bold mb-2">
                Today by tool
              </p>
              {tools.length === 0 ? (
                <p className="theme-text-muted text-sm">No tool calls yet today.</p>
              ) : (
                <ul className="divide-y divide-current/10">
                  {tools.map((t) => (
                    <li key={t.id} className="flex items-center justify-between py-2">
                      <div className="min-w-0">
                        <p className="theme-text font-bold text-sm truncate">{t.tool || t.id}</p>
                        <p className="theme-text-muted text-xs">
                          {numFmt.format(t.callCount || 0)} call{t.callCount === 1 ? '' : 's'}
                        </p>
                      </div>
                      <p className="theme-text font-black text-sm tabular-nums whitespace-nowrap">
                        {usdFmt.format(t.costUsd || 0)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="theme-card border theme-border rounded-radius-md p-4">
              <p className="theme-text-muted text-[11px] uppercase tracking-wider font-bold mb-2">
                Today's top consumers
              </p>
              {topUsers.length === 0 ? (
                <p className="theme-text-muted text-sm">No users have spent today.</p>
              ) : (
                <ul className="divide-y divide-current/10">
                  {topUsers.map((u) => (
                    <li key={u.id} className="flex items-center justify-between py-2">
                      <div className="min-w-0">
                        <p className="theme-text font-bold text-sm truncate font-mono">{u.id}</p>
                        <p className="theme-text-muted text-xs">
                          {numFmt.format(u.callCount || 0)} call{u.callCount === 1 ? '' : 's'}
                        </p>
                      </div>
                      <p className="theme-text font-black text-sm tabular-nums whitespace-nowrap">
                        {usdFmt.format(u.costUsd || 0)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
