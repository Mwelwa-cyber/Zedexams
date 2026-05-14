import { initializeApp } from 'firebase/app'
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check'
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  indexedDBLocalPersistence,
  GoogleAuthProvider,
} from 'firebase/auth'
import {
  getFirestore,
  enableMultiTabIndexedDbPersistence,
} from 'firebase/firestore'
import { getMessaging } from 'firebase/messaging'
import { getStorage } from 'firebase/storage'
import { isNativePlatform } from '../utils/runtime'

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId:     import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
}

const app = initializeApp(firebaseConfig)

export const auth    = getAuth(app)
export const db      = getFirestore(app)
export const storage = getStorage(app)

export const googleProvider = new GoogleAuthProvider()
googleProvider.setCustomParameters({ prompt: 'select_account' })

// Persistent auth on every platform: learners and teachers stay signed in
// across browser restarts and app relaunches. Closing the tab or killing
// the Capacitor wrapper no longer ends the session — they were complaining
// about having to sign in repeatedly. Web uses browserLocalPersistence
// (IndexedDB-backed, falls back to localStorage); native uses
// indexedDBLocalPersistence so the wrapper relaunch path keeps the session.
export function applyAuthPersistence() {
  const persistence = isNativePlatform()
    ? indexedDBLocalPersistence
    : browserLocalPersistence
  return setPersistence(auth, persistence).catch((e) => {
    console.error('Failed to set auth persistence:', e)
  })
}

applyAuthPersistence()

// ── App Check (audit B3) ──────────────────────────────────────────────
// Mints a short-lived attestation token the SDK forwards to Firestore,
// Storage, and callable Cloud Functions on every request. Server side
// rejects (or, for now, just logs) calls without one — closes the
// scraping vector on AI endpoints that cost real money.
//
// Web: reCAPTCHA v3 with a public site key. Silent — no checkbox or
// challenge — unless the score drops below the configured threshold,
// at which point the token mint fails and the gated call falls back
// to whatever the server's enforce mode is.
//
// Native (Capacitor / Android, audit B3 follow-up): Play Integrity via
// `@capacitor-firebase/app-check`. The native plugin handles the
// integrity-check round-trip with Google Play Services and surfaces
// tokens through the Firebase JS SDK's CustomProvider hook so all
// outbound Firestore/Storage/Functions calls from the WebView are
// attested without any JS-level token plumbing.
//
// IMPORTANT: the npm package is intentionally NOT bundled here. To
// activate Play Integrity, the operator runs:
//   npm install @capacitor-firebase/app-check
//   npx cap sync android
// + completes the Firebase Console / Play Console setup documented
// in docs/B3-PLAY-INTEGRITY-SETUP.md. Until then the runtime lookup
// returns null and native traffic stays unattested — the same
// soft-fail pattern as Sentry's DSN gating.
//
// Plugin lookup uses `Capacitor.Plugins.FirebaseAppCheck` (runtime
// registry) rather than `await import('@capacitor-firebase/app-check')`
// because the latter forces Rollup to resolve the specifier at build
// time and runs the plugin's module-load code — both of which caused
// real problems (build failures when the package was missing, white-
// screen on phone when it was present but had a peer-dep mismatch).
// The runtime registry is what Capacitor populates from the native
// side after `cap sync`, so it's the source of truth anyway.
//
// iOS support (DeviceCheck / App Attest) lands in a future PR if
// the iOS wrapper ever ships.
//
// DEV: setting `self.FIREBASE_APPCHECK_DEBUG_TOKEN = true` BEFORE
// initializeAppCheck logs a debug token to the console; that token
// must be registered in Firebase Console → App Check → Apps → manage
// debug tokens. Without that, the dev server can't mint legitimate
// attestation tokens.
const APPCHECK_RECAPTCHA_KEY = import.meta.env.VITE_FIREBASE_APPCHECK_RECAPTCHA_KEY

