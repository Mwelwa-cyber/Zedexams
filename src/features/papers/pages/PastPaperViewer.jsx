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

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { useDataSaver } from '../../../contexts/DataSaverContext'
import { whenAppCheckReady } from '../../../firebase/config'
import {
  getPaper,
  getLinkedQuizMeta,
  listMyPaperAttempts,
  listPublishedPapers,
  recordPaperEvent,
  resolvePaperUrl,
} from '../../../utils/pastPapers'
import { paperQuizIsAttached } from '../../../utils/pastPaperQuizStatus'
import { saveBlob } from '../../../utils/saveBlob'
import usePaperResumeSync from '../lib/paperResumeSync'
import { readArray, writeJson } from '../../../shared/utils/safeStorage'
import { PAPER_BOOKMARKS_KEY } from '../lib/paperStorageKeys'
import { buildDownloadName } from '../../../utils/downloadFilename'
import { siblingPapers } from '../lib/paperNav'
import { isOfficialSource, paperNumberLabel, paperSourceLabel } from '../../../config/paperSources'
import { PaperSourceBadge } from '../components/PaperTitle'
import { subjectMeta } from '../lib/paperVisuals'
// The viewer's own presentational pieces. All were declared in this file —
// ~790 lines of components and formatters wrapped around a 900-line page —
// and every one is prop-driven, so the move is a relocation, not a redesign.
import AnswersConfirmDialog from '../components/viewer/AnswersConfirmDialog'
import AnswersPanel from '../components/viewer/AnswersPanel'
import BackToTopFab from '../components/viewer/BackToTopFab'
import FullBleed from '../components/viewer/FullBleed'
import MobileQuizFab from '../components/viewer/MobileQuizFab'
import PageImageList from '../components/viewer/PageImageList'
import PaperPanels from '../components/viewer/PaperPanels'
import SubjectNav from '../components/viewer/SubjectNav'
import { extFromPath, formatBytes } from '../components/viewer/paperFormat'
import { PaperReaderOverlay, PdfPageStream } from '../components/viewer/lazyOverlays'

/** Fetch a Storage URL as a Blob. Storage CORS is configured (see CLAUDE.md
 *  `npm run storage:cors`), so cross-origin reads of the bytes succeed.
 *  Stays here rather than moving out with the presentational pieces: it is
 *  this page's own download plumbing and has no other consumer. */
async function fetchAsBlob(url) {
  const res = await fetch(url, { mode: 'cors' })
  if (!res.ok) throw new Error(`Download fetch failed: ${res.status}`)
  return res.blob()
}
import '../papersTheme.css'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import Skeleton from '../../../shared/components/Skeleton'
import {
  ArrowLeft,
  BookmarkSquareIcon,
  ChevronRight,
  Clock,
  Download,
  Maximize2,
  PencilLine,
  Upload,
} from '../../../shared/components/icons'

// PDF papers now read the way scanned (image) papers always have: one
// continuous vertical stack you scroll. See PdfPageStream for why it
// virtualises that stack instead of rasterising every page up front.

