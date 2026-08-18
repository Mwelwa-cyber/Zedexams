// src/features/notes/hooks/useDownloadedNotes.js
//
// Which notes are pinned for offline use, as a Set of note ids, for the
// Notes hub's downloaded badges.
//
// One IndexedDB read for the whole list rather than one per row: the hub
// renders every note the learner can reach, and a per-row `getContent`
// call would be a transaction each. `refresh()` is exposed so a row that
// has just downloaded updates its own badge without a re-mount.

import { useCallback, useEffect, useState } from 'react'
import { listEntries } from '../../../offline/offlineStore.js'

export function useDownloadedNotes() {
  const [ids, setIds] = useState(() => new Set())

  const refresh = useCallback(async () => {
    const entries = await listEntries()
    setIds(new Set(entries.filter((e) => e?.type === 'note' && e?.pinned).map((e) => e.id)))
  }, [])

  useEffect(() => {
    let alive = true
    listEntries()
      .then((entries) => {
        if (!alive) return
        setIds(new Set(entries.filter((e) => e?.type === 'note' && e?.pinned).map((e) => e.id)))
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  return { downloadedIds: ids, refresh }
}
