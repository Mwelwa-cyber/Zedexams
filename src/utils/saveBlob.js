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
import { isNativePlatform } from './runtime.js'

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

  // Native Capacitor shell ONLY: its WebView has no download manager, so a
  // blob: URL anchor click does nothing — encoding the bytes inline in a data:
  // URL is the only thing that triggers a save. Real browsers must NOT take this
  // route (Android Chrome truncates large data: URLs → corrupt .docx).
  if (isNativePlatform() && typeof FileReader !== 'undefined' && typeof document !== 'undefined') {
    try {
      const dataUrl = await blobToDataUrl(blob)
      anchorDownload(dataUrl, name)
      return
    } catch {
      // fall through to the blob-URL paths below
    }
  }

  // All real browsers (desktop + mobile): file-saver streams the full blob via
  // a blob: URL — never truncated — and honours the download filename.
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
