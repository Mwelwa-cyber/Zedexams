/**
 * /papers/:paperId — view a single ECZ past paper.
 *
 * Layout — Question Paper / Answers tabs, full-width page images on
 * mobile, action buttons repeated at the top and bottom. Images render
 * with explicit onLoad/onError handlers so a failed page shows a clean
 * learner-friendly message instead of the browser's broken-image icon
 * (which would otherwise render the alt text and a missing-asset glyph,
 * e.g. "Grade 7 mathematics past paper 2023 — page 4").
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useDataSaver } from '../../contexts/DataSaverContext'
import { getPaper, recordPaperEvent, resolvePaperUrl } from '../../utils/pastPapers'
import { SUBJECTS } from '../../config/curriculum'
import SeoHelmet from '../seo/SeoHelmet'
import Logo from '../ui/Logo'
import Skeleton from '../ui/Skeleton'

const PdfJsViewer = lazy(() => import('./PdfJsViewer'))

function formatBytes(bytes) {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function PastPaperViewer() {
  const { paperId } = useParams()
  const { currentUser, isAdmin } = useAuth()
  const { dataSaver } = useDataSaver()
  const navigate = useNavigate()
  const [paper, setPaper] = useState(null)
  const [loading, setLoading] = useState(true)
  const [errored, setErrored] = useState(false)
  const [paperUrl, setPaperUrl] = useState(null)
  const [paperUrlLoading, setPaperUrlLoading] = useState(false)
  const [downloadError, setDownloadError] = useState('')
  const [activeTab, setActiveTab] = useState('questionPaper')
  const [answersConfirmOpen, setAnswersConfirmOpen] = useState(false)
  const answersConfirmedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getPaper(paperId)
      .then((row) => {
        if (cancelled) return
        if (!row || (row.status !== 'published' && !isAdmin)) {
          setErrored(true)
          return
        }
        setPaper(row)
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

  const [imageAssetUrls, setImageAssetUrls] = useState([])
  const [imageAssetsLoading, setImageAssetsLoading] = useState(false)
  const [failedPages, setFailedPages] = useState({})
  const [loadedPages, setLoadedPages] = useState({})
  const [retryNonces, setRetryNonces] = useState({})

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

  useEffect(() => {
    if (!paper || !currentUser || previewSource?.kind !== 'images') {
      setImageAssetUrls([])
      return
    }
    let cancelled = false
    setImageAssetsLoading(true)
    setDownloadError('')
    setFailedPages({})
    setLoadedPages({})
    setRetryNonces({})
    Promise.all(previewSource.assets.map((a) => resolvePaperUrl(a.path).catch((err) => {
      console.warn('[PastPaperViewer] image url failed', a.path, err)
      return null
    })))
      .then((urls) => { if (!cancelled) setImageAssetUrls(urls) })
      .finally(() => { if (!cancelled) setImageAssetsLoading(false) })
    return () => { cancelled = true }
  }, [paper, currentUser, previewSource?.kind, previewSource?.assets])

  const handleImageLoad = useCallback((pageKey) => {
    setLoadedPages((prev) => ({ ...prev, [pageKey]: true }))
  }, [])

  const handleImageError = useCallback((pageKey, page) => {
    setFailedPages((prev) => ({ ...prev, [pageKey]: true }))
    console.error('[PastPaperViewer] page failed to load', {
      pageKey,
      pageNumber: page?.pageNumber,
      path: page?.path,
    })
  }, [])

  const handleRetryPage = useCallback((pageKey, page) => {
    setFailedPages((prev) => {
      const next = { ...prev }
      delete next[pageKey]
      return next
    })
    setLoadedPages((prev) => {
      const next = { ...prev }
      delete next[pageKey]
      return next
    })
    // If the original signed URL never resolved, refetch one. Otherwise
    // just bump the nonce to bust the browser's failed-fetch cache for
    // the existing URL.
    if (page?.path && (!page.url || retryNonces[pageKey])) {
      resolvePaperUrl(page.path)
        .then((url) => {
          if (!url) return
          setImageAssetUrls((prev) => {
            const next = [...prev]
            const idx = page.pageNumber - 1
            if (idx >= 0 && idx < next.length) next[idx] = url
            return next
          })
        })
        .catch((err) => {
          console.warn('[PastPaperViewer] retry url fetch failed', err)
          setFailedPages((prev) => ({ ...prev, [pageKey]: true }))
        })
    }
    setRetryNonces((prev) => ({ ...prev, [pageKey]: (prev[pageKey] || 0) + 1 }))
  }, [retryNonces])

  const requestTabChange = useCallback((next) => {
    if (next === 'answers' && !answersConfirmedRef.current) {
      try {
        if (typeof window !== 'undefined' && window.localStorage?.getItem(`paper-answer-revealed:${paperId}`) === '1') {
          answersConfirmedRef.current = true
        }
      } catch { /* localStorage blocked — fall through to modal */ }
    }
    if (next === 'answers' && !answersConfirmedRef.current) {
      setAnswersConfirmOpen(true)
      return
    }
    setActiveTab(next)
  }, [paperId])

  const confirmRevealAnswers = useCallback(() => {
    answersConfirmedRef.current = true
    try {
      window.localStorage?.setItem(`paper-answer-revealed:${paperId}`, '1')
    } catch { /* ignore */ }
    setAnswersConfirmOpen(false)
    setActiveTab('answers')
  }, [paperId])

  const handleDownload = useCallback(async (path, kind) => {
    if (!path) return
    setDownloadError('')
    try {
      const url = await resolvePaperUrl(path)
      window.open(url, '_blank', 'noopener,noreferrer')
      recordPaperEvent(paperId, 'download').catch(() => {})
    } catch (err) {
      console.warn('[PastPaperViewer] download failed', { kind, err })
      setDownloadError('Download failed — please try again.')
    }
  }, [paperId])

  // Build a clean, validated list of pages for the image renderer.
  // Filters empty/invalid URLs and sorts deterministically by page index.
  const validImagePages = useMemo(() => {
    if (previewSource?.kind !== 'images') return []
    return previewSource.assets
      .map((asset, idx) => ({
        key: asset.path || `page-${idx}`,
        pageNumber: idx + 1,
        path: asset.path,
        url: imageAssetUrls[idx] || null,
        width: asset.width || null,
        height: asset.height || null,
      }))
      .filter((p) => Boolean(p.url) && typeof p.url === 'string' && p.url.trim() !== '')
      .sort((a, b) => a.pageNumber - b.pageNumber)
  }, [previewSource, imageAssetUrls])

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
  const quizAvailable = Boolean(paper.quizId)
  const timedExamAvailable = Boolean(currentUser)
  const answersAvailable = Boolean(markSchemeSource)

  const renderActionButtons = (variant) => (
    <div className={`flex flex-col sm:flex-row gap-2 ${variant === 'footer' ? 'mt-6' : ''}`}>
      {quizAvailable ? (
        <Link
          to={`/papers/${paperId}/quiz`}
          className="theme-accent-fill theme-on-accent rounded-full px-5 py-3 text-sm font-black text-center hover:opacity-90 min-h-[48px] flex items-center justify-center"
        >
          ✏️ Take the quiz
        </Link>
      ) : (
        <button
          type="button"
          disabled
          className="theme-accent-fill theme-on-accent rounded-full px-5 py-3 text-sm font-black opacity-55 cursor-not-allowed min-h-[48px]"
        >
          ✏️ Quiz coming soon
        </button>
      )}
      {timedExamAvailable ? (
        <Link
          to={`/papers/${paperId}/practice`}
          className="theme-card border theme-border rounded-full px-5 py-3 text-sm font-black text-center hover:theme-bg-subtle min-h-[48px] flex items-center justify-center"
        >
          🎯 Practise as timed exam{paper.durationMinutes ? ` (${paper.durationMinutes} min)` : ''}
        </Link>
      ) : (
        <Link
          to={`/login?next=/papers/${paperId}`}
          className="theme-card border theme-border rounded-full px-5 py-3 text-sm font-black text-center hover:theme-bg-subtle min-h-[48px] flex items-center justify-center"
        >
          🎯 Sign in to practise as timed exam
        </Link>
      )}
    </div>
  )

  return (
    <div className="min-h-screen theme-bg flex flex-col">
      <SeoHelmet
        title={paper.title}
        description={`${paper.examBoard || 'ECZ'} Grade ${paper.grade} ${subjectLabel} ${paper.year} past paper${paper.paperNumber ? `, Paper ${paper.paperNumber}` : ''}.`}
        path={`/papers/${paperId}`}
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'LearningResource',
          name: paper.title,
          educationalLevel: `Grade ${paper.grade}`,
          learningResourceType: 'Exam',
          inLanguage: 'en',
          about: subjectLabel,
          provider: {
            '@type': 'Organization',
            name: paper.examBoard || 'Examinations Council of Zambia',
          },
          publisher: { '@type': 'Organization', name: 'ZedExams' },
          datePublished: paper.year ? `${paper.year}-01-01` : undefined,
          url: `https://zedexams.com/papers/${paperId}`,
        }}
      />

      {/* Header — back button on mobile, breadcrumb on desktop */}
      <header className="theme-card border-b theme-border px-3 sm:px-4 py-2.5 sm:py-3">
        <div className="max-w-5xl mx-auto flex items-center gap-2 sm:gap-3 text-xs font-bold theme-text-muted">
          <Link
            to="/papers"
            aria-label="Back to papers"
            className="sm:hidden inline-flex items-center justify-center w-9 h-9 rounded-full hover:theme-bg-subtle theme-text"
          >
            ←
          </Link>
          <div className="hidden sm:flex items-center gap-3">
            <Link to="/" className="hover:theme-text"><Logo className="h-5 w-auto" /></Link>
            <span aria-hidden="true">/</span>
            <Link to="/papers" className="hover:theme-text">Papers</Link>
            <span aria-hidden="true">/</span>
            <span className="theme-text truncate">{paper.title}</span>
          </div>
          <span className="sm:hidden theme-text font-black text-sm truncate">{paper.title}</span>
        </div>
      </header>

      <div className="flex-1 max-w-5xl w-full mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-4">
        {/* Title — shown once at the top only */}
        <section>
          <p className="theme-text-muted text-xs font-black uppercase tracking-widest">
            {paper.examBoard || 'ECZ'} · Grade {paper.grade} · {paper.year}
          </p>
          <h1 className="theme-text font-display font-black text-xl sm:text-3xl mt-1 leading-snug">{paper.title}</h1>
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

        {/* Top action buttons */}
        {renderActionButtons('header')}

        {downloadError && (
          <p role="alert" className="text-sm font-bold text-rose-700">{downloadError}</p>
        )}

        {!currentUser ? (
          <section className="theme-card border theme-border rounded-radius-md p-6 text-center">
            <h2 className="theme-text font-black text-base">Sign in to read the paper here</h2>
            <p className="theme-text-muted text-sm mt-2 max-w-md mx-auto">
              Past papers are available to ZedExams members. Creating an
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
        ) : (
          <>
            {/* Question Paper / Answers tabs */}
            <div role="tablist" aria-label="Paper sections" className="flex gap-2 border-b theme-border">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'questionPaper'}
                onClick={() => requestTabChange('questionPaper')}
                className={`px-4 py-2.5 text-sm font-black rounded-t-md min-h-[42px] transition-colors ${
                  activeTab === 'questionPaper'
                    ? 'theme-text border-b-2 border-current'
                    : 'theme-text-muted hover:theme-text'
                }`}
              >
                Question Paper
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'answers'}
                onClick={() => requestTabChange('answers')}
                className={`px-4 py-2.5 text-sm font-black rounded-t-md min-h-[42px] transition-colors inline-flex items-center gap-2 ${
                  activeTab === 'answers'
                    ? 'theme-text border-b-2 border-current'
                    : 'theme-text-muted hover:theme-text'
                }`}
              >
                Answers
                {answersAvailable ? (
                  <span
                    aria-hidden="true"
                    className="inline-block w-2 h-2 rounded-full bg-emerald-500"
                    title="Answers available"
                  />
                ) : (
                  <span className="text-[10px] font-bold theme-text-muted uppercase tracking-wide bg-amber-100 text-amber-800 rounded-full px-1.5 py-0.5">
                    Soon
                  </span>
                )}
              </button>
            </div>

            {answersConfirmOpen && (
              <AnswersConfirmDialog
                onCancel={() => setAnswersConfirmOpen(false)}
                onConfirm={confirmRevealAnswers}
              />
            )}

            {activeTab === 'questionPaper' && (
              <section aria-labelledby="question-paper-tab">
                {!previewSource && (
                  <div className="theme-card border theme-border rounded-radius-md p-6 text-center text-sm theme-text-muted">
                    No paper file has been attached yet.
                  </div>
                )}

                {previewSource?.kind === 'pdf' && (
                  paperUrlLoading || !paperUrl ? (
                    <div className="theme-card border theme-border rounded-radius-md h-[70vh] flex items-center justify-center theme-text-muted text-sm">
                      Loading paper…
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleDownload(previewSource.path, 'paper')}
                          className="theme-card border theme-border rounded-full px-4 py-2 text-xs font-black hover:theme-bg-subtle"
                        >
                          ⬇️ Download paper{previewSource.size ? ` (${formatBytes(previewSource.size)})` : ''}
                        </button>
                      </div>
                      <Suspense fallback={
                        <div className="theme-card border theme-border rounded-radius-md h-[70vh] flex items-center justify-center theme-text-muted text-sm">
                          Loading paper…
                        </div>
                      }>
                        <PdfJsViewer url={paperUrl} title={paper.title} />
                      </Suspense>
                    </div>
                  )
                )}

                {previewSource?.kind === 'images' && (
                  <PageImageList
                    pages={validImagePages}
                    totalPages={previewSource.assets.length}
                    loading={imageAssetsLoading}
                    loadedPages={loadedPages}
                    failedPages={failedPages}
                    retryNonces={retryNonces}
                    dataSaver={dataSaver}
                    syncHash
                    progressKey={`paper-progress:${paperId}`}
                    onLoad={handleImageLoad}
                    onError={handleImageError}
                    onRetry={handleRetryPage}
                  />
                )}
              </section>
            )}

            {activeTab === 'answers' && (
              <section aria-labelledby="answers-tab">
                {answersAvailable ? (
                  <AnswersPanel
                    source={markSchemeSource}
                    paperTitle={paper.title}
                    onDownload={handleDownload}
                  />
                ) : (
                  <div className="theme-card border theme-border rounded-radius-md p-8 text-center">
                    <p className="theme-text font-black text-base">Answers coming soon.</p>
                    <p className="theme-text-muted text-sm mt-2">
                      We're still preparing the answer key for this paper. Check back soon.
                    </p>
                  </div>
                )}
              </section>
            )}

            {/* Bottom action buttons */}
            {renderActionButtons('footer')}
          </>
        )}
      </div>

      <BackToTopFab />
    </div>
  )
}

