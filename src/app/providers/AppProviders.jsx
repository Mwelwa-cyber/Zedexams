/**
 * The single composition entry for the app's provider stack, named by
 * docs/architecture.md §12 and mounted in `main.jsx`.
 *
 * **Order is behaviour, not style.** This renders exactly the nesting
 * `main.jsx` had before it was extracted, and the sequence is load-bearing in
 * at least three places: `ThemeProvider` must be outermost of the app
 * providers so the saved reading theme is applied before anything paints;
 * `OfflineProvider` owns the IndexedDB stack that `AuthProvider` reads through
 * on a cold, offline start; and `NotificationProvider` is innermost because it
 * consumes auth state. Re-ordering these is a functional change and should be
 * argued for on its own, never tidied.
 *
 * **What is deliberately NOT here.**
 *
 *   • `ErrorBoundary` stays in `main.jsx`, OUTSIDE this component. It is a
 *     boundary rather than a provider, and keeping it outermost is what lets
 *     it catch a throw from provider construction itself — which it would not
 *     if it moved inside.
 *   • `PlatformSettingsProvider` stays inside `App.jsx`. It wraps only part of
 *     the routed tree, so hoisting it here would change which components can
 *     read it as well as when it mounts. (CLAUDE.md listed it as a `main.jsx`
 *     provider for months; it never was.)
 *   • The context modules themselves stay in `src/contexts/`. §12 sends them
 *     to this directory and they cannot come: 294 files under `src/features/`
 *     import them, and a feature may not import `src/app/**` — see the block
 *     recorded in `./index.js`. This component is the half of §12's
 *     requirement that IS reachable today, and it is reachable precisely
 *     because nothing under `features/` imports it: only `main.jsx` does, and
 *     the src root is the legacy layer, which may import anything.
 */

import { HelmetProvider } from 'react-helmet-async'
import { AuthProvider } from '../../contexts/AuthContext'
import { DataSaverProvider } from '../../contexts/DataSaverContext'
import { NotificationProvider } from '../../contexts/NotificationContext'
import { ThemeProvider } from '../../contexts/ThemeContext'
import { OfflineProvider } from '../../offline'
import { ToastProvider } from '../../shared/components/Toast'

export default function AppProviders({ children }) {
  return (
    <HelmetProvider>
      <ThemeProvider>
        <DataSaverProvider>
          <OfflineProvider>
            <AuthProvider>
              <ToastProvider>
                <NotificationProvider>
                  {children}
                </NotificationProvider>
              </ToastProvider>
            </AuthProvider>
          </OfflineProvider>
        </DataSaverProvider>
      </ThemeProvider>
    </HelmetProvider>
  )
}
