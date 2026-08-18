/**
 * The countdown behind a timed assessment.
 *
 * ## What it replaces
 *
 * `QuizRunnerV2` and `DailyExamRunner` each carried the same effect: derive the
 * remaining seconds from a fixed `endTime`, tick every 500 ms, and on reaching
 * zero clear the interval and auto-submit exactly once. The two were identical
 * down to the rounding and the guard ref, and differed only in the condition
 * that decides whether the clock is running (`started && mode === 'exam'` in
 * one, `status === 'ready' && !alreadyDone` in the other) — which is why the
 * hook takes that condition as a plain `active` boolean rather than trying to
 * know anything about modes or statuses.
 *
 * Two copies of a rule about exam time is one copy too many: a fix to the
 * resume behaviour, the tick rate or the double-submit guard had to be made
 * twice, and nothing failed if it was made once.
 *
 * ## The auto-submit latch is shared on purpose
 *
 * Both runners have a second path into the same submit — the quiz runner
 * finalises a session resumed after its deadline, the daily exam submits by
 * hand — and the timer must never fire alongside it. `expireOnce` exposes the
 * hook's own latch so the caller's other path claims the SAME one, which is
 * what makes a double submit structurally impossible rather than merely
 * unlikely.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { remainingSeconds, createOneShot } from '../utils/examCountdownCore'

/** How often the clock re-derives itself. Half a second so the displayed second is never visibly stale. */
const TICK_MS = 500

/**
 * @param {object} args
 * @param {number|null} args.endTime  fixed Unix-ms deadline; the clock is idle until it is set
 * @param {boolean} args.active       whether the clock should be running
 * @param {Function} args.onExpire    called at most once, when the clock reaches zero
 * @returns {{
 *   timeLeft: number,                seconds remaining
 *   stop: () => void,                clear the interval (e.g. on manual submit)
 *   expireOnce: (fn: Function) => boolean,  claim the shared auto-submit latch
 * }}
 */
export function useExamCountdown({ endTime, active, onExpire }) {
  const [timeLeft, setTimeLeft] = useState(0)
  const timerRef = useRef(null)
  const oneShotRef = useRef(null)
  if (oneShotRef.current === null) oneShotRef.current = createOneShot()

  // Held in a ref so a re-created callback never restarts the interval — the
  // effect below depends on `endTime` and `active` only, exactly as the two
  // hand-written versions did.
  const onExpireRef = useRef(onExpire)
  onExpireRef.current = onExpire

  const stop = useCallback(() => {
    clearInterval(timerRef.current)
    timerRef.current = null
  }, [])

  /** Run `fn` only if nothing has already claimed the auto-submit for this attempt. */
  const expireOnce = useCallback((fn) => oneShotRef.current.claim(fn), [])

  useEffect(() => {
    if (!active || !endTime) return undefined

    const tick = () => {
      const remaining = remainingSeconds(endTime, Date.now())
      setTimeLeft(remaining)
      if (remaining <= 0) {
        clearInterval(timerRef.current)
        timerRef.current = null
        oneShotRef.current.claim(() => onExpireRef.current?.(true))
      }
    }

    tick() // apply immediately on mount / resume
    timerRef.current = setInterval(tick, TICK_MS)
    return () => clearInterval(timerRef.current)
  }, [active, endTime])

  // Unmounting mid-attempt must not leave an interval running.
  useEffect(() => stop, [stop])

  return { timeLeft, stop, expireOnce }
}

export default useExamCountdown
