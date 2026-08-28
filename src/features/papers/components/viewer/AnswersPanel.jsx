/**
 * The marking-scheme panel: what the answers are, and the download.
 */
import { Suspense, useEffect, useMemo, useState } from 'react'
import { resolvePaperUrl } from '../../../../utils/pastPapers'
import { whenAppCheckReady } from '../../../../firebase/config'
import FullBleed from './FullBleed'
import PageImageList from './PageImageList'
import { PdfPageStream } from './lazyOverlays'

/**
 * Answers panel rendered inside the "Answers" tab. PDF answers use the
 * canvas viewer; image-based answers stack vertically like the question
 * paper, with the same clean error handling per page.
 */
function AnswersPanel({ source, paperTitle, onDownload, downloading = false }) {
  const [url, setUrl] = useState(null)
  const [imageUrls, setImageUrls] = useState([])
  const [loading, setLoading] = useState(true)
  // PDF-only: a failed resolve used to fall through to the "Answers coming
  // soon" branch below, which is wrong — the answers exist, the read just
  // failed (permission-denied from the same deferred-App-Check race the
  // question paper's own resolve now guards against — getDownloadURL()
  // needs a genuine token under Storage enforcement). The image-kind path
  // doesn't need this: PageImageList already retries per page.
  const [pdfError, setPdfError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [failedPages, setFailedPages] = useState({})
  const [loadedPages, setLoadedPages] = useState({})
  const [retryNonces, setRetryNonces] = useState({})

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setPdfError(false)
    setFailedPages({})
    setLoadedPages({})
    setRetryNonces({})
    async function resolve() {
      try {
        if (source.kind === 'pdf') {
          await whenAppCheckReady()
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
        if (!cancelled && source.kind === 'pdf') setPdfError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    resolve()
    return () => { cancelled = true }
  }, [source, attempt])

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

  if (source.kind === 'pdf' && pdfError) {
    return (
      <div className="theme-card border theme-border rounded-radius-md h-[40vh] flex flex-col items-center justify-center gap-3 text-center px-4">
        <p className="theme-text font-black text-base">Couldn't load the answers</p>
        <p className="theme-text-muted text-sm max-w-sm">Check your connection and try again.</p>
        <button
          type="button"
          onClick={() => setAttempt((n) => n + 1)}
          className="theme-accent-fill theme-on-accent rounded-full px-4 py-2 text-xs font-black hover:opacity-90"
        >
          Try again
        </button>
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
            <PdfPageStream url={url} title={`${paperTitle} — answers`} />
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

export default AnswersPanel
