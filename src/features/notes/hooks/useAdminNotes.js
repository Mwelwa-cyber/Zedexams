// src/features/notes/hooks/useAdminNotes.js
//
// Real-time admin notes list with filters + client-side title search.
// Filters that translate into Firestore queries: subject, grade, status.
// `search` is applied client-side after the snapshot arrives.

import { useEffect, useState, useMemo } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { subscribeAdminNotes } from '../lib/firestore'

export function useAdminNotes({ subject = 'all', grade = 'all', status = 'all', search = '' } = {}) {
  const { currentUser } = useAuth()
  const [notes, setNotes]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    if (!currentUser?.uid) {
      setNotes([])
      setLoading(false)
      return
    }
    setLoading(true)
    const unsub = subscribeAdminNotes(
      {
        uid:     currentUser.uid,
        subject: subject === 'all' ? undefined : subject,
        grade:   grade   === 'all' ? undefined : grade,
        status:  status  === 'all' ? undefined : status,
      },
      (next) => { setNotes(next); setLoading(false); setError(null) },
      (err)  => { setError(err);  setLoading(false) },
    )
    return unsub
  }, [currentUser?.uid, subject, grade, status])

  // Client-side title search — Firestore doesn't do substring queries cheaply.
  const filtered = useMemo(() => {
    if (!search.trim()) return notes
    const q = search.toLowerCase()
    return notes.filter(n => n.title?.toLowerCase().includes(q))
  }, [notes, search])

  return { notes: filtered, loading, error, totalCount: notes.length }
}
