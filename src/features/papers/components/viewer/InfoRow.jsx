/**
 * One label/value row in the paper's details panel.
 */

function InfoRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="theme-text-muted font-bold">{label}</dt>
      <dd className="theme-text font-black text-right truncate">{value ?? '—'}</dd>
    </div>
  )
}

export default InfoRow
