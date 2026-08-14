import { useCallback, useEffect, useRef, useState } from 'react'

import Button from '../../../../shared/components/Button'
import { compressImage } from '../../../../utils/imageCompression'
import { measureBlurFromDataUrl } from '../../lib/scanImageQuality'
import {
  addPage,
  hasBlurryPage,
  makePage,
  movePage,
  progressSteps,
  removePage,
  replacePage,
} from '../../lib/scanPages'
import {
  clearScanSession,
  loadScanSession,
  saveScanSession,
} from '../../lib/scanSessionStore'

/**
 * ScanPaperModal — "Scan full test paper" multi-page scanner for Assessment
 * Studio.
 *
 * The old behaviour photographed one page, immediately OCR'd it, and asked
 * "Replace the questions?" the moment a second page was captured — so a teacher
 * could only ever import a single page. This modal turns the camera into a
 * proper document scanner: the teacher captures every page of one paper into a
 * single ordered session, can preview / reorder / retake / delete pages, and
 * only when they press "Finish & Convert to Assessment" are all pages sent
 * together — in page order — through the existing multi-page vision OCR pipeline
 * (importQuizDocument treats an ordered array of images as one paper).
 *
 * The session is persisted to IndexedDB on every change so accidentally leaving
 * the camera screen never loses captured pages.
 *
 * Props
 *   open       — whether the modal is rendered
 *   onClose    — close without converting (session is kept for resume)
 *   onConvert  — (files: File[]) => void | Promise; receives the ordered pages
 *                as JPEG File objects for the studio import pipeline
 *   converting — parent's import-in-flight flag (disables actions)
 */
