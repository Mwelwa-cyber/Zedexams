import { useMemo, useRef, useState } from 'react'
import ResponsiveModal from '../../../shared/components/ResponsiveModal'
import {
  UNSORTED,
  applyMoveChange,
  buildMoveDraft,
  coordsFromDraft,
  describeDestination,
  isMoved,
  moveDimensions,
  optionsFor,
} from '../lib/moveTarget'

/**
 * Move a saved document into a different library folder.
 *
 * Every decision this dialog makes lives in `../lib/moveTarget.js` — which
 * dimensions apply, what each may be set to, what a change invalidates. This
 * file renders them and owns nothing else, so the rules are testable without a
 * DOM and cannot quietly differ between the dialog and anything else that
 * re-files a document later.
 *
 * The studio is deliberately not selectable; see the note at the top of
 * moveTarget.js for why offering it would be a control that does nothing.
 */

const DIMENSION_LABELS = {
  syllabus:       'Curriculum',
  gradeForm:      'Grade / Form',
  term:           'Term',
  subject:        'Subject',
  assessmentType: 'Assessment type',
}

export default function MoveToFolderDialog({ row, section, onCancel, onMove }) {
  const current = useMemo(() => buildMoveDraft(row, section), [row, section])
  const [draft, setDraft] = useState(current)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const firstFieldRef = useRef(null)

  const dims = moveDimensions(section)
  const moved = isMoved(draft, row, section)
  const busy = status === 'saving'

  function change(dimension, value) {
    setDraft((d) => applyMoveChange(d, section, dimension, value))
  }

  async function submit() {
    if (!moved || busy) return
    setStatus('saving')
    setError('')
    try {
      await onMove(coordsFromDraft(draft, section))
    } catch (err) {
      // Stay open with the teacher's choices intact — a failed move that closed
      // the dialog would look exactly like a successful one until they noticed
      // the document had not left the folder.
      setError(err?.message || 'Could not move this document.')
      setStatus('idle')
    }
  }

  return (
    <ResponsiveModal
      onClose={() => !busy && onCancel()}
      labelledBy="move-to-folder-title"
      initialFocusRef={firstFieldRef}
      footer={
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 rounded-xl border px-4 py-2.5 text-sm font-semibold theme-text disabled:opacity-50"
            style={{ borderColor: 'var(--zt-line)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!moved || busy}
            className="flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: '#d97757' }}
          >
            {busy ? 'Moving…' : 'Move'}
          </button>
        </div>
      }
    >
      <div className="p-5 pt-3">
        <h2
          id="move-to-folder-title"
          style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 18, margin: '0 0 4px' }}
          className="theme-text"
        >
          Move to folder
        </h2>
        <p className="theme-text-muted" style={{ fontSize: 13, margin: '0 0 16px' }}>
          {row?.__title || 'This document'} stays in {section?.folder} — choose where inside it.
        </p>

        <div className="grid gap-3">
          {dims.map((dim, i) => (
            <label key={dim} className="grid gap-1">
              <span className="theme-text-muted" style={{ fontSize: 12, fontWeight: 700 }}>
                {DIMENSION_LABELS[dim] || dim}
              </span>
              <select
                ref={i === 0 ? firstFieldRef : undefined}
                value={draft[dim] ?? UNSORTED}
                onChange={(e) => change(dim, e.target.value)}
                disabled={busy}
                className="w-full rounded-xl border px-3 py-2.5 text-sm theme-card theme-text"
                style={{ borderColor: 'var(--zt-line)' }}
              >
                {optionsFor(dim, draft, current[dim]).map((opt) => (
                  <option key={opt.value || '__unsorted__'} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>

        <p
          className="theme-text-muted mt-4 rounded-xl px-3 py-2"
          style={{ fontSize: 12, background: 'var(--zt-surface)', wordBreak: 'break-word' }}
        >
          {describeDestination(draft, section)}
        </p>

        {error && (
          <p role="alert" style={{ fontSize: 13, color: '#b91c1c', margin: '10px 0 0' }}>
            {error}
          </p>
        )}
      </div>
    </ResponsiveModal>
  )
}
