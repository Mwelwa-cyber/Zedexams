/**
 * Server-generated download for a SAVED library document.
 *
 * The document already lives on the server (aiGenerations/{id}), so we don't
 * upload anything: we mint a short-lived ticket via a callable, then navigate
 * the browser to /api/teacher/download?ticket=… (a normal GET). The server
 * regenerates the .docx and streams it with Content-Disposition, so it downloads
 * FROM zedexams.com with the correct filename on every browser — no Firebase
 * Storage, no upload delay.
 *
 * Returns true when the download was triggered, false when it couldn't be (not
 * a supported type, no id, native shell, or the callable failed) so the caller
 * falls back to the in-app client-side download. Never throws.
 */

import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../firebase/config.js'
import { apiUrl } from './runtime.js'
import { isNativePlatform } from './runtime.js'
import { reportClientError } from './clientErrorReporting.js'

const functions = getFunctions(app, 'us-central1')
const createTicket = httpsCallable(functions, 'createLibraryDownloadTicket')

/**
 * @param {object} args
 * @param {string} args.generationId  aiGenerations doc id (must be saved).
 * @param {string} args.filename      Human filename, e.g. "Grade 4 … Lesson Plan.docx".
 * @param {boolean} [args.attribution] Free-plan watermark.
 * @returns {Promise<boolean>}
 */
export async function downloadLibraryItemViaServer({ generationId, filename, attribution = false } = {}) {
  if (!generationId) return false
  // The native shell saves via the Capacitor filesystem path already, and a
  // cross-origin GET navigation doesn't download cleanly in the WebView — let
  // the caller use the in-app path there.
  if (isNativePlatform()) return false
  if (typeof document === 'undefined') return false

  let ticket
  try {
    const res = await createTicket({ generationId, format: 'docx', filename, attribution })
    ticket = res?.data?.ticket
  } catch (err) {
    // not-found / permission-denied / type-not-supported → fall back silently.
    reportClientError(err, 'library_download_ticket')
    return false
  }
  if (!ticket) return false

  const a = document.createElement('a')
  a.href = apiUrl(`/api/teacher/download?ticket=${encodeURIComponent(ticket)}`)
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  return true
}
