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
import useHideOnScroll from '../../hooks/useHideOnScroll'
import {
  getPaper,
  getLinkedQuizMeta,
  listMyPaperAttempts,
  listPublishedPapers,
  recordPaperEvent,
  resolvePaperUrl,
} from '../../utils/pastPapers'
import { QUIZ_PENDING_COPY, paperQuizIsAttached } from '../../utils/pastPaperQuizStatus'
import { saveBlob } from '../../utils/saveBlob'
import usePaperResumeSync from '../../features/learnerHome/lib/paperResumeSync'
import { buildDownloadName } from '../../utils/downloadFilename'
import { siblingPapers, viewPath } from './paperNav'
import { isOfficialSource, paperNumberLabel, paperSourceLabel } from '../../config/paperSources'
import { PaperSourceBadge } from './PaperTitle'
import { subjectMeta } from './paperVisuals'
import SeoHelmet from '../seo/SeoHelmet'
import Skeleton from '../ui/Skeleton'
import {
  ArrowLeft,
  BookmarkSquareIcon,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Info,
  Layers,
  Maximize2,
  PencilLine,
  TrophyIcon,
  Upload,
} from '../ui/icons'

const PdfJsViewer = lazy(() => import('./PdfJsViewer'))
const ImageZoomOverlay = lazy(() => import('./ImageZoomOverlay'))
const PaperReaderOverlay = lazy(() => import('./PaperReaderOverlay'))

/** Best-effort file extension from a Storage path (drops any query string). */
function extFromPath(path) {
  const match = /\.([a-z0-9]+)(?:\?|$)/i.exec(String(path || ''))
  return match ? match[1].toLowerCase() : null
}

/** Fetch a Storage URL as a Blob. Storage CORS is configured (see CLAUDE.md
 *  `npm run storage:cors`), so cross-origin reads of the bytes succeed. */
async function fetchAsBlob(url) {
  const res = await fetch(url, { mode: 'cors' })
  if (!res.ok) throw new Error(`Download fetch failed: ${res.status}`)
  return res.blob()
}

/**
 * Breaks a child out of its max-width column to span the full viewport
 * width, so an opened paper fills the whole screen edge-to-edge instead
 * of sitting in a narrow centred strip. Capped on very wide desktops so
 * a single scanned page doesn't blow up past readability; the root
 * viewer uses `overflow-x-clip` so the 100vw breakout can't introduce a
 * horizontal scrollbar.
 */
