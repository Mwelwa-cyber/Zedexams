/**
 * Same-origin image proxy helper.
 *
 * The Word/PDF exporters need to read an image's BYTES (not just display it):
 * the DOCX path does `fetch(url, {mode:'cors'})`, the PDF path rasterises with
 * html2canvas `useCORS`. Both fail when the Firebase Storage bucket's CORS
 * config is missing or was applied to the wrong bucket (`.firebasestorage.app`
 * vs `.appspot.com`) — the image still DISPLAYS via a plain `<img>` (no CORS
 * needed) but the byte read is rejected, so the figure drops from the download
 * and the exporter falls back to the dashed-red "Figure could not be embedded"
 * placeholder. The `cache:'reload'` retry in the exporters only fixes a poisoned
 * cache; it cannot fix a bucket that returns no CORS headers at all.
 *
 * `toProxyImageUrl` rewrites a cross-origin Storage URL to a same-origin
 * `/api/image-proxy?url=…` request. The `apiImageProxy` Cloud Function (behind
 * the Hosting rewrite) fetches the bytes server-side — where CORS doesn't apply
 * — and streams them back with permissive CORS headers. Because the browser
 * request is now same-origin, the byte read always succeeds, independent of the
 * bucket's CORS config.
 *
 * Pure + dependency-free so it's unit-testable under plain `node`.
 */

export const IMAGE_PROXY_PATH = '/api/image-proxy'

/**
 * Build a same-origin proxy URL for a cross-origin (http/https) image URL.
 * Returns null for anything that doesn't need proxying — relative paths,
 * `data:`/`blob:` URLs, or non-strings — so callers can use it as a guarded
 * last-resort fallback.
 *
 * @param {string} url
 * @returns {string|null}
 */
export function toProxyImageUrl(url) {
  if (!url || typeof url !== 'string') return null
  if (!/^https?:\/\//i.test(url)) return null
  return `${IMAGE_PROXY_PATH}?url=${encodeURIComponent(url)}`
}