async function initAppCheck() {
  if (typeof window === 'undefined') return

  // Native (Capacitor) path — Play Integrity via the Capacitor plugin.
  //
  // Instead of `await import('@capacitor-firebase/app-check')` — which
  // requires the npm package to be in node_modules for the web build to
  // even resolve the specifier — we look the plugin up at runtime in
  // Capacitor's `Plugins` registry. The native side (`npx cap sync
  // android`) auto-registers `FirebaseAppCheck` there when the package
  // is installed, and the registry is undefined-safe when it isn't.
  // This lets the web build stay package-agnostic AND avoids running
  // the plugin's web-shim module-load code (which caused a white
  // screen earlier — possibly a Capacitor 7 / 8 peer-dep clash with
  // the codex branch).
  if (isNativePlatform()) {
    let FirebaseAppCheck = null
    try {
      // Capacitor exposes registered plugins via `Capacitor.Plugins`.
      // We import the runtime object lazily inside the conditional so
      // a fresh web tab doesn't pay the import cost.
      const { Capacitor } = await import('@capacitor/core').catch(() => ({}))
      FirebaseAppCheck = Capacitor?.Plugins?.FirebaseAppCheck || null
    } catch (err) {
      console.warn('[appCheck] @capacitor/core import failed:', err?.message || err)
      return
    }
    if (!FirebaseAppCheck) {
      // Plugin not registered — operator hasn't run `npm install
      // @capacitor-firebase/app-check && npx cap sync android` yet,
      // or the package isn't in node_modules for this build. Native
      // traffic continues unattested. See docs/B3-PLAY-INTEGRITY-SETUP.md.
      console.info('[appCheck] FirebaseAppCheck plugin not registered; native traffic unattested')
      return
    }
    try {
      await FirebaseAppCheck.initialize({
        isTokenAutoRefreshEnabled: true,
      })
    } catch (err) {
      console.warn('[appCheck] native init failed:', err?.message || err)
    }
    return
  }

  // Web path — reCAPTCHA v3. Gated on the public site key being set
  // so a build that hasn't been configured silently no-ops rather
  // than crashing on init.
  if (!APPCHECK_RECAPTCHA_KEY) return
  if (import.meta.env.DEV) {
    // Must be set before initializeAppCheck to take effect.
     
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = true
  }
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(APPCHECK_RECAPTCHA_KEY),
      // Auto-refresh tokens behind the scenes; the SDK handles it.
      isTokenAutoRefreshEnabled: true,
    })
  } catch (err) {
    // initializeAppCheck throws if called twice (HMR + StrictMode);
    // safe to swallow.
    console.warn('[appCheck] init failed (probably double-init):', err?.message || err)
  }
}

// Fire-and-forget. Failures inside initAppCheck never reject because
// we catch every path internally.
initAppCheck()

// Firestore offline persistence (audit A1.1). Cached reads survive
// reload/refresh, writes queue while offline and replay on reconnect.
// Multi-tab variant lets learners with several tabs open share the
// same cache instead of fighting over a "primary" tab.
//
// Failures are non-fatal — Safari < 15, browser private modes, and
// quota-exceeded all surface here. The app still works, just without
// the cache-backed offline experience.
enableMultiTabIndexedDbPersistence(db).catch((err) => {
  if (err?.code === 'failed-precondition') {
    // Another tab already has persistence — multi-tab variant should
    // prevent this, but fall through gracefully if the browser is old.
    console.warn('Firestore persistence: multiple tabs without multi-tab support')
  } else if (err?.code === 'unimplemented') {
    // Browser doesn't support IndexedDB persistence (Safari < 15, etc.)
    console.warn('Firestore persistence: browser unsupported')
  } else {
    console.warn('Firestore persistence init failed:', err)
  }
})

// Firebase Cloud Messaging — initialised only when the browser actually
// supports web push (Service Worker + PushManager APIs) and we're not
// inside the Capacitor wrapper. The wrapper uses the native push plugin
// in a separate code path. `messaging` stays null on iOS Safari < 16.4,
// private-mode browsers, and Capacitor — callers in src/utils/fcm.js
// guard on the null and degrade gracefully (the permission prompt
// simply never renders).
let messagingInstance = null
try {
  if (
    typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && !isNativePlatform()
  ) {
    messagingInstance = getMessaging(app)
  }
} catch (err) {
  console.warn('Firebase Messaging init failed:', err)
}
export const messaging = messagingInstance

export default app
