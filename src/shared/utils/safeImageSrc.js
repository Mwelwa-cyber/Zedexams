/**
 * The scheme allow-list for any `<img src>` fed from stored content.
 *
 * Question and option images are teacher-authored data: they arrive from
 * Firestore, from an import, or from a blob: preview that has not been
 * uploaded yet, and by the time they reach a render nothing has looked at what
 * the string actually is. A saved paper carrying
 * `imageUrl: "https://attacker.example/beacon.gif"` makes every teacher who
 * opens it fetch that host — their IP, their user-agent, and the fact that
 * they opened this paper at this moment — with no visible image to explain it.
 * That is the realistic failure here, not script execution: no current browser
 * runs a `javascript:` URL out of an `<img src>`, which is why these five
 * sites were reported as XSS but are not one.
 *
 * What passes:
 *   https://…  http://…   the uploaded Storage URL, and the emulator's
 *                         http://127.0.0.1:9199/… during local development
 *   blob:…                the object URL of an import that is still local
 *   data:image/…          an inlined image, but never data:text/html
 *   /…  ./…  ../…         a bundled asset
 *
 * What is rejected is everything else — `javascript:`, `vbscript:`,
 * `data:text/html`, a protocol-relative `//host` that inherits the page
 * scheme — plus any value carrying whitespace, quotes, angle brackets or a
 * backslash, because those are the characters that let a URL escape the
 * attribute it is written into if one of these ever moves to markup.
 *
 * Pure and DOM-free so `node` can unit test it (npm run test:safe-image-src).
 */

const SAFE_IMAGE_SRC = /^(?:https?:\/\/|blob:|data:image\/|\/(?!\/)|\.{1,2}\/)[^\s"'<>\\]*$/i

/**
 * The URL to render, or `undefined` when it is not one this app should fetch.
 *
 * Returning `undefined` rather than `''` matters: React omits the attribute
 * entirely, so the browser makes no request at all, where `src=""` re-requests
 * the current page. Callers keep their existing `onError` handling for the
 * ordinary case of a URL that is fine but no longer resolves.
 *
 * The value is returned as written, NOT re-encoded. `encodeURI` would have
 * been the reflex here and it is wrong: it escapes `%`, so the `%2F` that
 * Firebase Storage puts in every object path becomes `%252F` and the URL
 * stops resolving. Encoding is also unnecessary — the pattern above already
 * refuses every character that could break out of an attribute, so what
 * survives it needs no further escaping.
 *
 * @param {unknown} url
 * @returns {string|undefined}
 */
export function safeImageSrc(url) {
  if (typeof url !== 'string') return undefined
  const value = url.trim()
  if (!value) return undefined
  return SAFE_IMAGE_SRC.test(value) ? value : undefined
}

export default safeImageSrc
