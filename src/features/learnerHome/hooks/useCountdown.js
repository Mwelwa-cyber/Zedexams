/**
 * useCountdown — a shared "now" that ticks every second ONLY while the
 * page is visible. Pauses on document hide and recalculates immediately
 * on resume, so no background timers burn battery and the countdown is
 * always correct after the app comes back (spec §12/§24).
 */
import { useEffect, useState } from 'react'

export default function useCountdown(enabled = true) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return undefined
    let timer = null
    const start = () => {
      if (timer) return
      setNow(Date.now()) // immediate recalc on resume
      timer = setInterval(() => setNow(Date.now()), 1000)
    }
    const stop = () => {
      if (timer) { clearInterval(timer); timer = null }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') stop()
      else start()
    }
    if (document.visibilityState !== 'hidden') start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [enabled])

  return now
}
