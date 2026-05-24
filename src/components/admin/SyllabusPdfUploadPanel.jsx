/**
 * SyllabusPdfUploadPanel — admin tool to ingest a CBC syllabus PDF into
 * the cbcKnowledgeBase via the extractTopicsFromPdf callable.
 *
 * Flow:
 *   1. Admin picks a PDF, grade, subject.
 *   2. PDF uploads to syllabus-uploads-pdf/{version}/{filename}.pdf.
 *   3. Client calls extractTopicsFromPdf which downloads + extracts
 *      text, asks Claude for structured topics, writes each topic to
 *      cbcKnowledgeBase/{version}/draftTopics, and returns a summary.
 *   4. The summary links to /admin/curriculum/replace where the
 *      existing draft-review UI handles promote-to-live.
 *
 * Embedded in CbcKbAdmin under the Knowledge Base page so admins can
 * grow the KB without leaving the topic editor.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { ref as storageRef, uploadBytes } from 'firebase/storage'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { Link } from 'react-router-dom'
import app, { storage } from '../../firebase/config'
import { getActiveKbVersion, KB_VERSION } from '../../utils/adminCbcKbService'
import { TEACHER_GRADES, TEACHER_SUBJECTS } from '../../utils/teacherTools'

const functions = getFunctions(app, 'us-central1')
const extractCallable = httpsCallable(functions, 'extractTopicsFromPdf', {
  timeout: 540_000,
})

const MAX_FILE_BYTES = 25 * 1024 * 1024
const ACCEPT_PDF = 'application/pdf,.pdf'

function safeFilename(name) {
  return String(name || 'syllabus')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'syllabus'
}

export default function SyllabusPdfUploadPanel() {
  const [version, setVersion] = useState(null)
  const [file, setFile] = useState(null)
  const [grade, setGrade] = useState('G6')
  const [subject, setSubject] = useState('mathematics')
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    getActiveKbVersion().then((v) => {
      if (!cancelled) setVersion(v || KB_VERSION)
    }).catch(() => {
      if (!cancelled) setVersion(KB_VERSION)
    })
    return () => { cancelled = true }
  }, [])

  const gradeOptions = useMemo(() => {
    return TEACHER_GRADES.filter((g) => g && g.value).map((g) => g.value)
  }, [])
  const subjectOptions = useMemo(() => {
    return (TEACHER_SUBJECTS || [])
      .filter((s) => s && s.value)
      .map((s) => ({ value: s.value, label: s.label || s.value }))
  }, [])

  function reset() {
    setFile(null)
    setResult(null)
    setError(null)
    setStep('')
    if (inputRef.current) inputRef.current.value = ''
  }

  function pickFile(f) {
    setError(null)
    setResult(null)
    if (!f) { setFile(null); return }
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
      setError('Only PDF files are accepted.')
      setFile(null)
      return
    }
    if (f.size > MAX_FILE_BYTES) {
      setError(`File is too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Limit is 25 MB.`)
      setFile(null)
      return
    }
    setFile(f)
  }

  async function handleExtract() {
    if (!file || !version) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      setStep('Uploading PDF to secure storage…')
      const stamp = Date.now()
      const safeName = `${stamp}-${safeFilename(file.name)}.pdf`
      const storagePath = `syllabus-uploads-pdf/${version}/${safeName}`
      const ref = storageRef(storage, storagePath)
      await uploadBytes(ref, file, { contentType: 'application/pdf' })

      setStep('Asking Claude to extract CBC topics — this can take 30–60s…')
      const res = await extractCallable({
        storagePath,
        grade,
        subject,
        version,
      })
      setResult(res?.data || null)
      setStep('')
    } catch (e) {
      const msg = e?.message || 'Extraction failed.'
      setError(msg)
      setStep('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-2xl border-2 border-dashed border-emerald-300 bg-emerald-50/60 p-5">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-eyebrow text-emerald-700">New</p>
          <h2 className="text-display-md text-gray-800 mt-1">
            Upload syllabus PDF
          </h2>
          <p className="text-xs text-gray-600 mt-1 max-w-2xl">
            Drop a CDC PDF here. Claude reads the text, extracts CBC
            topics, and stages them as draft topics for review. PDFs only,
            max 25 MB, text-based (scanned image-only PDFs need OCR first).
          </p>
        </div>
        <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700 bg-white rounded-full px-2 py-0.5 ring-1 ring-emerald-300">
          v{version || '…'}
        </span>
      </header>

      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-xs font-bold text-gray-700">
          <span className="block mb-1">Grade</span>
          <select
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
            disabled={busy}
            className="w-full rounded-xl border-2 border-emerald-200 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-emerald-500"
          >
            {gradeOptions.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-bold text-gray-700 md:col-span-2">
          <span className="block mb-1">Subject</span>
          <select
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={busy}
            className="w-full rounded-xl border-2 border-emerald-200 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-emerald-500"
          >
            {subjectOptions.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="cursor-pointer rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white hover:bg-emerald-700 transition-colors">
          {file ? 'Change file' : 'Choose PDF…'}
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT_PDF}
            disabled={busy}
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0] || null)}
          />
        </label>
        {file && (
          <span className="text-xs text-gray-700">
            <strong>{file.name}</strong> — {(file.size / 1024 / 1024).toFixed(2)} MB
          </span>
        )}
        <button
          type="button"
          onClick={handleExtract}
          disabled={busy || !file || !version}
          className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-black text-white hover:bg-slate-800 disabled:opacity-50 transition-colors"
        >
          {busy ? 'Working…' : 'Extract topics'}
        </button>
        {(file || result || error) && !busy && (
          <button
            type="button"
            onClick={reset}
            className="text-xs font-bold text-gray-500 hover:text-gray-700"
          >
            Reset
          </button>
        )}
      </div>

      {step && (
        <p className="mt-3 text-xs text-emerald-800 bg-emerald-100 rounded-lg px-3 py-2">
          {step}
        </p>
      )}

      {error && (
        <p className="mt-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
          <strong>Error:</strong> {error}
        </p>
      )}

      {result && (
        <div className="mt-3 rounded-xl border-2 border-emerald-300 bg-white p-4">
          <p className="text-sm font-black text-gray-800">
            ✓ Staged {result.topicCount} draft topic{result.topicCount === 1 ? '' : 's'}
            {result.skippedCount > 0 && ` (${result.skippedCount} skipped)`}
          </p>
          {result.truncated && (
            <p className="text-xs text-amber-700 mt-1">
              ⚠ Source PDF was truncated for cost reasons. If you need full coverage, split the file.
            </p>
          )}
          {Array.isArray(result.warnings) && result.warnings.length > 0 && (
            <ul className="mt-2 list-disc list-inside text-xs text-gray-600 space-y-0.5">
              {result.warnings.slice(0, 6).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <Link
              to="/admin/curriculum/replace"
              className="rounded-lg bg-emerald-600 px-3 py-1.5 font-black text-white no-underline hover:bg-emerald-700"
            >
              Review drafts & promote →
            </Link>
            <span className="text-gray-500 self-center">
              Drafts land under cbcKnowledgeBase/{result.version || version}/draftTopics
            </span>
          </div>
        </div>
      )}
    </section>
  )
}
