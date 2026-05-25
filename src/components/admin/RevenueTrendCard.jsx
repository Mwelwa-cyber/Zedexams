import { useEffect, useState } from 'react'
import { useFirestore } from '../../hooks/useFirestore'
import Skeleton from '../ui/Skeleton'

const WEEKDAY_FMT = new Intl.DateTimeFormat('en-ZM', { weekday: 'short' })
const DAY_FMT = new Intl.DateTimeFormat('en-ZM', { day: '2-digit' })

/**
 * 7-day revenue trend for the admin Grant tab. Vertical bars sized
 * relative to the peak day in the window, so an empty week shows
 * empty bars instead of a misleading "everything is at max" graph.
 * Tap a bar to see the exact K-amount + activation count for that
 * day. No chart library — recharts/chartjs would push 60kB+ into the
 * admin bundle for a single sparkline.
 */
export default function RevenueTrendCard() {
  const { getRevenueByDay } = useFirestore()
  const [days, setDays] = useState([])
  const [loading, setLoading] = useState(true)
  const [focus, setFocus] = useState(null) // index into days, or null

  useEffect(() => {
    let cancelled = false
    getRevenueByDay(7)
      .then((data) => { if (!cancelled) setDays(data) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [getRevenueByDay])

  if (loading) {
    return <Skeleton height={140} className="!rounded-2xl" />
  }

  const peak = Math.max(1, ...days.map((d) => d.revenue))
  const total = days.reduce((sum, d) => sum + d.revenue, 0)
  const activations = days.reduce((sum, d) => sum + d.activations, 0)
  const focusDay = focus != null ? days[focus] : null

  // Weekday-over-weekday delta for the headline copy — yesterday vs.
  // same weekday a week ago gives the admin a quick read on whether
  // the most recent post-blast actually worked.
  const yesterday = days[days.length - 2]?.revenue || 0
  const weekAgo = days[0]?.revenue || 0
  const deltaPct = weekAgo === 0
    ? (yesterday > 0 ? null : 0)
    : Math.round(((yesterday - weekAgo) / weekAgo) * 100)

  return (
    <div className="bg-white rounded-2xl shadow-sm border theme-border p-4">
      <div className="flex items-start justify-between mb-3 flex-wrap gap-2">
        <div>
          <p className="text-xs uppercase tracking-wider text-gray-500 font-bold">7-day revenue</p>
          <p className="text-2xl font-black text-[#0B1A2C] mt-0.5">K{total.toLocaleString()}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {activations} activation{activations === 1 ? '' : 's'}
            {deltaPct != null && (
              <>
                {' · '}
                <span className={deltaPct >= 0 ? 'text-green-700' : 'text-red-600'}>
                  {deltaPct >= 0 ? '▲' : '▼'} {Math.abs(deltaPct)}% vs. last week
                </span>
              </>
            )}
          </p>
        </div>
        {focusDay && (
          <div className="text-right">
            <p className="text-xs text-gray-500">{focusDay.date.toLocaleDateString('en-ZM', { weekday: 'long', day: '2-digit', month: 'short' })}</p>
            <p className="text-sm font-black text-[#0B1A2C]">K{focusDay.revenue} · {focusDay.activations}×</p>
          </div>
        )}
      </div>
      <div className="flex items-end gap-2 h-24" role="list" aria-label="Daily revenue, last 7 days">
        {days.map((d, i) => {
          const isToday = i === days.length - 1
          const hPct = Math.max(2, Math.round((d.revenue / peak) * 100))
          const isFocus = focus === i
          return (
            <button
              key={d.date.toISOString()}
              type="button"
              role="listitem"
              onMouseEnter={() => setFocus(i)}
              onMouseLeave={() => setFocus(null)}
              onFocus={() => setFocus(i)}
              onBlur={() => setFocus(null)}
              className="flex-1 flex flex-col items-center gap-1 group min-h-0 p-0 bg-transparent shadow-none"
              aria-label={`${d.date.toDateString()}: K${d.revenue}, ${d.activations} activations`}
            >
              <div className="w-full flex-1 flex items-end">
                <div
                  className={`w-full rounded-t transition-colors ${
                    d.revenue === 0
                      ? 'bg-gray-100'
                      : isFocus
                        ? 'bg-[#0B1A2C]'
                        : isToday
                          ? 'bg-[#B8860B]'
                          : 'bg-amber-200 group-hover:bg-amber-300'
                  }`}
                  style={{ height: `${hPct}%` }}
                  aria-hidden="true"
                />
              </div>
              <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold leading-none">
                {WEEKDAY_FMT.format(d.date).slice(0, 1)}
              </div>
              <div className="text-[10px] text-gray-400 leading-none">{DAY_FMT.format(d.date)}</div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
