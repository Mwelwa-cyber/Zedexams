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

/**
 * Strict magic-byte check for the formats the exporters can embed
 * (PNG/JPEG/GIF/BMP/WEBP). Used to validate the PROXY response specifically:
 * if the Hosting rewrite isn't live yet, `/api/image-proxy` resolves to the SPA
 * fallback (`index.html`, HTTP 200, `text/html`). Embedding those HTML bytes as
 * a PNG would produce a broken figure — a fresh variant of the very bug we're
 * fixing. Requiring a real image signature makes the proxy fallback fail
 * CLOSED (→ visible placeholder) instead of silently embedding garbage.
 *
 * @param {Uint8Array} bytes
 * @returns {boolean}
 */
export function hasImageSignature(bytes) {
  if (!bytes || bytes.length < 4) return false
  const [b0, b1, b2, b3] = bytes
  if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47) return true // PNG
  if (b0 === 0xff && b1 === 0xd8 && b2 === 0xff) return true // JPEG
  if (b0 === 0x47 && b1 === 0x49 && b2 === 0x46) return true // GIF
  if (b0 === 0x42 && b1 === 0x4d) return true // BMP
  if (
    bytes.length >= 12 &&
    b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return true // WEBP (RIFF....WEBP)
  }
  return false
}
