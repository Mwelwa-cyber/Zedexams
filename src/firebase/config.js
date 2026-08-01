import { initializeApp } from 'firebase/app'
import { initializeAppCheck, ReCaptchaEnterpriseProvider, CustomProvider, getToken } from 'firebase/app-check'
import { resilientGetToken, APPCHECK_PLACEHOLDER_TOKEN } from './appCheckResilient'
import { resolveWriteAttestation, WRITE_BLOCKED_MESSAGE } from './appCheckWriteGate'
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  indexedDBLocalPersistence,
  GoogleAuthProvider,
} from 'firebase/auth'
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore'
import { getMessaging, isSupported } from 'firebase/messaging'
import { getStorage } from 'firebase/storage'
import { isNativePlatform } from '../utils/runtime'
import { resolveAuthDomain } from './authDomain'

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  // On the production custom domain the page's own hostname serves the
  // /__/auth/* helpers, so the Google popup shows "zedexams.com" instead of
  // the env's firebaseapp.com domain — see authDomain.js for the rules.
  authDomain:        resolveAuthDomain(
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    typeof window !== 'undefined' ? window.location.hostname : ''
  ),
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId:     import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
}

// Fail loudly and specifically when the build shipped without a usable
// Firebase web config. Without this, the first symptom is getAuth() throwing
// an opaque `auth/invalid-api-key` synchronously at module load — which, since
// it happens before <ErrorBoundary> mounts, white-screens the whole app with
// no clue as to why. Naming the missing keys turns a blank page + cryptic
// console error into an actionable one. The index.html boot watchdog still
// renders the user-facing recovery UI; this is purely operator diagnostics.
// (Web Firebase config is public by design, so listing the keys leaks nothing.)
const REQUIRED_CONFIG_KEYS = ['apiKey', 'authDomain', 'projectId', 'appId']
const missingConfigKeys = REQUIRED_CONFIG_KEYS.filter((k) => !firebaseConfig[k])
if (missingConfigKeys.length) {
  throw new Error(
    `[firebase] Missing required Firebase web config: ${missingConfigKeys
      .map((k) => `VITE_FIREBASE_${k.replace(/[A-Z]/g, (c) => '_' + c).toUpperCase()}`)
      .join(', ')}. The app cannot start. Check the deploy's VITE_FIREBASE_* environment variables.`
  )
}

const app = initializeApp(firebaseConfig)

export const auth    = getAuth(app)
// Firestore offline persistence (audit A1.1) is configured here via the
// modern cache API rather than the deprecated
// enableMultiTabIndexedDbPersistence(). Cached reads survive reload/
// refresh, writes queue while offline and replay on reconnect, and the
// multi-tab manager lets several open tabs share one cache instead of
// fighting over a "primary" tab. Unsupported environments (Safari < 15,
// private mode, quota-exceeded) degrade to memory cache automatically —
// no try/catch needed.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
})
export const storage = getStorage(app)

// Firebase Performance Monitoring — DEFERRED off the cold-start path.
//
// getPerformance(app) pulls the perf SDK into the eager bundle AND starts
// auto-instrumentation (a PerformanceObserver + a network beacon) synchronously
// at module load, competing with React's first mount on cold mobile loads — pure
// overhead for the public landing page, which reports nothing actionable. Nothing
// in the app imports `perf`, so we dynamic-import + init it on the first idle slot
// after paint (mirroring the App Check deferral). This moves the perf SDK out of
// the eager `firebase-vendor` chunk into its own lazy chunk and frees the main
// thread during LCP. `perf` stays exported (null until init) for compatibility.
export let perf = null
if (typeof window !== 'undefined') {
  // A plain 2s setTimeout (not requestIdleCallback): perf monitoring is entirely
  // non-urgent, and this keeps the deferral independent of the App Check idle
  // scheduling (which tests capture) so the two never interleave.
  setTimeout(() => {
    import('firebase/performance')
      .then(({ getPerformance }) => { perf = getPerformance(app) })
      .catch((err) => console.warn('[perf] deferred init failed:', err?.message || err))
  }, 2000)
}

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
// Web: reCAPTCHA Enterprise with a public site key. Silent — no
// checkbox or challenge — unless the score drops below the configured
// threshold, at which point the token mint fails and the gated call
// falls back to whatever the server's enforce mode is.
//
// Native (Capacitor / Android, audit B3 follow-up): Play Integrity via
// `@capacitor-firebase/app-check` (a project dependency since 2026-07).
// The native plugin handles the integrity-check round-trip with Google
// Play Services; a CustomProvider bridge below feeds its tokens into the
// Firebase JS SDK so all outbound Firestore/Storage/Functions calls from
// the WebView are attested. Attestation also needs the Firebase Console /
// Play Console setup documented in docs/B3-PLAY-INTEGRITY-SETUP.md —
// until that's done the plugin has no provider, token minting fails, and
// the fail-open bridge sends the placeholder token (recorded server-side
// as unattested, same as before).
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

