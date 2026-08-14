/**
 * RosterImportModal — bulk-add learners to a Class Register's roster.
 *
 * Two sources, so a teacher enters a class list once and never retypes it:
 *   - Paste      — paste names (one per line) or tab/comma columns.
 *   - Upload     — a .csv or .xlsx file (Excel parsed via jszip, no new dep).
 *
 * There was a third — importing existing learner ACCOUNTS from the teacher's
 * invite-code classes — removed with the learner/teacher class feature. A
 * roster now holds names the teacher owns, never a link to a learner account.
 *
 * Pasted/uploaded rows are parsed + validated by src/utils/rosterImport.js and
 * previewed (ok / warning / error) before anything is written.
 */

import { useRef, useState } from 'react'
import useFocusTrap from '../../../hooks/useFocusTrap'
import {
  parseRosterText,
  buildRosterCsvTemplate,
  validRosterEntries,
} from '../../../utils/rosterImport'
import { bulkAddRoster, parseRosterFile } from '../../../utils/classRoster'
import { useToast } from '../../../shared/components/Toast'
import Button from '../../../shared/components/Button'
import { saveBlob } from '../../../utils/saveBlob.js'

const MODES = [
  { key: 'paste', label: 'Paste' },
  { key: 'upload', label: 'Upload CSV / Excel' },
]

const STATUS_DOT = { ok: 'bg-emerald-500', warning: 'bg-amber-500', error: 'bg-red-500' }

function downloadTemplate() {
  const blob = new Blob([buildRosterCsvTemplate()], { type: 'text/csv;charset=utf-8' })
  saveBlob(blob, 'class-list-template.csv')
}

function PreviewTable({ parsed }) {
  if (!parsed || parsed.rows.length === 0) return null
  const { summary, rows } = parsed
  return (
    <div className="mt-3">
      <p className="text-xs theme-text-muted mb-2">
        <span className="theme-text font-black">{summary.ok}</span> ready
        {summary.warning ? ` · ${summary.warning} with warnings` : ''}
        {summary.error ? ` · ${summary.error} skipped` : ''}
        {parsed.headerDetected ? ' · header row detected' : ''}
      </p>
      <div className="max-h-56 overflow-y-auto border theme-border rounded-radius-md divide-y divide-current/10">
        {rows.slice(0, 200).map((r) => (
          <div key={r.index} className="flex items-center gap-2 px-3 py-1.5 text-sm">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[r.status]}`} />
            <span className="theme-text-muted w-6">{r.entry.learnerNumber || r.index}</span>
            <span className="theme-text font-bold flex-1 truncate">{r.entry.fullName || <em className="theme-text-muted">(missing name)</em>}</span>
            <span className="theme-text-muted text-xs">{r.entry.gender || ''}</span>
            {(r.errors[0] || r.warnings[0]) && (
              <span className={`text-xs ${r.status === 'error' ? 'text-red-500' : 'text-amber-600'}`}>
                {r.errors[0] || r.warnings[0]}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function RosterImportModal({ classId, teacherUid, onClose, onImported }) {
  const toast = useToast()
  const [mode, setMode] = useState('paste')
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState(null)
  const [busy, setBusy] = useState(false)

  const panelRef = useRef(null)
  // Escape closes, Tab stays inside, focus returns to the opener on close.
  // Hold Escape while an import is committing so a stray key can't drop the
  // modal mid-write.
  useFocusTrap(panelRef, { onEscape: () => { if (!busy) onClose?.() } })

  function handleTextChange(value) {
    setText(value)
    setParsed(value.trim() ? parseRosterText(value) : null)
  }

  async function handleFile(e) {
    const inputEl = e.currentTarget
    const file = inputEl.files?.[0]
    if (!file) return
    // Reset synchronously (before any await) so the same file can be
    // re-selected and so there's no post-await write to the event target.
    inputEl.value = ''
    setBusy(true)
    try {
      const result = await parseRosterFile(file)
      setParsed(result)
      if (result.rows.length === 0) toast.error('No learners found in that file.')
    } catch (err) {
      console.warn('[RosterImportModal] file parse failed', err)
      toast.error(`Could not read that file: ${err.message || 'unsupported format'}`)
    } finally {
      setBusy(false)
    }
  }

  async function handleCommitParsed() {
    const entries = validRosterEntries(parsed)
    if (entries.length === 0) { toast.error('Nothing to import.'); return }
    setBusy(true)
    try {
      const result = await bulkAddRoster(classId, teacherUid, entries)
      onImported(result)
    } catch (err) {
      toast.error(`Import failed: ${err.message || 'unexpected error'}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="roster-import-modal-title"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose?.() }}
    >
      <div ref={panelRef} className="theme-card border theme-border rounded-t-2xl sm:rounded-radius-md w-full sm:max-w-lg max-h-[90vh] overflow-y-auto p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 id="roster-import-modal-title" className="theme-text font-display font-black text-lg">Import learners</h2>
          <button type="button" onClick={onClose} className="theme-text-muted hover:theme-text text-xl leading-none px-2" aria-label="Close">×</button>
        </div>

        <div className="flex gap-1 overflow-x-auto border-b theme-border">
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => { setMode(m.key); setParsed(null); setText('') }}
              className={`whitespace-nowrap px-3 py-2 text-sm font-black border-b-2 ${
                mode === m.key ? 'theme-accent-text border-current' : 'theme-text-muted border-transparent'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {mode === 'paste' && (
          <div>
            <p className="theme-text-muted text-xs mb-2">
              Paste one learner per line (e.g. &ldquo;1. Mary Banda&rdquo;), or columns copied from
              Excel. Columns map to: number, name, gender, parent phone, status.
            </p>
            <textarea
              value={text}
              onChange={(e) => handleTextChange(e.target.value)}
              rows={6}
              placeholder={'Mary Banda\nJohn Phiri\nGrace Mwale'}
              className="w-full rounded-radius-md border theme-border theme-card theme-text px-3 py-2 text-sm font-mono"
            />
            <PreviewTable parsed={parsed} />
          </div>
        )}

        {mode === 'upload' && (
          <div>
            <p className="theme-text-muted text-xs mb-2">
              Upload a <strong>.csv</strong> or <strong>.xlsx</strong> file. Need the format?{' '}
              <button type="button" onClick={downloadTemplate} className="theme-accent-text font-black underline">Download the CSV template</button>.
            </p>
            <input
              type="file"
              accept=".csv,.xlsx,text/csv"
              onChange={handleFile}
              className="block w-full text-sm theme-text-muted file:mr-3 file:py-2 file:px-3 file:rounded-full file:border-0 file:text-sm file:font-black file:theme-accent-fill file:theme-on-accent"
            />
            <PreviewTable parsed={parsed} />
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleCommitParsed} loading={busy} disabled={!parsed || validRosterEntries(parsed).length === 0}>
            Import {parsed ? validRosterEntries(parsed).length : 0} learners
          </Button>
        </div>
      </div>
    </div>
  )
}
