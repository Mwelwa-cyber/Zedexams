import { useEffect, useMemo, useState } from 'react'
import { collection, getCountFromServer, getDocs, limit, orderBy, query } from 'firebase/firestore'
import { db } from '../../../firebase/config'
import PageHeader from '../../../shared/components/PageHeader'
import Card from '../../../shared/components/Card'
import Skeleton from '../../../shared/components/Skeleton'

// Keep these in sync with functions/visitorTrackingCore.js — the rollups
// are bucketed by Lusaka day (UTC+02:00, no DST), so the dashboard has to
// read "today" the same way the writer does.
const LUSAKA_OFFSET_MIN = 120
const TREND_DAYS = 14
const RECENT_LIMIT = 100

// Mirrors VISIT_RETENTION_DAYS in functions/visitorTrackingCore.js, pinned by
// test:visitor-retention-mirror.
//
// This tile counted `visits` and was labelled "all time", which was true while
// nothing ever deleted a visit document. Now that the collection carries a TTL,
// the count is bounded by the retention window — and a stale label here would
// not fail anything, it would just quietly report a shrinking number as a
// lifetime total. Hence the mirror: the label states the window, and the window
// cannot drift from the one the writer stamps without CI saying so.
//
// Longer history is NOT lost with the raw docs — the per-day rollups in
// visitorStats are aggregates and are never expired, which is what the 7d/30d
// tiles and the trend chart above read.
const VISIT_RETENTION_DAYS = 90

function lusakaDayKey(date = new Date()) {
  return new Date(date.getTime() + LUSAKA_OFFSET_MIN * 60000).toISOString().slice(0, 10)
}

function lusakaDayKeyAgo(daysAgo) {
  return lusakaDayKey(new Date(Date.now() - daysAgo * 86400000))
}

function fmt(ts) {
  if (!ts) return '—'
  try {
    const d = typeof ts?.toDate === 'function' ? ts.toDate() : new Date(ts)
    if (Number.isNaN(d.getTime?.())) return '—'
    return d.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
  } catch { return '—' }
}

function topCounts(rows, key, n = 6) {
  const map = {}
  rows.forEach(r => {
    const v = r[key] || 'Unknown'
    map[v] = (map[v] || 0) + 1
  })
  return Object.entries(map)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n)
}

