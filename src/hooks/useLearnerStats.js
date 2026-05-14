import { useEffect, useState } from 'react'
import { subscribeToLearnerStats, levelFromXp } from '../utils/gamificationService'

/**
 * useLearnerStats — subscribe to the current learner's gamification doc
 * (/learnerStats/{uid}) and return the live stats plus a derived level
 * object. Returns sensible defaults until the first snapshot arrives, so
 * callers never have to guard against null.
 */
export default function useLearnerStats(uid) {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!uid) { setStats(null); setLoading(false); return undefined }
    setLoading(true)
    const unsub = subscribeToLearnerStats(uid, (next) => {
      setStats(next)
      setLoading(false)
    })
    return () => { unsub && unsub() }
  }, [uid])

  const level = levelFromXp(stats?.xp ?? 0)

  return { stats, level, loading }
}