function FullBleed({ children }) {
  // Break out to the full viewport on phone / tablet so a scanned page
  // fills the screen; on desktop (lg+) the viewer lives inside its
  // three-pane column, so the breakout is disabled to leave room for
  // the right rail.
  return (
    <div className="relative left-1/2 right-1/2 w-screen -translate-x-1/2 lg:left-auto lg:right-auto lg:mx-0 lg:w-full lg:translate-x-0">
      <div className="mx-auto max-w-[1400px] px-1 sm:px-3 lg:px-0">{children}</div>
    </div>
  )
}

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
  // Dashboard "Continue Reading" resume: local mirror + debounced
  // cross-device sync (writes only on leave, never per scroll).
  usePaperResumeSync({ paperId, paper, uid: currentUser?.uid || null })
  const [paperUrl, setPaperUrl] = useState(null)
  const [paperUrlLoading, setPaperUrlLoading] = useState(false)
  const [downloadError, setDownloadError] = useState('')
  const [downloadFallbackUrl, setDownloadFallbackUrl] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [immersive, setImmersive] = useState(false)
  const [activeTab, setActiveTab] = useState('questionPaper')
  const [answersConfirmOpen, setAnswersConfirmOpen] = useState(false)
  const answersConfirmedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const load = async () => {
      try {
        const row = await getPaper(paperId)
        if (cancelled) return
        if (!row || (row.status !== 'published' && !isAdmin)) {
          setErrored(true)
          return
        }
        setPaper(row)
        try { await recordPaperEvent(paperId, 'view') } catch { /* view telemetry is best-effort */ }
      } catch (err) {
        console.warn('[PastPaperViewer] load failed', err)
        if (!cancelled) setErrored(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load().catch(() => {})
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
    const { assets } = previewSource
    setImageAssetsLoading(true)
    setDownloadError('')
    setFailedPages({})
    setLoadedPages({})
    setRetryNonces({})
    // Seed a stable, index-aligned slot array so each signed URL can drop
    // into place as it resolves. `validImagePages` filters out the nulls,
    // so pages appear progressively instead of waiting on the slowest one.
    setImageAssetUrls(new Array(assets.length).fill(null))
    // Resolve every page's download URL independently rather than gating
    // the whole paper on a single Promise.all — a multi-page paper needs
    // one getDownloadURL round-trip per page, and the old code blocked the
    // first page on the last one finishing. Now page 1 paints the moment
    // its URL lands. The full-screen "Loading paper…" gate clears as soon
    // as the first URL resolves successfully, or once every page has
    // settled (so an all-failed paper still surfaces its error state
    // instead of spinning forever).
    let settled = 0
    assets.forEach((a, idx) => {
      resolvePaperUrl(a.path)
        .then((url) => {
          if (cancelled || !url) return
          setImageAssetUrls((prev) => {
            const next = [...prev]
            next[idx] = url
            return next
          })
          setImageAssetsLoading(false)
        })
        .catch((err) => {
          console.warn('[PastPaperViewer] image url failed', a.path, err)
        })
        .finally(() => {
          settled += 1
          if (!cancelled && settled === assets.length) setImageAssetsLoading(false)
        })
    })
    return () => { cancelled = true }
  }, [paper, currentUser, previewSource])

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

  // Human filename for a saved paper, e.g. "Grade 7 Mathematics Paper 1 -
  // 2023.pdf" (mark scheme → "… (Mark Scheme).pdf"). Uses the shared builder
  // so the name is consistent with every other download in the app.
  const buildPaperFilename = useCallback((kind, ext) => buildDownloadName({
    docType: paper?.paperNumber ? `Paper ${paper.paperNumber}` : 'Past Paper',
    grade: paper?.grade,
    subject: paper?.subject,
    year: paper?.year,
    variant: kind === 'mark-scheme' ? 'Mark Scheme' : null,
    ext,
  }), [paper])

  // Save a paper/mark-scheme as a real file. Unlike the old `window.open`
  // (blocked by mobile popup blockers after the `await`, and never an actual
  // download), this fetches the bytes and hands them to the shared saveBlob
  // helper — which works on desktop, mobile browsers, and the Capacitor app.
  // A multi-page scanned paper is zipped so the learner gets every page, not
  // just page 1.
  const downloadSource = useCallback(async (source, kind) => {
    if (!source || downloading) return
    setDownloadError('')
    setDownloadFallbackUrl('')
    setDownloading(true)
    try {
      if (source.kind === 'pdf') {
        const url = await resolvePaperUrl(source.path)
        const blob = await fetchAsBlob(url)
        await saveBlob(blob, buildPaperFilename(kind, extFromPath(source.path) || 'pdf'))
      } else if (source.kind === 'images' && Array.isArray(source.assets) && source.assets.length) {
        if (source.assets.length === 1) {
          const url = await resolvePaperUrl(source.assets[0].path)
          const blob = await fetchAsBlob(url)
          await saveBlob(blob, buildPaperFilename(kind, extFromPath(source.assets[0].path) || 'jpg'))
        } else {
          const { default: JSZip } = await import('jszip')
          const zip = new JSZip()
          const files = await Promise.all(source.assets.map(async (asset, idx) => {
            const url = await resolvePaperUrl(asset.path)
            const blob = await fetchAsBlob(url)
            return { idx, blob, ext: extFromPath(asset.path) || 'jpg' }
          }))
          files
            .sort((a, b) => a.idx - b.idx)
            .forEach(({ idx, blob, ext }) => {
              zip.file(`page-${String(idx + 1).padStart(2, '0')}.${ext}`, blob)
            })
          const zipBlob = await zip.generateAsync({ type: 'blob' })
          await saveBlob(zipBlob, buildPaperFilename(kind, 'zip'))
        }
      } else {
        throw new Error('No downloadable file for this paper.')
      }
      recordPaperEvent(paperId, 'download').catch(() => {})
    } catch (err) {
      console.warn('[PastPaperViewer] download failed', { kind, err })
      setDownloadError('Could not save the file automatically.')
      // Give the learner a direct link as a fallback (CORS / offline case).
      try {
        const firstPath = source.kind === 'pdf' ? source.path : source.assets?.[0]?.path
        if (firstPath) setDownloadFallbackUrl(await resolvePaperUrl(firstPath))
      } catch { /* nothing more we can do */ }
    } finally {
      setDownloading(false)
    }
  }, [paperId, downloading, buildPaperFilename])

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

  // ── Redesign state: bookmark, siblings, quiz meta, attempts, chrome ─
  const [bookmarked, setBookmarked] = useState(false)
  const [siblings, setSiblings] = useState([])
  const [quizMeta, setQuizMeta] = useState(null)
  const [attempts, setAttempts] = useState([])
  const [shareNote, setShareNote] = useState('')

  // Bookmark state mirrors the hub's `zx_paper_bookmarks` list so a save
  // here shows up as saved back on /papers.
  useEffect(() => {
    try {
      const raw = localStorage.getItem('zx_paper_bookmarks')
      const ids = raw ? JSON.parse(raw) : []
      setBookmarked(Array.isArray(ids) && ids.includes(paperId))
    } catch { /* private mode — bookmarks are best-effort */ }
  }, [paperId])

  const toggleBookmark = useCallback(() => {
    setBookmarked((prev) => {
      const next = !prev
      try {
        const raw = localStorage.getItem('zx_paper_bookmarks')
        const ids = new Set(Array.isArray(JSON.parse(raw || '[]')) ? JSON.parse(raw || '[]') : [])
        if (next) ids.add(paperId)
        else ids.delete(paperId)
        localStorage.setItem('zx_paper_bookmarks', JSON.stringify([...ids]))
      } catch { /* ignore quota / private mode */ }
      return next
    })
  }, [paperId])

  // Sibling subjects for the same grade+year → prev/next subject nav.
  useEffect(() => {
    if (!paper?.grade || !paper?.year) return
    let cancelled = false
    listPublishedPapers({ grade: paper.grade, year: paper.year })
      .then((rows) => { if (!cancelled) setSiblings(siblingPapers(rows, paper.grade, paper.year)) })
      .catch((err) => console.warn('[PastPaperViewer] siblings failed', err))
    return () => { cancelled = true }
  }, [paper?.grade, paper?.year])

  // Linked-quiz metadata (question count / difficulty) for the panel. Skipped
  // entirely while the quiz is pending — there is no panel to fill, and the
  // paper may still carry the id of a quiz that has no questions in it.
  useEffect(() => {
    if (!paper || !paperQuizIsAttached(paper)) { setQuizMeta(null); return }
    let cancelled = false
    getLinkedQuizMeta(paper.quizId)
      .then((meta) => { if (!cancelled) setQuizMeta(meta) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [paper])

  // This learner's timed-practice attempts on this paper (progress panel).
  useEffect(() => {
    if (!currentUser || !paperId) { setAttempts([]); return }
    let cancelled = false
    listMyPaperAttempts(currentUser.uid, { limit: 60 })
      .then((rows) => {
        if (cancelled) return
        setAttempts(rows.filter((a) => a.paperId === paperId && a.status === 'submitted'))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [currentUser, paperId])

  const handleShare = useCallback(async () => {
    const url = typeof window !== 'undefined' ? window.location.href : `https://zedexams.com/papers/${paperId}`
    const shareData = { title: paper?.title || 'ECZ Past Paper', text: paper?.title, url }
    try {
      if (navigator.share) {
        await navigator.share(shareData)
        return
      }
    } catch { /* user cancelled or share unsupported — fall through to copy */ }
    try {
      await navigator.clipboard.writeText(url)
      setShareNote('Link copied')
      setTimeout(() => setShareNote(''), 2000)
    } catch {
      setShareNote('Could not copy link')
      setTimeout(() => setShareNote(''), 2000)
    }
  }, [paper, paperId])

  // Immersive reading mode is a CSS overlay (see PaperReaderOverlay), not the
  // native Fullscreen API — reliable on iOS Safari + the Capacitor WebView,
  // where element.requestFullscreen() is unsupported or leaves the content
  // frozen and unscrollable.
  const openReader = useCallback(() => setImmersive(true), [])
  const closeReader = useCallback(() => setImmersive(false), [])

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

  const subjectInfo = subjectMeta(paper.subject)
  const subjectLabel = subjectInfo.fullLabel
  const SubjectIcon = subjectInfo.Icon
  // Derived rather than `Boolean(paper.quizId)`: the Quiz step of the Past
  // Paper Studio is optional, so a live paper can be carrying a quiz id that
  // is explicitly marked 'pending' (nothing in it yet). Papers published
  // before the field existed fall back to the id — see pastPaperQuizStatus.js.
  const quizAvailable = paperQuizIsAttached(paper)
  const timedExamAvailable = Boolean(currentUser)
  const answersAvailable = Boolean(markSchemeSource)

  // Total page count for the info card — image papers count assets, PDF
  // papers fall back to a stored value when present.
  const totalPages = previewSource?.kind === 'images'
    ? previewSource.assets.length
    : (paper.totalPages || null)

  // Prev / next subject within the same grade + year.
  const siblingIndex = siblings.findIndex((s) => s.id === paperId)
  const prevSibling = siblingIndex > 0 ? siblings[siblingIndex - 1] : null
  const nextSibling = siblingIndex >= 0 && siblingIndex < siblings.length - 1 ? siblings[siblingIndex + 1] : null
  const subjectsBackTo = `/papers?grade=${paper.grade}&year=${paper.year}`

  // Progress stats from timed-practice attempts (existing paperAttempts).
  const attemptCount = attempts.length
  const bestTime = attempts.reduce((min, a) => {
    const s = Number(a.elapsedSeconds)
    return Number.isFinite(s) && (min == null || s < min) ? s : min
  }, null)
  const avgTime = attemptCount
    ? Math.round(attempts.reduce((sum, a) => sum + (Number(a.elapsedSeconds) || 0), 0) / attemptCount)
    : null
  let quizTaken = false
  try { quizTaken = typeof window !== 'undefined' && window.localStorage?.getItem(`paper-answer-revealed:${paperId}`) === '1' } catch { /* ignore */ }

  // Whether the sticky-bar / tab Download buttons have a file to save.
  const canDownloadPaper = previewSource?.kind === 'pdf'
    || (previewSource?.kind === 'images' && (previewSource.assets?.length || 0) > 0)

  // Whether the floating glass page-navigation dock is on screen — true
  // whenever the visible tab is showing a page-by-page PDF viewer. Image
  // papers scroll vertically and never get the dock (or PDF arrows).
  const dockActive = Boolean(currentUser) && (
    (activeTab === 'questionPaper' && previewSource?.kind === 'pdf')
    || (activeTab === 'answers' && markSchemeSource?.kind === 'pdf')
  )

  return (
    <div
      className="min-h-screen theme-bg flex flex-col overflow-x-clip"
      // Reserve space under the content so the fixed dock never permanently
      // covers the panels / footer at the end of the page.
      style={dockActive ? { paddingBottom: 'calc(112px + env(safe-area-inset-bottom))' } : undefined}
    >
      <ViewerDockBodyFlag active={dockActive} />
      <SeoHelmet
        title={paper.title}
        description={`${paper.examBoard || 'ECZ'} Grade ${paper.grade} ${subjectLabel} ${paper.year} past paper${paper.paperNumber ? `, Paper ${paper.paperNumber}` : ''}.`}
        path={`/papers/${paperId}${paper.slug ? `/${paper.slug}` : ''}`}
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

      {/* Sticky top: back + breadcrumb, then a persistent action bar */}
      <div className="sticky top-0 z-20 theme-card border-b theme-border">
        <div className="max-w-6xl mx-auto px-3 sm:px-4">
          <div className="flex items-center gap-1.5 h-12 text-xs font-bold theme-text-muted">
            <Link
              to={subjectsBackTo}
              aria-label="Back to subjects"
              className="inline-flex items-center justify-center w-9 h-9 -ml-1.5 rounded-full hover:theme-bg-subtle theme-text"
            >
              <ArrowLeft size={18} strokeWidth={2.4} />
            </Link>
            <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 min-w-0">
              <Link to="/papers" className="hover:theme-text whitespace-nowrap">Grade {paper.grade}</Link>
              <ChevronRight size={12} strokeWidth={2.8} className="flex-shrink-0" />
              <Link to={subjectsBackTo} className="hover:theme-text whitespace-nowrap">{paper.year}</Link>
              <ChevronRight size={12} strokeWidth={2.8} className="flex-shrink-0" />
              <span className="theme-text font-black truncate" aria-current="page">{subjectLabel}</span>
            </nav>
          </div>

          {/* Sticky action bar — horizontally scrollable pills, full-bleed
              with padded ends so the last action is never cropped */}
          <div className="flex items-center gap-2 pb-2 overflow-x-auto no-scrollbar -mx-3 px-3 sm:-mx-4 sm:px-4">
            {quizAvailable ? (
              <Link
                to={`/papers/${paperId}/quiz`}
                className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-full theme-accent-fill theme-on-accent px-4 py-2 text-xs font-black active:scale-95 transition"
              >
                <PencilLine size={15} strokeWidth={2.4} /> Quiz
              </Link>
            ) : (
              <span className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-full theme-bg-subtle theme-text-muted px-4 py-2 text-xs font-black">
                <Clock size={15} strokeWidth={2.4} /> Quiz soon
              </span>
            )}
            {canDownloadPaper && (
              <button
                type="button"
                onClick={() => downloadSource(previewSource, 'paper')}
                disabled={downloading}
                className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-full theme-bg-subtle theme-text px-4 py-2 text-xs font-black active:scale-95 transition hover:theme-card disabled:opacity-60"
              >
                <Download size={15} strokeWidth={2.4} /> {downloading ? 'Preparing…' : 'Download'}
              </button>
            )}
            <button
              type="button"
              onClick={toggleBookmark}
              aria-pressed={bookmarked}
              className={`flex-shrink-0 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-black active:scale-95 transition ${
                bookmarked ? 'theme-accent-text bg-orange-50' : 'theme-bg-subtle theme-text hover:theme-card'
              }`}
            >
              <BookmarkSquareIcon size={15} strokeWidth={bookmarked ? 2.6 : 2.2} /> {bookmarked ? 'Saved' : 'Bookmark'}
            </button>
            <button
              type="button"
              onClick={handleShare}
              className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-full theme-bg-subtle theme-text px-4 py-2 text-xs font-black active:scale-95 transition hover:theme-card"
            >
              <Upload size={15} strokeWidth={2.4} /> {shareNote || 'Share'}
            </button>
            {previewSource && (
              <button
                type="button"
                onClick={openReader}
                className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-full theme-bg-subtle theme-text px-4 py-2 text-xs font-black active:scale-95 transition hover:theme-card"
              >
                <Maximize2 size={15} strokeWidth={2.4} /> Fullscreen
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 theme-bg max-w-6xl w-full mx-auto px-3 sm:px-4 py-4 sm:py-6">
        {/* Title block */}
        <section className="mb-4">
          <div className="flex items-start gap-3">
            <div className={`hidden sm:grid flex-shrink-0 w-14 h-14 rounded-2xl place-items-center ${subjectInfo.tile}`}>
              <SubjectIcon size={28} strokeWidth={2.1} />
            </div>
            <div className="min-w-0">
              <h1 className="theme-text font-display font-black text-2xl sm:text-3xl leading-tight">
                Grade {paper.grade} {subjectLabel}
              </h1>
              {/* The source badge sits with the title, not in a details panel
                  further down: "is this the real exam or a mock?" is the first
                  thing a learner needs from this page, and the answer must not
                  be something they have to scroll for. */}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {paperSourceLabel(paper.source) && (
                  <PaperSourceBadge
                    label={paperSourceLabel(paper.source)}
                    isOfficial={isOfficialSource(paper.source)}
                  />
                )}
                <p className="theme-text-muted text-sm font-bold">
                  {[paper.session, paper.year, paperNumberLabel(paper.paperNumber)]
                    .filter(Boolean).join(' · ')}
                </p>
              </div>
              {paper.description && (
                <p className="theme-text text-sm mt-3 leading-relaxed max-w-3xl">{paper.description}</p>
              )}
            </div>
          </div>
        </section>

        {downloadError && (
          <p role="alert" className="text-sm font-bold text-rose-700 mb-3">
            {downloadError}
            {downloadFallbackUrl && (
              <>
                {' '}
                <a
                  href={downloadFallbackUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline theme-accent-text"
                >
                  Open it in a new tab
                </a>
                {' '}instead.
              </>
            )}
          </p>
        )}

        {/* Three-pane on desktop: viewer ~70% + right rail */}
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6 lg:items-start">
          <div className="min-w-0 space-y-4">
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
                    <div className="theme-card border theme-border rounded-radius-md h-[70vh] flex flex-col items-center justify-center gap-3 theme-text-muted text-sm">
                      <Skeleton className="w-40 h-56 rounded-radius-md" />
                      <span className="font-bold">Preparing your paper…</span>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={openReader}
                          className="inline-flex items-center gap-1.5 theme-card border theme-border rounded-full px-4 py-2 text-xs font-black hover:theme-bg-subtle"
                        >
                          <Maximize2 size={14} strokeWidth={2.4} /> Read fullscreen
                        </button>
                        <button
                          type="button"
                          onClick={() => downloadSource(previewSource, 'paper')}
                          disabled={downloading}
                          className="theme-card border theme-border rounded-full px-4 py-2 text-xs font-black hover:theme-bg-subtle disabled:opacity-60"
                        >
                          {downloading ? '⏳ Preparing…' : `⬇️ Download paper${previewSource.size ? ` (${formatBytes(previewSource.size)})` : ''}`}
                        </button>
                      </div>
                      <FullBleed>
                        <Suspense fallback={
                          <div className="theme-card border theme-border rounded-radius-md h-[70vh] flex items-center justify-center theme-text-muted text-sm">
                            Loading paper…
                          </div>
                        }>
                          <PdfJsViewer url={paperUrl} title={paper.title} storageKey={`paper-pdf-page:${paperId}`} dock />
                        </Suspense>
                      </FullBleed>
                    </div>
                  )
                )}

                {previewSource?.kind === 'images' && (
                  <FullBleed>
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
                  </FullBleed>
                )}
              </section>
            )}

            {activeTab === 'answers' && (
              <section aria-labelledby="answers-tab">
                {answersAvailable ? (
                  <AnswersPanel
                    source={markSchemeSource}
                    paperTitle={paper.title}
                    onDownload={downloadSource}
                    downloading={downloading}
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

          </>
        )}
          </div>

          {/* Right rail — desktop only, sticky */}
          <aside className="hidden lg:block lg:sticky lg:top-28 space-y-4">
            <PaperPanels
              paper={paper}
              paperId={paperId}
              quizAvailable={quizAvailable}
              quizMeta={quizMeta}
              subjectLabel={subjectLabel}
              totalPages={totalPages}
              timedExamAvailable={timedExamAvailable}
              attemptCount={attemptCount}
              bestTime={bestTime}
              avgTime={avgTime}
              quizTaken={quizTaken}
            />
          </aside>
        </div>

        {/* Panels stacked below the viewer on phone / tablet */}
        <div className="lg:hidden mt-5 space-y-4">
          <PaperPanels
            paper={paper}
            paperId={paperId}
            quizAvailable={quizAvailable}
            quizMeta={quizMeta}
            subjectLabel={subjectLabel}
            totalPages={totalPages}
            timedExamAvailable={timedExamAvailable}
            attemptCount={attemptCount}
            bestTime={bestTime}
            avgTime={avgTime}
            quizTaken={quizTaken}
          />
        </div>

        {/* Subject navigation — Prev / Back to subjects / Next */}
        <SubjectNav prev={prevSibling} next={nextSibling} backTo={subjectsBackTo} />
      </div>

      <MobileQuizFab paperId={paperId} available={quizAvailable} aboveDock={dockActive} />
      {/* The dock owns the bottom edge in PDF mode; back-to-top is only
          needed for the long vertical scroll of image papers. */}
      {!dockActive && <BackToTopFab />}

      {/* Immersive reading mode — a CSS overlay (not the native Fullscreen
          API) so it scrolls + exits reliably on iOS and the Capacitor app.
          Shows the question paper, whose URLs are already resolved above. */}
      {immersive && previewSource && (
        <Suspense fallback={null}>
          <PaperReaderOverlay
            title={`Grade ${paper.grade} ${subjectLabel} · ${paper.year}`}
            onClose={closeReader}
            onDownload={canDownloadPaper ? () => downloadSource(previewSource, 'paper') : null}
            downloading={downloading}
          >
            {previewSource.kind === 'pdf' && (
              paperUrl ? (
                <div className="h-full p-2 sm:p-3">
                  <PdfJsViewer url={paperUrl} title={paper.title} fill storageKey={`paper-pdf-page:${paperId}`} dock />
                </div>
              ) : (
                <p className="theme-text-muted text-sm py-12 text-center">Loading paper…</p>
              )
            )}
            {previewSource.kind === 'images' && (
              <div className="mx-auto max-w-[1100px] w-full px-1 sm:px-3 py-4">
                <PageImageList
                  pages={validImagePages}
                  totalPages={previewSource.assets.length}
                  loading={imageAssetsLoading}
                  loadedPages={loadedPages}
                  failedPages={failedPages}
                  retryNonces={retryNonces}
                  dataSaver={dataSaver}
                  progressKey={`paper-progress:${paperId}`}
                  onLoad={handleImageLoad}
                  onError={handleImageError}
                  onRetry={handleRetryPage}
                />
              </div>
            )}
          </PaperReaderOverlay>
        </Suspense>
      )}
    </div>
  )
}

/**
 * Right-rail panels (also stacked below the viewer on mobile): the quiz
 * launcher, the paper-information card, and the learner's practice
 * progress. All data comes from existing reads — no new writes.
 */
function PaperPanels({
  paper, paperId, quizAvailable, quizMeta, subjectLabel, totalPages,
  timedExamAvailable, attemptCount, bestTime, avgTime, quizTaken,
}) {
  const questionCount = quizMeta?.questionCount || null
  const estMinutes = paper.durationMinutes || (questionCount ? Math.max(5, Math.round(questionCount * 1)) : null)
  return (
    <>
      {/* Quiz panel */}
      <div className="theme-card rounded-radius-lg shadow-elev-md ring-1 ring-black/5 p-4">
        {quizAvailable ? (
          <>
            <div className="flex items-center gap-2">
              <span className="grid place-items-center w-8 h-8 rounded-full bg-emerald-100 text-emerald-700">
                <Check size={16} strokeWidth={3} />
              </span>
              <h2 className="theme-text font-black text-base">Quiz Available</h2>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-center">
              <div className="rounded-xl theme-bg-subtle py-2">
                <dt className="text-[10px] font-bold theme-text-muted uppercase tracking-wide">Questions</dt>
                <dd className="theme-text font-black text-lg">{questionCount ?? '—'}</dd>
              </div>
              <div className="rounded-xl theme-bg-subtle py-2">
                <dt className="text-[10px] font-bold theme-text-muted uppercase tracking-wide">Est. time</dt>
                <dd className="theme-text font-black text-lg">{estMinutes ? `${estMinutes}m` : '—'}</dd>
              </div>
            </dl>
            <Link
              to={`/papers/${paperId}/quiz`}
              className="mt-3 w-full inline-flex items-center justify-center gap-1.5 rounded-full theme-accent-fill theme-on-accent text-sm font-black py-3 active:scale-[0.98] transition"
            >
              <PencilLine size={16} strokeWidth={2.4} /> Start Quiz
            </Link>
          </>
        ) : (
          /* Informational only — nothing here is clickable, because there is
             no quiz to click into. The paper itself stays fully readable and
             downloadable; only the quiz launcher is withheld. */
          <div className="text-center py-2">
            <span className="mx-auto grid place-items-center w-10 h-10 rounded-full theme-bg-subtle theme-text-muted mb-2">
              <Clock size={20} strokeWidth={2.2} />
            </span>
            <h2 className="theme-text font-black text-base">📝 {QUIZ_PENDING_COPY.learnerHeading}</h2>
            <p className="theme-text-muted text-sm mt-1">
              {QUIZ_PENDING_COPY.learnerBody.charAt(0).toUpperCase()}
              {QUIZ_PENDING_COPY.learnerBody.slice(1)}
            </p>
          </div>
        )}
      </div>

      {/* Paper information */}
      <div className="theme-card rounded-radius-lg shadow-elev-md ring-1 ring-black/5 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Info size={16} strokeWidth={2.4} className="theme-accent-text" />
          <h2 className="theme-text font-black text-sm uppercase tracking-wide">Paper Information</h2>
        </div>
        <dl className="space-y-2 text-sm">
          <InfoRow label="Year" value={paper.year} />
          <InfoRow label="Subject" value={subjectLabel} />
          <InfoRow label="Grade" value={paper.grade} />
          <InfoRow label="Paper Type" value={paper.paperNumber ? `Paper ${paper.paperNumber}` : 'National Examination'} />
          <InfoRow label="Language" value="English" />
          {totalPages ? <InfoRow label="Total Pages" value={totalPages} /> : null}
          <InfoRow label="Exam Board" value={paper.examBoard || 'ECZ'} />
          <InfoRow label="Last Updated" value={formatUpdated(paper.updatedAt)} />
        </dl>
      </div>

      {/* Progress (from timed-practice attempts) */}
      <div className="theme-card rounded-radius-lg shadow-elev-md ring-1 ring-black/5 p-4">
        <div className="flex items-center gap-2 mb-3">
          <TrophyIcon size={16} strokeWidth={2.4} className="theme-accent-text" />
          <h2 className="theme-text font-black text-sm uppercase tracking-wide">Your Progress</h2>
        </div>
        {attemptCount > 0 || quizTaken ? (
          <>
            {quizTaken && (
              <p className="inline-flex items-center gap-1.5 text-sm font-black text-emerald-700 mb-3">
                <Check size={15} strokeWidth={3} /> Quiz completed
              </p>
            )}
            <dl className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl theme-bg-subtle py-2">
                <dt className="text-[10px] font-bold theme-text-muted uppercase">Attempts</dt>
                <dd className="theme-text font-black text-lg">{attemptCount}</dd>
              </div>
              <div className="rounded-xl theme-bg-subtle py-2">
                <dt className="text-[10px] font-bold theme-text-muted uppercase">Best</dt>
                <dd className="theme-text font-black text-lg">{formatDuration(bestTime)}</dd>
              </div>
              <div className="rounded-xl theme-bg-subtle py-2">
                <dt className="text-[10px] font-bold theme-text-muted uppercase">Avg</dt>
                <dd className="theme-text font-black text-lg">{formatDuration(avgTime)}</dd>
              </div>
            </dl>
          </>
        ) : (
          <p className="theme-text-muted text-sm">
            Practise this paper as a timed exam to start tracking your progress.
          </p>
        )}
        {timedExamAvailable ? (
          <Link
            to={`/papers/${paperId}/practice`}
            className="mt-3 w-full inline-flex items-center justify-center gap-1.5 rounded-full theme-card border theme-border text-sm font-black py-2.5 hover:theme-bg-subtle transition"
          >
            {attemptCount > 0 ? 'Continue Practice' : 'Start timed practice'}
          </Link>
        ) : (
          <Link
            to={`/login?next=/papers/${paperId}`}
            className="mt-3 w-full inline-flex items-center justify-center gap-1.5 rounded-full theme-card border theme-border text-sm font-black py-2.5 hover:theme-bg-subtle transition"
          >
            Sign in to practise
          </Link>
        )}
      </div>
    </>
  )
}

function InfoRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="theme-text-muted font-bold">{label}</dt>
      <dd className="theme-text font-black text-right truncate">{value ?? '—'}</dd>
    </div>
  )
}

/** ← Previous Subject · Back to Subjects · Next Subject → */
function SubjectNav({ prev, next, backTo }) {
  if (!prev && !next) {
    return (
      <div className="mt-6 flex justify-center">
        <Link
          to={backTo}
          className="inline-flex items-center gap-1.5 rounded-full theme-card border theme-border px-5 py-2.5 text-sm font-black hover:theme-bg-subtle transition"
        >
          <Layers size={15} strokeWidth={2.4} /> Back to Subjects
        </Link>
      </div>
    )
  }
  return (
    <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-2 items-center">
      {prev ? (
        <Link
          to={viewPath(prev)}
          className="inline-flex items-center gap-1.5 rounded-full theme-card border theme-border px-4 py-2.5 text-xs sm:text-sm font-black hover:theme-bg-subtle transition min-w-0"
        >
          <ChevronLeft size={15} strokeWidth={2.6} className="flex-shrink-0" />
          <span className="truncate">{subjectMeta(prev.subject).label}</span>
        </Link>
      ) : <span className="hidden sm:block" />}
      <Link
        to={backTo}
        className="hidden sm:inline-flex items-center justify-center gap-1.5 rounded-full theme-bg-subtle theme-text px-4 py-2.5 text-xs sm:text-sm font-black hover:theme-card transition"
      >
        <Layers size={15} strokeWidth={2.4} /> Subjects
      </Link>
      {next ? (
        <Link
          to={viewPath(next)}
          className="inline-flex items-center justify-end gap-1.5 rounded-full theme-card border theme-border px-4 py-2.5 text-xs sm:text-sm font-black hover:theme-bg-subtle transition min-w-0 col-start-2 sm:col-start-3"
        >
          <span className="truncate">{subjectMeta(next.subject).label}</span>
          <ChevronRight size={15} strokeWidth={2.6} className="flex-shrink-0" />
        </Link>
      ) : <span className="hidden sm:block" />}
    </div>
  )
}

/**
 * Flags the <body> while the glass dock is on screen so global floating
 * chrome (the Zed chat bubble) can lift itself clear of it via CSS —
 * see `body[data-viewer-dock] .zx-chat-fab` in index.css.
 */
function ViewerDockBodyFlag({ active }) {
  useEffect(() => {
    if (!active) return undefined
    document.body.setAttribute('data-viewer-dock', '1')
    return () => document.body.removeAttribute('data-viewer-dock')
  }, [active])
  return null
}

/**
 * Floating "Take Quiz" action on phones (desktop uses the sticky bar +
 * rail). Sits on the left, above the glass dock in PDF mode, and never
 * over the Zed chat bubble (which docks right). While the learner scrolls
 * down it collapses to a small circular icon so it doesn't sit over exam
 * content; scrolling up expands it back to the full label.
 */
function MobileQuizFab({ paperId, available, aboveDock = false }) {
  const collapsed = useHideOnScroll({ threshold: 120 })
  if (!available) return null
  return (
    <Link
      to={`/papers/${paperId}/quiz`}
      aria-label="Take the quiz for this paper"
      style={{
        bottom: aboveDock
          ? 'calc(100px + env(safe-area-inset-bottom))'
          : 'calc(20px + env(safe-area-inset-bottom))',
      }}
      className={`lg:hidden fixed left-4 z-30 inline-flex items-center justify-center gap-2 rounded-full theme-accent-fill theme-on-accent min-h-[52px] text-sm font-black shadow-elev-lg active:scale-95 transition-all duration-300 ease-out ${
        collapsed ? 'w-[52px] px-0' : 'px-5 py-3'
      }`}
    >
      <PencilLine size={collapsed ? 22 : 17} strokeWidth={2.4} />
      {!collapsed && 'Take Quiz'}
    </Link>
  )
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds == null) return '—'
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return m ? `${m}m ${s}s` : `${s}s`
}

function formatUpdated(ts) {
  try {
    const date = ts?.toDate ? ts.toDate() : (ts?.seconds ? new Date(ts.seconds * 1000) : null)
    if (!date) return '—'
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return '—'
  }
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
  // The page currently open in the full-screen pinch-to-zoom viewer, if any.
  const [zoomedPage, setZoomedPage] = useState(null)
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
    <div
      className="flex flex-col gap-5 relative"
      // The page stack is a normal-flow surface: the document/body owns
      // vertical scrolling (no inner scroll container). `pan-y pinch-zoom`
      // guarantees a swipe anywhere on the paper scrolls the page and still
      // allows pinch-zoom; `overscroll-behavior-y: auto` keeps native rubber-
      // band scrolling at the ends.
      style={{ touchAction: 'pan-y pinch-zoom', overscrollBehaviorY: 'auto' }}
    >
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
                <div className="relative">
                  <PaperPageImage
                    pageKey={page.key}
                    src={src}
                    alt={`${altPrefix} ${page.pageNumber} of ${totalPages}`}
                    eager={page.pageNumber <= 2}
                    width={page.width || undefined}
                    height={page.height || undefined}
                    hasLoaded={hasLoaded}
                    onLoad={onLoad}
                    onError={() => onError(page.key, page)}
                  />
                  {!hasLoaded && (
                    <div
                      className="absolute inset-0 flex items-center justify-center theme-text-muted text-sm pointer-events-none"
                      aria-hidden="true"
                    >
                      Loading page {page.pageNumber}…
                    </div>
                  )}
                  {hasLoaded && (
                    <button
                      type="button"
                      onClick={() => setZoomedPage({
                        src,
                        alt: `${altPrefix} ${page.pageNumber} of ${totalPages}`,
                      })}
                      aria-label={`Zoom in on page ${page.pageNumber}`}
                      className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-black/70 text-white px-3 py-1.5 text-xs font-black shadow-elev-md hover:bg-black/85"
                    >
                      <span aria-hidden="true">🔍</span> Zoom
                    </button>
                  )}
                </div>
              )}
            </div>
          </article>
        )
      })}

      {zoomedPage && (
        <Suspense fallback={null}>
          <ImageZoomOverlay
            src={zoomedPage.src}
            alt={zoomedPage.alt}
            onClose={() => setZoomedPage(null)}
          />
        </Suspense>
      )}
    </div>
  )
}

