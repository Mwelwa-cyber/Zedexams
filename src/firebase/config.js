import { initializeApp } from 'firebase/app'
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check'
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
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

// Web default is session-only persistence — closing the last tab/window
// ends the session. Combined with the idle timeout in AuthContext, this
// protects accounts on shared or stolen devices. When the user ticks
// "Remember me" on the login form we switch to browserLocalPersistence
// for that sign-in so the session survives a browser restart.
//
// Native (Capacitor): every relaunch of the wrapper destroys the WebView,
// which would log session-only users out every time they open the app.
// Always use IndexedDB-backed persistence there; the "Remember me" choice
// is irrelevant.
export function applyAuthPersistence(remember) {
  const persistence = isNativePlatform()
    ? indexedDBLocalPersistence
    : remember ? browserLocalPersistence : browserSessionPersistence
  return setPersistence(auth, persistence).catch((e) => {
    console.error('Failed to set auth persistence:', e)
  })
}

applyAuthPersistence(false)

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
// IMPORTANT: this PR ships the wiring; the npm package is NOT added
// here. To activate Play Integrity, the operator runs:
//   npm install @capacitor-firebase/app-check
//   npx cap sync android
// + completes the Firebase Console / Play Console setup steps
// documented in docs/B3-PLAY-INTEGRITY-SETUP.md. Until then the
// dynamic import fails silently and native traffic stays unattested
// — the same soft-fail pattern as Sentry's DSN gating.
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
  if (isNativePlatform()) {
    try {
      // The Capacitor App Check plugin is optional — listed in
      // .env.example as a step the operator runs (`npm install
      // @capacitor-firebase/app-check`). Constructing the module
      // specifier at runtime keeps Rollup from trying to resolve it
      // at build time, so the web build doesn't fail when the
      // package isn't installed. The `/* @vite-ignore */` is
      // belt-and-braces.
      const moduleId = ['@capacitor-firebase', 'app-check'].join('/')
      const mod = await import(/* @vite-ignore */ moduleId).catch(() => null)
      if (!mod?.FirebaseAppCheck) {
        // Plugin not installed yet — soft-fail. Native traffic continues
        // unattested until the operator completes the setup steps.
        console.info('[appCheck] @capacitor-firebase/app-check not installed; native traffic unattested')
        return
      }
      await mod.FirebaseAppCheck.initialize({
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
    // eslint-disable-next-line no-self-assign
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
