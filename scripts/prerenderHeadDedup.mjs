/**
 * Pure, browser-and-Node-compatible head-dedup helpers used by prerender.mjs.
 *
 * Each function accepts a `document` object so they are testable in Node.js
 * (via JSDOM) without launching a browser.
 *
 * WHY this module exists — two distinct dedup problems that look similar but
 * differ in which occurrence to keep:
 *
 *  Meta tags (name / property)
 *  ───────────────────────────
 *  The static index.html shell ships generic <meta name="description">,
 *  og:title, og:description, etc. react-helmet-async v3 appends its per-route
 *  versions to the END of <head> (it cannot remove tags it didn't author).
 *  Result: generic-first, correct-last. Keep the LAST occurrence so the
 *  per-route tag survives.
 *
 *  <title> elements
 *  ─────────────────
 *  React 19's mountHoistable() calls:
 *    head.insertBefore(newTitle, head.querySelector("head > title"))
 *  — it inserts the per-route <title> BEFORE any existing static shell title
 *  without removing the existing one. Result: per-route-first, static-last.
 *  Keep the FIRST occurrence so the per-route title survives.
 *
 *  (Without the document.title= side-effect that was in PlatformSettingsContext
 *  the static title would retain its full text from index.html, but the
 *  direction — per-route inserted BEFORE — is the same regardless of the
 *  static text.)
 */

/**
 * Dedup <meta name="…"> and <meta property="…"> elements in `document.head`.
 * Keeps the LAST element for each name/property key; removes earlier twins.
 *
 * @param {Document} doc
 */
export function dedupMetaTags(doc) {
  const metas = [...doc.head.querySelectorAll('meta[name], meta[property]')]
  const keyOf = (m) =>
    m.getAttribute('name')
      ? `name:${m.getAttribute('name')}`
      : `prop:${m.getAttribute('property')}`
  const lastByKey = new Map()
  for (const m of metas) lastByKey.set(keyOf(m), m) // last write wins
  for (const m of metas) {
    if (lastByKey.get(keyOf(m)) !== m) m.remove()
  }
}

/**
 * Dedup <title> elements in `document.head`.
 * Keeps the FIRST element (React 19 hoists the per-route title before the
 * static shell one); removes every later twin.
 *
 * @param {Document} doc
 */
export function dedupTitleTags(doc) {
  const titles = [...doc.head.querySelectorAll('title')]
  if (titles.length > 1) {
    titles.slice(1).forEach((t) => t.remove())
  }
}
