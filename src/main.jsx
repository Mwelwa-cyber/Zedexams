import React from 'react'
import ReactDOM from 'react-dom/client'
import { HelmetProvider } from 'react-helmet-async'
import App from './App'
import { AuthProvider } from './contexts/AuthContext'
import { DataSaverProvider } from './contexts/DataSaverContext'
import { ThemeProvider } from './contexts/ThemeContext'
import ErrorBoundary from './components/ui/ErrorBoundary'
import { initNativeShell } from './utils/nativeShell'
import { initSentry } from './utils/sentry'
import { initAnalytics, capture as captureAnalytics } from './utils/analytics'
import { initClientErrorReporting } from './utils/clientErrorReporting'
// Audit A7 — initialise the i18n runtime before <App /> mounts so the
// detected language is in place for the first render. Side-effect
// import; the singleton is consumed via useTranslation() in components.
import './i18n'
import './index.css'

initNativeShell()
// Fire-and-forget — initSentry resolves to a no-op when VITE_SENTRY_DSN
// is unset, and dynamically imports @sentry/react only when it is. The
// promise is intentionally not awaited so a slow Sentry CDN can never
// delay the React mount.
initSentry()
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

// Service worker registration moved to src/hooks/usePwaUpdate.js so the
// "new version available" UX (audit A1.2) can wire registerSW's
// onNeedRefresh callback into React state. The hook is consumed by
// <UpdatePrompt /> mounted inside <App />. Capacitor still skips the SW
// entirely — the hook returns no-ops on native.
// editor.css and katex CSS are imported from the editor/viewer entry modules
// (QuizEditor, QuizViewer, QuizPreview via safeRender). Keeping them out of the
// root entry trims ~50 KB of parse-time CSS on public pages.

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <HelmetProvider>
        <ThemeProvider>
          <DataSaverProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </DataSaverProvider>
        </ThemeProvider>
      </HelmetProvider>
    </ErrorBoundary>
  </React.StrictMode>
)
