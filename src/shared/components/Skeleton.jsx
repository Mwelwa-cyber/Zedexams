/**
 * Skeleton — placeholder block with shimmer sweep.
 *
 * Replaces `animate-pulse` on loading states. Same CPU cost, reads as
 * "content is loading" much more clearly than opacity pulse.
 *
 * Usage
 *   <Skeleton />                         // one line, w-full, h-4
 *   <Skeleton width="60%" />             // percent or px width
 *   <Skeleton height={24} />             // px or tailwind class
 *   <Skeleton className="h-8 w-24" />    // full tailwind control
 *   <Skeleton shape="circle" size={40} />// avatar placeholder
 *   <SkeletonText lines={3} />           // convenience multi-line
 *
 * Respects the app-wide Data Saver mode — in that mode the shimmer
 * animation is suppressed by index.css (animation-duration: 0.001ms)
 * and the block renders as a static muted panel instead.
 */

function resolveDim(value, fallback) {
  if (value == null) return fallback
  if (typeof value === 'number') return `${value}px`
  return value
}

export default function Skeleton({
  width,
  height = 16,
  shape = 'rect',
  size,
  className = '',
  style = {},
}) {
  const isCircle = shape === 'circle'
  const radius = isCircle ? '9999px' : '10px'
  const w = isCircle ? resolveDim(size, '40px') : resolveDim(width, '100%')
  const h = isCircle ? resolveDim(size, '40px') : resolveDim(height, '16px')

  return (
    <div
      aria-hidden="true"
      className={`animate-shimmer ${className}`}
      style={{
        width: w,
        height: h,
        borderRadius: radius,
        ...style,
      }}
    />
  )
}

/**
 * SkeletonText — several shimmer lines with natural width variation so
 * it reads like a real paragraph placeholder instead of a grid.
 */
export function SkeletonText({ lines = 3, className = '' }) {
  const widths = ['100%', '92%', '78%', '86%', '64%']
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={widths[i % widths.length]} height={14} />
      ))}
    </div>
  )
}

/**
 * SkeletonCard — a drop-in card-sized placeholder for list loaders.
 * Matches the rhythm of a standard elevated Card.
 */
export function SkeletonCard({ className = '' }) {
  return (
    <div className={`theme-card border theme-border rounded-2xl p-5 ${className}`}>
      <div className="flex items-center gap-3 mb-3">
        <Skeleton shape="circle" size={40} />
        <div className="flex-1 space-y-2">
          <Skeleton width="60%" height={14} />
          <Skeleton width="40%" height={12} />
        </div>
      </div>
      <Skeleton width="90%" height={12} />
      <div className="h-2" />
      <Skeleton width="72%" height={12} />
    </div>
  )
}