// Captured App Check handles so getAppCheckToken() can mint a token for the
// raw-fetch HTTP/SSE endpoints. Firebase callables attach an App Check token
// automatically; a plain fetch() does not, so those endpoints need the header
// set by hand. Null until initAppCheck() runs (or when App Check is unconfigured).
// jsAppCheck is the Firebase JS SDK instance (set on BOTH platforms — on
// native it's the CustomProvider bridge below); nativeAppCheck is the raw
// Capacitor plugin handle.
let jsAppCheck = null
let nativeAppCheck = null
// One-shot guard. A second initializeAppCheck() (or a second reCAPTCHA render)
// makes Google's reCAPTCHA SDK throw "reCAPTCHA placeholder element must be
// empty" ASYNCHRONOUSLY — outside the try/catch below — which surfaces as an
// unhandled error in Sentry. The try/catch only catches the synchronous
// "already initialized" throw, so we also hard-gate re-entry here: App Check is
// initialised exactly once per page, even if initAppCheck() is ever reached
// twice (bfcache restore, a stray re-import, future callers).
let appCheckInitStarted = false

// Explicit, awaitable App Check readiness signal.
//
// App Check init is deliberately deferred off the cold-start path (see
// scheduleAppCheckInit), so at boot there is a window where protected requests
// can race ahead of the first token — the documented cause of intermittent 403s
// once enforcement is enabled. Callers that want to hold a protected request
// until attestation has SETTLED can now `await whenAppCheckReady()` instead of
// guessing. It resolves (never rejects) when init finishes — success OR a
// handled failure — or after a bounded timeout so a caller never hangs (e.g. a
// web build with no reCAPTCHA key never initialises). This does NOT change the
// existing fail-open token path: getAppCheckToken() still returns '' when no
// token is available; readiness is an opt-in gate, not a new hard dependency.
let appCheckReadyResolve
const appCheckReadyPromise = new Promise((resolve) => { appCheckReadyResolve = resolve })
let appCheckReadySettled = false
function markAppCheckReady() {
  if (appCheckReadySettled) return
  appCheckReadySettled = true
  try { appCheckReadyResolve(getAppCheckClientState()) } catch { appCheckReadyResolve({ initialized: false }) }
}

