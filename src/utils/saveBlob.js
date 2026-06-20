/**
 * Trigger a real file download for a Blob, keeping `filename`.
 *
 * Shared by every studio export so the behaviour is identical everywhere.
 *
 * WHY THE DATA-URL ROUTE EXISTS (ANDROID + iOS)
 * ─────────────────────────────────────────────
 * Both Android Chrome/WebView AND iOS Safari ignore the `download` attribute on
 * anchors that point to `blob:` URLs. Instead they name the saved file after the
 * blob's internal random UUID, so teachers downloading Notes / Worksheets / etc.
 * got files called things like "5fee66fe-1c3a-4b9d-….docx" instead of
 * "Grade 5 English Notes.docx".
 *
 * The workaround: convert the Blob to a `data:` URL first, then click an anchor
 * with `download=<filename>`. Both platforms honour the `download` attribute on
 * `data:` URLs — unlike `blob:` URLs — so the chosen name is preserved.
 *
 * ANDROID: any UA string that includes "Android".
 * iOS SAFARI: iPhones report "iPhone" / "iPad" in the UA. iPadOS 13+ spoofs as
 * "Macintosh" for desktop-site compat, so UA detection alone is insufficient.
 * We catch iPadOS by also checking `navigator.maxTouchPoints > 1` on a platform
 * that looks like Mac — a touch-capable "Mac" is always an iPad.
 *
 * Desktop browsers (Chrome, Firefox, Edge, desktop Safari) reliably honour
 * `download` on both `blob:` and `data:` URLs, so they stay on the faster
 * `file-saver` / blob-URL path.
 */

import { inspectFilename } from './downloadGuard.js'
import { reportClientError } from './clientErrorReporting.js'

function isAndroid() {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent || '')
}

/**
 * Returns true when the runtime is iOS Safari or iPadOS Safari — environments
 * that ignore the anchor `download` attribute for `blob:` URLs and so produce
 * random UUID filenames unless we switch to the `data:` URL route.
 *
 * Detection logic:
 *  • "iPhone" or "iPad" in the UA → definitely iOS/iPadOS.
 *  • UA looks like macOS ("Macintosh") BUT has multiple touch points → iPadOS 13+
 *    spoofing desktop UA. `navigator.maxTouchPoints > 1` is reliable here because
 *    real Intel Macs always report 0 touch points.
 */
function isIosSafari() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  if (/iPhone|iPad/i.test(ua)) return true
  // iPadOS 13+ desktop-mode spoofing: "Macintosh" UA but a touch screen.
  if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return true
  return false
}

/**
 * Returns true when the platform needs the `data:` URL route to preserve the
 * `download` filename (Android and iOS/iPadOS Safari).
 */
function prefersDataUrlDownload() {
  return isAndroid() || isIosSafari()
}

/** Click an attached `<a download>` — attached + removed so every browser honours it. */
function anchorDownload(href, filename) {
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error || new Error('Failed to read blob'))
    reader.readAsDataURL(blob)
  })
}

export async function saveBlob(blob, filename) {
  const name = filename || 'download'

  // Universal, free download-name observability. A junk/UUID/generic-default
  // name reaching this choke point means a human-readable name was lost in one
  // of the ~25 exporters upstream. We report it (name only — never blob bytes)
  // so the regression is caught, then ALWAYS continue — this never blocks a save.
  try {
    const verdict = inspectFilename(name)
    if (!verdict.ok) {
      reportClientError(`bad download name [${verdict.code}]: ${name}`, 'download_guard')
      console.warn(`saveBlob: ${verdict.message || 'suspicious filename'} (${name})`)
    }
  } catch {
    // The guard must never break a download.
  }

  // Android + iOS/iPadOS: the data-URL route is the only one that preserves the
  // filename. It must run BEFORE file-saver, which also uses blob: URLs and so
  // hits the same UUID-naming bug on these platforms.
  if (prefersDataUrlDownload() && typeof FileReader !== 'undefined' && typeof document !== 'undefined') {
    try {
      const dataUrl = await blobToDataUrl(blob)
      anchorDownload(dataUrl, name)
      return
    } catch {
      // fall through to the blob-URL paths below
    }
  }

  // Desktop: file-saver handles older-browser quirks.
  try {
    const { saveAs } = await import('file-saver')
    saveAs(blob, name)
    return
  } catch {
    // fall through to the anchor approach
  }

  const url = URL.createObjectURL(blob)
  anchorDownload(url, name)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
