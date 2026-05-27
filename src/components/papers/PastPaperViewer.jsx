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

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
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
  const { currentUser, isAdmin } = useAuth()
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
        // Admins can preview draft / archived papers from the Studio's
        // "Preview as learner" button. Everyone else only sees the
        // paper once it's been published.
        if (!row || (row.status !== 'published' && !isAdmin)) {
          setErrored(true)
          return
        }
        setPaper(row)
        // Best-effort: record a view. Doesn't block render.
        // eslint-disable-next-line promise/no-nesting
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
  }, [paperId, isAdmin])

  // The "preview source" picks the right rendering path:
  //   1. legacy pdfPath (set by the old single-page editor)
  //   2. a PDF inside the paper-role assets[] (Studio single-PDF case)
  //   3. images inside the paper-role assets[] (scanned multi-page)
  // Mark-scheme assets are split out into their own optional source.
  //
  // Memoised so the derived `assets` arrays keep a stable reference across
  // renders — the image-fetch effect below uses them as a dependency, and a
  // fresh `.filter()` array on every render would retrigger the effect, cancel
  // the in-flight `getDownloadURL` calls, and leave the spinner spinning.
  const { previewSource, markSchemeSource } = useMemo(() => {
    const paperAssets = Array.isArray(paper?.assets)
      ? paper.assets.filter((a) => a.role !== 'mark-scheme')
      : []
    const markSchemeAssets = Array.isArray(paper?.assets)
      ? paper.assets.filter((a) => a.role === 'mark-scheme')
      : []

    const buildPreview = () => {
      if (!paper) return null
      if (paper.pdfPath) return { kind: 'pdf', path: paper.pdfPath, size: paper.pdfSize || null }
      if (paperAssets.length === 0) return null
      const pdfAsset = paperAssets.find((a) => a.contentType === 'application/pdf')
      if (pdfAsset) return { kind: 'pdf', path: pdfAsset.path, size: pdfAsset.size || null }
      const images = paperAssets.filter((a) => a.contentType?.startsWith('image/'))
      if (images.length) return { kind: 'images', assets: images }
      return null
    }

    const buildMarkScheme = () => {
      if (!paper) return null
      if (paper.markSchemePath) return { kind: 'pdf', path: paper.markSchemePath, size: null }
      if (!markSchemeAssets.length) return null
      const pdfAsset = markSchemeAssets.find((a) => a.contentType === 'application/pdf')
      if (pdfAsset) return { kind: 'pdf', path: pdfAsset.path, size: pdfAsset.size || null }
      const images = markSchemeAssets.filter((a) => a.contentType?.startsWith('image/'))
      if (images.length) return { kind: 'images', assets: images }
      return null
    }

    return { previewSource: buildPreview(), markSchemeSource: buildMarkScheme() }
  }, [paper])

  // Resolved signed URLs for image-only papers. One per asset in upload
  // order — fetched in parallel after auth so the stacked scan view
  // composes into a single readable page.
  const [imageAssetUrls, setImageAssetUrls] = useState([])
  const [imageAssetsLoading, setImageAssetsLoading] = useState(false)

  // Fetch a signed URL for the PDF only when the user is signed in —
  // anonymous visitors trip Storage rules and get a CORS error in the
  // console, which is noisy. Wait for auth before attempting.
  useEffect(() => {
    if (!paper || !currentUser || previewSource?.kind !== 'pdf') {
      setPaperUrl(null)
      return
    }
    let cancelled = false
    setPaperUrlLoading(true)
    setDownloadError('')
    resolvePaperUrl(previewSource.path)
      .then((url) => { if (!cancelled) setPaperUrl(url) })
      .catch((err) => {
        console.warn('[PastPaperViewer] pdf URL failed', err)
        if (!cancelled) setDownloadError('Could not load this paper. Try refreshing.')
      })
      .finally(() => { if (!cancelled) setPaperUrlLoading(false) })
    return () => { cancelled = true }
  }, [paper, currentUser, previewSource?.kind, previewSource?.path])

  // Multi-image scanned-paper case — resolve every asset URL in parallel.
  useEffect(() => {
    if (!paper || !currentUser || previewSource?.kind !== 'images') {
      setImageAssetUrls([])
      return
    }
    let cancelled = false
    setImageAssetsLoading(true)
    setDownloadError('')
    Promise.all(previewSource.assets.map((a) => resolvePaperUrl(a.path).catch((err) => {
      console.warn('[PastPaperViewer] image url failed', a.path, err)
      return null
    })))
      .then((urls) => { if (!cancelled) setImageAssetUrls(urls) })
      .finally(() => { if (!cancelled) setImageAssetsLoading(false) })
    return () => { cancelled = true }
  }, [paper, currentUser, previewSource?.kind, previewSource?.assets])

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
          <Link to="/" className="hover:theme-text"><Logo className="h-5 w-auto" /></Link>
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
          {/* Past-paper quiz — available to anon visitors too. Primary
              CTA when the paper has a linked quiz; otherwise hidden. */}
          {paper.quizId && (
            <Link
              to={`/papers/${paperId}/quiz`}
              className="theme-accent-fill theme-on-accent rounded-full px-4 py-2 text-sm font-black hover:opacity-90"
            >
              ✏️ Take the quiz
            </Link>
          )}
          {currentUser ? (
            <>
              {/* Audit A2 PR 3 — practising under a timer is the #1
                  thing that improves real-exam performance. */}
              <Link
                to={`/papers/${paperId}/practice`}
                className="theme-card border theme-border rounded-full px-4 py-2 text-sm font-black hover:theme-bg-subtle"
              >
                🎯 Practise as timed exam{paper.durationMinutes ? ` (${paper.durationMinutes} min)` : ''}
              </Link>
              {previewSource?.kind === 'pdf' && (
                <button
                  type="button"
                  onClick={() => handleDownload(previewSource.path, 'paper')}
                  className="theme-card border theme-border rounded-full px-4 py-2 text-sm font-black hover:theme-bg-subtle"
                >
                  ⬇️ Download paper{previewSource.size ? ` (${formatBytes(previewSource.size)})` : ''}
                </button>
              )}
              {markSchemeSource?.kind === 'pdf' && (
                <button
                  type="button"
                  onClick={() => handleDownload(markSchemeSource.path, 'mark-scheme')}
                  className="theme-card border theme-border rounded-full px-4 py-2 text-sm font-black hover:theme-bg-subtle"
                >
                  📝 Download mark scheme
                </button>
              )}
            </>
          ) : (
            <Link
              to={`/login?next=/papers/${paperId}`}
              className="theme-card border theme-border rounded-full px-4 py-2 text-sm font-black hover:theme-bg-subtle"
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
        {currentUser && previewSource?.kind === 'pdf' && (
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

        {/* Scanned-paper case: a series of images stacked vertically.
            Each lands at a max readable width on mobile; lazy-loaded so
            a 30-page paper doesn't fetch every page on first paint. */}
        {currentUser && previewSource?.kind === 'images' && (
          imageAssetsLoading ? (
            <div className="theme-card border theme-border rounded-radius-md h-[70vh] flex items-center justify-center theme-text-muted text-sm">
              Loading scanned pages…
            </div>
          ) : (
            <section className="theme-card border theme-border rounded-radius-md p-3 space-y-3">
              <p className="text-xs font-black theme-text-muted uppercase tracking-widest text-center">
                {previewSource.assets.length} scanned page{previewSource.assets.length === 1 ? '' : 's'}
              </p>
              {previewSource.assets.map((asset, idx) => {
                const url = imageAssetUrls[idx]
                if (!url) {
                  return (
                    <div
                      key={asset.path}
                      className="theme-bg-subtle rounded-radius-md h-64 flex items-center justify-center text-xs theme-text-muted"
                    >
                      Page {idx + 1} unavailable
                    </div>
                  )
                }
                return (
                  <figure key={asset.path} className="space-y-1">
                    <img
                      src={url}
                      alt={`${paper.title} — page ${idx + 1}`}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-auto rounded-radius-md theme-bg-subtle"
                    />
                    <figcaption className="text-center text-xs theme-text-muted font-bold">
                      Page {idx + 1} of {previewSource.assets.length}
                    </figcaption>
                  </figure>
                )
              })}
            </section>
          )
        )}

        {currentUser && !previewSource && (
          <div className="theme-card border theme-border rounded-radius-md p-6 text-center text-sm theme-text-muted">
            No paper file has been attached yet.
          </div>
        )}

        {/* Mark scheme — collapsed by default so the learner attempts
            the paper first. Same auth requirement as the paper itself
            because Storage rules gate the file read. */}
        {currentUser && markSchemeSource && (
          <MarkSchemeSection
            source={markSchemeSource}
            paperTitle={paper.title}
            paperId={paperId}
            onDownload={handleDownload}
          />
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

/**
 * Mark scheme reveal section. Collapsed by default so a learner is
 * nudged into attempting the paper first. On expand it resolves the
 * relevant signed URLs and renders the scheme inline (PDF or stacked
 * images) plus a download button.
 */
function MarkSchemeSection({ source, paperTitle, paperId, onDownload }) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState(null)
  const [imageUrls, setImageUrls] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    async function resolve() {
      try {
        if (source.kind === 'pdf') {
          const u = await resolvePaperUrl(source.path)
          if (!cancelled) setUrl(u)
        } else {
          const urls = await Promise.all(source.assets.map((a) =>
            resolvePaperUrl(a.path).catch(() => null),
          ))
          if (!cancelled) setImageUrls(urls)
        }
      } catch (err) {
        console.warn('[PastPaperViewer] mark scheme load failed', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    resolve()
    return () => { cancelled = true }
  }, [open, source])

  return (
    <section className="theme-card border theme-border rounded-radius-md overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between p-4 hover:theme-bg-subtle text-left"
      >
        <div>
          <p className="theme-text font-black text-sm">📝 Mark scheme</p>
          <p className="theme-text-muted text-xs mt-0.5">
            {open ? 'Click to hide. Try the paper yourself first!' : 'Click to reveal the answer key.'}
          </p>
        </div>
        <span className="theme-text-muted text-lg" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="border-t theme-border p-3 space-y-3">
          <div className="flex flex-wrap gap-2">
            {source.kind === 'pdf' && (
              <button
                type="button"
                onClick={() => onDownload(source.path, 'mark-scheme')}
                className="theme-card border theme-border rounded-full px-4 py-2 text-xs font-black hover:theme-bg-subtle"
              >
                ⬇️ Download mark scheme
              </button>
            )}
          </div>
          {loading ? (
            <div className="h-40 flex items-center justify-center theme-text-muted text-sm">
              Loading mark scheme…
            </div>
          ) : source.kind === 'pdf' && url ? (
            <Suspense fallback={
              <div className="h-[60vh] flex items-center justify-center theme-text-muted text-sm">
                Loading viewer…
              </div>
            }>
              <PdfJsViewer url={url} title={`${paperTitle} — mark scheme`} />
            </Suspense>
          ) : source.kind === 'images' ? (
            <div className="space-y-3">
              {source.assets.map((a, i) => {
                const u = imageUrls[i]
                if (!u) {
                  return (
                    <div key={a.path} className="theme-bg-subtle rounded-radius-md h-48 flex items-center justify-center text-xs theme-text-muted">
                      Page {i + 1} unavailable
                    </div>
                  )
                }
                return (
                  <figure key={a.path} className="space-y-1">
                    <img
                      src={u}
                      alt={`${paperTitle} mark scheme page ${i + 1}`}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-auto rounded-radius-md theme-bg-subtle"
                    />
                    <figcaption className="text-center text-xs theme-text-muted font-bold">
                      Mark scheme page {i + 1} of {source.assets.length}
                    </figcaption>
                  </figure>
                )
              })}
            </div>
          ) : null}
          <p className="text-xs theme-text-muted">
            Paper id <code>{paperId}</code>
          </p>
        </div>
      )}
    </section>
  )
}
