/**
 * useDayKey — a "YYYY-MM-DD" string that changes when the local date does.
 *
 * The learner surfaces read the school calendar once, at mount, and memoise it
 * on `[]`. That is right for the cost — the answer only changes at midnight —
 * and wrong for a phone, where a tab is not closed so much as put down. A
 * learner who leaves the app open from 6 September into 7 September is still
 * told that school is closed and that Term 3 opens tomorrow, on the morning it
 * opened. Countdowns measured in whole days make that visible in a way the old
 * bare "Term 2" never did, which is why it needs answering here.
 *
 * Use it as the dependency of whatever reads the date:
 *
 *   const dayKey = useDayKey()
 *   const calendar = useMemo(() => resolveLearnerCalendar(), [dayKey])
 *
 * TWO triggers, because neither alone is enough. The timer is the one that
 * fires for a tab genuinely left in the foreground; browsers throttle or defer
 * timers in a backgrounded tab, so the visibility/focus listener is what
 * catches the far more common case — the phone in a pocket overnight, opened
 * at breakfast. Both funnel through one comparison, and identical state is a
 * no-op in React, so a tab switch inside one day re-renders nothing.
 */
import { useEffect, useRef, useState } from 'react'

export function dayKeyOf(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * The Date a day key names, at local midnight.
 *
 * Pass this INTO whatever reads the calendar rather than letting the reader
 * call `new Date()` itself: it makes `dayKey` a real argument instead of a
 * bare cache key, which is both what `react-hooks/exhaustive-deps` can see and
 * what makes the memo an honest pure function of its dependency. The calendar
 * is date-only, so midnight of the key and "now" resolve identically.
 */
export function dayKeyDate(key) {
  const d = new Date(`${key}T00:00:00`)
  return Number.isNaN(d.getTime()) ? new Date() : d
}

/** Milliseconds until the next local midnight, plus a second of slack. */
export function msUntilNextDay(now = new Date()) {
  const next = new Date(now)
  next.setHours(24, 0, 0, 0)
  return Math.max(1000, next.getTime() - now.getTime() + 1000)
}

export default function useDayKey() {
  const [key, setKey] = useState(dayKeyOf)
  const timerRef = useRef(null)

  useEffect(() => {
    let alive = true

    const sync = () => {
      if (!alive) return
      setKey((current) => {
        const next = dayKeyOf()
        return current === next ? current : next
      })
      schedule()
    }

    function schedule() {
      if (!alive) return
      clearTimeout(timerRef.current)
      // setTimeout's delay is a 32-bit signed value, so a full day is fine,
      // but a throttled background tab may fire it late — `sync` re-reads the
      // clock rather than assuming the timer was punctual.
      timerRef.current = setTimeout(sync, msUntilNextDay())
    }

    const onWake = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      sync()
    }

    schedule()
    document.addEventListener('visibilitychange', onWake)
    window.addEventListener('focus', onWake)
    return () => {
      alive = false
      clearTimeout(timerRef.current)
      document.removeEventListener('visibilitychange', onWake)
      window.removeEventListener('focus', onWake)
    }
  }, [])

  return key
}
