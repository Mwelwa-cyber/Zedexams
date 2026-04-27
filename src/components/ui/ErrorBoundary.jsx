import { Component } from 'react'

// After a Firebase Hosting release, the previous build's hashed JS chunks stop
// resolving on zedexams.com. Any user mid-session who triggers a lazy import
// then sees this boundary's recovery card. Detecting that specific failure and
// hard-reloading once turns the bug into a silent refresh to the new build.
const RELOAD_FLAG = 'zedexams:chunk-reload-at'
const RELOAD_COOLDOWN_MS = 30_000

function isChunkLoadError(err) {
  if (!err) return false
  if (err.name === 'ChunkLoadError') return true
  const msg = String(err.message || err)
  return (
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /Loading chunk .* failed/i.test(msg)
  )
}

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

    if (isChunkLoadError(error)) {
      // The cooldown stamp prevents an infinite reload loop if a real bug
      // happens to throw a chunk-shaped message — after a single retry inside
      // 30 s the boundary falls through to the normal recovery card.
      try {
        const last = Number(sessionStorage.getItem(RELOAD_FLAG) || 0)
        if (Date.now() - last > RELOAD_COOLDOWN_MS) {
          sessionStorage.setItem(RELOAD_FLAG, String(Date.now()))
          window.location.reload()
        }
      } catch {
        window.location.reload()
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
    // Hard reload so any broken lazy chunk gets a fresh network fetch.
    window.location.reload()
  }

  handleHome = () => {
    window.location.assign('/')
  }

  render() {
    if (!this.state.hasError) return this.props.children

    const message = this.state.error?.message || 'An unexpected error occurred.'
    const inline = !!this.props.inline

    const containerClass = inline
      ? 'w-full flex items-center justify-center py-10 px-4'
      : 'min-h-screen theme-bg flex items-center justify-center p-4'

    return (
      <div className={containerClass}>
        <div className="theme-card border theme-border rounded-3xl px-6 py-10 max-w-md w-full text-center shadow-sm">
          <div className="text-5xl mb-3">😕</div>
          <p className="theme-text-muted font-black text-xs uppercase tracking-widest mb-2">
            Something went wrong
          </p>
          <h1 className="theme-text text-2xl font-black leading-tight mb-2">
            We hit a snag loading this page.
          </h1>
          <p className="theme-text-muted text-sm mb-6">
            Try again — this usually fixes it. If it keeps happening, head back home and try from there.
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
