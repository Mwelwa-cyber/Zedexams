/**
 * Native (Capacitor / Android) push registration — the counterpart to the
 * web-push helpers in src/services/notifications/fcm.js.
 *
 * The web build reaches FCM through `firebase/messaging` + a VAPID key + a
 * service worker. None of that exists inside the Capacitor WebView: web push
 * APIs are absent and the SW is never registered. Android instead uses the
 * native Firebase Messaging SDK, surfaced to JS by the
 * `@capacitor-firebase/messaging` plugin. This module drives that plugin to:
 *
 *   1. request the OS notification permission (Android 13+ POST_NOTIFICATIONS),
 *   2. fetch the device's native FCM token, and
 *   3. persist it to users/{uid}.fcmTokens — the SAME array the web tokens land
 *      in, so the server-side sender (functions/notifications/sendPushToUser.js)
 *      multicasts to web + native devices with one call and prunes dead tokens
 *      of either kind.
 *
 * The plugin is resolved at runtime via `nativePlugin('FirebaseMessaging')`
 * (see runtime.js) so the web bundle never imports the package. Every entry
 * point is a graceful no-op on the web / when the plugin isn't registered.
 *
 * Background/killed-app delivery is handled entirely by the OS: an FCM message
 * carrying a `notification` block is rendered in the Android system tray
 * automatically. This module only has to make sure a valid token is on record.
 */

import { arrayUnion, doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { nativePlugin } from '../../utils/runtime'
import { capture } from '../../utils/analytics'

// Cache of the last-known native permission, mapped to the web tri-state that
// the shared UI (PushPermissionPrompt, settings panels) reads synchronously via
// fcm.pushPermission(). The plugin's own checkPermissions() is async, so we
// prime this on sign-in (refreshNativeTokenIfGranted) and update it on every
// request. 'default' until proven otherwise so a first-run user still gets the
// opt-in prompt.
let cachedPermission = 'default'
// The uid whose token the tokenReceived listener should persist on rotation.
let currentUid = null
let listenerBound = false

function plugin() {
  return nativePlugin('FirebaseMessaging')
}

/** True only when running native AND the messaging plugin is registered. */
export function isNativePushSupported() {
  return Boolean(plugin())
}

/** The cached native permission as a web tri-state ('granted'|'denied'|'default'). */
export function nativePushPermissionSync() {
  if (!plugin()) return 'unsupported'
  return cachedPermission
}

// Map the plugin's PermissionState ('prompt'|'prompt-with-rationale'|'granted'|
// 'denied') to the web Notification tri-state the shared UI expects.
function mapPermission(receive) {
  if (receive === 'granted') return 'granted'
  if (receive === 'denied') return 'denied'
  return 'default'
}

async function persistToken(uid, token) {
  if (!uid || !token) return null
  try {
    await updateDoc(doc(db, 'users', uid), {
      fcmTokens: arrayUnion(token),
      fcmTokensUpdatedAt: serverTimestamp(),
    })
    // The "native push is actually working" signal — mirrors the web path in
    // fcm.js. No token value is sent, only the platform.
    capture('push_token_registered', { platform: 'native' })
    return token
  } catch (err) {
    // Same rationale as the web path: a failed persist is non-fatal, we retry
    // on the next sign-in via refreshNativeTokenIfGranted.
    console.warn('[nativePush] persist token failed:', (err && err.message) || err)
    capture('push_token_failed', { platform: 'native', reason: 'persist_failed' })
    return null
  }
}

// FCM tokens rotate; the plugin emits `tokenReceived` when that happens. Bind
// once and re-persist against whichever uid is currently signed in.
async function ensureTokenListener(p) {
  if (listenerBound) return
  listenerBound = true
  try {
    await p.addListener('tokenReceived', (event) => {
      const token = event && event.token
      if (currentUid && token) persistToken(currentUid, token)
    })
  } catch (err) {
    console.warn('[nativePush] token listener bind failed:', (err && err.message) || err)
  }
}

/**
 * Prompt for the OS notification permission and, on grant, register the native
 * FCM token. Returns the resulting web-tri-state permission. Mirrors
 * fcm.requestPushPermission for the native platform.
 */
export async function requestNativePushPermission(uid) {
  const p = plugin()
  if (!p) return 'unsupported'
  if (uid) currentUid = uid
  let receive = 'denied'
  try {
    const res = await p.requestPermissions()
    receive = (res && res.receive) || 'denied'
  } catch (err) {
    console.warn('[nativePush] requestPermissions failed:', (err && err.message) || err)
  }
  cachedPermission = mapPermission(receive)
  if (cachedPermission === 'granted') {
    await ensureTokenListener(p)
    try {
      const res = await p.getToken()
      await persistToken(uid, res && res.token)
    } catch (err) {
      console.warn('[nativePush] getToken failed:', (err && err.message) || err)
      capture('push_token_failed', { platform: 'native', reason: 'get_token_failed' })
    }
  } else if (cachedPermission === 'denied') {
    capture('push_permission_denied', { platform: 'native' })
  }
  return cachedPermission
}

/**
 * Clear the uid the tokenReceived listener persists against. Called on sign-out
 * so that, on a shared device, an FCM token that rotates during the signed-out
 * window is NOT re-attributed to the user who just left — the listener becomes a
 * no-op until the next sign-in sets a fresh uid. Closes a cross-user delivery
 * gap (rotated token written to the previous user's fcmTokens).
 */
export function clearNativePushUser() {
  currentUid = null
}

/**
 * Silent re-register on sign-in: if the user already granted permission in a
 * previous session, fetch a fresh token and persist it. Never prompts. Mirrors
 * fcm.refreshTokenIfGranted for the native platform.
 */
export async function refreshNativeTokenIfGranted(uid) {
  const p = plugin()
  if (!p || !uid) return null
  currentUid = uid
  try {
    const res = await p.checkPermissions()
    cachedPermission = mapPermission(res && res.receive)
  } catch {
    return null
  }
  if (cachedPermission !== 'granted') return null
  await ensureTokenListener(p)
  try {
    const res = await p.getToken()
    return persistToken(uid, res && res.token)
  } catch (err) {
    console.warn('[nativePush] refresh getToken failed:', (err && err.message) || err)
    capture('push_token_failed', { platform: 'native', reason: 'get_token_failed' })
    return null
  }
}