/**
 * Floating "back to top" button — appears after the learner scrolls
 * past one viewport so reaching the tab bar / Take-the-quiz CTA from
 * the bottom of a long paper is one tap, not 14 swipes.
 */
function BackToTopFab() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const onScroll = () => {
      setVisible(window.scrollY > window.innerHeight * 0.75)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  if (!visible) return null

  return (
    <button
      type="button"
      aria-label="Back to top"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      className="fixed bottom-5 right-5 z-20 w-12 h-12 rounded-full bg-black/75 text-white text-xl font-black shadow-elev-lg hover:bg-black/90 flex items-center justify-center"
    >
      ↑
    </button>
  )
}

/**
 * Vertical stack of past-paper page images. Each image uses onLoad /
 * onError so a network or permission failure swaps the page to a clean
 * "page failed to load" panel instead of the browser's broken-image
 * glyph (which would otherwise show the alt text and an icon).
 */
function PageImageList({ pages, totalPages, loading, loadedPages, failedPages, retryNonces = {}, dataSaver = false, onLoad, onError, onRetry, altPrefix = 'Question paper page', syncHash = false, progressKey = null }) {
  const articleRefs = useRef({})
  const [visiblePage, setVisiblePage] = useState(1)
  const hasScrolledToHashRef = useRef(false)
  const hasRestoredProgressRef = useRef(false)
  // In Data Saver mode, pre-load only the first 2 pages; later pages
  // wait for an explicit "Load page" tap so a long paper doesn't burn
  // through 10+ MB on open.
  const DATA_SAVER_AUTOLOAD = 2
  const [revealedPages, setRevealedPages] = useState(() => {
    const next = {}
    if (dataSaver) {
      pages.slice(0, DATA_SAVER_AUTOLOAD).forEach((p) => { next[p.key] = true })
    }
    return next
  })

  useEffect(() => {
    if (!dataSaver) return
    setRevealedPages((prev) => {
      const next = { ...prev }
      pages.slice(0, DATA_SAVER_AUTOLOAD).forEach((p) => { next[p.key] = true })
      return next
    })
  }, [dataSaver, pages])

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the entry with the largest intersection ratio in view —
        // when two pages straddle the viewport, the bigger one wins.
        const inView = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)
        if (inView.length) {
          const pageNumber = Number(inView[0].target.dataset.pageNumber)
          if (pageNumber) {
            setVisiblePage(pageNumber)
            if (syncHash && typeof window !== 'undefined') {
              const nextHash = `#page=${pageNumber}`
              if (window.location.hash !== nextHash) {
                window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${nextHash}`)
              }
            }
            if (progressKey && typeof window !== 'undefined') {
              try {
                window.localStorage?.setItem(progressKey, String(pageNumber))
              } catch { /* quota / private mode — ignore */ }
            }
          }
        }
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1], rootMargin: '-20% 0px -60% 0px' },
    )
    Object.values(articleRefs.current).forEach((el) => {
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [pages, syncHash, progressKey])

  // On first mount, scroll to either:
  //   1. the #page=N hash (shared deep link wins — explicit intent)
  //   2. otherwise the locally-saved progress page (resume reading)
  // Only runs once per pages array; subsequent hash / progress updates
  // are driven by the observer and shouldn't fight the user's scroll.
  useEffect(() => {
    if (!pages.length) return
    if (hasScrolledToHashRef.current && hasRestoredProgressRef.current) return
    if (typeof window === 'undefined') return
    let targetPageNumber = null
    if (syncHash && !hasScrolledToHashRef.current) {
      const match = /#page=(\d+)/.exec(window.location.hash)
      if (match) targetPageNumber = Number(match[1])
    }
    if (targetPageNumber == null && progressKey && !hasRestoredProgressRef.current) {
      try {
        const stored = window.localStorage?.getItem(progressKey)
        const parsed = stored ? Number(stored) : NaN
        if (Number.isInteger(parsed) && parsed > 1) targetPageNumber = parsed
      } catch { /* ignore */ }
    }
    hasScrolledToHashRef.current = true
    hasRestoredProgressRef.current = true
    if (!targetPageNumber) return
    const target = pages.find((p) => p.pageNumber === targetPageNumber)
    if (!target) return
    if (dataSaver) setRevealedPages((prev) => ({ ...prev, [target.key]: true }))
    const el = articleRefs.current[target.key]
    if (!el) return
    requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: 'auto', block: 'start' })
    })
  }, [pages, syncHash, dataSaver, progressKey])

  if (loading) {
    return (
      <div className="theme-card border theme-border rounded-radius-md h-[60vh] flex items-center justify-center theme-text-muted text-sm">
        Loading paper…
      </div>
    )
  }

  if (!pages.length) {
    return (
      <div className="theme-card border theme-border rounded-radius-md p-6 text-center text-sm theme-text-muted">
        No pages available. Please refresh or contact support.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5 relative">
      <p className="text-center text-xs font-black theme-text-muted uppercase tracking-widest">
        {totalPages} {totalPages === 1 ? 'page' : 'pages'}
      </p>

      {/* Sticky page indicator — orients the learner inside a long paper */}
      {totalPages > 3 && (
        <div
          aria-hidden="true"
          className="sticky top-2 z-10 self-center pointer-events-none"
        >
          <span className="inline-block bg-black/75 text-white text-xs font-black rounded-full px-3 py-1 shadow-elev-md tabular-nums">
            Page {visiblePage} of {totalPages}
          </span>
        </div>
      )}

      {pages.map((page) => {
        const hasFailed = failedPages[page.key]
        const hasLoaded = loadedPages[page.key]
        const nonce = retryNonces[page.key] || 0
        const gated = dataSaver && !revealedPages[page.key]
        // Add a cache-busting param on retry so the browser refetches
        // instead of replaying its cached failure.
        const src = nonce > 0
          ? `${page.url}${page.url.includes('?') ? '&' : '?'}_r=${nonce}`
          : page.url
        return (
          <article
            key={page.key}
            ref={(el) => { articleRefs.current[page.key] = el }}
            data-page-number={page.pageNumber}
            className="w-full"
          >
            <p className="text-center text-xs font-bold theme-text-muted mb-2">
              Page {page.pageNumber} of {totalPages}
            </p>
            <div className="w-full bg-white rounded-radius-md overflow-hidden shadow-elev-sm">
              {hasFailed ? (
                <div className="px-4 py-8 text-center bg-rose-50">
                  <p className="text-sm font-bold text-rose-700">
                    Page failed to load. Please check your connection and try again.
                  </p>
                  {onRetry && (
                    <button
                      type="button"
                      onClick={() => onRetry(page.key, page)}
                      className="mt-3 inline-flex items-center justify-center rounded-full bg-rose-600 text-white px-4 py-2 text-xs font-black hover:bg-rose-700 min-h-[40px]"
                    >
                      Retry
                    </button>
                  )}
                </div>
              ) : gated ? (
                <button
                  type="button"
                  onClick={() => setRevealedPages((prev) => ({ ...prev, [page.key]: true }))}
                  className="w-full flex flex-col items-center justify-center gap-2 py-12 text-sm font-black theme-text-muted hover:theme-text hover:theme-bg-subtle"
                  style={{ minHeight: '40vh' }}
                >
                  <span className="text-3xl" aria-hidden="true">📄</span>
                  <span>Tap to load page {page.pageNumber}</span>
                  <span className="text-xs font-bold theme-text-muted">Data Saver is on</span>
                </button>
              ) : (
                <>
                  {!hasLoaded && (
                    <div
                      className="w-full flex items-center justify-center theme-text-muted text-sm"
                      style={{
                        aspectRatio: page.width && page.height
                          ? `${page.width} / ${page.height}`
                          : '1 / 1.41',
                        maxHeight: '70vh',
                      }}
                    >
                      Loading page {page.pageNumber}…
                    </div>
                  )}
                  <img
                    key={`${page.key}-${nonce}`}
                    src={src}
                    alt={`${altPrefix} ${page.pageNumber} of ${totalPages}`}
                    loading="lazy"
                    decoding="async"
                    width={page.width || undefined}
                    height={page.height || undefined}
                    onLoad={() => onLoad(page.key)}
                    onError={() => onError(page.key, page)}
                    className={hasLoaded
                      ? 'block w-full h-auto max-w-[900px] mx-auto'
                      : 'hidden'}
                  />
                </>
              )}
            </div>
          </article>
        )
      })}
    </div>
  )
}

function AnswersConfirmDialog({ onCancel, onConfirm }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="answers-confirm-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onCancel}
    >
      <div
        className="theme-card rounded-radius-md max-w-md w-full p-5 shadow-elev-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="answers-confirm-title" className="theme-text font-black text-lg">
          Reveal the answers?
        </h2>
        <p className="theme-text-muted text-sm mt-2 leading-relaxed">
          You'll learn the most if you try the questions yourself first. Are
          you sure you want to see the answers now?
        </p>
        <div className="mt-5 flex flex-col sm:flex-row-reverse gap-2">
          <button
            type="button"
            onClick={onConfirm}
            className="theme-accent-fill theme-on-accent rounded-full px-5 py-2.5 text-sm font-black hover:opacity-90 min-h-[44px]"
          >
            Yes, show answers
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="theme-card border theme-border rounded-full px-5 py-2.5 text-sm font-black hover:theme-bg-subtle min-h-[44px]"
          >
            Keep trying first
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Answers panel rendered inside the "Answers" tab. PDF answers use the
 * canvas viewer; image-based answers stack vertically like the question
 * paper, with the same clean error handling per page.
 */
function AnswersPanel({ source, paperTitle, onDownload }) {
  const [url, setUrl] = useState(null)
  const [imageUrls, setImageUrls] = useState([])
  const [loading, setLoading] = useState(true)
  const [failedPages, setFailedPages] = useState({})
  const [loadedPages, setLoadedPages] = useState({})
  const [retryNonces, setRetryNonces] = useState({})

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setFailedPages({})
    setLoadedPages({})
    setRetryNonces({})
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
        console.warn('[PastPaperViewer] answers load failed', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    resolve()
    return () => { cancelled = true }
  }, [source])

  const validPages = useMemo(() => {
    if (source.kind !== 'images') return []
    return source.assets
      .map((asset, idx) => ({
        key: asset.path || `answer-page-${idx}`,
        pageNumber: idx + 1,
        path: asset.path,
        url: imageUrls[idx] || null,
        width: asset.width || null,
        height: asset.height || null,
      }))
      .filter((p) => Boolean(p.url))
      .sort((a, b) => a.pageNumber - b.pageNumber)
  }, [source, imageUrls])

  if (loading) {
    return (
      <div className="theme-card border theme-border rounded-radius-md h-[40vh] flex items-center justify-center theme-text-muted text-sm">
        Loading answers…
      </div>
    )
  }

  if (source.kind === 'pdf' && url) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => onDownload(source.path, 'mark-scheme')}
            className="theme-card border theme-border rounded-full px-4 py-2 text-xs font-black hover:theme-bg-subtle"
          >
            ⬇️ Download answers
          </button>
        </div>
        <Suspense fallback={
          <div className="theme-card border theme-border rounded-radius-md h-[60vh] flex items-center justify-center theme-text-muted text-sm">
            Loading viewer…
          </div>
        }>
          <PdfJsViewer url={url} title={`${paperTitle} — answers`} />
        </Suspense>
      </div>
    )
  }

  if (source.kind === 'images') {
    return (
      <PageImageList
        pages={validPages}
        totalPages={source.assets.length}
        loading={false}
        loadedPages={loadedPages}
        failedPages={failedPages}
        retryNonces={retryNonces}
        altPrefix="Answer key page"
        onLoad={(key) => setLoadedPages((prev) => ({ ...prev, [key]: true }))}
        onError={(key, page) => {
          setFailedPages((prev) => ({ ...prev, [key]: true }))
          console.error('[PastPaperViewer] answers page failed to load', {
            key,
            pageNumber: page?.pageNumber,
            path: page?.path,
          })
        }}
        onRetry={(key) => {
          setFailedPages((prev) => {
            const next = { ...prev }
            delete next[key]
            return next
          })
          setLoadedPages((prev) => {
            const next = { ...prev }
            delete next[key]
            return next
          })
          setRetryNonces((prev) => ({ ...prev, [key]: (prev[key] || 0) + 1 }))
        }}
      />
    )
  }

  return (
    <div className="theme-card border theme-border rounded-radius-md p-8 text-center">
      <p className="theme-text font-black text-base">Answers coming soon.</p>
    </div>
  )
}
