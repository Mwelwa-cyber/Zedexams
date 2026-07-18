import { useEffect, useRef, useState } from 'react'

/**
 * Returns a value that only updates `delay` ms after the last time `value`
 * changed. The input itself must be rendered from the un-debounced state so
 * typing stays instant — only the expensive downstream work (a Firestore
 * query, a filter pass, an API call) should read the debounced value.
 *
 * Safe under React Strict Mode's mount/unmount/remount: the timer is owned
 * by a single effect keyed on `value`/`delay` and is always cleared on
 * cleanup, so a double-invoked effect never leaves a stray timer running.
 *
 * @param {*} value
 * @param {number} delay  ms to wait after the last change (default 300)
 */
export function useDebouncedValue(value, delay = 300) {
  const [debounced, setDebounced] = useState(value)
  const firstRun = useRef(true)

  useEffect(() => {
    // Skip the delay on mount so the initial value is available immediately.
    if (firstRun.current) {
      firstRun.current = false
      setDebounced(value)
      return undefined
    }
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debounced
}
