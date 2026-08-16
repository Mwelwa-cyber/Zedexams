/**
 * Skeleton — placeholder block on the shared loading tempo.
 *
 * Usage
 *   <Skeleton />                          // one line, w-full, h-4
 *   <Skeleton width="60%" />              // percent or px width
 *   <Skeleton height={24} />              // px or tailwind class
 *   <Skeleton className="h-8 w-24" />     // full tailwind control
 *   <Skeleton shape="circle" size={40} /> // avatar placeholder
 *   <Skeleton index={2} />                // stagger this row in a list
 *   <SkeletonText lines={3} />            // convenience multi-line
 *
 * Two things the placeholder gets from `.zx-sk` (src/shared/styles/zxLoading.css)
 * that it could not get from a hand-tuned class:
 *
 *   • Colour is MIXED FROM THE LIVE THEME. The old block was a cool grey
 *     gradient sitting on the warm cream background, which reads as a broken
 *     image rather than as content arriving, and had to be re-picked by hand
 *     for every theme. It now follows oatmeal / night / sky automatically.
 *   • Rows STAGGER by a fraction of the shared tempo (`index`), so a list is
 *     one wave down the page instead of N independent flashes.
 *
 * Respects the app-wide Data Saver mode — `body.data-saver *` in index.css
 * collapses the sweep and the block renders as a static tinted panel.
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
  index = 0,
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
      className={`zx-sk ${className}`.trim()}
      style={{
        width: w,
        height: h,
        borderRadius: radius,
        // Derived in CSS rather than multiplied out here, so the stagger step
        // is declared exactly once (--load-stagger) and cannot drift.
        '--zx-delay': index ? `calc(var(--load-stagger) * ${index})` : '0ms',
        ...style,
      }}
    />
  )
}

/**
 * SkeletonText — several lines with natural width variation so it reads like a
 * real paragraph placeholder instead of a grid.
 */
export function SkeletonText({ lines = 3, className = '' }) {
  const widths = ['100%', '92%', '78%', '86%', '64%']
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} index={i} width={widths[i % widths.length]} height={14} />
      ))}
    </div>
  )
}

/**
 * SkeletonCard — a drop-in card-sized placeholder for list loaders.
 *
 * The FRAME is real — border, radius, padding all match a live Card — and only
 * the contents are placeholder, so the swap to real data barely moves
 * anything. Pass `index` when rendering several in a list to keep them on the
 * one wave.
 */
export function SkeletonCard({ index = 0, className = '' }) {
  return (
    <div className={`theme-card border theme-border rounded-2xl p-5 ${className}`}>
      <div className="flex items-center gap-3 mb-3">
        <Skeleton shape="circle" size={40} index={index} />
        <div className="flex-1 space-y-2">
          <Skeleton width="60%" height={14} index={index} />
          <Skeleton width="40%" height={12} index={index} />
        </div>
      </div>
      <Skeleton width="90%" height={12} index={index} />
      <div className="h-2" />
      <Skeleton width="72%" height={12} index={index} />
    </div>
  )
}
