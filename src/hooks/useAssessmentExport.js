/**
 * React hook driving the branded, cached download buttons in the Assessment
 * Studio / library. Wraps assessmentExportClient with:
 *   - per-export-type status (idle | preparing | ready | failed)
 *   - a synchronous ref lock so a double-click/second-tap can't launch a second
 *     job while one is active (React state updates too late to catch this)
 *   - an aria-live status message for screen readers
 *   - a bounded retry surface (failureCode preserved) instead of a permanent
 *     spinner
 *
 * The heavy generation happens server-side; this hook only requests, observes
 * and navigates — optimised for Android Chrome / installed PWA where the
 * download is a real same-origin navigation.
 */

import { useCallback, useRef, useState } from 'react'
import { startBrandedDownload, AssessmentExportError } from '../utils/assessmentExportClient.js'

const MESSAGES = {
  idle: '',
  requesting: 'Starting download…',
  preparing: 'Preparing paper… this happens once, then downloads are instant.',
  ready: 'Download started.',
  failed: 'Could not prepare the download.',
}

/**
 * @param {string} assessmentId
 * @returns {{
 *   states: Record<string, {status:string, code?:string}>,
 *   message: string,
 *   isBusy: (exportType:string) => boolean,
 *   run: (exportType:string, opts?:{onFallback?:Function}) => Promise<boolean>,
 * }}
 */
export function useAssessmentExport(assessmentId) {
  const [states, setStates] = useState({})
  const [message, setMessage] = useState('')
  // Module-of-instance lock: which export types have an active job right now.
  const activeRef = useRef(new Set())

  const setTypeState = useCallback((exportType, status, code) => {
    setStates((prev) => ({ ...prev, [exportType]: { status, code } }))
    setMessage(MESSAGES[status] ?? '')
  }, [])

  const run = useCallback(async (exportType, opts = {}) => {
    // Synchronous dup-click guard — claim BEFORE any await.
    if (activeRef.current.has(exportType)) return false
    activeRef.current.add(exportType)
    setTypeState(exportType, 'requesting')
    try {
      await startBrandedDownload({
        assessmentId,
        exportType,
        onStatus: (s) => setTypeState(exportType, s.status, undefined),
      })
      setTypeState(exportType, 'ready')
      return true
    } catch (err) {
      const code = err instanceof AssessmentExportError ? err.code : 'EXPORT_FAILED'
      setTypeState(exportType, 'failed', code)
      // Let the caller run a client-side fallback (e.g. a brand-new unsaved
      // paper, or the server path being unavailable) so a download still works.
      if (opts.onFallback) {
        try { await opts.onFallback(err) } catch { /* fallback is best-effort */ }
      }
      return false
    } finally {
      activeRef.current.delete(exportType)
    }
  }, [assessmentId, setTypeState])

  const isBusy = useCallback((exportType) => {
    const s = states[exportType]?.status
    return s === 'requesting' || s === 'preparing'
  }, [states])

  return { states, message, isBusy, run }
}
