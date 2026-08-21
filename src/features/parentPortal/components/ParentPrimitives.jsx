/**
 * ParentPrimitives — the small shared pieces of the parent app.
 *
 * They live together because each is a few lines and every page uses
 * two or three of them; splitting them into files of their own would be
 * more imports than component.
 */
import { Link, useNavigate } from 'react-router-dom'
import { useNotifications } from '../../../contexts/NotificationContext'
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

/**
 * The Free plan / Premium chip.
 *
 * Rendered for EVERY child, paid or not. A chip that only appears when
 * there is something to sell is the arrangement that made a paid day
 * pass invisible — the parent app had no surface anywhere that said a
 * plan was on, so "paid" and "free" both drew as nothing.
 *
 * The words come from `describeChildPlan`; this only draws them. `tone`
 * is a class suffix rather than a colour so Night mode keeps working.
 */
export function PlanPill({ plan }) {
  if (!plan) return null
  return (
    <span className={`pax-plan-chip pax-plan-chip-${plan.tone}`}>
      <span aria-hidden="true">{plan.paid ? '\u2713' : '\u2726'}</span>
      {plan.pill}
    </span>
  )
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

/**
 * The parent header: brand, "Parent" pill, the notifications bell, then
 * whatever the page adds.
 *
 * The bell LINKS to /family/notifications rather than opening the overlay
 * NotificationCenter the teacher and admin shells use. A parent's inbox is
 * a destination — the requests waiting in it are things they came to
 * decide, not a tray they glance at — which is also how the prototype
 * draws it. It moved here from ParentLayout when the shell replaced it;
 * putting it on the header rather than in the tab bar keeps the four tabs
 * the prototype's four.
 */
export function ParentHeader({ children }) {
  const { unreadCount } = useNotifications()
  const hasUnread = unreadCount > 0
  return (
    <div className="pax-top">
      <img className="pax-brand" src="/zedexams-logo.webp" alt="ZedExams" />
      <span className="pax-role-pill">Parent</span>
      <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
        {children}
        <Link
          to="/family/notifications"
          className="lhx-iconbtn"
          aria-label={hasUnread ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        >
          <span aria-hidden="true">🔔</span>
          {hasUnread && <span className="lhx-notif-dot" aria-hidden="true" />}
        </Link>
      </span>
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

/**
 * An empty state that says what would fill it, never just "nothing here"
 * — and, where there is a next step, offers it as a button.
 *
 * The copy alone was not enough. "Ask your child for their family code
 * from Settings → Guardian, or invite them from the Children tab" tells
 * a parent exactly what to do and then makes them find the Children tab
 * themselves; the empty state is precisely the screen where somebody has
 * nothing to work with and the least patience for a hunt. `action` is
 * optional because some empties genuinely have no next step, and a
 * button that goes nowhere useful is worse than no button.
 */
export function Empty({ icon = '🌱', action = null, children }) {
  return (
    <div className="lhx-empty">
      <div className="lhx-empty-icon" aria-hidden="true">{icon}</div>
      <p>{children}</p>
      {action?.to && action?.label && (
        <Link className="lhx-btn lhx-btn-primary lhx-btn-sm pax-empty-cta" to={action.to}>
          {action.label}
        </Link>
      )}
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
