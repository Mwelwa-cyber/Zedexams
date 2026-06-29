/**
 * Shared, timeout-bounded image-bytes fetcher for the document exporters.
 *
 * Why this exists
 *   The Word exporters (assessment / exam paper / SBA via renderPaperBlocksToDocx,
 *   and the lesson-plan illustration) need an image's raw BYTES to embed them.
 *   Each used to call `fetch(url, {mode:'cors'})` with NO timeout, trying three
 *   strategies in turn (warm cache → `cache:'reload'` → same-origin proxy). When
 *   a Firebase Storage request is slow or hangs, an un-bounded fetch never
 *   settles — so the whole `.docx` build hangs and the download appears to
 *   "take forever" or fail outright. With several images fetched one after
 *   another, a single bad request stalls every figure behind it.
 *
 *   This centralises the three-strategy logic AND bounds every network attempt
 *   with an AbortController timeout, so a stuck request aborts and the exporter
 *   degrades to its visible "Figure could not be embedded" placeholder instead
 *   of hanging the entire download.
 *
 * Pure-ish + dependency-light so it's unit-testable under plain `node`; it reads
 * the global `fetch` at call time so tests can stub it.
 */

import { toProxyImageUrl, hasImageSignature } from './imageProxy.js'

// Per-attempt network budget. A healthy Storage read returns in well under a
// second; this only ever trips on a genuinely stuck request, so it can be
// generous without slowing the happy path.
export const DEFAULT_IMAGE_FETCH_TIMEOUT_MS = 12000

// fetch() wrapped with an abort-based timeout. AbortController is available in
// every browser we target and in Node 18+; if it's somehow missing we fall back
// to a plain (un-bounded) fetch rather than throwing.
function timedFetch(url, init, timeoutMs) {
  const f = globalThis.fetch
  if (typeof f !== 'function') return Promise.reject(new Error('fetch unavailable'))
  if (typeof AbortController === 'undefined' || !(timeoutMs > 0)) {
    return f(url, init)
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return f(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer))
}

/**
 * Fetch the raw bytes of an image, bounded by a timeout, falling back through
 * the same CORS-recovery strategies the exporters relied on:
 *   1. normal fetch (warm cache, fast path),
 *   2. `cache:'reload'` (defeats a CORS-poisoned cache entry),
 *   3. the same-origin `/api/image-proxy` (defeats a bucket with no CORS headers).
 *
 * @param {string} url
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<Uint8Array|null>} bytes on success, null when every strategy
 *   failed (or timed out) so the caller can render a placeholder.
 */
export async function fetchImageBytes(url, { timeoutMs = DEFAULT_IMAGE_FETCH_TIMEOUT_MS } = {}) {
  if (!url || typeof url !== 'string') return null
  if (typeof globalThis.fetch !== 'function') return null

  for (const cache of ['default', 'reload']) {
    try {
      const res = await timedFetch(url, { mode: 'cors', cache }, timeoutMs)
      if (!res.ok) continue
      const bytes = new Uint8Array(await res.arrayBuffer())
      if (bytes.length) return bytes
    } catch {
      // CORS rejection, network error, or timeout abort — try the next strategy.
    }
  }

  const proxied = toProxyImageUrl(url)
  if (proxied) {
    try {
      const res = await timedFetch(proxied, { cache: 'reload' }, timeoutMs)
      if (res.ok) {
        const contentType = res.headers && res.headers.get
          ? (res.headers.get('content-type') || '')
          : ''
        const bytes = new Uint8Array(await res.arrayBuffer())
        // Accept ONLY a genuine image: if the Hosting rewrite isn't live the
        // proxy path resolves to the SPA index.html (200/text/html); embedding
        // that would be a fresh broken-image bug, so fail closed.
        if (bytes.length && (/^image\//i.test(contentType) || hasImageSignature(bytes))) {
          return bytes
        }
      }
    } catch {
      // Proxy unreachable / timed out — give up gracefully.
    }
  }
  return null
}
