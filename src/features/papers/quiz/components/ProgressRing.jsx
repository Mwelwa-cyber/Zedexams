/**
 * The gradient progress ring.
 *
 * Used twice on purpose: the cover's personal best and the results screen's
 * score. §1b — "the same progress ring is reused on the results screen for the
 * score, so the two screens read as one system". A learner who sees their best
 * in a ring and then their result in a bar has met two products.
 *
 * The gradient id is derived from the size AND a caller-supplied key, because
 * two rings on one page with the same `<linearGradient id>` is a real bug:
 * SVG gradient ids are document-global, so the second definition wins and the
 * first ring silently re-paints itself with the other's colours.
 */

export default function ProgressRing({
  value,
  max,
  size = 84,
  label = 'BEST SCORE',
  idKey = 'a',
}) {
  const safeMax = Math.max(1, Number(max) || 0)
  const safeValue = Math.max(0, Math.min(safeMax, Number(value) || 0))
  const r = (size / 2) - 6
  const circumference = 2 * Math.PI * r
  const pct = safeValue / safeMax
  const gradientId = `pq-ring-${idKey}-${size}`

  return (
    <div className="pq-ring" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#5b4be8" />
            <stop offset=".45" stopColor="#8b5cf6" />
            <stop offset=".78" stopColor="#ff7a3c" />
            <stop offset="1" stopColor="#ff7a3c" />
          </linearGradient>
        </defs>
        <circle className="pq-ring-track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="7" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      {/* The ring is decorative; the NUMBER is the content, and it is real text
          so a screen reader reads "38 out of 60" rather than announcing an
          image. */}
      <div className="pq-ring-value">
        <b>
          {safeValue}
          <i>{`/${safeMax}`}</i>
        </b>
        <span>{label}</span>
      </div>
    </div>
  )
}
