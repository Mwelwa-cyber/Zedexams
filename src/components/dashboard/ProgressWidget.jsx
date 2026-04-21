/**
 * ProgressWidget — streak counter, weekly goal ring, and 7-day activity bars.
 * Receives already-fetched results so it adds zero extra Firestore queries.
 */

const WEEKLY_GOAL = 5
const DAY_LABELS  = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function toLocalDateStr(ts) {
  if (!ts) return null
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleDateString('en-CA') // YYYY-MM-DD in local time
}

function buildWeekBuckets(results) {
  const today    = new Date()
  const buckets  = []
  const countMap = {}

  for (let i = 6; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    const key  = d.toLocaleDateString('en-CA')
    const dow  = d.getDay()
    buckets.push({ key, dow, count: 0 })
    countMap[key] = buckets[buckets.length - 1]
  }

  for (const r of results) {
    const key = toLocalDateStr(r.completedAt)
    if (key && countMap[key]) countMap[key].count++
  }

  return buckets
}

// SVG arc for the goal ring
function GoalRing({ current, goal }) {
  const pct    = Math.min(current / goal, 1)
  const r      = 28
  const cx     = 36
  const cy     = 36
  const circ   = 2 * Math.PI * r
  const offset = circ * (1 - pct)
  const done   = pct >= 1

  return (
    <svg width={72} height={72} aria-hidden="true">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#E5E7EB" strokeWidth={7} />
      <circle
        cx={cx} cy={cy} r={r} fill="none"
        stroke={done ? '#10B981' : '#34D399'}
        strokeWidth={7}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${cx} ${cy})`}
        style={{ transition: 'stroke-dashoffset 0.6s ease' }}
      />
      <text x={cx} y={cy - 5} textAnchor="middle" fontSize={14} fontWeight={900} fill={done ? '#059669' : '#374151'}>
        {current}
      </text>
      <text x={cx} y={cy + 9} textAnchor="middle" fontSize={9} fontWeight={700} fill="#9CA3AF">
        /{goal}
      </text>
    </svg>
  )
}

function StreakFlame({ streak }) {
  const color = streak >= 7 ? '#EF4444' : streak >= 3 ? '#F97316' : '#FBBF24'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <span style={{ fontSize: 32, lineHeight: 1 }} aria-hidden="true">🔥</span>
      <span style={{ fontSize: 26, fontWeight: 900, lineHeight: 1, color }}>{streak}</span>
      <span style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        day streak
      </span>
    </div>
  )
}

function WeekBars({ buckets }) {
  const max = Math.max(...buckets.map(b => b.count), 1)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 40 }}>
        {buckets.map((b, i) => {
          const heightPct = b.count === 0 ? 6 : Math.round((b.count / max) * 100)
          const isToday   = i === 6
          return (
            <div
              key={b.key}
              title={`${b.count} quiz${b.count !== 1 ? 'zes' : ''}`}
              style={{
                flex: 1,
                height: `${heightPct}%`,
                minHeight: 3,
                borderRadius: 4,
                background: isToday
                  ? '#10B981'
                  : b.count > 0
                    ? '#6EE7B7'
                    : '#E5E7EB',
                transition: 'height 0.4s ease',
              }}
            />
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        {buckets.map((b, i) => (
          <div key={b.key} style={{ flex: 1, textAlign: 'center', fontSize: 9, fontWeight: 700,
            color: i === 6 ? '#059669' : '#9CA3AF' }}>
            {DAY_LABELS[b.dow]}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function ProgressWidget({ results = [], streak = 0, loading = false }) {
  if (loading) {
    return (
      <div className="theme-card rounded-2xl border theme-border p-4 animate-pulse">
        <div className="h-4 bg-gray-100 rounded w-32 mb-4" />
        <div className="h-16 bg-gray-100 rounded" />
      </div>
    )
  }

  const buckets      = buildWeekBuckets(results)
  const thisWeekCount = buckets.reduce((s, b) => s + b.count, 0)
  const goalReached  = thisWeekCount >= WEEKLY_GOAL

  return (
    <div className="theme-card rounded-2xl border theme-border p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-black text-gray-800 text-sm">📈 Your Progress</h2>
        {goalReached && (
          <span className="text-xs font-black text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
            🎯 Weekly goal hit!
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 16, alignItems: 'center' }}>
        {/* Streak */}
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <StreakFlame streak={streak} />
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 60, background: '#F3F4F6' }} />

        {/* Weekly goal ring + label */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <GoalRing current={thisWeekCount} goal={WEEKLY_GOAL} />
          <span style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            weekly goal
          </span>
        </div>
      </div>

      {/* 7-day bars */}
      <div style={{ marginTop: 16 }}>
        <WeekBars buckets={buckets} />
      </div>
    </div>
  )
}
