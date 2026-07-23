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
import { shortDate } from './dashboardV2Data'

const COPPER = '#c65a24'
const BLUE = '#2563eb'

/**
 * Performance Snapshot with two data modes:
 *
 * 1. classPerformance (preferred) — the real weekly series from the
 *    getClassPerformanceSeries callable: "Your Class" (the teacher's class
 *    members' average final quiz/exam score, copper) vs "Class Average"
 *    (platform-wide weekly average, blue). Weeks without scored attempts
 *    are gaps, never zeros.
 * 2. Fallback — the documents-created-per-week activity trend, for
 *    teachers with no chartable class data yet.
 *
 * series: [{ date, created }] · classPerformance: { series: [{ endMs,
 * yourClass, classAverage }], hasData } | null
 */
export default function PerformanceSnapshotCard({ series = [], classPerformance = null, dark = false }) {
  // recharts writes these as SVG attributes, which can't resolve CSS vars —
  // switch the literals with the dashboard theme instead.
  const gridStroke = dark ? 'rgba(255,255,255,0.09)' : '#efe7d9'
  const tickFill = dark ? '#8aa0b5' : '#98a2ad'
  const tooltipStyle = {
    borderRadius: 12,
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--ink)',
    boxShadow: '0 8px 24px rgba(0,0,0,.18)',
    fontSize: 12,
  }

  const classMode = Boolean(classPerformance?.hasData && classPerformance.series?.length)
  const classData = classMode
    ? classPerformance.series.map((p) => ({
        date: shortDate(p.endMs),
        yourClass: p.yourClass,
        classAverage: p.classAverage,
      }))
    : []
  const activityMax = Math.max(4, ...series.map((p) => p.created || 0))

  return (
    <section className="tdv2-card" aria-labelledby="tdv2-perf-h">
      <div className="tdv2-card-head" style={{ flexWrap: 'wrap' }}>
        <h2 className="tdv2-eyebrow" id="tdv2-perf-h">
          <ChartLine size={17} strokeWidth={2} aria-hidden="true" />
          {classMode ? 'Performance Snapshot' : 'Activity Snapshot'}
        </h2>
        <div className="tdv2-legend" aria-hidden="true">
          {classMode ? (
            <>
              <span><i style={{ background: BLUE }} />Class Average</span>
              <span><i style={{ background: COPPER }} />Your Class</span>
            </>
          ) : (
            <span><i style={{ background: COPPER }} />Documents created</span>
          )}
        </div>
      </div>

      {classMode ? (
        <div className="tdv2-chart-wrap">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={classData} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={gridStroke} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tick={{ fill: tickFill, fontSize: 11 }}
                interval="preserveStartEnd"
                minTickGap={24}
              />
              <YAxis
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                tickFormatter={(v) => `${v}%`}
                tickLine={false}
                axisLine={false}
                tick={{ fill: tickFill, fontSize: 11 }}
              />
              <Tooltip
                formatter={(value, name) => [
                  `${value}%`,
                  name === 'classAverage' ? 'Class Average' : 'Your Class',
                ]}
                contentStyle={tooltipStyle}
              />
              <Line
                isAnimationActive={false}
                type="monotone"
                dataKey="classAverage"
                stroke={BLUE}
                strokeWidth={2.25}
                connectNulls
                dot={{ r: 3, strokeWidth: 0, fill: BLUE }}
                activeDot={{ r: 4.5 }}
              />
              <Line
                isAnimationActive={false}
                type="monotone"
                dataKey="yourClass"
                stroke={COPPER}
                strokeWidth={2.25}
                connectNulls
                dot={{ r: 3, strokeWidth: 0, fill: COPPER }}
                activeDot={{ r: 4.5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : series.length === 0 ? (
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
                domain={[0, activityMax]}
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                tick={{ fill: tickFill, fontSize: 11 }}
              />
              <Tooltip
                formatter={(value) => [`${value}`, 'Documents created']}
                contentStyle={tooltipStyle}
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

      <Link className="tdv2-footer-action" to={classMode ? '/teacher/classes' : '/teacher/library'}>
        <ChartLine size={16} strokeWidth={1.75} aria-hidden="true" />
        View full report
      </Link>
    </section>
  )
}
