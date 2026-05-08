import React from 'react'
import ReactDOM from 'react-dom/client'
import { HelmetProvider } from 'react-helmet-async'
import App from './App'
import { AuthProvider } from './contexts/AuthContext'
import { DataSaverProvider } from './contexts/DataSaverContext'
import { ThemeProvider } from './contexts/ThemeContext'
import ErrorBoundary from './components/ui/ErrorBoundary'
import { initNativeShell } from './utils/nativeShell'
import { isNativePlatform } from './utils/runtime'
import { initSentry } from './utils/sentry'
import './index.css'

initNativeShell()
// Fire-and-forget — initSentry resolves to a no-op when VITE_SENTRY_DSN
// is unset, and dynamically imports @sentry/react only when it is. The
// promise is intentionally not awaited so a slow Sentry CDN can never
// delay the React mount.
initSentry()

// Service worker registration (audit A1.1). vite-plugin-pwa generates the
// SW at build time; we register it here so we control when it runs and
// can skip it inside the Capacitor wrapper. registerType: 'prompt' in
// vite.config.js means the SW won't auto-claim open tabs on update — the
// onNeedRefresh hook below logs when a new version is ready, and the full
// "click to update" UX lands in A1.2 (UpdatePrompt component).
//
// Skip on native: Capacitor's WebView serves files from `https://localhost`
// where Workbox can't usefully cache anything (the assets are bundled in
// the app already). Registering there is dead weight at best, and on some
// Android versions the file:// origin blocks the SW outright.
if (!isNativePlatform()) {
  import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({
      onNeedRefresh() {
        console.info('[pwa] new version available — refresh to update')
      },
      onOfflineReady() {
        console.info('[pwa] app ready to work offline')
      },
      onRegisterError(err) {
        console.warn('[pwa] SW registration failed:', err)
      },
    })
  }).catch((err) => {
    console.warn('[pwa] failed to load registerSW:', err)
  })
}
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
