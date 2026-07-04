import { Capacitor } from '@capacitor/core'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../firebase/config'
import { isNativePlatform } from './runtime'

// reCAPTCHA Enterprise action scoring for sensitive flows (login / signup / …).
//
// This is SEPARATE from Firebase App Check (src/firebase/config.js), which
// attests "this is a real ZedExams client" on every backend call. reCAPTCHA
// Enterprise answers a different question — "does THIS particular login attempt
// look like a bot?" — via a per-action token minted by the native Android SDK
// and scored server-side (functions/index.js → assessRecaptcha).
//
// FAIL-OPEN by design. Tokens are only minted on native Android; on web this
// returns null and callers proceed (browser traffic is already covered by App
// Check reCAPTCHA Enterprise). If the native plugin isn't registered, the SDK isn't
// warmed up yet, or the backend assessment errors, the result is 'skip' and
// the action proceeds. The ONLY verdict that should stop a flow is 'block'.

// Lazily created on first real use rather than at module load. The callable is
// only ever reached on native Android (web short-circuits to null before here),
// so deferring keeps `getFunctions(app, …)` — which needs an initialised
// Firebase app — out of the module-load path. That matters for jsdom unit tests
// that import Login/Register (and therefore this module) with a mocked
// firebase/config: no app is created, so an eager call would throw at import.
let assessRecaptchaCallable = null
function getAssessCallable() {
  if (!assessRecaptchaCallable) {
    const functions = getFunctions(app, 'us-central1')
    assessRecaptchaCallable = httpsCallable(functions, 'assessRecaptcha', {
      timeout: 20_000,
    })
  }
  return assessRecaptchaCallable
}

/**
 * Mint a reCAPTCHA Enterprise token for an action on native Android.
 * @param {string} action e.g. 'login', 'signup'
 * @returns {Promise<string|null>} token, or null on web / when unavailable
 */
export async function executeRecaptcha(action) {
  if (!isNativePlatform()) return null
  try {
    // Runtime plugin lookup (same pattern as the App Check native bridge in
    // firebase/config.js) so the web build stays package-agnostic — the plugin
    // is registered natively by MainActivity, not imported by the bundle.
    const plugin = Capacitor?.Plugins?.Recaptcha
    if (!plugin?.execute) return null
    const { token } = await plugin.execute({ action })
    return token || null
  } catch (err) {
    console.warn('[recaptcha] execute failed:', err?.message || err)
    return null
  }
}

/**
 * Full flow: mint a token natively, then have the backend score it. Always
 * resolves (never throws) — on any failure returns a 'skip' verdict so the
 * caller fails open.
 * @param {string} action
 * @returns {Promise<{verdict: string, score?: number|null, reason?: string}>}
 */
export async function assessAction(action) {
  const token = await executeRecaptcha(action)
  if (!token) return { verdict: 'skip', reason: 'no-token' }
  try {
    const { data } = await getAssessCallable()({ token, action })
    return data || { verdict: 'skip', reason: 'no-data' }
  } catch (err) {
    console.warn('[recaptcha] assessment failed:', err?.message || err)
    return { verdict: 'skip', reason: 'callable-error' }
  }
}

/**
 * The single decision a caller should gate on: block iff the backend returned a
 * definitive 'block' verdict. Everything else (allow / challenge / skip / any
 * error) proceeds.
 * @param {{verdict?: string}} result
 * @returns {boolean}
 */
export function shouldBlock(result) {
  return result?.verdict === 'block'
}
