import { useEffect, useRef, useState } from 'react'
import { PREP_STEPS } from '../shared/components/liveGenerationSections'

/**
 * Drives the Live Generation Canvas reveal state machine.
 *
 * A generation goes through three visible phases and this hook owns the timing:
 *
 *   1. preparing — while the model is still working and no result exists yet,
 *      walk the fixed prep steps ("Reading your teacher details" → "Reading the
 *      curriculum" → "Checking grade, subject & topic") on a gentle timer so the
 *      wait feels intentional instead of a dead spinner.
 *   2. revealing — once the result lands, unveil the document one section at a
 *      time (`revealedCount` climbs) so the teacher watches it being built
 *      rather than getting a wall of text dumped at the end.
 *   3. complete — every section shown; the action bar (Continue editing / Save
 *      to library / Regenerate) takes over.
 *
 * The generators return the whole document at once (or stream token counts), so
 * the reveal is an honest, paced unveiling of the real result — never invented
 * streaming. Respects `prefers-reduced-motion` by revealing everything at once.
 *
 * @param {object} args
 * @param {'idle'|'generating'|'success'|'error'} args.status
 * @param {number} args.sectionCount — number of sections the result yielded.
 * @param {number} [args.stepMs=650]  — ms between section reveals.
 * @param {number} [args.prepMs=1400] — ms between prep-step advances.
 * @returns {{ phase, prepIndex, revealedCount, complete, reset }}
 */
export function useLiveReveal({ status, sectionCount, stepMs = 650, prepMs = 1400 }) {
  const reduced = usePrefersReducedMotion()
  const [prepIndex, setPrepIndex] = useState(0)
  const [revealedCount, setRevealedCount] = useState(0)
  const runIdRef = useRef(0)

  const generating = status === 'generating'
  const success = status === 'success'

  // Prep-step walk while generating with nothing to show yet.
  useEffect(() => {
    if (!generating) return undefined
    setPrepIndex(0)
    setRevealedCount(0)
    if (reduced) {
      setPrepIndex(PREP_STEPS.length - 1)
      return undefined
    }
    const id = setInterval(() => {
      setPrepIndex((i) => Math.min(i + 1, PREP_STEPS.length - 1))
    }, prepMs)
    return () => clearInterval(id)
  }, [generating, reduced, prepMs])

  // Section-by-section reveal once the result is in.
  useEffect(() => {
    if (!success || sectionCount <= 0) return undefined
    const myRun = ++runIdRef.current
    if (reduced) {
      setRevealedCount(sectionCount)
      return undefined
    }
    // Start from 1 (first section pops in immediately so there's no blank beat).
    setRevealedCount(1)
    const id = setInterval(() => {
      setRevealedCount((c) => {
        if (runIdRef.current !== myRun) return c
        if (c >= sectionCount) {
          clearInterval(id)
          return c
        }
        return c + 1
      })
    }, stepMs)
    return () => clearInterval(id)
  }, [success, sectionCount, reduced, stepMs])

  // When we leave the success/generating states, clear the counters so the next
  // run starts fresh.
  useEffect(() => {
    if (status === 'idle' || status === 'error') {
      setRevealedCount(0)
      setPrepIndex(0)
    }
  }, [status])

  const complete = success && (sectionCount === 0 || revealedCount >= sectionCount)
  let phase = 'idle'
  if (generating) phase = 'preparing'
  else if (success) phase = complete ? 'complete' : 'revealing'
  else if (status === 'error') phase = 'error'

  function reset() {
    setPrepIndex(0)
    setRevealedCount(0)
  }

  return { phase, prepIndex, revealedCount, complete, reset }
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(mq.matches)
    onChange()
    if (mq.addEventListener) mq.addEventListener('change', onChange)
    else mq.addListener(onChange)
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange)
      else mq.removeListener(onChange)
    }
  }, [])
  return reduced
}