async function initAppCheck() {
  if (typeof window === 'undefined') return
  if (appCheckInitStarted) return
  appCheckInitStarted = true

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
      nativeAppCheck = FirebaseAppCheck
    } catch (err) {
      console.warn('[appCheck] native init failed:', err?.message || err)
      return
    }
    // Bridge native (Play Integrity) tokens into the Firebase JS SDK. The
    // Capacitor plugin above only configures the NATIVE Firebase SDK — the
    // JS SDK running inside the WebView, which issues every Firestore /
    // Storage / callable request, knows nothing about it until
    // initializeAppCheck() is called with a provider. Without this bridge
    // native traffic reaches the backend with no X-Firebase-AppCheck header
    // at all — the "every callable shows missing" signature on
    // /admin/app-check. resilientGetToken gives the bridge the same
    // fail-open guarantee as the web path: an unconfigured or hung Play
    // Integrity yields a short-lived placeholder instead of stalling
    // Auth/Firestore (see appCheckResilient.js).
    try {
      const provider = new CustomProvider({
        getToken: () => resilientGetToken(async () => {
          const res = await FirebaseAppCheck.getToken()
          if (!res || !res.token) return null
          return {
            token: res.token,
            // Some plugin platforms omit expireTimeMillis; a short TTL just
            // makes the SDK re-request sooner, which is safe.
            expireTimeMillis: res.expireTimeMillis || Date.now() + 60_000,
          }
        }),
      })
      jsAppCheck = initializeAppCheck(app, {
        provider,
        isTokenAutoRefreshEnabled: true,
      })
    } catch (err) {
      console.warn('[appCheck] native JS-SDK bridge init failed:', err?.message || err)
    }
    return
  }

  // Web path — reCAPTCHA Enterprise. Gated on the public site key being
  // set so a build that hasn't been configured silently no-ops rather
  // than crashing on init.
  if (!APPCHECK_RECAPTCHA_KEY) return
  if (import.meta.env.DEV) {
    // Must be set before initializeAppCheck to take effect.
     
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = true
  }
  try {
    // Fail-open reCAPTCHA (fixes the 2026-07-01 sign-in outage, originally on
    // the reCAPTCHA v3 provider; the wrapper is provider-agnostic and now guards
    // Enterprise the same way). The SDK attaches an App Check token to EVERY
    // Auth + Firestore request even in Monitoring mode, so when reCAPTCHA crashes
    // ("placeholder element must be empty") or hangs ("reCAPTCHA Timeout") the
    // token never resolves and the request stalls — surfacing as
    // auth/network-request-failed and Firestore "backend didn't respond within
    // 10s" for many users at once. We wrap the reCAPTCHA Enterprise provider in a
    // CustomProvider whose getToken races the real fetch against a short timeout
    // and NEVER rejects (see appCheckResilient.js): a stuck reCAPTCHA yields a
    // short-lived placeholder so sign-in proceeds, while a healthy reCAPTCHA
    // passes its real token through untouched.
    //
    // CustomProvider does not forward initialize() to the wrapped provider, so
    // we initialize the ReCaptchaEnterpriseProvider ourselves, lazily on first
    // token request and guarded against a synchronous throw.
    //
    // The render itself can still die with "reCAPTCHA placeholder element must
    // be empty": the SDK renders into a div with the FIXED id
    // `fire_app_check_${app.name}`, and grecaptcha resolves that id to the
    // FIRST matching node — so any stale or duplicate container (bfcache-
    // restored DOM, an extension cloning nodes, a previous half-finished init)
    // makes the render throw ASYNCHRONOUSLY inside grecaptcha.ready(), where no
    // try/catch of ours can reach it. Worse than the noise: the SDK's internal
    // `initialized` deferred never resolves after that throw, so EVERY later
    // mint in the session times out into a placeholder — the session stays
    // unattested until reload. Two defences:
    //   1. remove any pre-existing container before initialize, so the SDK's
    //      fresh div is the only match for the id;
    //   2. if minting is still stuck on placeholders well after init (a broken
    //      render never self-heals), clean up and re-initialize — bounded and
    //      spaced so a genuinely-down reCAPTCHA can't cause an init loop.
    const removeStaleRecaptchaContainers = () => {
      try {
        document
          .querySelectorAll(`div[id="fire_app_check_${app.name}"]`)
          .forEach((node) => node.remove())
      } catch { /* DOM cleanup is best-effort */ }
    }
    const RECAPTCHA_RECOVERY_MAX_ATTEMPTS = 2
    const RECAPTCHA_RECOVERY_MIN_AGE_MS = 60_000
    const recaptcha = new ReCaptchaEnterpriseProvider(APPCHECK_RECAPTCHA_KEY)
    let recaptchaInitialized = false
    let recaptchaInitAt = 0
    let consecutivePlaceholders = 0
    let recoveryAttempts = 0
    const provider = new CustomProvider({
      getToken: async () => {
        if (!recaptchaInitialized) {
          recaptchaInitialized = true
          recaptchaInitAt = Date.now()
          removeStaleRecaptchaContainers()
          try { recaptcha.initialize(app) } catch { /* redundant init is harmless */ }
        }
        const res = await resilientGetToken(() => recaptcha.getToken())
        if (res.token !== APPCHECK_PLACEHOLDER_TOKEN) {
          consecutivePlaceholders = 0
          return res
        }
        consecutivePlaceholders += 1
        // Two consecutive placeholder cycles (~2 min at the 60s placeholder
        // TTL) a minute or more after init is a stuck widget, not a slow first
        // script load — re-initialize so the session regains real attestation.
        if (
          consecutivePlaceholders >= 2 &&
          recoveryAttempts < RECAPTCHA_RECOVERY_MAX_ATTEMPTS &&
          Date.now() - recaptchaInitAt >= RECAPTCHA_RECOVERY_MIN_AGE_MS
        ) {
          recoveryAttempts += 1
          recaptchaInitAt = Date.now()
          consecutivePlaceholders = 0
          removeStaleRecaptchaContainers()
          try { recaptcha.initialize(app) } catch { /* same guard as first init */ }
        }
        return res
      },
    })
    jsAppCheck = initializeAppCheck(app, {
      provider,
      // Auto-refresh tokens behind the scenes; the SDK handles it. This also
      // re-requests a real token soon after reCAPTCHA recovers from a placeholder.
      isTokenAutoRefreshEnabled: true,
    })
  } catch (err) {
    // initializeAppCheck throws if called twice (HMR + StrictMode);
    // safe to swallow.
    console.warn('[appCheck] init failed (probably double-init):', err?.message || err)
  }
}

