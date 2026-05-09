/**
 * /admin/papers/new and /admin/papers/:paperId/edit — admin upload
 * + edit form for past papers (audit A2 foundation).
 *
 * Two-step create flow: a placeholder Firestore doc is written first
 * (so we have an ID), then PDFs are uploaded to Storage under
 * papers/{adminUid}/{paperId}/, and finally the doc is updated with
 * the Storage paths. This keeps the Storage path deterministic and
 * lets us re-upload a replacement file later without orphaning a
 * stale path on a different ID.
 */

import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import {
  PAPER_GRADES,
  PAPER_STATUSES,
  createPaper,
  deletePaper,
  deletePaperPdf,
  getPaper,
  updatePaper,
  uploadPaperPdf,
} from '../../utils/pastPapers'
import { SUBJECTS } from '../../config/curriculum'
import SeoHelmet from '../seo/SeoHelmet'

const CURRENT_YEAR = new Date().getFullYear()
const YEARS = Array.from({ length: 12 }, (_, i) => CURRENT_YEAR - i)

function FieldRow({ label, hint, children }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-black theme-text-muted uppercase tracking-widest">
        {label}
        {hint && <span className="ml-2 normal-case text-[11px] font-normal opacity-70">{hint}</span>}
      </label>
      {children}
    </div>
  )
}

function inputCls() {
  return 'w-full rounded-xl border-2 theme-border theme-input px-3 py-2 text-sm focus:outline-none disabled:opacity-50'
}

