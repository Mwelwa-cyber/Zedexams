import { useState, useEffect } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { db } from '../../../firebase/config.js'

/**
 * Subscribes to a lesson series in Firestore and returns real-time progress.
 *
 * Collection path: lessonSeries/{uid}/{seriesId}
 * Each document has at minimum:
 *   - lessonNumber: string
 *   - status: string  ('completed' | 'pending' | …)
 *
 * @param {string|null} uid       - Firebase Auth user ID
 * @param {string|null} seriesId  - Series identifier (null until first plan generated)
 * @returns {{
 *   completedCount:   number,
 *   completedLessons: string[],
 *   seriesLoading:    boolean,
 *   seriesError:      string|null
 * }}
 */
export function useLessonSeries(uid, seriesId) {
  const [completedLessons, setCompletedLessons] = useState([])
  const [seriesLoading, setSeriesLoading]       = useState(true)
  const [seriesError, setSeriesError]           = useState(null)

  useEffect(() => {
    if (!uid || !seriesId) {
      setCompletedLessons([])
      setSeriesLoading(false)
      setSeriesError(null)
      return
    }

    setSeriesLoading(true)
    setSeriesError(null)

    const lessonsRef = collection(db, 'lessonSeries', uid, seriesId)

    const unsubscribe = onSnapshot(
      lessonsRef,
      (snapshot) => {
        const completed = []
        snapshot.forEach((doc) => {
          const data = doc.data()
          if (data.status === 'completed') {
            completed.push(String(data.lessonNumber))
          }
        })
        setCompletedLessons(completed)
        setSeriesLoading(false)
        setSeriesError(null)
      },
      (err) => {
        setSeriesError(err instanceof Error ? err.message : String(err))
        setSeriesLoading(false)
      },
    )

    return unsubscribe
  }, [uid, seriesId])

  return {
    completedCount:   completedLessons.length,
    completedLessons,
    seriesLoading,
    seriesError,
  }
}
