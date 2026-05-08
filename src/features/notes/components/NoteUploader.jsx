// src/features/notes/components/NoteUploader.jsx
//
// File uploader for "file" content notes.
// Two states:
//   1. Empty drop zone — pick a PDF or Word doc, watch a progress bar
//   2. Already uploaded — show file metadata, Preview link, Replace button

import { useRef, useState } from 'react'
import { Upload, FileType, Eye, Loader2 } from '../../../components/ui/icons'
import { uploadNoteFile } from '../lib/storage'
import { formatDate } from '../lib/format'

export function NoteUploader({ ownerUid, assetBatchId, currentFile, onUploaded, onError }) {
  const inputRef = useRef(null)
  const [progress, setProgress] = useState(null)
  const [busy, setBusy] = useState(false)

  const ready = !!ownerUid && !!assetBatchId
  const pickFile = () => inputRef.current?.click()

  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!ready) {
      onError?.(new Error('Save the note as a draft first, then upload the file.'))
      return
    }
    setBusy(true)
    setProgress(0)
    try {
      const result = await uploadNoteFile({ ownerUid, assetBatchId, file, onProgress: setProgress })
      onUploaded?.(result)
    } catch (err) {
      onError?.(err)
    } finally {
      setBusy(false)
      setProgress(null)
      e.target.value = ''
    }
  }

  if (currentFile?.fileName) {
    return (
      <div className="bg-white rounded-xl border border-neutral-200 p-6">
        <div className="flex items-center gap-4 p-4 rounded-lg border border-neutral-100 bg-[#FAFAF7]">
          <div className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0 bg-red-100">
            <FileType size={20} className="text-red-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate text-neutral-900">{currentFile.fileName}</div>
            <div className="text-xs text-neutral-500 mt-0.5">
              {currentFile.size ? `${(currentFile.size / 1024 / 1024).toFixed(1)} MB · ` : ''}
              uploaded {formatDate(currentFile.updatedAt)}
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <a
              href={currentFile.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm px-3 py-1.5 rounded-lg border border-neutral-200 hover:bg-neutral-50 transition inline-flex items-center gap-1.5 text-neutral-900"
            >
              <Eye size={13} /> Preview
            </a>
            <button
              onClick={pickFile}
              disabled={busy || !ready}
              className="text-sm px-3 py-1.5 rounded-lg border border-neutral-200 hover:bg-neutral-50 transition inline-flex items-center gap-1.5 text-neutral-900 disabled:opacity-50"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
              Replace
            </button>
          </div>
        </div>

        {progress !== null && <ProgressBar value={progress} />}

        <p className="text-xs text-neutral-500 mt-4">
          Learners will see a download button and an inline PDF preview where supported.
        </p>

        <input ref={inputRef} type="file" hidden accept=".pdf,.doc,.docx" onChange={handleFile} />
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-neutral-200 p-10 text-center">
      <div className="max-w-sm mx-auto">
        <div className="w-14 h-14 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ backgroundColor: '#D1FAE5' }}>
          <Upload size={22} style={{ color: '#047857' }} />
        </div>
        <h3 className="font-display text-2xl mb-2 text-neutral-900">Upload a PDF or Word file</h3>
        <p className="text-sm text-neutral-600 mb-5">
          Best for visual notes built in Canva or Word — diagrams, infographics, illustrated worksheets.
        </p>
        <button
          onClick={pickFile}
          disabled={busy || !ready}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-neutral-900 text-white text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
          {busy ? 'Uploading…' : 'Choose file'}
        </button>
        <p className="text-xs text-neutral-400 mt-4">PDF, DOC, DOCX · up to 25 MB</p>

        {progress !== null && <ProgressBar value={progress} />}

        <input ref={inputRef} type="file" hidden accept=".pdf,.doc,.docx" onChange={handleFile} />
      </div>
    </div>
  )
}

function ProgressBar({ value }) {
  return (
    <div className="mt-4 max-w-xs mx-auto">
      <div className="h-1.5 bg-neutral-100 rounded-full overflow-hidden">
        <div
          className="h-full transition-all"
          style={{ width: `${value}%`, backgroundColor: '#059669' }}
        />
      </div>
      <div className="text-xs text-neutral-500 mt-1.5">{value}%</div>
    </div>
  )
}