/**
 * Mint a current App Check token for manual attachment to the HTTP/SSE
 * endpoints that a raw fetch() reaches (Zed chat, the teacher streams) — those
 * don't get the automatic token a Firebase callable would. Never throws and
 * never blocks: returns '' when App Check isn't initialised yet (e.g. the
 * deferred web init hasn't run, or no reCAPTCHA key is configured) or token
 * minting fails, so the caller just omits the header (the server records it as
 * "missing", exactly as today — no regression).
 *
 * @returns {Promise<string>}
 */
export async function getAppCheckToken() {
  try {
    if (isNativePlatform()) {
      if (!nativeAppCheck) return ''
      const res = await nativeAppCheck.getToken()
      return (res && res.token) || ''
    }
    if (!jsAppCheck) return ''
    const res = await getToken(jsAppCheck, /* forceRefresh */ false)
    return (res && res.token) || ''
  } catch (err) {
    console.warn('[appCheck] getAppCheckToken failed:', err?.message || err)
    return ''
  }
}

/**
 * Gate a Cloud Storage WRITE on GENUINE attestation.
 *
 * App Check enforcement is ON for Storage (2026-08). Reads are unaffected —
 * a download URL carrying a valid download token serves without App Check
 * being consulted, which is why images keep rendering — but every SDK
 * operation (uploadBytes / getDownloadURL / deleteObject / listAll) is
 * rejected unless it carries a real token:
 *   401 {"error":{"code":401,"message":"Firebase App Check token is invalid."}}
 *
 * The fail-open placeholder from appCheckResilient.js is exactly such an
 * unrecognised token, and the SDK caches it for its whole 60s TTL, so
 * without this gate one reCAPTCHA stall would refuse every upload for a
 * minute and report it as `storage/unauthorized` — a permissions error the
 * teacher cannot act on. Awaiting readiness first also closes the
 * deferred-init race (scheduleAppCheckInit runs on an idle callback, so an
 * upload issued in the first couple of seconds could otherwise outrun the
 * first mint).
 *
 * Never throws. See assertStorageWriteAttested() for the throwing form.
 *
 * @returns {Promise<{ok: boolean, reason: string}>}
 */
export async function ensureStorageWriteAttestation() {
  await whenAppCheckReady()
  return resolveWriteAttestation({
    configured: Boolean(jsAppCheck || nativeAppCheck),
    placeholderToken: APPCHECK_PLACEHOLDER_TOKEN,
    mintToken: async (forceRefresh) => {
      if (isNativePlatform()) {
        if (!nativeAppCheck) return ''
        const res = await nativeAppCheck.getToken({ forceRefresh: Boolean(forceRefresh) })
        return (res && res.token) || ''
      }
      if (!jsAppCheck) return ''
      const res = await getToken(jsAppCheck, Boolean(forceRefresh))
      return (res && res.token) || ''
    },
  })
}

/**
 * ensureStorageWriteAttestation() in throwing form, for the upload paths.
 * The message is about the DEVICE CHECK, not about permission: the user is
 * entitled to upload, and retrying genuinely works once a real token mints.
 *
 * @throws {Error & {code: 'appcheck/unattested', reason: string}}
 */
