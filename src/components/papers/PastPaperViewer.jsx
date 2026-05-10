/**
 * /papers/:paperId — view + download a single ECZ past paper.
 *
 * Page logic:
 *   - Anonymous read of the Firestore doc (rules allow read for
 *     status==published).
 *   - The PDF itself lives in Storage with auth-required read rules,
 *     so signed-out visitors see metadata + a "Sign in to view" CTA
 *     instead of the iframe.
 *   - Inline iframe for signed-in users — the browser's native PDF
 *     viewer is good enough for v1; PDF.js polish lands later if we
 *     need annotations or richer paging.
 *   - "Download paper" + "Download mark scheme" buttons request a
 *     fresh signed URL each click (so a token leak from a previous
 *     session can't be reused).
 *   - View / download counts are best-effort incremented for analytics.
 */

import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { getPaper, recordPaperEvent, resolvePaperUrl } from '../../utils/pastPapers'
import { SUBJECTS } from '../../config/curriculum'
import SeoHelmet from '../seo/SeoHelmet'
import Logo from '../ui/Logo'
import Skeleton from '../ui/Skeleton'

// Audit A2 PR 2 — PDF.js viewer is heavy (the worker + the lib add
// ~400 kB gzipped). Lazy-load so a learner browsing /papers without
// opening one doesn't pay the cost.
const PdfJsViewer = lazy(() => import('./PdfJsViewer'))

