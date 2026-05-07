// src/features/notes/components/PublishToggle.jsx
//
// Publish / unpublish button. Includes a small confirmation step on unpublish,
// since pulling a published note back to draft is a deliberate action.

import { useState } from 'react'
import { Sparkles, EyeOff } from '../../../components/ui/icons'
import { publishNote, unpublishNote } from '../lib/firestore'
import { NOTE_STATUS } from '../../../config/curriculum'

export function PublishToggle({ noteId, status, disabled, onChange }) {
  const [busy, setBusy]       = useState(false)
  const [confirm, setConfirm] = useState(false)

  const isPublished = status === NOTE_STATUS.PUBLISHED

  const handlePublish = async () => {
    if (!noteId || busy) return
    setBusy(true)
    try {
      await publishNote(noteId)
      onChange?.(NOTE_STATUS.PUBLISHED)
    } catch (err) {
      console.error('publishNote failed', err)
      window.alert('Could not publish this note. Please try again.')
    } finally { setBusy(false) }
  }

  const handleUnpublish = async () => {
    if (!noteId || busy) return
    if (!confirm) { setConfirm(true); return }
    setBusy(true)
    try {
      await unpublishNote(noteId)
      onChange?.(NOTE_STATUS.DRAFT)
      setConfirm(false)
    } catch (err) {
      console.error('unpublishNote failed', err)
      window.alert('Could not unpublish this note. Please try again.')
    } finally { setBusy(false) }
  }

  if (isPublished) {
    return (
      <button
        onClick={handleUnpublish}
        disabled={disabled || busy}
        className={`text-sm px-4 py-1.5 rounded-lg transition inline-flex items-center gap-1.5 ${
          confirm
            ? 'bg-amber-100 text-amber-900 hover:bg-amber-200'
            : 'border border-neutral-200 text-neutral-700 hover:bg-neutral-50'
        } disabled:opacity-50`}
        title={confirm ? 'Click again to confirm' : 'Unpublish'}
      >
        <EyeOff size={14} />
        {confirm ? 'Click again to confirm' : busy ? 'Unpublishing…' : 'Unpublish'}
      </button>
    )
  }

  return (
    <button
      onClick={handlePublish}
      disabled={disabled || busy}
      className="text-sm px-4 py-1.5 rounded-lg text-white transition hover:opacity-90 inline-flex items-center gap-1.5 disabled:opacity-50"
      style={{ backgroundColor: '#059669' }}
    >
      <Sparkles size={14} />
      {busy ? 'Publishing…' : 'Publish'}
    </button>
  )
}
