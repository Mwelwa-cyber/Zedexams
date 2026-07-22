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
import { CHART_COLORS, PERFORMANCE_SERIES } from './mockData'

export default function PerformanceSnapshotCard() {
  return (
    <section className="tdv2-card" aria-labelledby="tdv2-perf-h">
      <div className="tdv2-card-head" style={{ flexWrap: 'wrap' }}>
        <h2 className="tdv2-eyebrow" id="tdv2-perf-h">
          <ChartLine size={17} strokeWidth={2} aria-hidden="true" />
          Performance Snapshot
        </h2>
        <div className="tdv2-legend" aria-hidden="true">
          <span><i style={{ background: CHART_COLORS.classAverage }} />Class Average</span>
          <span><i style={{ background: CHART_COLORS.yourClass }} />Your Class</span>
        </div>
      </div>

      <div className="tdv2-chart-wrap">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={PERFORMANCE_SERIES} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#efe7d9" />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tick={{ fill: '#98a2ad', fontSize: 11 }}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tickFormatter={(v) => `${v}%`}
              tickLine={false}
              axisLine={false}
              tick={{ fill: '#98a2ad', fontSize: 11 }}
            />
            <Tooltip
              formatter={(value, name) => [
                `${value}%`,
                name === 'classAverage' ? 'Class Average' : 'Your Class',
              ]}
              contentStyle={{
                borderRadius: 12,
                border: '1px solid #e8ded4',
                boxShadow: '0 8px 24px rgba(16,36,62,.12)',
                fontSize: 12,
              }}
            />
            <Line
              isAnimationActive={false}
              type="monotone"
              dataKey="classAverage"
              stroke={CHART_COLORS.classAverage}
              strokeWidth={2.25}
              dot={{ r: 3, strokeWidth: 0, fill: CHART_COLORS.classAverage }}
              activeDot={{ r: 4.5 }}
            />
            <Line
              isAnimationActive={false}
              type="monotone"
              dataKey="yourClass"
              stroke={CHART_COLORS.yourClass}
              strokeWidth={2.25}
              dot={{ r: 3, strokeWidth: 0, fill: CHART_COLORS.yourClass }}
              activeDot={{ r: 4.5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <Link className="tdv2-footer-action" to="/teacher/classes">
        <ChartLine size={16} strokeWidth={1.75} aria-hidden="true" />
        View full report
      </Link>
    </section>
  )
}
