/**
 * Web push (audit A5.1) — token registration helpers.
 *
 * Three things callers need:
 *   - pushPermission()             — current Notification.permission state
 *   - requestPushPermission(uid)   — prompt + register-on-grant
 *   - refreshTokenIfGranted(uid)   — silent re-register on sign-in if
 *                                    the user already granted previously
 *
 * The actual daily-reminder push is sent server-side by a Cloud
 * Function (A5.2). This file only handles the client side: getting a
 * VAPID-signed token and persisting it to users/{uid}.fcmTokens so the
 * Function knows where to deliver.
 *
 * Capacitor / iOS-Safari < 16.4 / private mode return 'unsupported'
 * across the board and every helper short-circuits to a no-op.
 */

import { getToken, onMessage } from 'firebase/messaging'
import { arrayUnion, doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db, messaging } from '../../firebase/config'
import { isNativePlatform } from '../../utils/runtime'
import { capture } from '../../utils/analytics'
import {
  isNativePushSupported,
  nativePushPermissionSync,
  requestNativePushPermission,
  refreshNativeTokenIfGranted,
  clearNativePushUser,
} from './nativePush'

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY

// One-shot guard so the "VAPID key missing" diagnostic logs once, not on every
// sign-in / settings toggle.
let warnedNoVapid = false

/**
 * True if this device can mint FCM tokens. On native (Capacitor) that means the
 * @capacitor-firebase/messaging plugin is registered; on the web it means the
 * Firebase Messaging SDK initialised (which requires isSupported() to have
 * resolved true — see src/firebase/config.js).
 */
export async function isPushSupported() {
  if (isNativePlatform()) return isNativePushSupported()
  if (typeof window === 'undefined') return false
  const m = await messaging
  return Boolean(m)
}

/**
 * Current permission state — extends the Notification API's tri-state
 * with 'unsupported' so callers can distinguish "the user can choose"
 * from "the platform won't even let us ask". On native this reads the cached
 * plugin permission (primed on sign-in by refreshTokenIfGranted).
 */
export async function pushPermission() {
  if (isNativePlatform()) return nativePushPermissionSync()
  if (!(await isPushSupported())) return 'unsupported'
  return Notification.permission // 'default' | 'granted' | 'denied'
}

/**
 * Get the current FCM token and append it to users/{uid}.fcmTokens.
 * Idempotent: arrayUnion dedupes if the same token is already present.
 * Stale tokens for old browser installs accumulate harmlessly — A5.2's
 * Cloud Function prunes any token that returns NotRegistered when sent.
 */
export async function registerToken(uid) {
  if (!(await isPushSupported()) || !uid) return null
  if (!VAPID_KEY) {
    // The single most common reason web push is silently dead in production:
    // the VAPID public key isn't configured, so no FCM token can ever be
    // minted. Warn once so it's diagnosable from the console instead of a
    // no-op. Fix: set VITE_FIREBASE_VAPID_KEY (Firebase Console → Cloud
    // Messaging → Web Push certificates → Generate key pair) and rebuild.
    if (!warnedNoVapid) {
      warnedNoVapid = true
      console.warn(
        '[push] VITE_FIREBASE_VAPID_KEY is not set — web push is disabled and no FCM token can be minted.',
      )
    }
    // Observability: lets /admin PostHog see *why* web push isn't working in
    // production (no token can mint without the key) rather than silence.
    capture('push_token_failed', { platform: 'web', reason: 'no_vapid_key' })
    return null
  }
  try {
    const m = await messaging
    const token = await getToken(m, { vapidKey: VAPID_KEY })
    if (!token) {
      capture('push_token_failed', { platform: 'web', reason: 'no_token' })
      return null
    }
    await updateDoc(doc(db, 'users', uid), {
      fcmTokens: arrayUnion(token),
      fcmTokensUpdatedAt: serverTimestamp(),
    })
    // The key "web push is actually working" signal — fires once per successful
    // mint (sign-in / opt-in). No token value is sent, only the platform.
    capture('push_token_registered', { platform: 'web' })
    return token
  } catch (err) {
    // Common causes: SW not yet registered, VAPID mismatch, browser
    // blocked the request. None warrant a UI error — we silently
    // degrade and try again on the next sign-in via refreshTokenIfGranted.
    console.warn('[push] getToken failed:', err)
    capture('push_token_failed', { platform: 'web', reason: 'exception' })
    return null
  }
}

/**
 * Ask the OS for notification permission and, on grant, register the FCM token.
 *
 * Returns 'granted' | 'denied' | 'unsupported' | 'error'. Note 'error':
 * permission was granted but no FCM token could actually be minted (almost
 * always a missing VITE_FIREBASE_VAPID_KEY, sometimes an unreachable service
 * worker). Enabling push is only real once a token exists — otherwise the
 * server has nowhere to deliver — so we must NOT report success in that case.
 * Callers key their success/error UX on the exact return value.
 */
export async function requestPushPermission(uid) {
  if (isNativePlatform()) return requestNativePushPermission(uid)
  if (!(await isPushSupported())) return 'unsupported'
  let result = 'denied'
  try {
    result = await Notification.requestPermission()
  } catch {
    // Some browsers return a synchronous boolean instead of a promise.
    // The Notification API is wonky on older Edge / Samsung Internet.
    result = Notification.permission
  }
  if (result === 'granted') {
    const token = await registerToken(uid)
    // Granted but token-mint failed → surface as 'error' so the UI doesn't
    // claim push is on when nothing will ever arrive.
    if (!token) return 'error'
  } else if (result === 'denied') {
    // Distinguishes "user declined" from "config broken" in the PostHog funnel.
    capture('push_permission_denied', { platform: 'web' })
  }
  return result
}

/**
 * If the user already granted permission in a previous session, get a
 * fresh FCM token and re-register it (tokens rotate periodically and
 * old browser installs may have stale ones). Never asks — silent.
 * Called by AuthContext on every sign-in.
 */
export async function refreshTokenIfGranted(uid) {
  if (isNativePlatform()) return refreshNativeTokenIfGranted(uid)
  if ((await pushPermission()) !== 'granted' || !uid) return null
  return registerToken(uid)
}

/**
 * Called on sign-out. On native, forgets the uid the FCM token-rotation
 * listener persists against so a token that rotates while signed out (shared
 * device) isn't re-attributed to the user who just left. No-op on the web,
 * which has no persistent rotation listener.
 */
export function clearPushUser() {
  if (isNativePlatform()) clearNativePushUser()
}

/**
 * Foreground message handler — fires only while the tab is in focus.
 * Background notifications are handled by public/firebase-messaging-sw.js
 * which arrives in A5.3. Returns an unsubscribe function.
 */
export function onForegroundMessage(handler) {
  // Native foreground display is owned by the OS / plugin, and there is no web
  // `messaging` instance to subscribe to inside the Capacitor WebView — the
  // in-app bell still updates live from the Firestore feed listener. Bail here
  // so we never call onMessage() with a null messaging instance.
  if (isNativePlatform()) return () => {}
  // Return an unsubscribe function immediately; subscribe asynchronously once
  // the messaging Promise resolves so callers get a stable () => void handle.
  let unsubscribe = () => {}
  messaging
    .then((m) => {
      if (!m) return
      unsubscribe = onMessage(m, handler)
    })
    .catch(() => {})
  return () => unsubscribe()
}
