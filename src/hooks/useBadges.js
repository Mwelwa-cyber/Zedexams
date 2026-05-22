import { useState, useEffect } from 'react'
import { useFirestore } from './useFirestore'
import { evaluateBadges } from '../config/badges'

/**
 * useBadges — computes badge state for the current user.
 *
 * Fetches the user's last 50 results from Firestore and runs
 * the badge evaluator from badges.js.
 *
 * @param {string} userId
 * @returns {{
 *   earned: import('../config/badges').Badge[],
 *   progress: { badge, progress, totalAttempts, avgScore }[],
 *   loading: boolean,
 *   refresh: () => void,
 * }}
 */
export function useBadges(userId) {
  const { getUserResults } = useFirestore()
  const [earned,   setEarned]   = useState([])
  const [progress, setProgress] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [tick,     setTick]     = useState(0)

  function refresh() { setTick(t => t + 1) }

  useEffect(() => {
    if (!userId) { setLoading(false); return }
    let cancelled = false
    setLoading(true)

    getUserResults(userId, 50).then(results => {
      if (cancelled) return
      const { earned: e, progress: p } = evaluateBadges(results)
      setEarned(e)
      setProgress(p)
      setLoading(false)
    }).catch(err => {
      if (cancelled) return
      console.error('useBadges:', err)
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [userId, tick, getUserResults])

  return { earned, progress, loading, refresh }
}