export default function ScanPaperModal({ open, onClose, onConvert, converting = false }) {
  // 'start' → first screen (Start New Test Scan / Resume).
  // 'captured' → just captured a page; "what next?" actions.
  // 'preview' → grid of all captured pages.
  const [stage, setStage] = useState('start')
  const [pages, setPages] = useState([])
  const [focusIndex, setFocusIndex] = useState(0)
  const [hasResumable, setHasResumable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [notice, setNotice] = useState('')
  const [viewerIndex, setViewerIndex] = useState(null)

  // When a capture should replace an existing page rather than append, the
  // target index is parked here until the file input fires.
  const replaceTargetRef = useRef(null)
  const captureInputRef = useRef(null)
  const uploadInputRef = useRef(null)

  // Restore any in-progress session when the modal opens.
  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    setNotice('')
    setViewerIndex(null)
    loadScanSession().then(saved => {
      if (cancelled) return
      if (Array.isArray(saved) && saved.length) {
        setPages(saved)
        setHasResumable(true)
      } else {
        setPages([])
        setHasResumable(false)
      }
      setStage('start')
    }).catch(() => { if (!cancelled) setStage('start') })
    return () => { cancelled = true }
  }, [open])

  // Persist on every page change so leaving the screen never loses work.
  useEffect(() => {
    if (!open) return
    saveScanSession(pages)
  }, [pages, open])

  // Escape closes (when not mid-capture / mid-convert).
  useEffect(() => {
    if (!open) return undefined
    function onKey(e) {
      if (e.key === 'Escape' && !busy && !finishing) {
        if (viewerIndex != null) setViewerIndex(null)
        else onClose?.()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, busy, finishing, viewerIndex, onClose])

  const openCapture = useCallback((replaceIndex = null) => {
    replaceTargetRef.current = replaceIndex
    captureInputRef.current?.click()
  }, [])

  const openUpload = useCallback(() => {
    replaceTargetRef.current = null
    uploadInputRef.current?.click()
  }, [])

  async function ingestFiles(fileList, replaceIndex) {
    const files = Array.from(fileList || []).filter(Boolean)
    if (!files.length) return
    setBusy(true)
    setNotice('')
    try {
      const built = []
      for (const file of files) {
        let blob = file
        try {
          // Downscale + JPEG re-encode: keeps the session small enough for
          // IndexedDB and the upload light, while staying legible for OCR.
          blob = await compressImage(file, 1600, 0.9)
        } catch {
          blob = file
        }
        const dataUrl = await blobToDataUrl(blob)
        const quality = await measureBlurFromDataUrl(dataUrl)
        built.push(makePage({
          dataUrl,
          mime: blob.type || 'image/jpeg',
          blurry: quality.blurry,
          variance: quality.variance,
        }))
      }

      let next = pages
      let focus
      if (replaceIndex != null && replaceIndex >= 0 && replaceIndex < pages.length) {
        next = replacePage(pages, replaceIndex, built[0])
        focus = replaceIndex
      } else {
        for (const page of built) next = addPage(next, page)
        focus = next.length - 1
      }
      setPages(next)
      setFocusIndex(focus)
      setHasResumable(false)
      setStage('captured')
    } finally {
      setBusy(false)
    }
  }

  function handleStartNew() {
    // Fresh scan: drop any resumable session, then open the camera.
    setPages([])
    setHasResumable(false)
    clearScanSession()
    openCapture(null)
  }

  function handleResume() {
    setHasResumable(false)
    setStage(pages.length ? 'preview' : 'start')
  }

  function handleDelete(index) {
    const next = removePage(pages, index)
    setPages(next)
    if (!next.length) {
      setStage('start')
      setNotice('')
    } else if (focusIndex >= next.length) {
      setFocusIndex(next.length - 1)
    }
  }

  function handleMove(index, dir) {
    setPages(movePage(pages, index, dir))
  }

  async function handleFinish() {
    if (!pages.length) {
      setNotice('Capture at least one page before converting.')
      return
    }
    setFinishing(true)
    try {
      const files = pages.map((page, i) =>
        dataUrlToFile(page.dataUrl, `scan-page-${String(i + 1).padStart(2, '0')}.jpg`),
      ).filter(Boolean)
      if (!files.length) {
        setNotice('Could not read the captured pages. Please retake them.')
        return
      }
      const ok = await onConvert?.(files)
      if (ok === false) {
        // OCR failed or extracted nothing — keep every captured page so the
        // teacher can simply press convert again rather than re-scanning.
        setNotice('Converting the pages did not work. Your pages are kept — please try again.')
        return
      }
      // The pages now live as an import inside the studio — release the session.
      await clearScanSession()
      setPages([])
      setStage('start')
      onClose?.()
    } finally {
      setFinishing(false)
    }
  }

  if (!open) return null

  const blurryCount = pages.filter(p => p.blurry).length
  const steps = progressSteps(pages)
  const focusPage = pages[focusIndex] || pages[pages.length - 1] || null

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-5">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
        aria-hidden="true"
        onMouseDown={() => { if (!busy && !finishing) onClose?.() }}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Scan full test paper"
        className="relative flex w-full max-w-2xl max-h-[92vh] flex-col overflow-hidden theme-card theme-border rounded-3xl border shadow-elev-xl animate-scale-in"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b theme-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-display-md theme-text">📷 Scan full test paper</h2>
            <p className="text-body-sm theme-text-muted mt-0.5">
              Capture every page first, then convert them into one assessment.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { if (!busy && !finishing) onClose?.() }}
            disabled={busy || finishing}
            aria-label="Close scanner"
            className="shrink-0 rounded-full p-2 theme-text-muted hover:theme-bg-subtle hover:theme-text disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        {/* Progress indicator */}
        {pages.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-b theme-border px-5 py-3">
            {steps.map((step, i) => (
              <span key={step.key} className="inline-flex items-center gap-1.5">
                <span
                  className={[
                    'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-bold',
                    step.key === 'ready'
                      ? (step.done ? 'theme-accent-fill theme-on-accent' : 'theme-bg-subtle theme-text-muted')
                      : 'theme-bg-subtle theme-text',
                  ].join(' ')}
                >
                  {step.key === 'ready' ? '🚀 ' : '✓ '}{step.label}
                </span>
                {i < steps.length - 1 && <span className="theme-text-muted text-xs">›</span>}
              </span>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {notice && (
            <div className="mb-4 rounded-xl border border-[color:var(--danger)] bg-danger-subtle px-3 py-2 text-body-sm text-danger">
              {notice}
            </div>
          )}

          {busy && (
            <div className="mb-4 flex items-center gap-2 text-body-sm theme-text-muted">
              <Spinner /> Reading the page you just captured…
            </div>
          )}

          {stage === 'start' && (
            <StartStage
              hasResumable={hasResumable && pages.length > 0}
              resumeCount={pages.length}
              onStartNew={handleStartNew}
              onResume={handleResume}
              onUpload={openUpload}
              disabled={busy}
            />
          )}

          {stage === 'captured' && focusPage && (
            <CapturedStage
              page={focusPage}
              pageNumber={focusIndex + 1}
              totalPages={pages.length}
              onAddNext={() => openCapture(null)}
              onRetake={() => openCapture(focusIndex)}
              onPreview={() => setStage('preview')}
              onFinish={handleFinish}
              disabled={busy || finishing || converting}
              finishing={finishing || converting}
            />
          )}

          {stage === 'preview' && (
            <PreviewStage
              pages={pages}
              onView={setViewerIndex}
              onRetake={i => openCapture(i)}
              onDelete={handleDelete}
              onMove={handleMove}
              onAddNext={() => openCapture(null)}
              onUpload={openUpload}
              disabled={busy || finishing || converting}
            />
          )}
        </div>

        {/* Sticky footer with the primary convert action */}
        {(stage === 'preview' || stage === 'captured') && (
          <div className="flex flex-col gap-2 border-t theme-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-body-sm theme-text-muted">
              {pages.length} page{pages.length === 1 ? '' : 's'} captured
              {blurryCount > 0 && (
                <span className="ml-2 text-danger">· {blurryCount} may be blurry</span>
              )}
            </div>
            <Button
              variant="primary"
              size="md"
              onClick={handleFinish}
              loading={finishing || converting}
              disabled={busy || converting || !pages.length}
            >
              ✅ Finish &amp; Convert to Assessment
            </Button>
          </div>
        )}

        {/* Full-page viewer */}
        {viewerIndex != null && pages[viewerIndex] && (
          <PageViewer
            page={pages[viewerIndex]}
            pageNumber={viewerIndex + 1}
            onClose={() => setViewerIndex(null)}
            onRetake={() => { const i = viewerIndex; setViewerIndex(null); openCapture(i) }}
          />
        )}

        {/* Hidden inputs: camera capture (one page) + multi-file upload */}
        <input
          ref={captureInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={e => {
            const target = replaceTargetRef.current
            ingestFiles(e.target.files, target)
            e.target.value = ''
          }}
        />
        <input
          ref={uploadInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={e => {
            ingestFiles(e.target.files, null)
            e.target.value = ''
          }}
        />
      </div>
    </div>
  )
}

function StartStage({ hasResumable, resumeCount, onStartNew, onResume, onUpload, disabled }) {
  return (
    <div className="flex flex-col items-center gap-5 py-6 text-center">
      <div className="text-5xl" aria-hidden="true">📄</div>
      <div>
        <h3 className="text-display-sm theme-text">Scan a full test paper</h3>
        <p className="text-body-sm theme-text-muted mt-1 max-w-sm">
          Take a photo of each page one at a time. You can preview, reorder and
          retake pages before anything is read.
        </p>
      </div>

      {hasResumable && (
        <div className="w-full max-w-sm rounded-2xl border theme-border theme-bg-subtle p-3 text-left">
          <p className="text-body-sm theme-text font-bold">Unfinished scan found</p>
          <p className="text-body-sm theme-text-muted">
            You have {resumeCount} page{resumeCount === 1 ? '' : 's'} from a previous session.
          </p>
          <div className="mt-2 flex gap-2">
            <Button variant="primary" size="sm" onClick={onResume} disabled={disabled}>
              Resume scan
            </Button>
            <Button variant="ghost" size="sm" onClick={onStartNew} disabled={disabled}>
              Discard &amp; start over
            </Button>
          </div>
        </div>
      )}

      {!hasResumable && (
        <div className="flex w-full max-w-sm flex-col gap-2">
          <Button variant="primary" size="lg" fullWidth onClick={onStartNew} disabled={disabled}>
            📷 Start New Test Scan
          </Button>
          <Button variant="secondary" size="md" fullWidth onClick={onUpload} disabled={disabled}>
            📁 Upload page images instead
          </Button>
        </div>
      )}
    </div>
  )
}

function CapturedStage({ page, pageNumber, totalPages, onAddNext, onRetake, onPreview, onFinish, disabled, finishing }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="text-center">
        <h3 className="text-display-sm theme-text">Page captured. What would you like to do next?</h3>
        <p className="text-body-sm theme-text-muted mt-0.5">
          Saved as Page {pageNumber} of {totalPages}.
        </p>
      </div>

      <div className="mx-auto w-full max-w-xs">
        <img
          src={page.dataUrl}
          alt={`Captured page ${pageNumber}`}
          className="w-full rounded-xl border theme-border object-contain"
        />
        {page.blurry && (
          <div className="mt-2 rounded-lg border border-[color:var(--danger)] bg-danger-subtle px-3 py-2 text-body-sm text-danger">
            ⚠️ This page looks blurry. Consider retaking it for a cleaner read.
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Button variant="primary" size="md" onClick={onAddNext} disabled={disabled}>
          ➕ Add Next Page
        </Button>
        <Button variant="secondary" size="md" onClick={onRetake} disabled={disabled}>
          🔄 Retake This Page
        </Button>
        <Button variant="secondary" size="md" onClick={onPreview} disabled={disabled}>
          🖼 Preview Captured Pages
        </Button>
        <Button variant="primary" size="md" onClick={onFinish} loading={finishing} disabled={disabled}>
          ✅ Finish &amp; Convert
        </Button>
      </div>
    </div>
  )
}

function PreviewStage({ pages, onView, onRetake, onDelete, onMove, onAddNext, onUpload, disabled }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-display-sm theme-text">Captured pages</h3>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={onUpload} disabled={disabled}>📁 Upload</Button>
          <Button variant="primary" size="sm" onClick={onAddNext} disabled={disabled}>➕ Add Next Page</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {pages.map((page, index) => (
          <div key={page.id} className="rounded-2xl border theme-border theme-bg-subtle p-3">
            <div className="flex items-center justify-between">
              <span className="text-body-sm font-bold theme-text">Page {index + 1}</span>
              {page.blurry && <span className="text-[12px] font-bold text-danger">⚠️ blurry</span>}
            </div>
            <button
              type="button"
              onClick={() => onView(index)}
              className="mt-2 block w-full overflow-hidden rounded-xl border theme-border"
              aria-label={`View page ${index + 1}`}
            >
              <img src={page.dataUrl} alt={`Page ${index + 1}`} className="h-36 w-full object-cover" />
            </button>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <MiniBtn onClick={() => onView(index)} disabled={disabled}>👁 View</MiniBtn>
              <MiniBtn onClick={() => onRetake(index)} disabled={disabled}>🔄 Retake</MiniBtn>
              <MiniBtn onClick={() => onDelete(index)} disabled={disabled} danger>🗑 Delete</MiniBtn>
              <MiniBtn onClick={() => onMove(index, -1)} disabled={disabled || index === 0}>↑ Up</MiniBtn>
              <MiniBtn onClick={() => onMove(index, 1)} disabled={disabled || index === pages.length - 1}>↓ Down</MiniBtn>
            </div>
          </div>
        ))}
      </div>

      {hasBlurryPage(pages) && (
        <p className="text-body-sm text-danger">
          ⚠️ Some pages look blurry. Retake them for the most accurate reading.
        </p>
      )}
    </div>
  )
}

function MiniBtn({ children, onClick, disabled, danger }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        'rounded-lg border px-2 py-1 text-[12px] font-bold transition-colors disabled:opacity-40',
        danger
          ? 'border-[color:var(--danger)] text-danger hover:bg-danger-subtle'
          : 'theme-border theme-text hover:theme-accent-text hover:border-[var(--accent)]',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function PageViewer({ page, pageNumber, onClose, onRetake }) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-black/90">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <span className="font-bold">Page {pageNumber}</span>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={onRetake}>🔄 Retake</Button>
          <button type="button" onClick={onClose} aria-label="Close preview" className="rounded-full px-3 py-1 text-white hover:bg-white/10">✕</button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <img src={page.dataUrl} alt={`Page ${pageNumber}`} className="max-h-full max-w-full object-contain" />
      </div>
    </div>
  )
}

function Spinner() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="animate-spin" aria-hidden="true">
      <path d="M21 12a9 9 0 11-6.219-8.56" />
    </svg>
  )
}

// --- browser image helpers -------------------------------------------------

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error || new Error('Could not read image'))
    reader.readAsDataURL(blob)
  })
}

function dataUrlToFile(dataUrl, filename) {
  try {
    const [meta, b64] = String(dataUrl).split(',')
    if (!b64) return null
    const mime = (meta.match(/data:(.*?)(;|$)/) || [])[1] || 'image/jpeg'
    const binary = atob(b64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return new File([bytes], filename, { type: mime })
  } catch {
    return null
  }
}
