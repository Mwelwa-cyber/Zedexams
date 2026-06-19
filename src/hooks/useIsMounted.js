import { useEffect, useRef } from 'react'

/**
 * Returns a ref whose `.current` is true while the component is mounted and
 * false after it unmounts. Guard post-`await` state updates with
 * `if (!isMounted.current) return` so a slow request that resolves after the
 * user has navigated away doesn't call setState on an unmounted component
 * (a React warning + wasted work). The teacher studios use this because their
 * generations legitimately run for tens of seconds.
 */
export function useIsMounted() {
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  return mounted
}
