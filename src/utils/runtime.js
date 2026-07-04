import { Capacitor } from '@capacitor/core'

// Production hosting origin used as the API base when running inside the
// Capacitor wrapper. The WebView serves files from `https://localhost`, which
// has no Firebase Hosting rewrites — so a relative `/api/...` fetch 404s.
// Calling the live origin lets the same Hosting rewrites resolve to the
// underlying Cloud Functions. This is also the canonical origin for any URL
// meant to leave the device (share links) — see siteOrigin().
export const SITE_ORIGIN = 'https://zedexams.com'
const NATIVE_API_BASE = SITE_ORIGIN

export function isNativePlatform() {
  try {
    return Capacitor.isNativePlatform?.() === true
  } catch {
    return false
  }
}

/**
 * True for a mobile *web browser* (Android Chrome, iOS Safari, …) — NOT the
 * native Capacitor shell, and NOT a desktop browser.
 *
 * Why this matters for downloads: on a mobile browser an `<a download>` click
 * on a `blob:` URL does NOT reliably keep the filename. Android Chrome names
 * the saved file after the blob's internal UUID (e.g. "acc6d3a8-….docx") and
 * iOS Safari ignores the name too. The Web Share API is the only browser path
 * that preserves a real filename there, so saveBlob() routes mobile browsers
 * through it. Desktop browsers honour `download`, so they stay on file-saver.
 */
export function isMobileBrowser() {
  if (isNativePlatform()) return false
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return true
  // iPadOS 13+ reports a desktop "Macintosh" UA; disambiguate via touch points.
  if (/Macintosh/.test(ua) && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1) {
    return true
  }
  return false
}

/**
 * The origin to use when building a URL that will be handed to someone else —
 * a share link, an invite, anything copied out of the app.
 *
 * On the web this is just `window.location.origin` (works, and keeps staging /
 * preview deploys self-referential). In the native Capacitor shell the WebView
 * serves from `https://localhost`, so `window.location.origin` is
 * `https://localhost` — a link built from it (`https://localhost/share/…`) is
 * dead the moment it leaves the phone. Native therefore always uses the
 * canonical production origin so shared links actually resolve.
 */
export function siteOrigin() {
  if (isNativePlatform()) return SITE_ORIGIN
  if (typeof window !== 'undefined' && window.location && window.location.origin) {
    return window.location.origin
  }
  return SITE_ORIGIN
}

/**
 * Resolve an `/api/...` path to a fully-qualified URL when running in the
 * native shell, or return it unchanged on the web. Anything that isn't an
 * `/api/...` path is returned unchanged so call sites can pass straight URLs.
 */
export function apiUrl(path) {
  if (typeof path !== 'string') return path
  if (!isNativePlatform()) return path
  if (!path.startsWith('/api/')) return path
  return `${NATIVE_API_BASE}${path}`
}
