import { Capacitor } from '@capacitor/core'

// Production hosting origin used as the API base when running inside the
// Capacitor wrapper. The WebView serves files from `https://localhost`, which
// has no Firebase Hosting rewrites — so a relative `/api/...` fetch 404s.
// Calling the live origin lets the same Hosting rewrites resolve to the
// underlying Cloud Functions.
const NATIVE_API_BASE = 'https://zedexams.com'

export function isNativePlatform() {
  try {
    return Capacitor.isNativePlatform?.() === true
  } catch {
    return false
  }
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
