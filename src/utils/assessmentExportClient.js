/**
 * Client orchestration for branded, cached assessment downloads.
 *
 * Flow (replaces the old "generate in the browser, then navigate to a
 * firebasestorage.googleapis.com download URL" path):
 *   1. call requestAssessmentExport({ assessmentId, exportType })
 *   2. ready   → navigate to the same-origin branded URL and the download starts
 *   3. missing → the server has started generating; poll getAssessmentExportStatus
 *                with bounded backoff, then navigate when ready ("Preparing…")
 *   4. failed  → throw an Error carrying the failureCode so the button can offer
 *                a retry instead of spinning forever
 *
 * The browser only ever sees a zedexams.com URL — never the Firebase download
 * token or the raw storage path. A short-lived ticket (returned by the callable)
 * is the bearer credential in the query string; the domain shown in the
 * download dialog is zedexams.com regardless.
 */

import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../firebase/config.js'

const functions = getFunctions(app, 'us-central1')
const requestExportCallable = httpsCallable(functions, 'requestAssessmentExport')
const statusCallable = httpsCallable(functions, 'getAssessmentExportStatus')

/** The three server-rendered export types the studio buttons map to. */
export const EXPORT_TYPES = {
  paperDocx: 'paper-docx',
  paperPdf: 'paper-pdf',
  schemeDocx: 'scheme-docx',
}

/** Bounded polling schedule (ms) while an export is being generated. Caps total
 * wait around ~30s — a first-time generation on a big paper — before giving up
 * and letting the caller fall back. */
const POLL_DELAYS_MS = [1200, 1500, 1800, 2200, 2600, 3000, 3000, 3500, 3500, 4000, 4000]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Same-origin navigation to the branded download URL — a real navigation so
 * the browser's own download manager names the file from Content-Disposition
 * (works on every browser, including the Android/in-app WebViews that drop
 * blob: filenames). */
function navigateToDownload(downloadPath, ticket) {
  if (typeof document === 'undefined') return
  const url = `${downloadPath}?t=${encodeURIComponent(ticket)}`
  const a = document.createElement('a')
  a.href = url
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

/** Error subclass so callers can read the machine failureCode. */
export class AssessmentExportError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'AssessmentExportError'
    this.code = code || 'EXPORT_FAILED'
  }
}

/**
 * Start (or reuse) a branded download for one export type.
 *
 * @param {object} opts
 * @param {string} opts.assessmentId
 * @param {string} opts.exportType   one of EXPORT_TYPES values
 * @param {(state:{status:string, cacheHit?:boolean}) => void} [opts.onStatus]
 * @returns {Promise<{status:'ready', cacheHit:boolean}>}
 * @throws {AssessmentExportError} on a failed generation or timeout
 */
export async function startBrandedDownload({ assessmentId, exportType, onStatus }) {
  if (!assessmentId) throw new AssessmentExportError('This paper must be saved first.', 'NOT_SAVED')
  const emit = (s) => { try { onStatus?.(s) } catch { /* status is advisory */ } }

  emit({ status: 'requesting' })
  const first = (await requestExportCallable({ assessmentId, exportType })).data || {}

  if (first.status === 'ready') {
    navigateToDownload(first.downloadPath, first.ticket)
    emit({ status: 'ready', cacheHit: Boolean(first.cacheHit) })
    return { status: 'ready', cacheHit: Boolean(first.cacheHit) }
  }
  if (first.status === 'failed') {
    throw new AssessmentExportError('The export could not be prepared.', first.failureCode)
  }

  // status === 'generating' (or 'missing'): poll with bounded backoff.
  emit({ status: 'preparing' })
  for (const delay of POLL_DELAYS_MS) {
    await sleep(delay)
    const s = (await statusCallable({ assessmentId, exportType })).data || {}
    if (s.status === 'ready') {
      navigateToDownload(s.downloadPath, s.ticket)
      emit({ status: 'ready', cacheHit: Boolean(s.cacheHit) })
      return { status: 'ready', cacheHit: Boolean(s.cacheHit) }
    }
    if (s.status === 'failed') {
      throw new AssessmentExportError('The export could not be prepared.', s.failureCode)
    }
    emit({ status: 'preparing' })
  }
  throw new AssessmentExportError('Preparing the download is taking longer than expected.', 'TIMEOUT')
}

/** Best-effort cache warm after a save — fire-and-forget, never throws. */
export function prewarmExports(assessmentId) {
  if (!assessmentId) return
  try {
    const warm = httpsCallable(functions, 'prewarmAssessmentExports')
    warm({ assessmentId }).catch(() => {})
  } catch { /* prewarming is best-effort */ }
}
