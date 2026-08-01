/**
 * Universal download fallback that preserves the filename on EVERY browser —
 * including ones (DuckDuckGo, some in-app WebViews, older Android browsers) that
 * neither honour the `<a download>` name for a `blob:` URL nor support the Web
 * Share API. Those browsers save an in-page-generated file under the blob's
 * internal UUID ("acc6d3a8-….docx"); there is no purely-client-side way to stop
 * that, because the name has to come from an HTTP response header.
 *
 * So we round-trip the bytes: upload the just-generated file to a short-lived
 * `tmp-downloads/{uid}/…` Storage object whose `Content-Disposition` metadata
 * carries the real filename, then point the browser's own download manager at
 * the tokened download URL. The download manager reads `Content-Disposition:
 * attachment; filename="Grade 6 English Lesson Plan.docx"` and names the file
 * correctly — this header is honoured universally.
 *
 * Cost: it uploads then re-downloads the file (extra mobile data), so saveBlob
 * only reaches here AFTER the free, local Web Share path has been ruled out.
 * The temp object is best-effort deleted by the client and swept hourly by the
 * `tmpDownloadReaper` Cloud Function.
 */

import { storage, auth } from '../firebase/config.js'
import { reportClientError } from './clientErrorReporting.js'

/** Lowercase extension (without the dot) from a filename, or 'bin'. */
function extOf(filename) {
  const m = /\.([a-z0-9]{1,8})$/i.exec(String(filename || ''))
  return m ? m[1].toLowerCase() : 'bin'
}

/**
 * Build an RFC 6266 Content-Disposition value that survives non-ASCII names.
 * Includes a sanitised ASCII `filename=` fallback plus the precise UTF-8
 * `filename*=` form modern browsers prefer.
 */
export function contentDispositionFor(filename) {
  const name = String(filename || 'download')
  const ascii = name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

/** Click a hidden anchor pointing at the stamped, tokened download URL. */
function triggerDownload(url) {
  const a = document.createElement('a')
  a.href = url
  // Cross-origin so the browser ignores `download` — that's fine, the object's
  // Content-Disposition header supplies the name. rel keeps the opener clean.
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

/**
 * Save `blob` as `filename` by stamping the name onto a temp Storage object.
 *
 * @returns {Promise<boolean>} true when the download was triggered; false when
 *   we couldn't (not signed in, upload failed, no DOM) so the caller falls back
 *   to file-saver. Never throws.
 */
export async function saveViaStampedUrl(blob, filename) {
  if (typeof document === 'undefined') return false

  const uid = auth?.currentUser?.uid
  // The temp path is owner-scoped (storage.rules); without a uid the upload
  // would be denied, so don't even try — let the caller fall back.
  if (!uid) return false

  try {
    const { ref, getDownloadURL } = await import('firebase/storage')
    // Writes go through the attested wrappers: App Check enforcement rejects
    // an upload carrying the fail-open placeholder token (see attestedStorage.js).
    const { uploadBytes, deleteObject } = await import('../firebase/attestedStorage')

    const name = filename || 'download'
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const objectRef = ref(storage, `tmp-downloads/${uid}/${id}.${extOf(name)}`)

    await uploadBytes(objectRef, blob, {
      contentType: blob.type || 'application/octet-stream',
      // THE point of this whole module: the browser's download manager reads
      // this header and names the saved file correctly on every browser.
      contentDisposition: contentDispositionFor(name),
    })

    const url = await getDownloadURL(objectRef)
    triggerDownload(url)

    // Best-effort cleanup once the download has surely started. The hourly
    // tmpDownloadReaper sweeps anything left behind (e.g. the tab closed first).
    setTimeout(() => {
      deleteObject(objectRef).catch(() => {})
    }, 90_000)

    return true
  } catch (err) {
    reportClientError(err, 'stamped_download_fallback')
    return false
  }
}
