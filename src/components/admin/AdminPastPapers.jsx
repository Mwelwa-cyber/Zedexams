/**
 * /admin/papers — admin list of every past paper across statuses
 * (draft / published / archived). Audit A2 foundation.
 *
 * Counterpart to /admin/quizzes; admin-only per Firestore rules.
 * Provides a "New paper" CTA, a status filter, and a table-style
 * row per paper with quick edit links.
 */

import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  PAPER_STATUSES,
  listAllPapersForAdmin,
} from '../../utils/pastPapers'
import { SUBJECTS } from '../../config/curriculum'
import { convertPaperToQuizDraft } from '../../utils/paperToQuizConverter'
import { useAuth } from '../../contexts/AuthContext'
import { useFirestore } from '../../hooks/useFirestore'
import SeoHelmet from '../seo/SeoHelmet'
import Skeleton from '../ui/Skeleton'

const STATUS_LABEL = {
  [PAPER_STATUSES.DRAFT]:     { label: 'Draft',     cls: 'bg-amber-100 text-amber-800' },
  [PAPER_STATUSES.PUBLISHED]: { label: 'Published', cls: 'bg-emerald-100 text-emerald-800' },
  [PAPER_STATUSES.ARCHIVED]:  { label: 'Archived',  cls: 'bg-slate-200 text-slate-700' },
}

function formatDate(ts) {
  if (!ts) return '—'
  const d = ts?.toDate?.() ?? new Date(ts)
  if (Number.isNaN(d?.getTime?.())) return '—'
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function AdminPastPapers() {
  const [papers, setPapers] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  // Per-row "Convert to quiz draft" state. converting holds the
  // current paper id so only one row spins at a time; convertMsg /
  // convertErr show a banner above the list with the result.
  const [converting, setConverting] = useState(null)
  const [convertMsg, setConvertMsg] = useState(null)
  const [convertErr, setConvertErr] = useState(null)
  const { currentUser } = useAuth()
  const { createQuiz, saveQuestions } = useFirestore()
  const navigate = useNavigate()

  async function handleConvert(paper) {
    if (converting) return
    setConverting(paper.id)
    setConvertMsg(null)
    setConvertErr(null)
    try {
      const result = await convertPaperToQuizDraft({
        paper,
        uid: currentUser?.uid,
        createQuiz,
        saveQuestions,
        onProgress: ({ step }) => setConvertMsg(step),
      })
      setConvertMsg(`✓ Converted to a draft quiz with ${result.questionCount} question${result.questionCount === 1 ? '' : 's'}. Opening editor…`)
      setTimeout(() => navigate(`/admin/quizzes/${result.quizId}/edit`), 800)
    } catch (err) {
      setConvertErr(err?.message || 'Conversion failed.')
      setConvertMsg(null)
    } finally {
      setConverting(null)
    }
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    listAllPapersForAdmin({ limit: 500 })
      .then((rows) => { if (!cancelled) setPapers(rows) })
      .catch((err) => console.warn('[AdminPastPapers] list failed', err))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const filtered = statusFilter === 'all'
    ? papers
    : papers.filter((p) => (p.status || PAPER_STATUSES.DRAFT) === statusFilter)

  return (
    <div className="space-y-5">
      <SeoHelmet title="Past papers" path="/admin/papers" noIndex />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-black theme-text-muted uppercase tracking-widest">Content</p>
          <h1 className="theme-text font-display font-black text-2xl sm:text-3xl">Past papers</h1>
          <p className="theme-text-muted text-sm mt-1">
            ECZ archive uploads — Grade 7, 9, 12 across every CBC subject.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/admin/quizzes/new?mode=import"
            className="rounded-full border-2 theme-border theme-text px-3 py-2 text-xs font-black hover:bg-amber-50"
            title="Convert a past paper PDF into editable quiz questions"
          >
            🔄 Convert to quiz
          </Link>
          <Link
            to="/admin/papers/new"
            className="theme-accent-fill theme-on-accent rounded-full px-4 py-2 text-sm font-black hover:opacity-90"
          >
            + New paper
          </Link>
        </div>
      </div>

      {/* Status filter */}
      <div className="flex flex-wrap items-center gap-2">
        {[
          { id: 'all', label: 'All' },
          ...Object.entries(STATUS_LABEL).map(([id, meta]) => ({ id, label: meta.label })),
        ].map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => setStatusFilter(opt.id)}
            className={`rounded-full border-2 px-3 py-1 text-xs font-bold transition-colors ${
              statusFilter === opt.id
                ? 'theme-accent-fill theme-on-accent border-transparent'
                : 'theme-border theme-text-muted hover:theme-text'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Convert-to-quiz feedback banner (shared across rows). */}
      {convertMsg && (
        <div className="rounded-2xl border-2 border-violet-200 bg-violet-50 px-4 py-3 text-xs font-bold text-violet-900">
          {convertMsg}
        </div>
      )}
      {convertErr && (
        <div className="rounded-2xl border-2 border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800">
          <p className="font-black">Conversion failed</p>
          <p className="mt-1">{convertErr}</p>
        </div>
      )}

      {/* Body */}
      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-radius-md" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="theme-card border theme-border rounded-radius-md p-8 text-center text-sm theme-text-muted">
          No papers yet. Click <span className="theme-text font-bold">New paper</span> to upload the first one.
        </div>
      ) : (
        <ul className="theme-card border theme-border rounded-radius-md divide-y divide-current/10 overflow-hidden">
          {filtered.map((p) => {
            const subjectMeta = SUBJECTS.find((s) => s.id === p.subject)
            const status = STATUS_LABEL[p.status] || STATUS_LABEL.draft
            return (
              <li key={p.id} className="p-4 flex flex-wrap sm:flex-nowrap items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="theme-text font-black text-sm truncate">{p.title}</p>
                  <p className="theme-text-muted text-xs mt-1">
                    Grade {p.grade} · {subjectMeta?.label || p.subject} · {p.year}
                    {p.paperNumber ? ` · Paper ${p.paperNumber}` : ''}
                  </p>
                  <p className="theme-text-muted text-[11px] mt-1">
                    {p.views || 0} views · {p.downloads || 0} downloads · updated {formatDate(p.updatedAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${status.cls}`}>
                    {status.label}
                  </span>
                  {p.pdfPath && (
                    <button
                      type="button"
                      onClick={() => handleConvert(p)}
                      disabled={converting !== null}
                      className="text-xs font-bold rounded-full px-2.5 py-1 border-2 border-violet-300 text-violet-700 hover:bg-violet-50 disabled:opacity-50"
                      title="Auto-convert this paper into a draft quiz (admin reviews before publishing)"
                    >
                      {converting === p.id ? '… working' : '✨ Convert to quiz'}
                    </button>
                  )}
                  <Link
                    to={`/admin/papers/${p.id}/edit`}
                    className="text-xs font-bold theme-accent-text hover:underline"
                  >
                    Edit
                  </Link>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
