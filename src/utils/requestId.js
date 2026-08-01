/**
 * Per-request correlation id (OBS-003).
 *
 * Mint one id per logical client request and send it as the `x-request-id`
 * header. The Cloud Function reads the same header (functions/logger.js
 * `requestIdFromReq`) and stamps it on every structured log line, so one
 * request is traceable UI -> function -> data by a single id.
 */

/** A fresh correlation id (crypto.randomUUID when available, else a fallback). */
export function newRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `rid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Return a copy of `headers` with a single `x-request-id` entry. Never mutates
 * the input; an existing id (in EITHER case spelling) is preserved so a retry
 * of the same logical request keeps its id.
 *
 * Critically, it emits only ONE spelling: if the caller passed `X-Request-Id`,
 * that case-variant key is dropped rather than left alongside a new lowercase
 * one — otherwise `fetch`'s Headers would fold the two into `"id, id"`, which
 * the server then reads as a doubled id.
 */
export function withRequestId(headers = {}, id) {
  const rest = {}
  let existing
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'x-request-id') existing = value
    else rest[key] = value
  }
  return { ...rest, 'x-request-id': existing || id || newRequestId() }
}
