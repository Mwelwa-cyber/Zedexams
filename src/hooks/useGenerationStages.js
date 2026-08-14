import { useEffect, useRef, useState } from 'react'
import {
  resolveStages,
  computeStageStates,
} from '../shared/components/aiGenerationStages'

const TICK_MS = 250

/**
 * Drives the AI generation progress tracker.
 *
 * It owns an internal elapsed-time ticker so callers that have no live
 * progress (the single-promise callables) still get a believable, advancing
 * stage walk. Callers that DO have live progress pass `activeStageId` and the
 * ticker is ignored — the real phase wins.
 *
 * Lifecycle:
 *   • running flips true  → reset the clock, start ticking.
 *   • running flips false → if there was no error, snap every stage to done
 *                           (the "landed" state) and stop the clock.
 *   • error set           → freeze on the active stage, marked errored.
 *
 * Honours `prefers-reduced-motion`: the ticker still advances stages (so the
 * text stays truthful) but the component suppresses pulsing/sweeping animation.
 *
 * @param {object} args
 * @param {boolean} args.running         — is a generation currently in flight.
 * @param {string|string[]} args.preset  — STAGE_PRESETS key or explicit stage ids.
 * @param {string} [args.activeStageId]  — real driver; overrides the timer.
 * @param {*} [args.error]               — truthy when the run failed.
 * @returns {{ items, activeIndex, percent, stages, elapsedMs, reducedMotion }}
 */
export function useGenerationStages({ running, preset, activeStageId, error }) {
  const stagesRef = useRef([])
  // Resolve stages once per preset identity. The preset is almost always a
  // stable string, but support an array reference too.
  const presetKey = Array.isArray(preset) ? preset.join(',') : preset
  if (stagesRef.current.__key !== presetKey) {
    const resolved = resolveStages(preset)
    resolved.__key = presetKey
    stagesRef.current = resolved
  }
  const stages = stagesRef.current

  const [elapsedMs, setElapsedMs] = useState(0)
  // Latches true once a run completes without error, so the stages stay in the
  // "all done" state until the next run begins (rather than snapping back).
  const [finished, setFinished] = useState(false)
  const startRef = useRef(null)
  const wasRunningRef = useRef(false)

  const reducedMotion = usePrefersReducedMotion()

  useEffect(() => {
    if (running) {
      // New run: reset the clock and clear any previous "finished" latch.
      if (!wasRunningRef.current) {
        startRef.current = Date.now()
        setElapsedMs(0)
        setFinished(false)
        wasRunningRef.current = true
      }
      // No timer needed when a real driver is steering, or on error.
      if (activeStageId || error) return undefined
      const id = setInterval(() => {
        setElapsedMs(Date.now() - (startRef.current || Date.now()))
      }, TICK_MS)
      return () => clearInterval(id)
    }

    // running just went false.
    if (wasRunningRef.current) {
      wasRunningRef.current = false
      if (!error) setFinished(true)
    }
    return undefined
  }, [running, activeStageId, error])

  const errored = Boolean(error) && running
  const state = computeStageStates({
    stages,
    elapsedMs,
    activeStageId: errored ? undefined : activeStageId,
    running,
    finished: finished && !error,
    errored,
  })

  return { ...state, stages, elapsedMs, reducedMotion }
}

/* ── prefers-reduced-motion ────────────────────────────────────── */

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(mq.matches)
    onChange()
    // addEventListener for modern browsers, fall back to addListener.
    if (mq.addEventListener) mq.addEventListener('change', onChange)
    else mq.addListener(onChange)
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange)
      else mq.removeListener(onChange)
    }
  }, [])
  return reduced
}
