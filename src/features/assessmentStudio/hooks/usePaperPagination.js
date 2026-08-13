/**
 * The studio's live page count: idle → measuring → ready, and stale on edit.
 *
 * The number this replaces was `Math.ceil((questionCount + totalMarks * 0.4) / 8)`
 * printed as "Est. 3 pages · A4". This one is measured, so it costs a real
 * render — which is what the debounce and the staleness rule are for. A teacher
 * typing a question should not trigger forty measurements, and should not be
 * looking at a page count for the paper they had a minute ago.
 *
 * ## One printable model, fingerprinted AND measured
 *
 * The inputs are folded into a single canonical object (`buildPrintableModel`),
 * that object is what the fingerprint identifies, and that same object is what
 * the measurement renders. An earlier version fingerprinted passages, parts and
 * pagebreaks while handing the measurement only the assessment and questions,
 * so editing a passage marked the count stale and then re-measured a document
 * that did not contain the edit — a "fresh" answer identical to the stale one.
 *
 * ## Why STALE is a state rather than "just remeasure"
 *
 * Keeping the last number on screen while a new one is computed shows a count
 * for a different document, indistinguishable from a current one. A teacher
 * checking whether their edit pushed the paper onto a fourth sheet would read
 * the answer to the question they asked before the edit.
 *
 * ## The in-flight token is cleared when the paper changes, not when the next
 * ## measurement starts
 *
 * This is the subtle one. Invalidating the RESULT immediately is not enough:
 * during the debounce window there is no new measurement yet, so a measurement
 * already in flight for the old paper still matches the token, resolves, and
 * writes itself back as `ready` — replacing the stale state with a confident
 * page count for a document the teacher has already changed. The token is
 * therefore cleared in the same effect that notices the fingerprint moved.
 *
 * ## The scheduling effect is keyed on the fingerprint and nothing else
 *
 * The studio rebuilds its questions array on every render, so an effect keyed on
 * that array — or on a callback closing over it — re-runs every render,
 * schedules another measurement, sets state when it lands, and renders again: a
 * loop that renders the whole paper into an iframe each time round. The first
 * draft of this hook did exactly that and hung the test run.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  PAGINATION_STATES, emptyPagination, paginationLabel,
} from '../../../utils/paperPaginationCore.js'
import { buildPrintableModel, printableFingerprint } from '../lib/printableModel.js'

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
  const inFlightRef = useRef(null)

  const model = buildPrintableModel({ assessment, questions, passages, parts, pagebreaks, mode })
  const fingerprint = printableFingerprint(model)

  // The latest model, reachable from the effect without its identity being able
  // to trigger it. Written every render on purpose: the measurement must render
  // what is on screen now, not what was on screen when the fingerprint last
  // changed.
  const modelRef = useRef(null)
  modelRef.current = model
  const measureRef = useRef(null)
  measureRef.current = measure

  const run = useCallback(async (fp) => {
    const target = modelRef.current
    inFlightRef.current = fp
    setResult((prev) => (
      prev.status === PAGINATION_STATES.MEASURING ? prev : { ...prev, status: PAGINATION_STATES.MEASURING }
    ))
    let next
    try {
      const measureFn = measureRef.current
        || (await import('../lib/paperPaginationMeasure.js')).measurePagination
      next = await measureFn(target)
    } catch (err) {
      next = emptyPagination(PAGINATION_STATES.FAILED, {
        issues: [{ code: 'measure-failed', message: err?.message || 'Could not measure the pages.' }],
      })
    }
    // A reply for a paper that has since changed is discarded, never displayed.
    if (inFlightRef.current !== fp) return
    setResult({ ...next, fingerprint: fp })
  }, [])

  useEffect(() => {
    if (!enabled) {
      inFlightRef.current = null
      setResult((prev) => (prev.status === PAGINATION_STATES.IDLE ? prev : emptyPagination(PAGINATION_STATES.IDLE)))
      return undefined
    }
    // Order matters, and this is the whole of the correctness argument:
    //   1. abandon whatever is in flight — it is measuring the old paper,
    //   2. invalidate the displayed result,
    //   3. only then schedule the replacement.
    // Doing (1) at the start of the next measurement instead leaves a window,
    // the length of the debounce, in which the old measurement can land and
    // overwrite `stale` with a `ready` count for a document that no longer
    // exists.
    inFlightRef.current = null
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
    fingerprint: result.fingerprint,
    label: paginationLabel(result),
    isMeasuring: result.status !== PAGINATION_STATES.READY && result.status !== PAGINATION_STATES.FAILED,
    remeasure,
  }
}

export default usePaperPagination