export default function AdminPastPaperEditor() {
  const { paperId } = useParams()
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const isNew = !paperId

  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    title: '',
    grade: '7',
    subject: SUBJECTS[0].id,
    year: CURRENT_YEAR - 1,
    paperNumber: '',
    examBoard: 'ECZ',
    description: '',
    durationMinutes: '',
    totalMarks: '',
    status: PAPER_STATUSES.DRAFT,
  })
  const [paperFile, setPaperFile] = useState(null)
  const [markSchemeFile, setMarkSchemeFile] = useState(null)
  const [existing, setExisting] = useState(null)

  useEffect(() => {
    if (isNew) return
    let cancelled = false
    setLoading(true)
    getPaper(paperId)
      .then((row) => {
        if (cancelled) return
        if (!row) {
          setError('Paper not found.')
          return
        }
        setExisting(row)
        setForm({
          title: row.title || '',
          grade: row.grade || '7',
          subject: row.subject || SUBJECTS[0].id,
          year: row.year || CURRENT_YEAR - 1,
          paperNumber: row.paperNumber ? String(row.paperNumber) : '',
          examBoard: row.examBoard || 'ECZ',
          description: row.description || '',
          durationMinutes: row.durationMinutes ? String(row.durationMinutes) : '',
          totalMarks: row.totalMarks ? String(row.totalMarks) : '',
          status: row.status || PAPER_STATUSES.DRAFT,
        })
      })
      .catch((err) => {
        console.warn('[AdminPastPaperEditor] load failed', err)
        if (!cancelled) setError('Could not load this paper.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [paperId, isNew])

  function set(key, value) { setForm((f) => ({ ...f, [key]: value })) }

  function buildFields() {
    return {
      title: form.title.trim(),
      grade: form.grade,
      subject: form.subject,
      year: Number(form.year),
      paperNumber: form.paperNumber ? Number(form.paperNumber) : null,
      examBoard: form.examBoard.trim() || 'ECZ',
      description: form.description.trim() || null,
      durationMinutes: form.durationMinutes ? Number(form.durationMinutes) : null,
      totalMarks: form.totalMarks ? Number(form.totalMarks) : null,
      status: form.status,
    }
  }

  async function handleSave(e) {
    e.preventDefault()
    setError('')
    if (!form.title.trim()) { setError('Title is required.'); return }
    if (!form.year)         { setError('Year is required.'); return }
    if (isNew && !paperFile) { setError('A paper PDF is required for a new paper.'); return }

    setSaving(true)
    try {
      const fields = buildFields()
      let id = paperId

      // Two-step create: stash the doc first to claim an ID, then we
      // upload Storage objects keyed by that ID.
      if (isNew) {
        id = await createPaper({ uid: currentUser.uid, fields })
      } else {
        await updatePaper(id, fields)
      }

      // Upload paper PDF if provided. On replacement, delete the old
      // file so we don't accumulate orphans.
      if (paperFile) {
        if (existing?.pdfPath && existing.pdfPath !== paperFile.path) {
          await deletePaperPdf(existing.pdfPath).catch(() => {})
        }
        const result = await uploadPaperPdf({
          uid: currentUser.uid,
          paperId: id,
          kind: 'paper',
          file: paperFile,
        })
        await updatePaper(id, {
          pdfPath: result.path,
          pdfFilename: result.filename,
          pdfSize: result.size,
        })
      }

      // Upload mark scheme PDF if provided.
      if (markSchemeFile) {
        if (existing?.markSchemePath) {
          await deletePaperPdf(existing.markSchemePath).catch(() => {})
        }
        const result = await uploadPaperPdf({
          uid: currentUser.uid,
          paperId: id,
          kind: 'mark-scheme',
          file: markSchemeFile,
        })
        await updatePaper(id, {
          markSchemePath: result.path,
          markSchemeFilename: result.filename,
        })
      }

      navigate('/admin/papers')
    } catch (err) {
      console.error('[AdminPastPaperEditor] save failed', err)
      setError(err?.message || 'Could not save this paper.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!paperId) return
    if (typeof window !== 'undefined' && !window.confirm('Delete this paper and its PDF files? This cannot be undone.')) {
      return
    }
    setDeleting(true)
    try {
      const paths = [existing?.pdfPath, existing?.markSchemePath].filter(Boolean)
      await deletePaper(paperId, paths)
      navigate('/admin/papers')
    } catch (err) {
      console.error('[AdminPastPaperEditor] delete failed', err)
      setError('Delete failed — try again.')
      setDeleting(false)
    }
  }

  if (loading) return <p className="theme-text-muted text-sm">Loading paper…</p>

  return (
    <div className="space-y-5 max-w-3xl">
      <SeoHelmet title={isNew ? 'New paper' : 'Edit paper'} path="/admin/papers" noIndex />

      <div>
        <Link to="/admin/papers" className="text-xs font-bold theme-text-muted hover:theme-text">
          ← All papers
        </Link>
        <h1 className="theme-text font-display font-black text-2xl sm:text-3xl mt-1">
          {isNew ? 'New past paper' : 'Edit past paper'}
        </h1>
        <p className="theme-text-muted text-sm mt-1">
          PDFs land in <code className="text-xs">papers/{currentUser?.uid}/{paperId || '{newId}'}/…</code>.
        </p>
      </div>

      {error && (
        <div role="alert" className="border-l-4 border-rose-500 bg-rose-50 text-rose-900 text-sm rounded-r-lg p-3 font-bold">
          {error}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-5">
        <FieldRow label="Title" hint="e.g. Mathematics Paper 1 (2023)">
          <input
            type="text"
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            required
            className={inputCls()}
            placeholder="Mathematics Paper 1"
          />
        </FieldRow>

        <div className="grid sm:grid-cols-3 gap-4">
          <FieldRow label="Grade">
            <select value={form.grade} onChange={(e) => set('grade', e.target.value)} className={inputCls()}>
              {PAPER_GRADES.map((g) => <option key={g} value={g}>Grade {g}</option>)}
            </select>
          </FieldRow>
          <FieldRow label="Subject">
            <select value={form.subject} onChange={(e) => set('subject', e.target.value)} className={inputCls()}>
              {SUBJECTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </FieldRow>
          <FieldRow label="Year">
            <select value={form.year} onChange={(e) => set('year', Number(e.target.value))} className={inputCls()}>
              {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </FieldRow>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <FieldRow label="Paper number" hint="optional">
            <input
              type="number"
              min="1"
              max="5"
              value={form.paperNumber}
              onChange={(e) => set('paperNumber', e.target.value)}
              className={inputCls()}
              placeholder="1"
            />
          </FieldRow>
          <FieldRow label="Duration (min)" hint="optional">
            <input
              type="number"
              min="5"
              max="480"
              value={form.durationMinutes}
              onChange={(e) => set('durationMinutes', e.target.value)}
              className={inputCls()}
              placeholder="120"
            />
          </FieldRow>
          <FieldRow label="Total marks" hint="optional">
            <input
              type="number"
              min="0"
              max="1000"
              value={form.totalMarks}
              onChange={(e) => set('totalMarks', e.target.value)}
              className={inputCls()}
              placeholder="100"
            />
          </FieldRow>
        </div>

        <FieldRow label="Description" hint="optional, shown to learners">
          <textarea
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            rows={3}
            className={inputCls()}
            placeholder="Algebra, geometry, and statistics. Closed-book. Calculator allowed."
          />
        </FieldRow>

        <FieldRow label="Status">
          <select value={form.status} onChange={(e) => set('status', e.target.value)} className={inputCls()}>
            <option value={PAPER_STATUSES.DRAFT}>Draft (hidden from learners)</option>
            <option value={PAPER_STATUSES.PUBLISHED}>Published (visible at /papers)</option>
            <option value={PAPER_STATUSES.ARCHIVED}>Archived (hidden, kept for reference)</option>
          </select>
        </FieldRow>

        <div className="grid gap-4">
          <FieldRow label="Paper PDF" hint={existing?.pdfFilename ? `current: ${existing.pdfFilename}` : 'required for new papers, max 20MB'}>
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => setPaperFile(e.target.files?.[0] ?? null)}
              className="block w-full text-xs file:mr-3 file:py-2 file:px-3 file:rounded-full file:border-0 file:font-bold file:theme-accent-fill file:theme-on-accent file:text-xs hover:file:opacity-90"
            />
          </FieldRow>
          <FieldRow label="Mark scheme PDF" hint={existing?.markSchemeFilename ? `current: ${existing.markSchemeFilename}` : 'optional, separate PDF, max 20MB'}>
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => setMarkSchemeFile(e.target.files?.[0] ?? null)}
              className="block w-full text-xs file:mr-3 file:py-2 file:px-3 file:rounded-full file:border-0 file:font-bold file:theme-card file:theme-text file:border-2 file:theme-border file:text-xs hover:file:theme-bg-subtle"
            />
          </FieldRow>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2 border-t theme-border">
          <button
            type="submit"
            disabled={saving}
            className="theme-accent-fill theme-on-accent rounded-full px-5 py-2 text-sm font-black hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : isNew ? 'Create paper' : 'Save changes'}
          </button>
          <Link
            to="/admin/papers"
            className="text-sm font-bold theme-text-muted hover:theme-text"
          >
            Cancel
          </Link>
          {!isNew && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="ml-auto text-xs font-bold text-rose-700 hover:underline disabled:opacity-50"
            >
              {deleting ? 'Deleting…' : 'Delete this paper'}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
