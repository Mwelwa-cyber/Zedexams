/**
 * ParentPrimitives — the one shared piece still used by the guardian screens.
 *
 * The rest of the parent app's pieces (avatar, pills, back row, header,
 * empty and error states) went with the app itself (2026-10).
 */

/** Shimmer placeholders, matching the real layout so content does not jump. */
export function ListSkeleton({ rows = 3, height = 76 }) {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="lhx-skel" style={{ height, borderRadius: 20, marginBottom: 12 }} />
      ))}
    </div>
  )
}
