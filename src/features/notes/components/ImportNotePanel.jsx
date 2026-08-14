// src/features/notes/components/ImportNotePanel.jsx
//
// Admin UI to import a document (paste / DOCX / PDF / scanned PDF) into a study
// note. Presentational: it collects input + shows progress/warnings and calls
// onImport({ kind, file, text }). The page owns the actual import + navigation.

import { useRef, useState } from 'react'
import { Upload, Loader2, FileType, AlertCircle } from '../../../shared/components/icons'

const ACCEPT = '.doc,.docx,.pdf'

export function ImportNotePanel({ importing, progress, warnings, onImport }) {
  const fileRef = useRef(null)
  const [text, setText] = useState('')

  const pickFile = () => fileRef.current?.click()
  const onFile = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) onImport({ kind: 'file', file })
  }

  return (
    <div className="space-y-5">
      <div className="notes-card p-6">
        <div className="flex items-center gap-3 mb-3">
          <span className="w-10 h-10 rounded-xl grid place-items-center border-2 border-[#0F1B2D] bg-[#F8EADF]" style={{ boxShadow: '0 2px 0 #0F1B2D' }}>
            <FileType size={18} className="text-[#A3422E]" />
          </span>
          <div>
            <h2 className="font-display text-xl text-[#0F1B2D]">Import a document</h2>
            <p className="text-[13px] text-[#4A5A6E]">Word, PDF, or a scanned PDF — we'll turn it into a study note for you to review.</p>
          </div>
        </div>
        <button
          type="button" onClick={pickFile} disabled={importing}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-sm font-bold disabled:opacity-50"
          style={{ backgroundColor: '#D97757' }}
        >
          {importing ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
          {importing ? 'Importing…' : 'Choose a file'}
        </button>
        <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={onFile} />
        {progress && (
          <p className="text-xs text-[#4A5A6E] mt-3">
            {progress.phase === 'rendering' ? 'Rendering pages' : 'Reading pages'} · {progress.current}/{progress.total}
          </p>
        )}
      </div>

      <div className="notes-card p-6">
        <h3 className="font-display text-lg text-[#0F1B2D] mb-2">…or paste text</h3>
        <textarea
          value={text} onChange={e => setText(e.target.value)} rows={8} disabled={importing}
          placeholder="Paste notes or a chapter here…"
          className="w-full rounded-xl border-2 border-[#0F1B2D] p-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#D97757]/40"
        />
        <button
          type="button" disabled={importing || text.trim().length < 80}
          onClick={() => onImport({ kind: 'paste', text })}
          className="mt-3 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#0F1B2D] text-white text-sm font-semibold disabled:opacity-50"
        >
          {importing ? <Loader2 size={15} className="animate-spin" /> : null} Build note from text
        </button>
      </div>

      {warnings?.length > 0 && (
        <div className="notes-card p-4">
          <div className="flex items-center gap-2 text-sm font-bold text-[#9F1239] mb-2"><AlertCircle size={15} /> Warnings</div>
          <ul className="list-disc pl-5 text-[13px] text-[#4A5A6E] space-y-1">
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}

export default ImportNotePanel
