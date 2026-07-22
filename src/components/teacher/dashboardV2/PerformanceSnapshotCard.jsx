import { Link } from 'react-router-dom'
import { ChartLine } from 'lucide-react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const COPPER = '#c65a24'

/**
 * Honest activity trend: documents created per week (the platform has no
 * per-class performance series to chart here yet — when class analytics
 * land, this card is where they go).
 *
 * series: [{ date, created }]
 */
export default function PerformanceSnapshotCard({ series = [], dark = false }) {
  const max = Math.max(4, ...series.map((p) => p.created || 0))
  // recharts writes these as SVG attributes, which can't resolve CSS vars —
  // switch the literals with the dashboard theme instead.
  const gridStroke = dark ? 'rgba(255,255,255,0.09)' : '#efe7d9'
  const tickFill = dark ? '#8aa0b5' : '#98a2ad'
  return (
    <section className="tdv2-card" aria-labelledby="tdv2-perf-h">
      <div className="tdv2-card-head" style={{ flexWrap: 'wrap' }}>
        <h2 className="tdv2-eyebrow" id="tdv2-perf-h">
          <ChartLine size={17} strokeWidth={2} aria-hidden="true" />
          Activity Snapshot
        </h2>
        <div className="tdv2-legend" aria-hidden="true">
          <span><i style={{ background: COPPER }} />Documents created</span>
        </div>
      </div>

      {series.length === 0 ? (
        <div className="tdv2-empty">Create documents to see your weekly trend.</div>
      ) : (
        <div className="tdv2-chart-wrap">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 6, right: 8, left: -26, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={gridStroke} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tick={{ fill: tickFill, fontSize: 11 }}
                interval="preserveStartEnd"
              />
              <YAxis
                domain={[0, max]}
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                tick={{ fill: tickFill, fontSize: 11 }}
              />
              <Tooltip
                formatter={(value) => [`${value}`, 'Documents created']}
                contentStyle={{
                  borderRadius: 12,
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--ink)',
                  boxShadow: '0 8px 24px rgba(0,0,0,.18)',
                  fontSize: 12,
                }}
              />
              <Line
                isAnimationActive={false}
                type="monotone"
                dataKey="created"
                stroke={COPPER}
                strokeWidth={2.25}
                dot={{ r: 3, strokeWidth: 0, fill: COPPER }}
                activeDot={{ r: 4.5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <Link className="tdv2-footer-action" to="/teacher/library">
        <ChartLine size={16} strokeWidth={1.75} aria-hidden="true" />
        View full report
      </Link>
    </section>
  )
}
