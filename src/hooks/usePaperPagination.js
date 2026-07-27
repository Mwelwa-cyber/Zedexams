/**
 * The studio's live page count: idle → measuring → ready, and stale on edit.
 *
 * The number this replaces was `Math.ceil((questionCount + totalMarks * 0.4) / 8)`
 * printed as "Est. 3 pages · A4". This one is measured, so it costs a real
 * render — which is what the debounce and the staleness rule are for. A teacher
 * typing a question should not trigger forty measurements, and should not be
 * looking at a page count for the paper they had a minute ago.
 *
 * ## Why STALE is a state rather than "just remeasure"
 *
 * The alternative is to keep showing the last number while a new one is
 * computed. That number is about a different document and is indistinguishable
 * on screen from a current one — a teacher checking whether their edit pushed
 * the paper onto a fourth sheet would read the answer to the question they
 * asked before the edit. So an edit invalidates the result immediately and the
 * label goes back to "Calculating pages…", even though a measurement is only
 * scheduled.
 *
 * ## The scheduling effect depends on the FINGERPRINT and nothing else
 *
 * This is load-bearing, not a tidy-up. The studio rebuilds its questions array
 * on every render, so an effect keyed on that array — or on a callback closing
 * over it — re-runs every render, schedules another measurement, sets state
 * when it lands, and renders again: a measurement loop that never settles and
 * renders the whole paper into an iframe each time round. The first draft of
 * this hook did exactly that and hung the test run.
 *
 * The fingerprint is the only correct key, because it is the only value that
 * changes when the PRINTED PAGE changes. The inputs travel in a ref so the
 * measurement always reads the latest ones without their identity being able to
 * trigger it.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  PAGINATION_STATES, emptyPagination, paperFingerprint, paginationLabel,
} from '../utils/paperPaginationCore.js'

/** Long enough to swallow typing, short enough to feel like it is keeping up. */
const DEBOUNCE_MS = 700

export function usePaperPagination({
  assessment,
  questions,
  passages = [],
  parts = [],
  pagebreaks = [],
  mode = 'paper',
  enabled = true,
  debounceMs = DEBOUNCE_MS,
  measure,
} = {}) {
  const [result, setResult] = useState(() => emptyPagination(PAGINATION_STATES.IDLE))
  const timerRef = useRef(null)
  // Every measurement carries the fingerprint it was started for. A slow one
  // that lands after the paper moved on must not overwrite a newer answer —
  // without this, a fast second edit can be overwritten by the first edit's
  // reply and the teacher is shown a count for a paper that no longer exists.
  const inFlightRef = useRef(null)

  const fingerprint = paperFingerprint({
    questions,
    passages,
    parts,
    pagebreaks,
    details: { mode, title: assessment?.title, schoolName: assessment?.schoolName },
  })

  // The latest inputs, reachable from the effect without being able to trigger
  // it. Written on every render on purpose: the measurement must read what is
  // on screen now, not what was on screen when the fingerprint last changed.
  const inputsRef = useRef(null)
  inputsRef.current = { assessment, questions, mode, measure }

  const run = useCallback(async (fp) => {
    const { assessment: a, questions: q, mode: m, measure: fn } = inputsRef.current || {}
    inFlightRef.current = fp
    setResult((prev) => (
      prev.status === PAGINATION_STATES.MEASURING ? prev : { ...prev, status: PAGINATION_STATES.MEASURING }
    ))
    let next
    try {
      const measureFn = fn || (await import('../utils/paperPaginationMeasure.js')).measurePagination
      next = await measureFn(a, q, { mode: m })
    } catch (err) {
      next = emptyPagination(PAGINATION_STATES.FAILED, {
        issues: [{ code: 'measure-failed', message: err?.message || 'Could not measure the pages.' }],
      })
    }
    // A reply for a paper that has since changed is discarded, not displayed.
    if (inFlightRef.current !== fp) return
    setResult({ ...next, fingerprint: fp })
  }, [])

  useEffect(() => {
    if (!enabled) {
      setResult((prev) => (prev.status === PAGINATION_STATES.IDLE ? prev : emptyPagination(PAGINATION_STATES.IDLE)))
      return undefined
    }
    // Invalidate FIRST, schedule second. The label must stop claiming a number
    // for the previous paper the moment the paper changes, not when the
    // replacement arrives.
    setResult((prev) => (
      prev.status === PAGINATION_STATES.READY && prev.fingerprint !== fingerprint
        ? { ...prev, status: PAGINATION_STATES.STALE }
        : prev
    ))
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => run(fingerprint), debounceMs)
    return () => clearTimeout(timerRef.current)
  }, [fingerprint, enabled, debounceMs, run])

  useEffect(() => () => { inFlightRef.current = null }, [])

  const remeasure = useCallback(() => {
    clearTimeout(timerRef.current)
    return run(fingerprint)
  }, [run, fingerprint])

  return {
    ...result,
    label: paginationLabel(result),
    isMeasuring: result.status !== PAGINATION_STATES.READY && result.status !== PAGINATION_STATES.FAILED,
    remeasure,
  }
}

export default usePaperPagination