export default function AdminVisitors() {
  const [stats, setStats] = useState([])      // daily rollups (visitorStats)
  const [recent, setRecent] = useState([])    // recent visit docs (live feed)
  const [allTime, setAllTime] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const [statsSnap, recentSnap, allTimeAgg] = await Promise.all([
          getDocs(query(collection(db, 'visitorStats'), orderBy('date', 'desc'), limit(30))).catch(() => null),
          getDocs(query(collection(db, 'visits'), orderBy('createdAt', 'desc'), limit(RECENT_LIMIT))).catch(() => null),
          getCountFromServer(collection(db, 'visits')).catch(() => null),
        ])
        if (cancelled) return
        setStats(statsSnap ? statsSnap.docs.map(d => ({ id: d.id, ...d.data() })) : [])
        setRecent(recentSnap ? recentSnap.docs.map(d => ({ id: d.id, ...d.data() })) : [])
        setAllTime(allTimeAgg?.data()?.count ?? null)
        setError(null)
      } catch (e) {
        console.error('visitors load:', e)
        if (!cancelled) setError('Could not load visitor data. The tracking collections may not exist yet — numbers will start appearing here once the Cloud Function is deployed and visitors browse the site.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Index rollups by day for quick lookups.
  const byDay = useMemo(() => {
    const m = {}
    stats.forEach(s => { m[s.date || s.id] = s })
    return m
  }, [stats])

  const todayKey = lusakaDayKey()
  const today = byDay[todayKey] || {}

  const sumWindow = (days, field) => {
    let total = 0
    for (let i = 0; i < days; i++) {
      const row = byDay[lusakaDayKeyAgo(i)]
      if (row && typeof row[field] === 'number') total += row[field]
    }
    return total
  }

  const trend = useMemo(() => {
    const arr = []
    for (let i = TREND_DAYS - 1; i >= 0; i--) {
      const key = lusakaDayKeyAgo(i)
      const row = byDay[key] || {}
      arr.push({ day: key.slice(5), pageviews: row.pageviews || 0, visitors: row.uniqueVisitors || 0 })
    }
    return arr
  }, [byDay])

  const maxTrend = Math.max(1, ...trend.map(t => t.pageviews))

  // Breakdowns from the recent feed (human visitors only — bots excluded so
  // the shape of real traffic isn't drowned out by crawlers).
  const humans = useMemo(() => recent.filter(r => !r.isBot), [recent])
  const topPages = useMemo(() => topCounts(humans, 'path'), [humans])
  const devices = useMemo(() => topCounts(humans, 'device', 4), [humans])
  const referrers = useMemo(() => topCounts(humans.filter(r => r.referrerHost), 'referrerHost'), [humans])
  const countries = useMemo(() => topCounts(humans.filter(r => r.country), 'country'), [humans])

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Reports"
        title="Website visitors"
        description="First-party page-view tracking for zedexams.com. Privacy-friendly: no personal data, and visitors are only counted across sessions once they accept the cookie banner."
      />

      {error && (
        <Card variant="flat" size="md" className="border-amber-200 bg-amber-50">
          <p className="text-sm font-bold text-amber-700">{error}</p>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Page views · today" value={today.pageviews ?? 0} loading={loading} />
        <Tile label="Visitors · today" value={today.uniqueVisitors ?? 0} loading={loading} />
        <Tile label="Page views · 7d" value={sumWindow(7, 'pageviews')} loading={loading} />
        <Tile label="Visitors · 7d" value={sumWindow(7, 'uniqueVisitors')} loading={loading} />
        <Tile label="Page views · 30d" value={sumWindow(30, 'pageviews')} loading={loading} />
        <Tile label="Visitors · 30d" value={sumWindow(30, 'uniqueVisitors')} loading={loading} />
        <Tile label="Sessions · 7d" value={sumWindow(7, 'sessions')} loading={loading} />
        <Tile label={`Page views · last ${VISIT_RETENTION_DAYS}d`} value={allTime ?? '—'} loading={loading} />
      </div>

      <Card variant="elevated" size="md">
        <h3 className="font-black theme-text mb-3">Daily traffic · last {TREND_DAYS} days</h3>
        <div className="flex items-end gap-1.5 h-36">
          {trend.map(t => (
            <div key={t.day} className="flex-1 flex flex-col items-center gap-1">
              <div
                className="w-full theme-accent-fill rounded-t"
                style={{ height: `${(t.pageviews / maxTrend) * 100}%`, minHeight: 2 }}
                title={`${t.day}: ${t.pageviews} views · ${t.visitors} visitors`}
              />
              <span className="text-[9px] theme-text-muted">{t.day}</span>
            </div>
          ))}
        </div>
        <p className="text-[11px] theme-text-muted mt-2">Bar height = page views. Hover a bar for views + unique visitors that day.</p>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BreakdownCard title={`Top pages · last ${RECENT_LIMIT} views`} rows={topPages} loading={loading} empty="No visits recorded yet." />
        <BreakdownCard title="Devices" rows={devices} loading={loading} empty="No visits recorded yet." />
        <BreakdownCard title="Top referrers" rows={referrers} loading={loading} empty="No external referrers yet (mostly direct traffic)." />
        <BreakdownCard title="Top countries" rows={countries} loading={loading} empty="No country data available." />
      </div>

      <Card variant="flat" size="md" className="!p-0 overflow-hidden">
        <div className="px-5 py-3 border-b theme-border">
          <h3 className="font-black theme-text">Recent visits</h3>
        </div>
        <div className="hidden md:grid grid-cols-[1.1fr_2fr_1.4fr_1fr_0.8fr] gap-4 px-5 py-3 border-b theme-border text-[11px] font-black uppercase tracking-wider theme-text-muted">
          <span>When</span><span>Page</span><span>Referrer</span><span>Device</span><span>Country</span>
        </div>
        {loading ? (
          <p className="px-5 py-8 text-center text-sm theme-text-muted">Loading…</p>
        ) : recent.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm theme-text-muted">No visits recorded yet.</p>
        ) : (
          recent.map(r => (
            <div key={r.id} className="border-b theme-border last:border-b-0 px-5 py-3 grid grid-cols-1 md:grid-cols-[1.1fr_2fr_1.4fr_1fr_0.8fr] gap-1 md:gap-4 text-sm">
              <div className="theme-text-muted">{fmt(r.createdAt)}</div>
              <div className="theme-text truncate" title={r.path}>{r.path}{r.isBot && <span className="ml-2 text-[10px] font-black uppercase text-amber-600">bot</span>}</div>
              <div className="theme-text-muted truncate">{r.referrerHost || 'direct'}</div>
              <div className="theme-text-muted">{r.device || '—'}{r.browser ? ` · ${r.browser}` : ''}</div>
              <div className="theme-text-muted">{r.country || '—'}</div>
            </div>
          ))
        )}
      </Card>
    </div>
  )
}

function Tile({ label, value, loading }) {
  return (
    <Card variant="elevated" size="sm" className="!p-4">
      <p className="text-[10px] font-black uppercase tracking-wider theme-text-muted">{label}</p>
      <p className="text-2xl font-black theme-text mt-1">{loading ? <Skeleton height={28} width={50} /> : value}</p>
    </Card>
  )
}

function BreakdownCard({ title, rows, loading, empty }) {
  const max = Math.max(1, ...rows.map(r => r.count))
  return (
    <Card variant="elevated" size="md">
      <h3 className="font-black theme-text mb-3">{title}</h3>
      {loading ? (
        <Skeleton height={80} />
      ) : rows.length === 0 ? (
        <p className="text-sm theme-text-muted">{empty}</p>
      ) : (
        <div className="space-y-2">
          {rows.map(r => (
            <div key={r.label} className="flex items-center gap-3">
              <span className="w-36 truncate text-sm font-bold theme-text" title={r.label}>{r.label}</span>
              <div className="flex-1 h-2 rounded-full bg-black/5 overflow-hidden">
                <div className="h-full theme-accent-fill" style={{ width: `${(r.count / max) * 100}%` }} />
              </div>
              <span className="w-10 text-right text-xs font-bold theme-text">{r.count}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
