import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './app/App'
import AppProviders from './app/providers/AppProviders'
import ErrorBoundary from './shared/components/ErrorBoundary'
import { initNativeShell } from './utils/nativeShell'
import { initSentry } from './utils/sentry'
import { initAnalytics, capture as captureAnalytics } from './utils/analytics'
import { initClientErrorReporting, reportClientError } from './utils/clientErrorReporting'
import { bootstrapCurriculumCatalogue } from './config/curriculumCatalogBootstrap'
// Audit A7 — initialise the i18n runtime before <App /> mounts so the
// detected language is in place for the first render. Side-effect
// import; the singleton is consumed via useTranslation() in components.
import './i18n'
import './index.css'
// The loading system (tokens + top line + skeletons + button states). Global
// because its `:root` tempo/easing tokens are read from several stylesheets,
// and because a route fallback must not wait on a feature chunk to be styled.
import './shared/styles/zxLoading.css'

initNativeShell()
// Sentry is a support-triage error sink, not part of first paint, so its
// ~130 KiB chunk has no business loading on the critical path — when it
// did, PageSpeed flagged it as a long main-thread task (~106 ms) firing
// right as React mounts, plus the bulk of its bytes as "unused JS" during
// load. Defer the download/parse/init to browser idle (after first paint /
// LCP). Any error thrown in the gap before Sentry loads still reaches the
// PostHog client-error sink wired synchronously below — that is its
// documented "we have a signal even without Sentry" role. initSentry stays
// a no-op + tree-shaken when VITE_SENTRY_DSN is unset.
//   • requestIdleCallback keeps it off the busy initial main thread; the
//     `timeout` guarantees it still runs on a saturated thread.
//   • setTimeout fallback covers Safari, which lacks requestIdleCallback.
const scheduleSentryInit = (cb) => {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(cb, { timeout: 5000 })
  } else {
    setTimeout(cb, 2000)
  }
}
scheduleSentryInit(() => { initSentry() })
// Audit B2 — wire the PostHog consent listener. Silent no-op without
// VITE_POSTHOG_KEY. When the user accepts the cookie banner, the SDK
// dynamically imports + initialises; when they decline, it tears down.
initAnalytics()
// Wire window-level error + unhandledrejection listeners so async crashes
// the ErrorBoundary can't catch still reach the analytics sink. Sentry
// installs its own listeners independently — this is the "we have a
// signal even without a Sentry DSN" fallback. Rate-limited + deduped to
// keep the analytics event stream usable.
initClientErrorReporting(captureAnalytics)
// Register the canonical curriculum catalogue's syllabi-backed topic provider +
// diagnostics sink so every studio wired to useCurriculumSelection resolves
// topics from one source and picker-resolution telemetry reaches observability.
bootstrapCurriculumCatalogue({ capture: captureAnalytics, reportError: reportClientError })

// Service worker registration moved to src/hooks/usePwaUpdate.js so the
// "new version available" UX (audit A1.2) can wire registerSW's
// onNeedRefresh callback into React state. The hook is consumed by
// <UpdatePrompt /> mounted inside <App />. Capacitor still skips the SW
// entirely — the hook returns no-ops on native.
// editor.css is imported by the AUTHORING surfaces only (RichEditor,
// NoteEditor). Keeping it out of the root entry trims ~50 KB of parse-time CSS
// on public pages, and that is still right.
//
// It used to say editor.css arrived "via safeRender". It did not, and the gap
// was real: safeRender imports katex.min.css and, since the fix, the school
// notation rules it emits markup for (`editor/mathNotation.css`). Before that
// the learner quiz route rendered a stacked fraction with no CSS to stack it.
// A renderer's stylesheet travels with the renderer; the editor's stays with
// the editor.

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AppProviders>
        <App />
      </AppProviders>
    </ErrorBoundary>
  </React.StrictMode>
)

// Tell the boot watchdog in index.html that the app started. React commits
// the first paint asynchronously after render() returns, so the watchdog
// primarily relies on #root having children; this flag is a belt-and-braces
// signal so a successful-but-slow boot can never trip the white-screen
// fallback. A render that throws before committing never reaches this line,
// leaving the watchdog free to show its recovery UI.
window.__ZED_APP_MOUNTED__ = true
