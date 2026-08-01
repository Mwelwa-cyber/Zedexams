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
 * Return a copy of `headers` with `x-request-id` set. Never mutates the input;
 * an existing id is preserved so a retry of the SAME logical request keeps its
 * id.
 */
export function withRequestId(headers = {}, id) {
  const existing = headers['x-request-id'] || headers['X-Request-Id']
  return { ...headers, 'x-request-id': existing || id || newRequestId() }
}
