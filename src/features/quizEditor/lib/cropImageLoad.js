/**
 * cropImageLoad — load a source image so its pixels can be read back off a
 * canvas without tainting it.
 *
 * The crop preview <img> loads its URL WITHOUT crossOrigin, so the browser may
 * cache a non-CORS response. Re-requesting the same URL with
 * crossOrigin='anonymous' then reuses that cached response, the CORS check
 * fails, and exporting the cropped canvas throws — surfaced to the admin as the
 * "browser may be blocking it" error. This module dodges that:
 *   • blob:/data: URLs are same-origin → load directly (no CORS needed).
 *   • remote URLs get a cache-busting param so the CORS request can't reuse the
 *     tainted cache entry, with a fetch-to-object-URL fallback that is
 *     same-origin and so never taints the canvas.
 */

// Load an <img> element from a URL, optionally requesting it CORS-clean.
export function loadImageEl(src, useCors) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (useCors) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('load failed'))
    img.src = src
  })
}

export async function loadCorsImage(src) {
  if (src.startsWith('blob:') || src.startsWith('data:')) {
    return loadImageEl(src, false)
  }
  try {
    const sep = src.includes('?') ? '&' : '?'
    return await loadImageEl(`${src}${sep}_cors=${Date.now()}`, true)
  } catch {
    // Fall back to fetching the bytes and loading via an object URL, which is
    // same-origin and so never taints the canvas.
    const res = await fetch(src, { mode: 'cors', cache: 'reload' })
    if (!res.ok) throw new Error(`fetch ${res.status}`)
    const blobUrl = URL.createObjectURL(await res.blob())
    try {
      return await loadImageEl(blobUrl, false)
    } finally {
      URL.revokeObjectURL(blobUrl)
    }
  }
}