/**
 * Renders the paper page <img> with a defensive "already cached?" check.
 *
 * The bug this guards against: when the Firebase Storage SW cache (or
 * the browser HTTP cache) serves the image synchronously fast — fast
 * enough that the image's `complete` flag is true before React attaches
 * the `onLoad` listener — the native `load` event never fires for our
 * listener. The "Loading page N…" overlay then sticks forever even
 * though the image is fully rendered behind it.
 *
 * Fix: on mount and on every src change, look at the underlying img
 * element. If it's already complete with non-zero natural dimensions,
 * call `onLoad` manually so the overlay clears.
 */
function PaperPageImage({ pageKey, src, alt, eager, width, height, hasLoaded, onLoad, onError }) {
  const imgRef = useRef(null)

  useEffect(() => {
    const el = imgRef.current
    if (!el || hasLoaded) return
    if (el.complete && el.naturalWidth > 0) {
      onLoad(pageKey)
    }
  }, [src, hasLoaded, pageKey, onLoad])

  return (
    <img
      ref={imgRef}
      src={src}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      width={width}
      height={height}
      onLoad={() => onLoad(pageKey)}
      onError={onError}
      className="block w-full h-auto select-none"
      style={{
        // `pan-y pinch-zoom` keeps single-finger vertical scrolling AND
        // pinch-to-zoom available when a swipe starts on the page image —
        // never `touch-action: none`, which would freeze the scroll. The
        // drag/select hints stop a long-press from starting an image drag
        // that swallows the scroll gesture instead.
        touchAction: 'pan-y pinch-zoom',
        userSelect: 'none',
        WebkitUserDrag: 'none',
        // Fallback aspect ratio reserves layout space for old uploads that
        // don't have stored dimensions yet, reducing load-time layout jumps.
        // Drop it once loaded so the intrinsic ratio takes over and the
        // rendered page isn't squashed.
        ...(!hasLoaded && !(width && height) ? { aspectRatio: '1 / 1.41' } : {}),
      }}
    />
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
function AnswersPanel({ source, paperTitle, onDownload, downloading = false }) {
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
            onClick={() => onDownload(source, 'mark-scheme')}
            disabled={downloading}
            className="theme-card border theme-border rounded-full px-4 py-2 text-xs font-black hover:theme-bg-subtle disabled:opacity-60"
          >
            {downloading ? '⏳ Preparing…' : '⬇️ Download answers'}
          </button>
        </div>
        <FullBleed>
          <Suspense fallback={
            <div className="theme-card border theme-border rounded-radius-md h-[60vh] flex items-center justify-center theme-text-muted text-sm">
              Loading viewer…
            </div>
          }>
            <PdfJsViewer url={url} title={`${paperTitle} — answers`} dock />
          </Suspense>
        </FullBleed>
      </div>
    )
  }

  if (source.kind === 'images') {
    return (
      <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => onDownload(source, 'mark-scheme')}
          disabled={downloading}
          className="theme-card border theme-border rounded-full px-4 py-2 text-xs font-black hover:theme-bg-subtle disabled:opacity-60"
        >
          {downloading ? '⏳ Preparing…' : '⬇️ Download answers'}
        </button>
      </div>
      <FullBleed>
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
      </FullBleed>
      </div>
    )
  }

  return (
    <div className="theme-card border theme-border rounded-radius-md p-8 text-center">
      <p className="theme-text font-black text-base">Answers coming soon.</p>
    </div>
  )
}
