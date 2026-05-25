/**
 * CurriculumUploadPanel — admin tool to push curriculum modules
 * (DOCX / PDF / XLSX) straight into the RAG corpus the teacher
 * generators query. No review queue — uploads are live the moment the
 * function returns.
 *
 * Pairs with `functions/teacherTools/uploadCurriculumModule.js`.
 * Route: /admin/curriculum-upload (registered in src/App.jsx).
 *
 * Flow:
 *   1. Admin picks file + grade + subject + document type (+ optional
 *      term / topic).
 *   2. File uploads to curriculum-uploads/{uid}/{stamp-name}.{ext}.
 *   3. Client calls uploadCurriculumModule with the storage path.
 *   4. Server downloads, parses, chunks, embeds, writes curriculum/ +
 *      rag_chunks/, mirrors a summary to curriculumUploads/ which this
 *      page subscribes to for the recent-uploads list.
 *   5. Delete button calls deleteCurriculumUpload which tears down the
 *      curriculum doc + every rag_chunks row + the Storage blob.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { ref as storageRef, uploadBytes } from 'firebase/storage'
import { getFunctions, httpsCallable } from 'firebase/functions'
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  limit as limitFn,
} from 'firebase/firestore'
import app, { storage, db } from '../../firebase/config'
import { useAuth } from '../../contexts/AuthContext'
import { TEACHER_GRADES, TEACHER_SUBJECTS } from '../../utils/teacherTools'

const functions = getFunctions(app, 'us-central1')
const uploadCallable = httpsCallable(functions, 'uploadCurriculumModule', {
  timeout: 540_000,
})
const deleteCallable = httpsCallable(functions, 'deleteCurriculumUpload', {
  timeout: 120_000,
})

const MAX_FILE_BYTES = 25 * 1024 * 1024

const ACCEPT_ATTR = [
  'application/pdf',
  '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xlsx',
].join(',')

const EXT_TO_CONTENT_TYPE = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

const DOCUMENT_TYPE_OPTIONS = [
  { value: 'module', label: 'Module' },
  { value: 'syllabus', label: 'Syllabus' },
  { value: 'scheme_of_work', label: 'Scheme of work' },
  { value: 'lesson_plan', label: 'Lesson plan' },
  { value: 'assessment', label: 'Assessment / past paper' },
  { value: 'teachers_guide', label: "Teacher's guide" },
  { value: 'learners_book', label: "Learner's book / textbook" },
]

function safeFilename(name) {
  return String(name || 'module')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'module'
}

function extOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || ''))
  return m ? m[1].toLowerCase() : ''
}

function formatBytes(n) {
  if (!n) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

function formatTimestamp(ts) {
  if (!ts) return '…'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  if (Number.isNaN(d.getTime())) return '…'
  return d.toLocaleString()
}

export default function CurriculumUploadPanel() {
  const { currentUser } = useAuth()
  const [file, setFile] = useState(null)
  const [grade, setGrade] = useState('G6')
  const [subject, setSubject] = useState('mathematics')
  const [term, setTerm] = useState('')
  const [topic, setTopic] = useState('')
  const [documentType, setDocumentType] = useState('module')
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [uploads, setUploads] = useState([])
  const [uploadsLoading, setUploadsLoading] = useState(true)
  const [deletingId, setDeletingId] = useState(null)
  const inputRef = useRef(null)

  // Subscribe to the last 30 uploads so the table refreshes when a new
  // upload finishes (the callable writes the summary doc inside the
  // batched commit). Resilient to permission errors so the rest of the
  // UI stays functional if a non-admin somehow lands here.
  useEffect(() => {
    setUploadsLoading(true)
    const q = query(
      collection(db, 'curriculumUploads'),
      orderBy('uploadedAt', 'desc'),
      limitFn(30),
    )
    const unsub = onSnapshot(
      q,
      (snap) => {
        const items = []
        snap.forEach((doc) => items.push({ id: doc.id, ...doc.data() }))
        setUploads(items)
        setUploadsLoading(false)
      },
      (err) => {
        console.warn('[curriculum-uploads] subscription error', err?.code, err?.message)
        setUploadsLoading(false)
      },
    )
    return () => unsub()
  }, [])

  const gradeOptions = useMemo(() => {
    return TEACHER_GRADES.filter((g) => g && g.value).map((g) => ({
      value: g.value,
      label: g.label || g.value,
    }))
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
    setTopic('')
    if (inputRef.current) inputRef.current.value = ''
  }

  function pickFile(f) {
    setError(null)
    setResult(null)
    if (!f) {
      setFile(null)
      return
    }
    const ext = extOf(f.name)
    if (!EXT_TO_CONTENT_TYPE[ext]) {
      setError('Only PDF, DOCX, or XLSX files are accepted.')
      setFile(null)
      return
    }
    if (f.size > MAX_FILE_BYTES) {
      setError(
        `File is too large (${(f.size / 1024 / 1024).toFixed(1)} MB). ` +
          `Limit is 25 MB.`,
      )
      setFile(null)
      return
    }
    setFile(f)
  }

  async function handleUpload() {
    if (!file || !currentUser?.uid) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      setStep('Uploading file to secure storage…')
      const stamp = Date.now()
      const ext = extOf(file.name) || 'pdf'
      const safeName = `${stamp}-${safeFilename(file.name)}.${ext}`
      const storagePath = `curriculum-uploads/${currentUser.uid}/${safeName}`
      const ref = storageRef(storage, storagePath)
      await uploadBytes(ref, file, {
        contentType: EXT_TO_CONTENT_TYPE[ext] || 'application/octet-stream',
      })

      setStep(
        'Parsing, chunking, and embedding — this can take 30–60s for a ' +
          'large file…',
      )
      const res = await uploadCallable({
        storagePath,
        filename: file.name,
        grade,
        subject,
        term: term === '' ? null : Number(term),
        topic: topic.trim() || null,
        documentType,
      })
      setResult(res?.data || null)
      setStep('')
    } catch (e) {
      const msg = e?.message || 'Upload failed.'
      setError(msg)
      setStep('')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(uploadId) {
    if (!uploadId) return
    const confirmDelete = window.confirm(
      'Remove this curriculum upload? It will be deleted from search ' +
        'results immediately.',
    )
    if (!confirmDelete) return
    setDeletingId(uploadId)
    try {
      await deleteCallable({ id: uploadId })
    } catch (e) {
      window.alert(`Delete failed: ${e?.message || 'unknown error'}`)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="mx-auto max-w-5xl p-6 space-y-6">
      <header>
        <p className="text-eyebrow text-emerald-700">Admin · Curriculum</p>
        <h1 className="text-display-lg text-gray-900 mt-1">
          Upload curriculum modules
        </h1>
        <p className="text-sm text-gray-600 mt-2 max-w-3xl">
          Push Zambian CBC modules straight into the AI search corpus.
          Accepts <strong>DOCX</strong>, <strong>PDF</strong>, and{' '}
          <strong>XLSX</strong>. The file is parsed, chunked, and embedded
          on the server, then made available to every teacher tool
          (lesson plans, worksheets, schemes of work, quizzes, notes…)
          right away — no review queue. Modules are preferred over the
          general syllabus when a topic matches.
        </p>
      </header>

      <section className="rounded-2xl border-2 border-dashed border-emerald-300 bg-emerald-50/60 p-5 space-y-4">
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
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-bold text-gray-700">
            <span className="block mb-1">Subject</span>
            <select
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={busy}
              className="w-full rounded-xl border-2 border-emerald-200 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-emerald-500"
            >
              {subjectOptions.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-bold text-gray-700">
            <span className="block mb-1">Document type</span>
            <select
              value={documentType}
              onChange={(e) => setDocumentType(e.target.value)}
              disabled={busy}
              className="w-full rounded-xl border-2 border-emerald-200 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-emerald-500"
            >
              {DOCUMENT_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-xs font-bold text-gray-700">
            <span className="block mb-1">
              Term <span className="text-gray-400 font-normal">(optional)</span>
            </span>
            <select
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              disabled={busy}
              className="w-full rounded-xl border-2 border-emerald-200 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-emerald-500"
            >
              <option value="">— any —</option>
              <option value="1">Term 1</option>
              <option value="2">Term 2</option>
              <option value="3">Term 3</option>
            </select>
          </label>
          <label className="text-xs font-bold text-gray-700 md:col-span-2">
            <span className="block mb-1">
              Topic <span className="text-gray-400 font-normal">(optional, helps matching)</span>
            </span>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              disabled={busy}
              maxLength={200}
              placeholder="e.g. Fractions, Plant nutrition, The water cycle"
              className="w-full rounded-xl border-2 border-emerald-200 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-emerald-500"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="cursor-pointer rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white hover:bg-emerald-700 transition-colors">
            {file ? 'Change file' : 'Choose file…'}
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT_ATTR}
              disabled={busy}
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0] || null)}
            />
          </label>
          {file && (
            <span className="text-xs text-gray-700">
              <strong>{file.name}</strong> — {formatBytes(file.size)}
            </span>
          )}
          <button
            type="button"
            onClick={handleUpload}
            disabled={busy || !file}
            className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-black text-white hover:bg-slate-800 disabled:opacity-50 transition-colors"
          >
            {busy ? 'Working…' : 'Upload & ingest'}
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
          <p className="text-xs text-emerald-800 bg-emerald-100 rounded-lg px-3 py-2">
            {step}
          </p>
        )}

        {error && (
          <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
            <strong>Error:</strong> {error}
          </p>
        )}

        {result && (
          <div className="rounded-xl border-2 border-emerald-300 bg-white p-4">
            <p className="text-sm font-black text-gray-800">
              ✓ Uploaded — {result.chunkCount} chunk
              {result.chunkCount === 1 ? '' : 's'} indexed
              {result.embeddedCount != null && result.embeddedCount !== result.chunkCount
                ? ` (${result.embeddedCount} with embeddings)`
                : ''}
              .
            </p>
            <p className="text-xs text-gray-600 mt-1">
              This module is now searchable by teacher tools. Tags applied:{' '}
              <code className="text-[10px] bg-emerald-50 px-1 rounded">
                {(result.tags || []).join(', ') || '—'}
              </code>
              .
            </p>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-display-md text-gray-800 mb-3">
          Recent uploads
        </h2>
        {uploadsLoading ? (
          <p className="text-xs text-gray-500">Loading…</p>
        ) : uploads.length === 0 ? (
          <p className="text-xs text-gray-500">
            No uploads yet. Files you upload here will appear in this list and
            in every teacher-tool generation right away.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-left p-2 font-bold">Filename</th>
                  <th className="text-left p-2 font-bold">Grade</th>
                  <th className="text-left p-2 font-bold">Subject</th>
                  <th className="text-left p-2 font-bold">Type</th>
                  <th className="text-left p-2 font-bold">Topic</th>
                  <th className="text-left p-2 font-bold">Chunks</th>
                  <th className="text-left p-2 font-bold">Uploaded</th>
                  <th className="text-left p-2 font-bold" />
                </tr>
              </thead>
              <tbody>
                {uploads.map((u) => (
                  <tr key={u.id} className="border-t border-gray-100">
                    <td className="p-2 align-top max-w-xs">
                      <span className="font-mono text-[11px] text-gray-800 break-all">
                        {u.filename || '(unnamed)'}
                      </span>
                      <span className="block text-[10px] text-gray-400 mt-0.5">
                        {formatBytes(u.byteLength)} · {u.kind || '?'}
                      </span>
                    </td>
                    <td className="p-2 align-top font-bold">{u.grade || '—'}</td>
                    <td className="p-2 align-top">{u.subject || '—'}</td>
                    <td className="p-2 align-top">
                      <span className="inline-block rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 text-[10px] font-bold">
                        {u.documentType || 'module'}
                      </span>
                    </td>
                    <td className="p-2 align-top text-gray-700">
                      {u.topic || '—'}
                      {u.term ? (
                        <span className="block text-[10px] text-gray-400">
                          Term {u.term}
                        </span>
                      ) : null}
                    </td>
                    <td className="p-2 align-top">
                      {u.chunkCount ?? 0}
                      {u.embeddedCount != null && u.embeddedCount !== u.chunkCount
                        ? (
                          <span className="block text-[10px] text-amber-700">
                            {u.embeddedCount} embedded
                          </span>
                        )
                        : null}
                    </td>
                    <td className="p-2 align-top text-gray-500">
                      {formatTimestamp(u.uploadedAt)}
                    </td>
                    <td className="p-2 align-top text-right">
                      <button
                        type="button"
                        onClick={() => handleDelete(u.id)}
                        disabled={deletingId === u.id}
                        className="text-[11px] font-bold text-rose-600 hover:text-rose-800 disabled:opacity-50"
                      >
                        {deletingId === u.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
