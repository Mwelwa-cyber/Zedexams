// src/features/notes/hooks/useNoteProgressMap.js
//
// Subscribes to the signed-in learner's note-progress records and exposes them
// as a `{ [noteId]: progress }` map for the notes library. Returns {} for
// signed-out users (the page is gated, but this keeps the hook safe to call).

import { useEffect, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { subscribeNoteProgress } from '../lib/progress'

export function useNoteProgressMap() {
  const { currentUser } = useAuth()
  const uid = currentUser?.uid
  const [progressById, setProgressById] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!uid) {
      setProgressById({})
      setLoading(false)
      return
    }
    setLoading(true)
    const unsub = subscribeNoteProgress(
      uid,
      (map) => { setProgressById(map); setLoading(false) },
      () => setLoading(false),
    )
    return unsub
  }, [uid])

  return { progressById, loading }
}
