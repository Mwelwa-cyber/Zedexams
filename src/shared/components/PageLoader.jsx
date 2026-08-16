import TopLine from './TopLine'

/**
 * PageLoader — the Suspense fallback for lazily-loaded routes.
 *
 * It draws the shared 2px accent line and nothing else. Two things changed
 * when the loading system landed:
 *
 *   • It was a green (#10B981) gradient on its own 1.4s loop. Green is the
 *     success colour everywhere else in the product, so using it for
 *     in-progress was a false signal — and being hard-coded it ignored the
 *     reader's theme entirely.
 *   • It now runs through TopLine's delay gate, so a chunk that resolves
 *     inside ~200ms (most of them) paints no loader at all instead of a flash.
 */
export default function PageLoader() {
  return <TopLine fixed label="Loading page" />
}
