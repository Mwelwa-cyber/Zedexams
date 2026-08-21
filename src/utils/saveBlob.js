/**
 * Trigger a real file download for a Blob, keeping `filename`.
 *
 * Shared by every studio export so the behaviour is identical everywhere.
 *
 * THE RULE: DOWNLOAD SAVES A FILE. IT NEVER OPENS A SHARE SHEET.
 * ─────────────────────────────────────────────────────────────
 * Both mobile routes used to hand the file to the OS share sheet — the browser
 * one through `navigator.share`, the native one through @capacitor/share. A
 * teacher tapping "Download" on a lesson plan therefore got a grid of WhatsApp
 * contacts, Bluetooth and Huawei Share, and no file anywhere on the phone
 * unless they picked a target and understood they were picking a target. That
 * is a share, and it is not what the button says.
 *
 * Sharing is a fine thing to offer; it is a different intention from saving,
 * and it must be a different button. Nothing in this module opens a share sheet
 * as the FIRST answer to a download any more.
 *
 * FOUR ROUTES, and what each is for
 * ─────────────────────────────────
 * 1. NATIVE CAPACITOR SHELL → the app-local `ZedDownloads` plugin writes the
 *    full bytes into the phone's public Downloads folder via MediaStore. See
 *    nativeDownload.js; it keeps the old cache+share route as its own internal
 *    fallback for an APK built before the plugin existed.
 *
 * 2. MOBILE BROWSERS → the Storage-stamped URL (stampedDownload.js). The bytes
 *    go to a short-lived object whose `Content-Disposition` carries the real
 *    filename, and the browser's own download manager fetches it — so the file
 *    lands in Downloads, correctly named, on every mobile browser including the
 *    ones that honour neither `<a download>` nor Web Share.
 *
 *    It costs an upload and a re-download, which is real on a Zambian mobile
 *    connection. It is first anyway, because it is the only client route that
 *    gets BOTH the destination and the name right, and a document saved as
 *    "acc6d3a8-4f1e-….docx" is a document a teacher cannot find again.
 *
 * 3. BLOB-URL ANCHOR → the fallback under (2) (signed out, upload failed,
 *    offline) and the normal desktop path. Desktop browsers honour the
 *    `download` name; some mobile browsers replace it with the blob's internal
 *    UUID, which is why it is not first on mobile. The file still reaches the
 *    Downloads folder either way, so a wrong name beats no save.
 *
 * 4. DATA-URL ANCHOR → last resort inside the native shell only, where the
 *    WebView has no download manager at all. It risks truncating large files
 *    (Android's download manager cuts long data: URLs, which is how a .docx
 *    once arrived as a half-written ZIP and Word reported "unreadable
 *    content"), so nothing reaches it until every other route has failed.
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

  // Native Capacitor shell: save into the phone's public Downloads folder.
  // saveBlobNative degrades internally (Downloads plugin → cache+share), so
  // reaching the catch here means every native route failed.
  if (isNativePlatform()) {
    try {
      await saveBlobNative(blob, name)
      return
    } catch (err) {
      // The WebView has no download manager, so the data: URL anchor is the only
      // thing left that triggers a save at all. It risks truncating very large
      // files, but a possibly-truncated save still beats no save.
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

  // Mobile browsers: stamp the real filename onto a temp Storage object and let
  // the browser's own download manager read it from Content-Disposition. This
  // navigates to a real, working download URL, so the file lands in Downloads
  // under its real name — and a failure surfaces instead of silently dropping
  // the download. Declines (returns false) when signed out or the upload fails,
  // and we fall through to the local blob-URL save below.
  if (isMobileBrowser()) {
    try {
      const { saveViaStampedUrl } = await import('./stampedDownload.js')
      if (await saveViaStampedUrl(blob, name)) return
    } catch {
      // stampedDownload is already defensive; never let it break a download.
    }
  }

  // Desktop browsers, and the fallback for everything above: file-saver streams
  // the full blob via a blob: URL — never truncated — and desktop browsers
  // honour the download filename.
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