export default function PastPaperViewer() {
  const { paperId } = useParams()
  const { currentUser, isAdmin } = useAuth()
  const { dataSaver } = useDataSaver()
  const navigate = useNavigate()
  const [paper, setPaper] = useState(null)
  const [loading, setLoading] = useState(true)
  // Kept apart on purpose. `notFound` means the read succeeded and the
  // paper genuinely doesn't exist (or isn't published) — the archive is the
  // right next step. `loadError` means the READ itself failed (permission-
  // denied, offline, a network blip) — the paper may be perfectly fine and
  // the honest next step is to retry, not to tell a learner it was "moved
  // or unpublished" when nobody knows that. PaperQuizPage already keeps
  // these apart for the same paperId lookup; this page used to collapse
  // both into one `errored` flag and show the not-found copy for either.
  const [notFound, setNotFound] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  // Dashboard "Continue Reading" resume: local mirror + debounced
  // cross-device sync (writes only on leave, never per scroll).
  usePaperResumeSync({ paperId, paper, uid: currentUser?.uid || null })
  const [paperUrl, setPaperUrl] = useState(null)
  const [paperUrlLoading, setPaperUrlLoading] = useState(false)
  // Distinct from `downloadError` (the explicit Download-button action):
  // this is the PREVIEW's own resolve, and a failure here must not leave
  // the reader stuck on "Preparing your paper…" forever with no way out.
  // `getDownloadURL()` is a Storage SDK call — App Check enforcement is on
  // for Cloud Storage, so it can 401 on the same deferred-attestation race
  // the doc-level read above just got a gate for. attestedStorage.js
  // deliberately leaves ordinary reads unwrapped because a failure there
  // usually degrades one decorative image; the primary paper preview is
  // the one read on this page where that trade doesn't hold, so it gets
  // its own bounded readiness wait and its own retry.
  const [paperUrlError, setPaperUrlError] = useState(false)
  const [paperUrlAttempt, setPaperUrlAttempt] = useState(0)
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
    setNotFound(false)
    setLoadError(false)
    const load = async () => {
      try {
        // A signed-out visitor's App Check attestation is deliberately
        // deferred off the cold-start path (scheduleAppCheckInit in
        // firebase/config.js) so reCAPTCHA doesn't sit on the LCP path —
        // and opening a shared paper link straight from WhatsApp/search is
        // exactly a cold, signed-out load. whenAppCheckReady() never
        // rejects and gives up after a bounded timeout, so this costs at
        // most a beat; without it the very first Firestore read here can
        // race ahead of the first real token and come back
        // permission-denied, which — before this fix — showed as the same
        // "moved or unpublished" message as a paper that never existed.
        await whenAppCheckReady()
        const row = await getPaper(paperId)
        if (cancelled) return
        if (!row || (row.status !== 'published' && !isAdmin)) {
          setNotFound(true)
          return
        }
        setPaper(row)
        try { await recordPaperEvent(paperId, 'view') } catch { /* view telemetry is best-effort */ }
      } catch (err) {
        console.warn('[PastPaperViewer] load failed', err)
        if (!cancelled) setLoadError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load().catch(() => {})
    return () => { cancelled = true }
  }, [paperId, isAdmin, loadAttempt])

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
    setPaperUrlError(false)
    setDownloadError('')
    ;(async () => {
      try {
        // Same deferred-App-Check race as the doc read, on Storage instead
        // of Firestore this time: getDownloadURL() needs a genuine token
        // under Storage enforcement, and this is the primary content of
        // the page — worth the same bounded wait rather than eating a 401
        // on the first attempt.
        await whenAppCheckReady()
        const url = await resolvePaperUrl(previewSource.path)
        if (!cancelled) setPaperUrl(url)
      } catch (err) {
        console.warn('[PastPaperViewer] pdf URL failed', err)
        if (!cancelled) setPaperUrlError(true)
      } finally {
        if (!cancelled) setPaperUrlLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [paper, currentUser, previewSource?.kind, previewSource?.path, paperUrlAttempt])

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
    setBookmarked(readArray(PAPER_BOOKMARKS_KEY).includes(paperId))
  }, [paperId])

  const toggleBookmark = useCallback(() => {
    setBookmarked((prev) => {
      const next = !prev
      const ids = new Set(readArray(PAPER_BOOKMARKS_KEY))
      if (next) ids.add(paperId)
      else ids.delete(paperId)
      writeJson(PAPER_BOOKMARKS_KEY, [...ids])
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

  if (loadError) {
    return (
      <div className="min-h-screen theme-bg flex flex-col items-center justify-center px-4 text-center">
        <div className="text-5xl mb-3">⚠️</div>
        <h1 className="theme-text font-black text-xl">Couldn't load this paper</h1>
        <p className="theme-text-muted text-sm mt-2 max-w-sm">
          Check your connection and try again.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => setLoadAttempt((n) => n + 1)}
            className="theme-accent-fill theme-on-accent rounded-full px-5 py-2.5 text-sm font-black hover:opacity-90"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => navigate('/papers')}
            className="theme-card border theme-border rounded-full px-5 py-2.5 text-sm font-black hover:theme-bg-subtle"
          >
            Back to archive
          </button>
        </div>
      </div>
    )
  }

  if (notFound || !paper) {
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
  // whenever the visible tab is showing a PDF. Both formats now scroll
  // vertically; the dock survives on PDFs because it is the only way to
  // jump to a page (image papers have no thumbnail sheet).
  const dockActive = Boolean(currentUser) && (
    (activeTab === 'questionPaper' && previewSource?.kind === 'pdf')
    || (activeTab === 'answers' && markSchemeSource?.kind === 'pdf')
  )

  return (
    <div
      className="papers-proto min-h-screen theme-bg flex flex-col overflow-x-clip"
      // Reserve space under the content so the fixed dock never permanently
      // covers the panels / footer at the end of the page.
      style={dockActive ? { paddingBottom: 'calc(112px + env(safe-area-inset-bottom))' } : undefined}
    >
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
                bookmarked ? 'theme-accent-text bg-[var(--accent-bg)]' : 'theme-bg-subtle theme-text hover:theme-card'
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
          <p role="alert" className="text-sm font-bold text-[var(--danger-fg)] mb-3">
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
                  <span className="text-[10px] font-bold theme-text-muted uppercase tracking-wide bg-[var(--warning-bg)] text-[var(--warning-fg)] rounded-full px-1.5 py-0.5">
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
                  paperUrlError ? (
                    <div className="theme-card border theme-border rounded-radius-md h-[70vh] flex flex-col items-center justify-center gap-3 text-center px-4">
                      <div className="text-4xl">⚠️</div>
                      <p className="theme-text font-black text-base">Couldn't load this paper</p>
                      <p className="theme-text-muted text-sm max-w-sm">Check your connection and try again.</p>
                      <button
                        type="button"
                        onClick={() => setPaperUrlAttempt((n) => n + 1)}
                        className="theme-accent-fill theme-on-accent rounded-full px-5 py-2.5 text-sm font-black hover:opacity-90"
                      >
                        Try again
                      </button>
                    </div>
                  ) : paperUrlLoading || !paperUrl ? (
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
                          <PdfPageStream
                            url={paperUrl}
                            title={paper.title}
                            storageKey={`paper-pdf-page:${paperId}`}
                            syncHash
                          />
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
            subtitle={[paperSourceLabel(paper.source), paper.examBoard || 'ECZ'].filter(Boolean).join(' · ')}
            onClose={closeReader}
            onDownload={canDownloadPaper ? () => downloadSource(previewSource, 'paper') : null}
            downloading={downloading}
            /* Close first so the overlay's throwaway history entry is
               unwound before navigating to the quiz. */
            onStartQuiz={quizAvailable ? () => { closeReader(); navigate(`/papers/${paperId}/quiz`) } : null}
          >
            {previewSource.kind === 'pdf' && (
              paperUrlError ? (
                <div className="flex flex-col items-center gap-3 py-12 text-center px-4">
                  <p className="theme-text-muted text-sm">Couldn't load this paper. Check your connection and try again.</p>
                  <button
                    type="button"
                    onClick={() => setPaperUrlAttempt((n) => n + 1)}
                    className="theme-accent-fill theme-on-accent rounded-full px-4 py-2 text-xs font-black hover:opacity-90"
                  >
                    Try again
                  </button>
                </div>
              ) : paperUrl ? (
                // Same flow container the image stack uses below: the
                // reader overlay owns the scrolling, the stream just flows.
                <div className="mx-auto max-w-[1100px] w-full px-1 sm:px-3 py-4">
                  <PdfPageStream
                    url={paperUrl}
                    title={paper.title}
                    storageKey={`paper-pdf-page:${paperId}`}
                    overlay
                  />
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
                  /* Inside the reader overlay (z-60) — lifts the zoom pill
                     above it, exactly as PdfPageStream's `overlay` does. */
                  overlay
                />
              </div>
            )}
          </PaperReaderOverlay>
        </Suspense>
      )}
    </div>
  )
}

