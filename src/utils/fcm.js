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
import { db, messaging } from '../firebase/config'
import { isNativePlatform } from './runtime'

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY

/** True if the browser can mint FCM tokens. */
export function isPushSupported() {
  if (isNativePlatform()) return false
  if (typeof window === 'undefined') return false
  if (!('Notification' in window)) return false
  if (!('serviceWorker' in navigator)) return false
  if (!('PushManager' in window)) return false
  return Boolean(messaging)
}

/**
 * Current permission state — extends the Notification API's tri-state
 * with 'unsupported' so callers can distinguish "the user can choose"
 * from "the platform won't even let us ask".
 */
export function pushPermission() {
  if (!isPushSupported()) return 'unsupported'
  return Notification.permission // 'default' | 'granted' | 'denied'
}

/**
 * Get the current FCM token and append it to users/{uid}.fcmTokens.
 * Idempotent: arrayUnion dedupes if the same token is already present.
 * Stale tokens for old browser installs accumulate harmlessly — A5.2's
 * Cloud Function prunes any token that returns NotRegistered when sent.
 */
export async function registerToken(uid) {
  if (!isPushSupported() || !VAPID_KEY || !uid) return null
  try {
    const token = await getToken(messaging, { vapidKey: VAPID_KEY })
    if (!token) return null
    await updateDoc(doc(db, 'users', uid), {
      fcmTokens: arrayUnion(token),
      fcmTokensUpdatedAt: serverTimestamp(),
    })
    return token
  } catch (err) {
    // Common causes: SW not yet registered, VAPID mismatch, browser
    // blocked the request. None warrant a UI error — we silently
    // degrade and try again on the next sign-in via refreshTokenIfGranted.
    console.warn('[push] getToken failed:', err)
    return null
  }
}

/**
 * Ask the OS for notification permission and, on grant, register the
 * FCM token. Returns the resulting permission state. Caller is
 * responsible for any UX (success toast, etc.) — the existing
 * <PushPermissionPrompt /> wraps this call.
 */
export async function requestPushPermission(uid) {
  if (!isPushSupported()) return 'unsupported'
  let result = 'denied'
  try {
    result = await Notification.requestPermission()
  } catch {
    // Some browsers return a synchronous boolean instead of a promise.
    // The Notification API is wonky on older Edge / Samsung Internet.
    result = Notification.permission
  }
  if (result === 'granted') {
    await registerToken(uid)
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
  if (pushPermission() !== 'granted' || !uid) return null
  return registerToken(uid)
}

/**
 * Foreground message handler — fires only while the tab is in focus.
 * Background notifications are handled by public/firebase-messaging-sw.js
 * which arrives in A5.3. Returns an unsubscribe function.
 */
export function onForegroundMessage(handler) {
  if (!isPushSupported()) return () => {}
  return onMessage(messaging, handler)
}
