/**
 * Trigger a real file download for a Blob, keeping `filename`.
 *
 * Shared by every studio export so the behaviour is identical everywhere.
 *
 * TWO ROUTES — and why the split matters
 * ──────────────────────────────────────
 * 1. REAL BROWSERS (desktop AND mobile: Android Chrome, iOS Safari, …) use a
 *    `blob:` URL via `file-saver`. A blob URL references the full in-memory
 *    Blob, so the browser streams every byte — the file is never truncated —
 *    and modern browsers honour the `download` filename.
 *
 * 2. THE NATIVE CAPACITOR SHELL (the installed Android app) uses a `data:` URL.
 *    Its WebView has no browser download manager, so a `blob:` URL anchor click
 *    does nothing at all there; encoding the bytes inline in a `data:` URL is
 *    the only thing that triggers a save.
 *
 * WHY WE NO LONGER USE `data:` URLS IN MOBILE BROWSERS
 * ───────────────────────────────────────────────────
 * An earlier version routed *all* Android + iOS browsers through the `data:`
 * URL trick to dodge a UUID-naming quirk. That backfired badly: Android
 * Chrome's download manager TRUNCATES large `data:` URL downloads, so a
 * multi-hundred-KB .docx arrived as a half-written ZIP — Word then reported
 * "found unreadable content" and recovery produced an empty document. It also
 * still named those downloads after a random id. So `data:` URLs gave the worst
 * of both worlds in real browsers; they are now reserved for the native shell,
 * where there is no alternative.
 *
 * NOTE: the native shell's `data:` route shares the same truncation risk for
 * very large files. A proper native fix (write to disk via a Capacitor
 * filesystem plugin, then open) is tracked separately; it needs the native
 * project + on-device testing.
 */

import { inspectFilename } from './downloadGuard.js'
import { reportClientError } from './clientErrorReporting.js'
import { isNativePlatform, isMobileBrowser } from './runtime.js'
import { saveBlobNative } from './nativeDownload.js'

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

/**
 * Save `blob` as `filename` through the Web Share API (Web Share Level 2).
 *
 * This is the ONLY browser mechanism that preserves a real filename on a mobile
 * browser. An `<a download>` click on a `blob:` URL does not: Android Chrome
 * names the saved file after the blob's internal UUID ("acc6d3a8-….docx") and
 * iOS Safari ignores the `download` name entirely. We hand the OS a `File`
 * object whose `.name` IS the human filename, so "Save to Files" / Drive / Word
 * all keep "Grade 1 Mathematics Lesson Plan.docx".
 *
 * @returns {Promise<boolean>} true when the file was handed off (shared) OR the
 *   user deliberately dismissed the share sheet — in both cases the caller must
 *   NOT fall through to the anchor route (which would dump a UUID-named copy
 *   into Downloads). false means "couldn't even try" → caller should fall back.
 */
async function trySaveViaShare(blob, filename) {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false
  if (typeof File !== 'function') return false

  let file
  try {
    file = new File([blob], filename, { type: blob.type || 'application/octet-stream' })
  } catch {
    return false
  }

  // If the platform can tell us it can't share this file, don't try — fall back.
  if (typeof navigator.canShare === 'function' && !navigator.canShare({ files: [file] })) {
    return false
  }

  try {
    await navigator.share({ files: [file], title: filename })
    return true
  } catch (err) {
    // AbortError = the user closed the share sheet on purpose. Treat as handled
    // so we don't immediately re-trigger a UUID-named anchor download.
    if (err && err.name === 'AbortError') return true
    // Any other failure (NotAllowedError, share unsupported for files, …) →
    // report and let the caller fall through to the file-saver/anchor route.
    reportClientError(err, 'share_save_fallback')
    return false
  }
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

  // Native Capacitor shell: its WebView has no download manager. Write the full
  // bytes to disk via @capacitor/filesystem and share them — this never
  // truncates, unlike the data: URL route below.
  if (isNativePlatform()) {
    try {
      await saveBlobNative(blob, name)
      return
    } catch (err) {
      // Native filesystem/share unavailable (e.g. plugins not yet synced into
      // the APK). Fall back to the legacy data: URL anchor — the only other
      // thing that triggers a save in a WebView. It risks truncating very large
      // files, but a possibly-truncated save still beats no save at all.
      reportClientError(err, 'native_save_fallback')
      if (typeof FileReader !== 'undefined' && typeof document !== 'undefined') {
        try {
          const dataUrl = await blobToDataUrl(blob)
          anchorDownload(dataUrl, name)
          return
        } catch {
          // fall through to the browser paths below
        }
      }
    }
  }

  // Mobile browsers (Android Chrome, iOS Safari): an <a download> on a blob:
  // URL loses the filename here — Android saves it under the blob's UUID
  // ("acc6d3a8-….docx") and iOS ignores the name. The Web Share API is the only
  // free/local path that keeps the real name, so try it first.
  if (isMobileBrowser()) {
    try {
      if (await trySaveViaShare(blob, name)) return
    } catch {
      // trySaveViaShare is already defensive; never let it break a download.
    }
    // No Web Share (DuckDuckGo, in-app WebViews, older Android): echo the bytes
    // back through our own /api/download endpoint so the file downloads FROM
    // zedexams.com with the correct name, in a single round-trip.
    try {
      const { saveViaServerEcho } = await import('./serverEchoDownload.js')
      if (await saveViaServerEcho(blob, name)) return
    } catch {
      // fall through
    }
    // Last universal fallback for oversized files the echo can't carry: stamp
    // the name onto a temp Storage object and let the download manager read it.
    try {
      const { saveViaStampedUrl } = await import('./stampedDownload.js')
      if (await saveViaStampedUrl(blob, name)) return
    } catch {
      // fall through to file-saver
    }
  }

  // Desktop browsers (and the last-resort fallback): file-saver streams the full
  // blob via a blob: URL — never truncated — and desktop browsers honour the
  // download filename.
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
