// src/features/notes/hooks/useOfflineNote.js
//
// Cache-first note loader for the learner reader. Drop-in for useNote, but
// routes the read through the shared offline content cache (src/offline):
//   • a previously-opened note reopens instantly, with no spinner and no
//     network — the core "notes work offline" objective;
//   • when online, a stale copy refreshes transparently in the background.
//
// Timestamps are normalised via serializeNoteForCache so a cached note renders
// identical dates to a fresh one. Firestore permission-denied is treated as
// "not found" (note: null) so the reader shows its friendly empty state instead
// of surfacing a FirebaseError.

import { useOfflineContent } from '../../../offline/useOfflineContent.js'
import { getNote } from '../lib/firestore'
import { serializeNoteForCache } from '../lib/noteCache'

// Exported so the Save-for-offline pin action caches the exact same normalised
// shape the reader consumes.
export async function fetchNoteForCache(id) {
  try {
    return serializeNoteForCache(await getNote(id))
  } catch (err) {
    if (err?.code === 'permission-denied' || err?.code === 'firestore/permission-denied') {
      return null
    }
    throw err
  }
}

export function useOfflineNote(id) {
  const { data, loading, fromCache, error } = useOfflineContent({
    type: 'note',
    id,
    version: null,
    fetcher: () => fetchNoteForCache(id),
    enabled: !!id,
  })

  return { note: data, loading, fromCache, error }
}
