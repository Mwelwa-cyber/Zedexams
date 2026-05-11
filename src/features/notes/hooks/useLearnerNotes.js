// src/features/notes/hooks/useLearnerNotes.js
//
// Real-time subscription to published notes for a given grade.
// Subject filter and title search are applied client-side (Firestore can
// do subject server-side too, but client-side keeps the chips snappy
// without re-subscribing).
//
// Notes share the `lessons` Firestore collection with slide-based lessons.
// Slide-only docs (no `noteFormat`, has `slides[]`) are dropped here so
// the /notes surface only ever shows reading material — slide lessons
// belong on /lessons.

import { useEffect, useState, useMemo } from 'react'
import { subscribeLearnerNotes } from '../lib/firestore'

function isReadingNote(doc) {
  if (!doc) return false
  if (doc.noteFormat) return true
  return !(Array.isArray(doc.slides) && doc.slides.length > 0)
}

export function useLearnerNotes({ grade, subject = 'all', search = '' }) {
  const [notes, setNotes]     = useState([])
  const [loading, setLoading] = useState(!!grade)
  const [error, setError]     = useState(null)

  useEffect(() => {
    if (!grade) {
      setNotes([])
      setLoading(false)
      return
    }
    setLoading(true)
    const unsub = subscribeLearnerNotes(
      { grade },
      (next) => { setNotes(next.filter(isReadingNote)); setLoading(false); setError(null) },
      (err)  => { setError(err);  setLoading(false) },
    )
    return unsub
  }, [grade])

  const filtered = useMemo(() => {
    let list = notes
    if (subject !== 'all') list = list.filter(n => n.subject === subject)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(n => n.title?.toLowerCase().includes(q))
    }
    return list
  }, [notes, subject, search])

  const countsBySubject = useMemo(() => {
    const counts = {}
    for (const n of notes) counts[n.subject] = (counts[n.subject] || 0) + 1
    return counts
  }, [notes])

  return { notes: filtered, allNotes: notes, countsBySubject, loading, error }
}