function formatBytes(bytes) {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function PastPaperViewer() {
  const { paperId } = useParams()
  const { currentUser } = useAuth()
  const navigate = useNavigate()
  const [paper, setPaper] = useState(null)
  const [loading, setLoading] = useState(true)
  const [errored, setErrored] = useState(false)
  const [paperUrl, setPaperUrl] = useState(null)
  const [paperUrlLoading, setPaperUrlLoading] = useState(false)
  const [downloadError, setDownloadError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getPaper(paperId)
      .then((row) => {
        if (cancelled) return
        if (!row || row.status !== 'published') {
          setErrored(true)
          return
        }
        setPaper(row)
        // Best-effort: record a view. Doesn't block render.
        recordPaperEvent(paperId, 'view').catch(() => {})
      })
      .catch((err) => {
        console.warn('[PastPaperViewer] load failed', err)
        if (!cancelled) setErrored(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [paperId])

  // Fetch a signed URL for the PDF only when the user is signed in —
  // anonymous visitors trip Storage rules and get a CORS error in the
  // console, which is noisy. Wait for auth before attempting.
  useEffect(() => {
    if (!paper || !currentUser) {
      setPaperUrl(null)
      return
    }
    let cancelled = false
    setPaperUrlLoading(true)
    setDownloadError('')
    resolvePaperUrl(paper.pdfPath)
      .then((url) => { if (!cancelled) setPaperUrl(url) })
      .catch((err) => {
        console.warn('[PastPaperViewer] pdf URL failed', err)
        if (!cancelled) setDownloadError('Could not load this paper. Try refreshing.')
      })
      .finally(() => { if (!cancelled) setPaperUrlLoading(false) })
    return () => { cancelled = true }
  }, [paper, currentUser])

  const handleDownload = useCallback(async (path, kind) => {
    if (!path) return
    setDownloadError('')
    try {
      const url = await resolvePaperUrl(path)
      // Force a download by opening in a new tab — the storage URL
      // serves Content-Disposition: attachment so Chrome / Safari /
      // Firefox all download instead of preview here.
      window.open(url, '_blank', 'noopener,noreferrer')
      recordPaperEvent(paperId, 'download').catch(() => {})
    } catch (err) {
      console.warn('[PastPaperViewer] download failed', { kind, err })
      setDownloadError('Download failed — please try again.')
    }
  }, [paperId])

  if (loading) {
    return (
      <div className="min-h-screen theme-bg p-6 max-w-4xl mx-auto space-y-4">
        <Skeleton className="h-10 w-2/3 rounded-md" />
        <Skeleton className="h-6 w-1/3 rounded-md" />
        <Skeleton className="h-96 rounded-radius-md" />
      </div>
    )
  }

  if (errored || !paper) {
    return (
      <div className="min-h-screen theme-bg flex flex-col items-center justify-center px-4 text-center">
        <div className="text-5xl mb-3">📄</div>
        <h1 className="theme-text font-black text-xl">Paper not found</h1>
        <p className="theme-text-muted text-sm mt-2 max-w-sm">
          This past paper may have been moved or unpublished.
        </p>
        <button
          type="button"
          onClick={() => navigate('/papers')}
          className="mt-6 theme-accent-fill theme-on-accent rounded-full px-5 py-2.5 text-sm font-black hover:opacity-90"
        >
          Back to archive
        </button>
      </div>
    )
  }

  const subjectMeta = SUBJECTS.find((s) => s.id === paper.subject)
  const subjectLabel = subjectMeta?.label || paper.subject

  return (
    <div className="min-h-screen theme-bg flex flex-col">
      <SeoHelmet
        title={paper.title}
        description={`${paper.examBoard || 'ECZ'} Grade ${paper.grade} ${subjectLabel} ${paper.year} past paper${paper.paperNumber ? `, Paper ${paper.paperNumber}` : ''}.`}
        path={`/papers/${paperId}`}
      />

      {/* Breadcrumb */}
      <header className="theme-card border-b theme-border px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center gap-3 text-xs font-bold theme-text-muted">
          <Link to="/welcome" className="hover:theme-text"><Logo className="h-5 w-auto" /></Link>
          <span aria-hidden="true">/</span>
          <Link to="/papers" className="hover:theme-text">Papers</Link>
          <span aria-hidden="true">/</span>
          <span className="theme-text truncate">{paper.title}</span>
        </div>
      </header>

      <div className="flex-1 max-w-5xl w-full mx-auto px-4 py-6 space-y-5">
        {/* Title + meta */}
        <section>
          <p className="theme-text-muted text-xs font-black uppercase tracking-widest">
            {paper.examBoard || 'ECZ'} · Grade {paper.grade} · {paper.year}
          </p>
          <h1 className="theme-text font-display font-black text-2xl sm:text-3xl mt-1">{paper.title}</h1>
          <p className="theme-text-muted text-sm mt-1">
            {subjectLabel}
            {paper.paperNumber ? ` · Paper ${paper.paperNumber}` : ''}
            {paper.durationMinutes ? ` · ${paper.durationMinutes} minutes` : ''}
            {paper.totalMarks ? ` · ${paper.totalMarks} marks` : ''}
          </p>
          {paper.description && (
            <p className="theme-text text-sm mt-3 leading-relaxed max-w-3xl">{paper.description}</p>
          )}
        </section>

        {/* Action row */}
        <section className="flex flex-wrap gap-2">
          {currentUser ? (
            <>
              {/* Audit A2 PR 3 — primary CTA. The conversion lever the
                  audit called out: practising under a timer is the #1
                  thing that improves real-exam performance. */}
              <Link
                to={`/papers/${paperId}/practice`}
                className="theme-accent-fill theme-on-accent rounded-full px-4 py-2 text-sm font-black hover:opacity-90"
              >
                🎯 Practise as timed exam{paper.durationMinutes ? ` (${paper.durationMinutes} min)` : ''}
              </Link>
              <button
                type="button"
                onClick={() => handleDownload(paper.pdfPath, 'paper')}
                className="theme-card border theme-border rounded-full px-4 py-2 text-sm font-black hover:theme-bg-subtle"
              >
                ⬇️ Download paper ({formatBytes(paper.pdfSize)})
              </button>
              {paper.markSchemePath && (
                <button
                  type="button"
                  onClick={() => handleDownload(paper.markSchemePath, 'mark-scheme')}
                  className="theme-card border theme-border rounded-full px-4 py-2 text-sm font-black hover:theme-bg-subtle"
                >
                  📝 Download mark scheme
                </button>
              )}
            </>
          ) : (
            <Link
              to={`/login?next=/papers/${paperId}`}
              className="theme-accent-fill theme-on-accent rounded-full px-4 py-2 text-sm font-black hover:opacity-90"
            >
              Sign in to view + download
            </Link>
          )}
        </section>

        {downloadError && (
          <p role="alert" className="text-sm font-bold text-rose-700">{downloadError}</p>
        )}

        {/* Inline viewer (signed-in only). Audit A2 PR 2 — PDF.js
            replaces the iframe. iOS Safari refuses inline iframe PDFs
            on most pages and falls back to "tap to download"; PDF.js
            renders consistently across Safari, Chrome, Edge, Firefox,
            and the Capacitor WebView. */}
        {currentUser && (
          paperUrlLoading || !paperUrl ? (
            <div className="theme-card border theme-border rounded-radius-md h-[70vh] flex items-center justify-center theme-text-muted text-sm">
              Loading paper…
            </div>
          ) : (
            <Suspense fallback={
              <div className="theme-card border theme-border rounded-radius-md h-[70vh] flex items-center justify-center theme-text-muted text-sm">
                Loading viewer…
              </div>
            }>
              <PdfJsViewer url={paperUrl} title={paper.title} />
            </Suspense>
          )
        )}

        {!currentUser && (
          <section className="theme-card border theme-border rounded-radius-md p-6 text-center">
            <h2 className="theme-text font-black text-base">Sign in to read the paper here</h2>
            <p className="theme-text-muted text-sm mt-2 max-w-md mx-auto">
              Past-paper PDFs are available to ZedExams members. Creating an
              account is free and takes under a minute.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Link
                to={`/login?next=/papers/${paperId}`}
                className="theme-accent-fill theme-on-accent rounded-full px-4 py-2 text-sm font-black hover:opacity-90"
              >
                Sign in
              </Link>
              <Link
                to="/register"
                className="theme-card border theme-border rounded-full px-4 py-2 text-sm font-black hover:theme-bg-subtle"
              >
                Create free account
              </Link>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
