import { useEffect, useRef, useState } from 'react'
import {
  resolveDelayedFlag,
  DEFAULT_DELAY_MS,
  DEFAULT_MIN_VISIBLE_MS,
} from '../utils/delayedFlagCore'

/**
 * useDelayedFlag — gate a loader behind a short hold-off, then hold it for a
 * minimum once shown. All timing decisions live in delayedFlagCore; this hook
 * only owns the timers and the state.
 *
 *   const showLoader = useDelayedFlag(saving)
 *
 * Returns false for the first ~200ms of `active`, so an operation that
 * finishes faster than that renders no loader at all.
 */
export default function useDelayedFlag(
  active,
  { delay = DEFAULT_DELAY_MS, minVisible = DEFAULT_MIN_VISIBLE_MS } = {},
) {
  const [visible, setVisible] = useState(false)
  const shownAt = useRef(0)

  useEffect(() => {
    const { action, waitMs } = resolveDelayedFlag({
      active,
      visible,
      now: Date.now(),
      shownAt: shownAt.current,
      delay,
      minVisible,
    })
    if (action === 'none') return undefined

    const id = setTimeout(() => {
      if (action === 'show') shownAt.current = Date.now()
      setVisible(action === 'show')
    }, waitMs)
    return () => clearTimeout(id)
  }, [active, visible, delay, minVisible])

  return visible
}
