/**
 * ErrorState — the one component that turns any caught error into a calm,
 * actionable card. Pairs with src/utils/friendlyErrors.js: that module
 * decides WHAT to say, this component decides HOW it looks.
 *
 * Give it whatever you caught and it renders an illustration (emoji), a
 * reassuring title, a plain-language explanation, and the action buttons the
 * friendly error asked for — wired to sensible defaults so most call sites
 * only need to pass `onRetry`.
 *
 *   // simplest — a failed Firestore read inside a panel
 *   <ErrorState error={err} onRetry={reload} inline />
 *
 *   // a domain failure with the right tone + a custom action
 *   <ErrorState
 *     error={err}
 *     category="payment"
 *     handlers={{ [ACTIONS.CHOOSE_PAYMENT]: openMethods }}
 *     onRetry={pay}
 *   />
 *
 * Distinct from <ContentLoadError /> (a focused "this read failed, retry"
 * strip) and <EmptyState /> ("nothing here yet"): ErrorState is the full
 * recovery surface that understands error *codes* and offers the matching
 * buttons (Forgot Password, Contact Support, Upgrade, …).
 */
import { ACTIONS, ACTION_LABELS, toFriendlyError } from '../../utils/friendlyErrors'
import { reportClientError } from '../../utils/clientErrorReporting'

const SUPPORT_EMAIL = 'support@zedexams.com'

// Severity → accent treatment. Stays inside the theme token system so the
// card reads correctly on every theme; criticals lean on the danger palette.
const SEVERITY_TONE = {
  info: 'theme-accent-text',
  warning: 'theme-accent-text',
  error: 'text-danger',
  critical: 'text-danger',
}

// Built-in fallbacks for the universal actions. A call site can always
// override any of these by passing a `handlers` entry or the matching
// `on*` prop. Actions NOT listed here (Forgot Password, Upgrade, Choose
// File, …) are contextual: they only render when a handler is supplied.
function defaultHandlers(error) {
  return {
    [ACTIONS.REFRESH]: () => {
      if (typeof window !== 'undefined') window.location.reload()
    },
    [ACTIONS.GO_HOME]: () => {
      if (typeof window !== 'undefined') window.location.assign('/')
    },
    [ACTIONS.GO_BACK]: () => {
      if (typeof window === 'undefined') return
      if (window.history.length > 1) window.history.back()
      else window.location.assign('/')
    },
    [ACTIONS.CONTACT_SUPPORT]: () => {
      if (typeof window === 'undefined') return
      const subject = encodeURIComponent('I need help with ZedExams')
      window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${subject}`
    },
    [ACTIONS.REPORT_PROBLEM]: () => {
      // Silently forward the technical details to the admin sink. The
      // learner just sees the confirmation from `onReported`. `force` bypasses
      // the dedup + per-session cap so a deliberate report is never dropped.
      reportClientError(error, 'error_state_report', { force: true })
    },
  }
}

export default function ErrorState({
  error,
  friendly: friendlyProp,
  category,
  online,
  // Convenience handlers for the most common actions.
  onRetry,
  onGoBack,
  onContactSupport,
  onReportProblem,
  onReported,
  // Escape hatch: a map of ACTION key → handler for contextual actions.
  handlers = {},
  inline = false,
  className = '',
}) {
  const friendly = friendlyProp || toFriendlyError(error, { category, online })
  const tone = SEVERITY_TONE[friendly.severity] || SEVERITY_TONE.error

  // Build the built-in handlers ONCE — this used to be called three times
  // per render, allocating a fresh set of closures each time for no reason.
  const defaults = defaultHandlers(error)
  const resolved = {
    ...defaults,
    [ACTIONS.RETRY]: onRetry,
    [ACTIONS.GO_BACK]: onGoBack || defaults[ACTIONS.GO_BACK],
    [ACTIONS.CONTACT_SUPPORT]: onContactSupport || defaults[ACTIONS.CONTACT_SUPPORT],
    [ACTIONS.REPORT_PROBLEM]: () => {
      defaults[ACTIONS.REPORT_PROBLEM]()
      onReportProblem?.()
      onReported?.()
    },
    ...handlers,
  }

  // Keep only the actions we can actually wire to a handler so we never
  // render a dead button. Retry/contextual actions disappear when no
  // handler is provided rather than confusing the learner.
  const buttons = friendly.actions
    .map((key) => ({ key, label: ACTION_LABELS[key] || key, onClick: resolved[key] }))
    .filter((b) => typeof b.onClick === 'function')

  const containerClass = inline
    ? `w-full flex items-center justify-center py-8 px-4 ${className}`
    : `min-h-[60vh] theme-bg flex items-center justify-center p-4 ${className}`

  return (
    <div className={containerClass} role="alert" aria-live="assertive">
      <div className="theme-card border theme-border rounded-3xl px-6 py-10 max-w-md w-full text-center shadow-sm">
        <div className="text-5xl mb-3" aria-hidden="true">
          {friendly.icon || '😕'}
        </div>
        <p className={`font-black text-xs uppercase tracking-widest mb-2 ${tone}`}>
          {friendly.title}
        </p>
        <p className="theme-text-muted text-sm mb-6 leading-relaxed">
          {friendly.message}
        </p>

        {buttons.length > 0 && (
          <div className="flex flex-col sm:flex-row flex-wrap gap-2 justify-center">
            {buttons.map((b, i) => {
              // The first button is the primary call to action.
              const primary = i === 0
              const cls = primary
                ? 'theme-accent-fill theme-on-accent'
                : 'theme-card border theme-border theme-text hover:theme-bg-subtle'
              return (
                <button
                  key={b.key}
                  type="button"
                  onClick={b.onClick}
                  className={`inline-flex items-center justify-center gap-2 font-black text-sm px-5 py-3 rounded-2xl shadow-sm transition-all hover:shadow-md ${cls}`}
                >
                  {b.label}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
