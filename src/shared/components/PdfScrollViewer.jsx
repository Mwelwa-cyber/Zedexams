/**
 * PdfScrollViewer — continuous, fit-to-width PDF rendering.
 *
 * Unlike the page-by-page {@link ./PdfJsViewer}, this stacks every page
 * vertically in one scroll surface and sizes each page to the container
 * width — so opening it behaves like a native PDF: it fills the screen
 * and you simply scroll down through the pages. No prev/next chrome.
 *
 * Why a separate component instead of a mode on PdfJsViewer:
 *   PdfJsViewer is tuned for the past-paper archive, where a paper can be
 *   20+ pages and rendering them all at once would exhaust memory on the
 *   low-end Tecno / Itel devices much of our audience uses. This viewer
 *   is for SHORT documents (the 2026 exam timetable is 3 pages) where
 *   rendering everything up front is cheap and the continuous scroll is
 *   the experience users expect from a timetable.
 *
 * Mirrors PdfJsViewer's loader/fetch approach (lazy pdfjs-dist via the
 * shared loadPdfjs() — which runs the worker on the main thread so old
 * Android WebViews don't fail at "Setting up fake worker failed" — fetch as
 * ArrayBuffer for iOS Safari / Capacitor WebView reliability) and its
 * native-link error fallback.
 */

import { useEffect, useRef, useState } from 'react'
import { loadPdfjs } from '../../utils/pdfjsLoader'
import { friendlyMessage } from '../../utils/friendlyErrors'

async function fetchPdfBuffer(url, { retries = 1 } = {}) {
  let lastErr
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, { mode: 'cors' })
      if (!res.ok) throw new Error(`PDF fetch failed: ${res.status}`)
      return await res.arrayBuffer()
    } catch (err) {
      lastErr = err
      if (attempt < retries) await new Promise((r) => setTimeout(r, 400))
    }
  }
  throw lastErr || new Error('PDF fetch failed')
}

export default function PdfScrollViewer({ url, title }) {
  const containerRef = useRef(null)
  const [pdf, setPdf] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Load + parse the PDF when the URL changes.
  useEffect(() => {
    if (!url) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setPdf(null)
    ;(async () => {
      try {
        const [pdfjs, buffer] = await Promise.all([
          loadPdfjs(),
          fetchPdfBuffer(url),
        ])
        if (cancelled) return
        const { getDocument } = pdfjs
        const doc = await getDocument({ data: buffer }).promise
        if (cancelled) {
          doc.destroy?.()
          return
        }
        setPdf(doc)
      } catch (err) {
        console.warn('[PdfScrollViewer] load failed', err)
        if (!cancelled) setError(friendlyMessage(err, 'Could not open this document.'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [url])

  // Render every page into the stack, fit to container width. Re-runs on
  // pdf change and on container resize (orientation change / window
  // resize) so the pages always track the column width.
  useEffect(() => {
    if (!pdf) return
    const container = containerRef.current
    if (!container) return
    let cancelled = false
    const renderTasks = []

    async function renderAll() {
      const width = Math.max(220, container.clientWidth)
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      for (let i = 1; i <= pdf.numPages; i += 1) {
        if (cancelled) return
        const page = await pdf.getPage(i)
        if (cancelled) return
        const canvas = container.querySelector(`canvas[data-page="${i}"]`)
        if (!canvas) continue
        const baseViewport = page.getViewport({ scale: 1 })
        const scale = width / baseViewport.width
        const viewport = page.getViewport({ scale: scale * dpr })
        canvas.width = viewport.width
        canvas.height = viewport.height
        canvas.style.width = '100%'
        canvas.style.height = 'auto'
        const ctx = canvas.getContext('2d')
        if (!ctx) continue
        const task = page.render({ canvasContext: ctx, viewport })
        renderTasks.push(task)
        try {
          await task.promise
        } catch (err) {
          if (err?.name !== 'RenderingCancelledException') {
            console.warn('[PdfScrollViewer] render failed', err)
          }
        }
      }
    }

    renderAll()

    // Re-render at the new width when the column resizes. Debounced via a
    // microtask-ish timer so a drag-resize doesn't thrash the canvases.
    let resizeTimer = null
    const ro = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        if (!cancelled) renderAll()
      }, 150)
    })
    ro.observe(container)

    return () => {
      cancelled = true
      if (resizeTimer) clearTimeout(resizeTimer)
      ro.disconnect()
      renderTasks.forEach((t) => t.cancel?.())
    }
  }, [pdf])

  // Tear down the PDF.js doc on unmount.
  useEffect(() => () => {
    if (pdf) {
      try { pdf.destroy?.() } catch { /* ignore */ }
    }
  }, [pdf])

  if (error) {
    return (
      <div role="alert" className="py-12 text-center space-y-3">
        <p className="text-rose-700 font-bold text-sm">{error}</p>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block theme-accent-fill theme-on-accent rounded-full px-4 py-2 text-xs font-black hover:opacity-90"
          >
            Open PDF in a new tab
          </a>
        )}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="w-full flex flex-col items-stretch gap-3"
      // `pan-y` is essential: the canvases fill the viewport, so without it
      // `touch-action: pinch-zoom` would block single-finger vertical scroll
      // and the page becomes un-scrollable on touch. Keep pinch-zoom for
      // readability on small phones.
      style={{ touchAction: 'pan-y pinch-zoom' }}
      aria-label={title ? `${title} viewer` : 'PDF viewer'}
    >
      {loading && (
        <p className="theme-text-muted text-sm py-12 text-center">Loading timetable…</p>
      )}
      {pdf &&
        Array.from({ length: pdf.numPages }, (_, idx) => (
          <canvas
            key={idx + 1}
            data-page={idx + 1}
            aria-label={`${title || 'PDF'} — page ${idx + 1}`}
            className="block w-full shadow-elev-sm bg-white"
          />
        ))}
    </div>
  )
}
