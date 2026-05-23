import { useEffect, useState } from 'react'
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '../../../firebase/config'

// Modal for the Regenerate (and Edit, per the chosen Edit semantics)
// action on any AI artifact card. Admin types notes, we flip the
// source aiAgentTasks to status='regenerating' with the notes
// attached so the dispatcher can include them in the re-run prompt
// + log them on aiAgentLogs.
//
// Why a modal and not a textbox inline on the card: the rules
// changedKeys allow-list only permits a write of {status,
// errorMessage, regenerateNotes, updatedAt}. Capturing the notes
// in one transactional submit avoids partial writes.

export default function RegenerateWithNotesModal({ taskId, mode, onClose }) {
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (!taskId) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [taskId])

  if (!taskId) return null

  const verb = mode === 'edit' ? 'Edit (regenerate with notes)' : 'Regenerate with notes'
  const placeholder = mode === 'edit' ?
    'What needs to change? e.g. "Use simpler vocabulary for Grade 5; replace London with Lusaka."' :
    'Optional notes for the regeneration. Leave blank to re-run with the original prompt.'

  async function handleSubmit() {
    setBusy(true)
    setErr(null)
    try {
      await updateDoc(doc(db, 'aiAgentTasks', taskId), {
        status: 'regenerating',
        errorMessage: null,
        regenerateNotes: notes.trim().slice(0, 4000) || null,
        updatedAt: serverTimestamp(),
      })
      onClose()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={verb}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute inset-0 bg-slate-900/40"
      />
      <div className="relative w-full sm:max-w-lg bg-white rounded-t-xl sm:rounded-xl shadow-xl flex flex-col max-h-[90vh]">
        <header className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900">{verb}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-slate-700 text-2xl leading-none px-1"
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="p-4 flex-1 overflow-y-auto">
          <p className="text-xs text-slate-600 mb-2 leading-snug">
            Submitting will set the task status to <strong>regenerating</strong>. The
            dispatcher reruns the full agent chain on the next trigger. Notes
            are attached for the prompt + logged to aiAgentLogs so the change
            history is auditable.
          </p>
          <label className="text-xs font-semibold text-slate-700 block mb-1">
            Notes (max 4000 chars)
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder={placeholder}
            rows={6}
            maxLength={4000}
            className="w-full text-sm border border-slate-300 rounded p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="text-[11px] text-slate-400 mt-1 text-right">{notes.length}/4000</div>
          {err && (
            <div className="mt-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1.5">
              {err}
            </div>
          )}
        </div>

        <footer className="px-4 py-3 border-t border-slate-200 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-xs font-semibold px-3 py-1.5 rounded bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={busy}
            className="text-xs font-semibold px-3 py-1.5 rounded bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40"
          >
            {busy ? 'Submitting…' : 'Regenerate'}
          </button>
        </footer>
      </div>
    </div>
  )
}
