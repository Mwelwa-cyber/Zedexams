import { useEffect, useState } from 'react'
import { subscribeMyLessonPlans } from '../../../utils/lessonMemoryService.js'

/**
 * useLessonMemory — live subscription to ALL of the signed-in teacher's saved
 * lesson memory records (the `lessonPlans` collection). The studio derives the
 * per-subtopic lesson list, coverage, and recommendations from this one source
 * with the pure helpers in utils/lessonMemory.js.
 *
 * One subscription powers every memory-aware panel, so a teaching-status change
 * or a freshly generated lesson reflects everywhere instantly. Fail-closed: any
 * subscription error resolves to an empty list so the studio degrades to its
 * pre-memory behaviour rather than crashing.
 *
 * @param {string|null} uid
 * @returns {{ plans: object[], loading: boolean, error: string|null }}
 */
export function useLessonMemory(uid) {
  const [state, setState] = useState({ plans: [], loading: !!uid, error: null })

  useEffect(() => {
    if (!uid) {
      setState({ plans: [], loading: false, error: null })
      return undefined
    }
    setState((s) => ({ ...s, loading: true, error: null }))
    const unsubscribe = subscribeMyLessonPlans(
      uid,
      (rows) => setState({ plans: rows, loading: false, error: null }),
      (err) => setState({ plans: [], loading: false, error: err instanceof Error ? err.message : String(err) }),
    )
    return unsubscribe
  }, [uid])

  return state
}
