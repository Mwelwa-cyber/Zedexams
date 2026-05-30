import { Component } from 'react'
import { reportClientError } from '../../utils/clientErrorReporting'
import { isChunkLoadError, recoverFromChunkError } from '../../utils/swRecovery'

// After a Firebase Hosting release, the previous build's hashed JS chunks stop
// resolving on zedexams.com. Any user mid-session who triggers a lazy import
// then sees this boundary's recovery card. Detecting that specific failure and
// recovering once turns the bug into a silent refresh to the new build.
//
// A plain reload isn't enough: the PWA service worker precaches index.html and
// keeps serving the stale shell that points at the dead chunk hashes, so the
// reload loops straight back into the same failed import. recoverFromChunkError
// evicts the SW shell (clears Cache Storage + unregisters the SW) BEFORE
// reloading so the next navigation pulls the live index.html + new chunks.
const RELOAD_FLAG = 'zedexams:chunk-reload-at'
const RELOAD_COOLDOWN_MS = 30_000

/**
 * ErrorBoundary — catches render-time exceptions anywhere in the React tree
 * and shows a friendly recovery card instead of a blank white screen.
 *
 * Wrapped around <App /> in main.jsx so a lazy-chunk load failure, a malformed
 * Firestore payload, or any unexpected render throw still leaves the user with
 * a clear way to recover (reload or jump home).
 *
 * Props:
 *   resetKey — when this value changes the boundary drops its error state so
 *              the next render can succeed (handy for a route-keyed reset so
 *              navigating away from a broken page recovers without a full
 *              page reload).
 *   inline   — render a compact recovery card instead of the full-screen one,
 *              so nested boundaries don't blow away the surrounding shell.
 *   fallback — optional ReactNode (or function returning one) rendered in
 *              place of the default recovery card. Lets a feature owner
 *              show a context-aware UI (e.g. the exam runner's "Try again"
 *              card with the exam id baked in) instead of the generic
 *              "Something went wrong" surface. Receives no args when a node;
 *              when a function, called with `({ error, retry })` so the
 *              fallback can wire its own retry button to the boundary's
 *              clear-state handler without hoisting state into the parent.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    // Surface the full stack for devs; kept out of the UI for learners.
    console.error('ErrorBoundary caught:', error, info?.componentStack)

    // Forward to the rate-limited analytics sink. No-op without consent
    // / config; Sentry's React integration captures the same event
    // through its own pathway when DSN is set.
    reportClientError(error, 'error_boundary')

    if (isChunkLoadError(error)) {
      // The cooldown stamp prevents an infinite reload loop if a real bug
      // happens to throw a chunk-shaped message — after a single retry inside
      // 30 s the boundary falls through to the normal recovery card.
      try {
        const last = Number(sessionStorage.getItem(RELOAD_FLAG) || 0)
        if (Date.now() - last > RELOAD_COOLDOWN_MS) {
          sessionStorage.setItem(RELOAD_FLAG, String(Date.now()))
          recoverFromChunkError()
        }
      } catch {
        recoverFromChunkError()
      }
    }
  }

  componentDidUpdate(prevProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null })
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  handleReload = () => {
    // If the boundary caught a stale-chunk failure, a plain reload would be
    // re-served the same broken shell by the service worker — so evict the SW
    // shell first, then reload. Otherwise a normal hard reload is enough.
    if (isChunkLoadError(this.state.error)) {
      recoverFromChunkError()
      return
    }
    window.location.reload()
  }

  handleHome = () => {
    window.location.assign('/')
  }

  render() {
    if (!this.state.hasError) return this.props.children

    // Feature-specific fallback wins over the generic recovery card so a
    // caller (e.g. the exam runner) can show an exam-aware retry card
    // without losing the boundary's catch-and-reset machinery.
    if (this.props.fallback !== undefined) {
      return typeof this.props.fallback === 'function'
        ? this.props.fallback({ error: this.state.error, retry: this.handleRetry })
        : this.props.fallback
    }

    const message = this.state.error?.message || 'An unexpected error occurred.'
    const inline = !!this.props.inline

    // Audit A1.2 — when the browser reports it's offline, the failure was
    // almost certainly a network drop (Firestore call timed out, lazy
    // chunk couldn't load, etc.). Show a more accurate message so the
    // learner doesn't think the app itself is broken.
    const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false

    const containerClass = inline
      ? 'w-full flex items-center justify-center py-10 px-4'
      : 'min-h-screen theme-bg flex items-center justify-center p-4'

    return (
      <div className={containerClass}>
        <div className="theme-card border theme-border rounded-3xl px-6 py-10 max-w-md w-full text-center shadow-sm">
          <div className="text-5xl mb-3">{isOffline ? '📡' : '😕'}</div>
          <p className="theme-text-muted font-black text-xs uppercase tracking-widest mb-2">
            {isOffline ? "You're offline" : 'Something went wrong'}
          </p>
          <h1 className="theme-text text-2xl font-black leading-tight mb-2">
            {isOffline
              ? "We can't reach the network right now."
              : 'We hit a snag loading this page.'}
          </h1>
          <p className="theme-text-muted text-sm mb-6">
            {isOffline
              ? "Most pages you've already visited still work offline — try going back, or wait for your connection to return."
              : 'Try again — this usually fixes it. If it keeps happening, head back home and try from there.'}
          </p>

          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <button
              type="button"
              onClick={this.handleRetry}
              className="inline-flex items-center justify-center gap-2 theme-accent-fill theme-on-accent font-black text-sm px-5 py-3 rounded-2xl shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all"
            >
              ↻ Try again
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="inline-flex items-center justify-center gap-2 theme-card border theme-border theme-text font-black text-sm px-5 py-3 rounded-2xl hover:theme-bg-subtle transition-colors"
            >
              Reload page
            </button>
            {!inline && (
              <button
                type="button"
                onClick={this.handleHome}
                className="inline-flex items-center justify-center gap-2 theme-card border theme-border theme-text font-black text-sm px-5 py-3 rounded-2xl hover:theme-bg-subtle transition-colors"
              >
                ← Go home
              </button>
            )}
          </div>

          {import.meta.env.DEV && (
            <details className="mt-6 text-left">
              <summary className="theme-text-muted text-xs font-bold cursor-pointer">
                Developer details
              </summary>
              <pre className="mt-2 text-xs theme-text-muted whitespace-pre-wrap break-words">
                {message}
              </pre>
            </details>
          )}
        </div>
      </div>
    )
  }
}
