/**
 * CaptureClassListFlow — photograph every page of a written or printed class
 * list, then hand the whole set to the review screen as ONE import.
 *
 * THE RULE THIS SCREEN EXISTS TO HONOUR (§5): it does not stop after one page.
 * A Zambian class of 86 is three to six pages of a ruled register, and a
 * capture flow that reads one photograph and calls it a class list is a flow
 * that makes a teacher type the other sixty names.
 *
 * So the shape of the screen is a PAGE STRIP the teacher keeps adding to —
 * add, reorder, retake, rotate, enhance, delete — with a running count, and a
 * single "Finish scanning" that reads them all together. Every page is
 * prepared on the device (downscaled, re-encoded) before it is sent, because
 * the connection is the scarce resource here, not the model.
 *
 * Full-screen on a phone: this is a camera task, and a camera task inside a
 * 400px modal on a 360px screen is not one.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ACCEPTED_CAPTURE_TYPES, preparePageImage, pdfToPageImages,
  extractClassListPages, nextPageId,
} from '../services/classListCapture'
import {
  buildCaptureSession, captureSessionReadiness, removePage, reorderPages,
} from '../../../utils/captureSessionCore'
import { useToast } from '../../../components/ui/Toast'
import Button from '../../../components/ui/Button'
import {
  AlertTriangle, Camera, Check, ChevronLeft, ChevronRight, Info,
  Loader2, RotateCw, ScanLine, Trash2, Upload, X,
} from '../../../shared/icons/classListIcons'

/** A page in the strip, before it has been read. */
function newPage(position, image, file) {
  return {
    id: nextPageId(),
    position,
    previewUrl: image.previewUrl,
    dataUrl: image.dataUrl,
    imageDigest: image.digest,
    width: image.width,
    height: image.height,
    fileName: file?.name || `Page ${position}`,
    rotation: 0,
    enhanced: false,
    sourceFile: file,
    status: 'captured',
    rows: [],
  }
}

/**
 * @param {object} props
 * @param {Array} [props.initialPages] Pages the strip starts with. Used by the
 *   preview route (/teacher/register-preview/capture) so a reviewer sees the
 *   three-pages-captured state rather than the empty one. It is a seam for the
 *   preview and nothing else — the alternative was a hand-built replica of
 *   this strip, which makes the preview a drawing of the screen instead of the
 *   screen. Production callers pass nothing.
 */
