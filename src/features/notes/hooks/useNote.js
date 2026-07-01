// src/features/notes/hooks/useNote.js
//
// Loads a single note by id for the editor screen.
// Returns { note, loading, error, refresh } — refresh re-fetches manually.

import { useEffect, useState, useCallback } from 'react'
import { getNote } from '../lib/firestore'

export function useNote(id) {
  const [note, setNote]       = useState(null)
  const [loading, setLoading] = useState(!!id)
  const [error, setError]     = useState(null)

  const load = useCallback(async () => {
    if (!id) { setNote(null); setLoading(false); return }
    setLoading(true)
    try {
      const data = await getNote(id)
      setNote(data)
      setError(null)
    } catch (err) {
      // Treat Firestore permission-denied the same as "not found": the note
      // exists but this user isn't allowed to read it (e.g. it's a draft
      // owned by another teacher). Setting note to null lets LearnerNoteRead
      // render its "Note not found / may have been unpublished" message without
      // surfacing an unhandled FirebaseError to Sentry.
      if (err?.code === 'permission-denied' || err?.code === 'firestore/permission-denied') {
        setNote(null)
        setError(null)
      } else {
        setError(err)
      }
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  return { note, loading, error, refresh: load }
}
