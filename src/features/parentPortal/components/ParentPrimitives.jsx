/**
 * ParentPrimitives — the small shared pieces of the parent app.
 *
 * They live together because each is a few lines and every page uses
 * two or three of them; splitting them into files of their own would be
 * more imports than component.
 */
import { useNavigate } from 'react-router-dom'
import { initialOf, statusPill } from '../lib/parentAppView'

/** The four-tint avatar bubble. Tint is by index so it is stable per child. */
export function Avatar({ name, index = 0, size = 'sm', className = '' }) {
  const tint = `pax-av-t${(Number(index) % 4) + 1}`
  return (
    <span className={`pax-av pax-av-${size} ${tint} ${className}`} aria-hidden="true">
      {initialOf(name)}
    </span>
  )
}

/** The on-track / needs-a-nudge pill. */
export function StatusPill({ status }) {
  const { label, tone } = statusPill(status)
  return <span className={`pax-status pax-status-${tone}`}>{label}</span>
}

/** A back row with a title, used by every screen below the four tabs. */
export function BackRow({ title, subtitle, to, onBack }) {
  const navigate = useNavigate()
  const go = () => {
    if (onBack) return onBack()
    return to ? navigate(to) : navigate(-1)
  }
  return (
    <div className="lhx-back-row">
      <button type="button" className="lhx-back-btn" aria-label="Back" onClick={go}>‹</button>
      <div>
        <h1 className="lhx-back-title">{title}</h1>
        {subtitle && <p className="lhx-back-sub">{subtitle}</p>}
      </div>
    </div>
  )
}

/** The parent header: brand, "Parent" pill, then whatever the page adds. */
export function ParentHeader({ children }) {
  return (
    <div className="pax-top">
      <img src="/zedexams-logo.webp" alt="ZedExams" height="28" />
      <span className="pax-role-pill">Parent</span>
      <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>{children}</span>
    </div>
  )
}

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

/** An empty state that says what would fill it, never just "nothing here". */
export function Empty({ icon = '🌱', children }) {
  return (
    <div className="lhx-empty">
      <div className="lhx-empty-icon" aria-hidden="true">{icon}</div>
      <p>{children}</p>
    </div>
  )
}

/**
 * An error state that offers the retry. Never a dead end — the parent
 * app is where somebody goes to approve a payment, and a screen that
 * fails without a way forward is a screen that loses the payment.
 */
export function ErrorRetry({ message, onRetry }) {
  return (
    <div className="lhx-error" role="alert">
      <p className="lhx-error-text">{message || 'We could not load that just now.'}</p>
      {onRetry && (
        <button type="button" className="lhx-btn lhx-btn-soft lhx-btn-sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}

/**
 * The offline bar. Online-only actions (approving, paying, inviting) are
 * disabled by their own pages; this says why.
 */
export function OfflineBanner() {
  return (
    <div className="lhx-offline" role="status">
      📴 You are offline — approvals and payments need a connection.
    </div>
  )
}
