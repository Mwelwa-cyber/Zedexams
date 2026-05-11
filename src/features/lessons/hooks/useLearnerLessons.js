// src/features/lessons/hooks/useLearnerLessons.js
//
// Real-time subscription to published slide-based lessons for a given
// grade. Mirrors useLearnerNotes — subject filter and title search are
// applied client-side so chips stay snappy without re-subscribing.

import { useEffect, useState, useMemo } from 'react'
import { subscribeLearnerLessons } from '../lib/firestore'

export function useLearnerLessons({ grade, subject = 'all', search = '' }) {
  const [lessons, setLessons] = useState([])
  const [loading, setLoading] = useState(!!grade)
  const [error, setError]     = useState(null)

  useEffect(() => {
    if (!grade) {
      setLessons([])
      setLoading(false)
      return
    }
    setLoading(true)
    const unsub = subscribeLearnerLessons(
      { grade },
      (next) => { setLessons(next); setLoading(false); setError(null) },
      (err)  => { setError(err);    setLoading(false) },
    )
    return unsub
  }, [grade])

  const filtered = useMemo(() => {
    let list = lessons
    if (subject !== 'all') list = list.filter(l => l.subject === subject)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(l => l.title?.toLowerCase().includes(q))
    }
    return list
  }, [lessons, subject, search])

  const countsBySubject = useMemo(() => {
    const counts = {}
    for (const l of lessons) counts[l.subject] = (counts[l.subject] || 0) + 1
    return counts
  }, [lessons])

  return { lessons: filtered, allLessons: lessons, countsBySubject, loading, error }
}