export async function assertStorageWriteAttested() {
  const verdict = await ensureStorageWriteAttestation()
  if (verdict.ok) return verdict
  const err = new Error(WRITE_BLOCKED_MESSAGE)
  err.code = 'appcheck/unattested'
  err.reason = verdict.reason
  throw err
}

/**
 * Client-side App Check state for the /admin/app-check "this device"
 * self-test. Answers, from inside the deployed bundle, the questions the
 * server-side counters can't: did this build ship with a reCAPTCHA site key
 * at all, and did App Check init actually run on this platform?
 */
export function getAppCheckClientState() {
  return {
    native: isNativePlatform(),
    recaptchaKeyConfigured: Boolean(APPCHECK_RECAPTCHA_KEY),
    initialized: Boolean(jsAppCheck || nativeAppCheck),
  }
}

/**
 * Await App Check readiness. Resolves with getAppCheckClientState() once init
 * has settled (success or handled failure), or after `timeoutMs` so a caller is
 * never blocked indefinitely. Never rejects. Opt-in — use it before issuing a
 * protected request where you'd rather wait a beat for a token than race ahead
 * of the first mint and eat a 403.
 *
 * @param {number} [timeoutMs=3000]
 * @returns {Promise<{initialized:boolean, native?:boolean, recaptchaKeyConfigured?:boolean}>}
 */
export function whenAppCheckReady(timeoutMs = 3000) {
  return Promise.race([
    appCheckReadyPromise,
    new Promise((resolve) => {
      const ms = Number.isFinite(timeoutMs) && timeoutMs >= 0 ? timeoutMs : 3000
      setTimeout(() => resolve(getAppCheckClientState()), ms)
    }),
  ])
}

// Defer App Check off the cold-start critical path. On web, initAppCheck()
// downloads + runs Google's reCAPTCHA Enterprise script (recaptcha/enterprise.js),
// whose main-thread work was competing with React's first mount and inflating real-
// user FCP/LCP on cold mobile loads (p75 LCP ~10s on /login). Scheduling it for
// the first idle slot after paint frees the main thread for the app to render
// first, then attestation initialises a beat later.
//
// Why this is safe: for the products still in Monitoring mode the server LOGS
// unattested calls rather than rejecting them, and even with eager init the
// earliest boot requests already raced ahead of the async token mint, so the
// security posture is unchanged. The hard `timeout` cap guarantees init still
// runs within a couple of seconds even on a busy thread, so tokens are ready
// well before any user-driven AI call. Failures inside initAppCheck never
// reject (every path is caught internally).
//
// STORAGE IS ENFORCED (2026-08), so the race this comment used to wave off is
// real for Storage SDK calls issued during the first idle slot. Rather than
// un-defer init — which would put reCAPTCHA back on the LCP critical path for
// every visitor, including the ones who never touch Storage — the Storage
// WRITE paths await whenAppCheckReady() through assertStorageWriteAttested().
// A Storage READ needs no such gate: the download URL it produces carries its
// own token and App Check is not consulted on that path.
function scheduleAppCheckInit() {
  // Resolve the readiness promise once init settles, whatever path it takes
  // (initAppCheck never rejects — every failure is caught internally).
  const run = () => Promise.resolve(initAppCheck()).finally(markAppCheckReady)
  if (typeof window === 'undefined') { run(); return }
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(() => run(), { timeout: 2500 })
  } else {
    setTimeout(() => run(), 1000)
  }
}
scheduleAppCheckInit()

// Firebase Cloud Messaging — initialised only when Firebase's own
// isSupported() confirms the browser has every required API (Service
// Worker, PushManager, IndexedDB, Notification, etc.) and we're not
// inside the Capacitor wrapper. Using isSupported() instead of manual
// API-presence checks prevents the messaging/unsupported-browser error
// that was thrown on feature-phone browsers and headless environments
// that expose serviceWorker/PushManager stubs but lack the full API set.
// `messaging` resolves to null on iOS Safari < 16.4, private-mode
// browsers, and Capacitor — callers in src/utils/fcm.js await this
// Promise and degrade gracefully (the permission prompt simply never renders).
export const messaging = (async () => {
  try {
    if (isNativePlatform() || typeof window === 'undefined') return null
    const supported = await isSupported()
    if (!supported) return null
    return getMessaging(app)
  } catch (err) {
    console.warn('Firebase Messaging init failed:', err)
    return null
  }
})()

export default app
