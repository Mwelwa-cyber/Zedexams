// src/features/notes/components/SaveOfflineButton.jsx
//
// Real "Save for offline" control for content-in-doc notes (study / visual /
// rich_text). Pins the note into the shared offline cache so it opens with no
// network later; a pinned note is exempt from cache cleanup until the learner
// removes it. Replaces the old behaviour where STUDY/SLIDE notes had no offline
// option at all and the label "Save offline" only ever did a file download.

import { useEffect, useState } from 'react'
import { Download, Check, Loader2, Trash2 } from '../../../shared/components/icons'
import { downloadForOffline, unpin } from '../../../offline/contentCache.js'
import { getContent } from '../../../offline/offlineStore.js'
import { fetchNoteForCache } from '../hooks/useOfflineNote'
import { isPinnableNote } from '../lib/noteCache'
import { reportClientError } from '../../../utils/clientErrorReporting'

export function SaveOfflineButton({ note }) {
  const id = note?.id
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    let alive = true
    if (!id) return undefined
    getContent('note', id)
      .then((rec) => { if (alive) setSaved(!!rec?.entry?.pinned) })
      .catch(() => {})
      .finally(() => { if (alive) setChecked(true) })
    return () => { alive = false }
  }, [id])

  if (!isPinnableNote(note) || !id) return null

  async function save() {
    if (busy) return
    setBusy(true)
    try {
      await downloadForOffline({ type: 'note', id, fetcher: () => fetchNoteForCache(id) })
      setSaved(true)
    } catch (err) {
      reportClientError(err, 'notes.saveOffline')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (busy) return
    setBusy(true)
    try {
      await unpin('note', id)
      setSaved(false)
    } catch (err) {
      reportClientError(err, 'notes.removeOffline')
    } finally {
      setBusy(false)
    }
  }

  // Avoid a flash of the wrong label before the pinned check resolves.
  if (!checked) return null

  if (saved) {
    return (
      <button
        type="button"
        onClick={remove}
        disabled={busy}
        className="notes-chip notes-chip-shadow inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white text-[#0F1B2D] text-sm font-semibold hover:-translate-y-px transition disabled:opacity-60"
        title="Saved on this device for offline reading — tap to remove"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} className="text-emerald-600" />}
        Saved offline
        <Trash2 size={13} className="opacity-60" />
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={save}
      disabled={busy}
      className="notes-chip notes-chip-shadow inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white text-[#0F1B2D] text-sm font-semibold hover:-translate-y-px transition disabled:opacity-60"
      title="Keep this note on your device to read without internet"
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
      Save for offline
    </button>
  )
}