export default function CaptureClassListFlow({ className, onCancel, onExtracted, initialPages }) {
  const toast = useToast()
  const cameraRef = useRef(null)
  const galleryRef = useRef(null)
  const [pages, setPages] = useState(() => initialPages || [])
  const [busy, setBusy] = useState(null)          // null | 'preparing' | 'reading'
  const [progress, setProgress] = useState(null)  // { done, total }
  const [zoomed, setZoomed] = useState(null)

  // Object URLs are revoked when the flow closes; a six-page session of
  // un-revoked bitmaps is how a low-cost Android tablet runs out of memory.
  const pagesRef = useRef(pages)
  useEffect(() => { pagesRef.current = pages })
  useEffect(() => () => {
    for (const page of pagesRef.current) {
      if (page.previewUrl) URL.revokeObjectURL(page.previewUrl)
    }
  }, [])

  const addFiles = useCallback(async (fileList) => {
    const files = [...(fileList || [])]
    if (!files.length) return
    setBusy('preparing')
    try {
      const added = []
      for (const file of files) {
        if (file.type === 'application/pdf') {
          const { images, truncated, totalPages } = await pdfToPageImages(file)
          images.forEach((image) => added.push({ image, file }))
          if (truncated) {
            toast.info(`That PDF has ${totalPages} pages — the first ${images.length} were added. Add the rest as a second file.`)
          }
          continue
        }
        if (!file.type.startsWith('image/')) {
          toast.error(`${file.name} is not a photograph or a PDF.`)
          continue
        }
        added.push({ image: await preparePageImage(file), file })
      }
      if (added.length) {
        setPages((prev) => [
          ...prev,
          ...added.map(({ image, file }, i) => newPage(prev.length + i + 1, image, file)),
        ])
      }
    } catch (err) {
      console.warn('[CaptureClassListFlow] page preparation failed', err)
      toast.error(err?.message || 'That page could not be opened. Try photographing it again.')
    } finally {
      setBusy(null)
      // Cleared so re-picking the SAME file fires a change event; without this
      // a teacher who retakes and picks the same photograph gets nothing.
      if (cameraRef.current) cameraRef.current.value = ''
      if (galleryRef.current) galleryRef.current.value = ''
    }
  }, [toast])

  async function reprocess(pageId, patch) {
    const page = pages.find((p) => p.id === pageId)
    if (!page?.sourceFile) return
    setBusy('preparing')
    try {
      const rotation = patch.rotation ?? page.rotation
      const enhanced = patch.enhanced ?? page.enhanced
      const image = await preparePageImage(page.sourceFile, { rotation, enhance: enhanced })
      setPages((prev) => prev.map((p) => {
        if (p.id !== pageId) return p
        if (p.previewUrl) URL.revokeObjectURL(p.previewUrl)
        return {
          ...p,
          rotation,
          enhanced,
          previewUrl: image.previewUrl,
          dataUrl: image.dataUrl,
          imageDigest: image.digest,
          // The reading belonged to the image that was just replaced.
          rows: [],
          status: 'captured',
        }
      }))
    } catch (err) {
      toast.error(err?.message || 'That page could not be adjusted.')
    } finally {
      setBusy(null)
    }
  }

  function drop(pageId) {
    const page = pages.find((p) => p.id === pageId)
    if (page?.previewUrl) URL.revokeObjectURL(page.previewUrl)
    setPages((prev) => removePage(prev, pageId))
  }

  function move(index, delta) {
    setPages((prev) => reorderPages(prev, index, index + delta))
  }

  const readiness = captureSessionReadiness(pages)

  async function finish() {
    if (!readiness.ready) {
      toast.error(readiness.message)
      return
    }
    setBusy('reading')
    setProgress({ done: 0, total: pages.length })
    try {
      const read = await extractClassListPages(pages, { onProgress: setProgress })
      setPages(read)
      const session = buildCaptureSession(read)
      if (session.rows.length === 0) {
        toast.error('No learners could be read from these pages. Retake them in better light, or type the names instead.')
        setBusy(null)
        setProgress(null)
        return
      }
      onExtracted(session, read)
    } catch (err) {
      console.warn('[CaptureClassListFlow] extraction failed', err)
      toast.error(err?.message || 'The pages could not be read. Check your connection and try again.')
    } finally {
      setBusy(null)
      setProgress(null)
    }
  }

  const captured = pages.length

  return (
    <div className="fixed inset-0 z-50 theme-bg flex flex-col" role="dialog" aria-modal="true" aria-label="Capture class list">
      {/* header */}
      <header className="flex items-center gap-2 px-4 py-3 border-b theme-border theme-card shrink-0">
        <button type="button" onClick={onCancel} aria-label="Close capture"
          className="w-11 h-11 grid place-items-center rounded-radius-sm theme-text-muted">
          <X size={20} aria-hidden="true" />
        </button>
        <div className="min-w-0">
          <h1 className="theme-text font-display font-black text-base truncate">Capture learner list</h1>
          <p className="theme-text-muted text-xs truncate">{className}</p>
        </div>
        <span className="ml-auto theme-text-muted text-xs font-black tabular-nums">
          {captured} page{captured === 1 ? '' : 's'} captured
        </span>
      </header>

      {/* body */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {captured === 0 && (
          <div className="theme-card border theme-border rounded-radius-lg p-6 text-center max-w-md mx-auto">
            <span className="inline-grid place-items-center w-16 h-16 rounded-radius-md theme-bg-subtle theme-text-muted mx-auto">
              <ScanLine size={30} aria-hidden="true" />
            </span>
            <h2 className="theme-text font-black text-lg mt-3">Photograph every page</h2>
            <p className="theme-text-muted text-sm mt-1">
              Take one photograph per page of your written or printed class list, from the
              first page to the last. We read the names and admission numbers, and you check
              them before anything is saved.
            </p>
            <ul className="theme-text-muted text-xs mt-3 space-y-1 text-left max-w-xs mx-auto">
              <li>· Lay the page flat and fill the frame with it.</li>
              <li>· Daylight or a bright room reads best.</li>
              <li>· Include the column headings on the first page.</li>
            </ul>
          </div>
        )}

        {captured > 0 && (
          <ol className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {pages.map((page, index) => (
              <li key={page.id} className="theme-card border theme-border rounded-radius-md overflow-hidden">
                <button type="button" onClick={() => setZoomed(page)}
                  className="block w-full aspect-[3/4] theme-bg-subtle relative"
                  aria-label={`View page ${page.position} full screen`}>
                  <img src={page.previewUrl} alt={`Page ${page.position} of the class list`}
                    className="w-full h-full object-cover" />
                  <span className="absolute top-1.5 right-1.5 w-6 h-6 rounded-radius-pill bg-emerald-600 text-white grid place-items-center">
                    <Check size={14} aria-hidden="true" />
                  </span>
                </button>
                <div className="px-2 py-1.5">
                  <p className="theme-text text-xs font-black">Page {page.position}</p>
                  <div className="flex items-center gap-0.5 mt-1">
                    <button type="button" onClick={() => move(index, -1)} disabled={index === 0}
                      aria-label={`Move page ${page.position} earlier`}
                      className="w-9 h-9 grid place-items-center rounded-radius-xs theme-text-muted disabled:opacity-25">
                      <ChevronLeft size={15} aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => move(index, +1)} disabled={index === pages.length - 1}
                      aria-label={`Move page ${page.position} later`}
                      className="w-9 h-9 grid place-items-center rounded-radius-xs theme-text-muted disabled:opacity-25">
                      <ChevronRight size={15} aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => reprocess(page.id, { rotation: (page.rotation + 90) % 360 })}
                      aria-label={`Rotate page ${page.position}`}
                      className="w-9 h-9 grid place-items-center rounded-radius-xs theme-text-muted">
                      <RotateCw size={15} aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => reprocess(page.id, { enhanced: !page.enhanced })}
                      aria-pressed={page.enhanced}
                      aria-label={`${page.enhanced ? 'Remove extra contrast from' : 'Improve contrast on'} page ${page.position}`}
                      className={`w-9 h-9 grid place-items-center rounded-radius-xs text-xs font-black ${page.enhanced ? 'theme-accent-text' : 'theme-text-muted'}`}>
                      A
                    </button>
                    <button type="button" onClick={() => drop(page.id)}
                      aria-label={`Delete page ${page.position}`}
                      className="w-9 h-9 grid place-items-center rounded-radius-xs text-red-500 ml-auto">
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </li>
            ))}

            <li>
              <button type="button" onClick={() => cameraRef.current?.click()} disabled={Boolean(busy)}
                className="w-full h-full min-h-[180px] rounded-radius-md border-2 border-dashed theme-border grid place-items-center gap-1 theme-text-muted disabled:opacity-50">
                {busy === 'preparing'
                  ? <Loader2 size={22} className="animate-spin" aria-hidden="true" />
                  : <Camera size={22} aria-hidden="true" />}
                <span className="text-xs font-black">Add another page</span>
              </button>
            </li>
          </ol>
        )}

        {readiness.warning && (
          <p role="status" className="flex items-start gap-2 rounded-radius-sm border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 text-xs font-bold">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
            {readiness.warning}
          </p>
        )}

        {busy === 'reading' && (
          <p role="status" className="flex items-center gap-2 rounded-radius-sm theme-card border theme-border px-3 py-2.5 theme-text text-sm font-bold">
            <Loader2 size={16} className="animate-spin shrink-0" aria-hidden="true" />
            Reading {progress ? `page ${Math.min(progress.done + 1, progress.total)} of ${progress.total}` : 'the pages'}…
            <span className="theme-text-muted font-normal">This can take a minute on a slow connection.</span>
          </p>
        )}

        <p className="flex items-start gap-2 theme-text-muted text-xs max-w-prose">
          <Info size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
          Nothing is saved yet. When you finish scanning you will see every learner we read,
          with anything uncertain marked, and you confirm the list before it is added.
        </p>
      </div>

      {/* footer */}
      <footer className="border-t theme-border theme-card px-4 py-3 shrink-0"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={finish} loading={busy === 'reading'}
            disabled={!readiness.ready || Boolean(busy)}
            className="min-h-[48px]">
            Finish scanning
          </Button>
          <Button type="button" variant="secondary" onClick={() => cameraRef.current?.click()}
            disabled={Boolean(busy)} leadingIcon={<Camera size={16} aria-hidden="true" />}
            className="min-h-[48px]">
            Add page
          </Button>
          <Button type="button" variant="ghost" onClick={() => galleryRef.current?.click()}
            disabled={Boolean(busy)} leadingIcon={<Upload size={16} aria-hidden="true" />}
            className="min-h-[48px]">
            From gallery or PDF
          </Button>
          {!readiness.ready && captured === 0 && (
            <span className="theme-text-muted text-xs ml-auto">{readiness.message}</span>
          )}
        </div>
      </footer>

      {/* `capture="environment"` opens the rear camera directly on a phone;
          the gallery input deliberately omits it so the same button can pick
          an existing photograph or a PDF a school emailed. */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" multiple
        className="sr-only" onChange={(e) => addFiles(e.target.files)} />
      <input ref={galleryRef} type="file" accept={ACCEPTED_CAPTURE_TYPES} multiple
        className="sr-only" onChange={(e) => addFiles(e.target.files)} />

      {zoomed && (
        <div className="fixed inset-0 z-60 bg-black/90 flex flex-col" role="dialog" aria-modal="true"
          aria-label={`Page ${zoomed.position}`}>
          <div className="flex items-center gap-2 px-4 py-3 text-white">
            <button type="button" onClick={() => setZoomed(null)} aria-label="Close page view"
              className="w-11 h-11 grid place-items-center"><X size={22} aria-hidden="true" /></button>
            <span className="font-black text-sm">Page {zoomed.position}</span>
          </div>
          <img src={zoomed.previewUrl} alt={`Page ${zoomed.position} of the class list`}
            className="flex-1 min-h-0 w-full object-contain" />
        </div>
      )}
    </div>
  )
}
