// src/features/lessons/hooks/useLearnerLessons.js
//
// Real-time subscription to published slide-based lessons for a given
// grade. Mirrors useLearnerNotes — subject filter and title search are
// applied client-side so chips stay snappy without re-subscribing.

import { useEffect, useState, useMemo, useCallback } from 'react'
import { subscribeLearnerLessons } from '../lib/firestore'
import { useDebouncedValue } from '../../../hooks/useDebouncedValue'

export function useLearnerLessons({ grade, subject = 'all', search = '' }) {
  const [lessons, setLessons] = useState([])
  const [loading, setLoading] = useState(!!grade)
  const [error, setError]     = useState(null)
  // Bumping reloadKey tears down + re-creates the subscription, which is how
  // the "Try again" button recovers from a read error.
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey(k => k + 1), [])

  useEffect(() => {
    if (!grade) {
      setLessons([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    const unsub = subscribeLearnerLessons(
      { grade },
      (next) => { setLessons(next); setLoading(false); setError(null) },
      (err)  => { setError(err);    setLoading(false) },
    )
    return unsub
  }, [grade, reloadKey])

  const debouncedSearch = useDebouncedValue(search, 200)
  const filtered = useMemo(() => {
    let list = lessons
    if (subject !== 'all') list = list.filter(l => l.subject === subject)
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.toLowerCase()
      list = list.filter(l =>
        l.title?.toLowerCase().includes(q) ||
        l.excerpt?.toLowerCase().includes(q) ||
        l.topic?.toLowerCase().includes(q),
      )
    }
    return list
  }, [lessons, subject, debouncedSearch])

  const countsBySubject = useMemo(() => {
    const counts = {}
    for (const l of lessons) counts[l.subject] = (counts[l.subject] || 0) + 1
    return counts
  }, [lessons])

  return { lessons: filtered, allLessons: lessons, countsBySubject, loading, error, reload }
}
