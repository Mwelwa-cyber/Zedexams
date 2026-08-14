/**
 * RegisterPaperPreview — "how this will look on the paper", live while the
 * teacher marks.
 *
 * The sheet is the printed document: buildPaperPreview() emits the same page
 * markup and print stylesheet that Print & Export sends to the printer, on an
 * A4-sized sheet instead of a `@page` box. It renders inside an iframe so no
 * app or theme CSS can leak in and flatter the preview — what is on the sheet
 * is what comes out of the printer.
 *
 * It is fed from the on-screen day list, which carries unsaved marks, so a
 * tap on a learner shows up on the paper a moment later (the rebuild is
 * debounced — marking a whole class must not re-render the sheet 40 times).
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import useRegisterExportModel from '../../hooks/useRegisterExportModel'
import {
  buildPaperPreview,
  buildOfficialRegisterHtml,
  buildTermSummaryHtml,
  printAttendanceHtml,
  PREVIEW_DOCUMENTS,
} from '../../lib/attendanceExportService'
import { useToast } from '../../../../shared/components/Toast'
import Button from '../../../../shared/components/Button'

const OPEN_KEY = 'zedexams:registerPaperPreview:open'
const REBUILD_DELAY_MS = 400

function loadOpen() {
  try {
    return localStorage.getItem(OPEN_KEY) === '1'
  } catch {
    return false
  }
}

export default function RegisterPaperPreview({
  registerHook, register, uid, teacherName, policy, monthKey = null,
}) {
  const toast = useToast()
  const [open, setOpen] = useState(loadOpen)
  const [doc, setDoc] = useState('register')
  const [zoom, setZoom] = useState('fit') // 'fit' | 'actual'

  const { model } = useRegisterExportModel({
    registerHook, register, uid, teacherName, policy, enabled: open,
  })

  useEffect(() => {
    try { localStorage.setItem(OPEN_KEY, open ? '1' : '0') } catch { /* storage blocked */ }
  }, [open])

  const months = useMemo(() => model?.months || [], [model])

  // The register sheet previews the month selected by the grid's month chips
  // above — ONE month control for the whole tab, no second picker here. The
  // preview only carries non-future months, so a future month falls back to
  // the nearest earlier available one, else the last.
  const previewMonthKey = useMemo(() => {
    if (!months.length) return null
    if (monthKey && months.some((m) => m.key === monthKey)) return monthKey
    if (monthKey) {
      const earlier = months.filter((m) => m.key < monthKey)
      if (earlier.length) return earlier[earlier.length - 1].key
    }
    return months[months.length - 1].key
  }, [months, monthKey])

  // Marking must not re-render the sheet on every tap, so the MODEL settles on
  // a debounce. Choosing a different document or page is a direct request and
  // redraws at once.
  const [settledModel, setSettledModel] = useState(null)
  const paintedRef = useRef(false)
  useEffect(() => {
    if (!model) { paintedRef.current = false; setSettledModel(null); return undefined }
    if (!paintedRef.current) { // first paint is immediate
      paintedRef.current = true
      setSettledModel(model)
      return undefined
    }
    const t = setTimeout(() => setSettledModel(model), REBUILD_DELAY_MS)
    return () => clearTimeout(t)
  }, [model])

  const sheet = useMemo(
    () => (settledModel ? buildPaperPreview(settledModel, { doc, monthKey: previewMonthKey }) : null),
    [settledModel, doc, previewMonthKey],
  )

  // ── fit the A4 sheet to the column ──────────────────────────────
  const frameRef = useRef(null)
  const wrapRef = useRef(null)
  const [wrapWidth, setWrapWidth] = useState(0)
  const [sheetHeight, setSheetHeight] = useState(0)

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return undefined
    const measure = () => setWrapWidth(el.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [open])

  const geo = sheet?.geometry
  const scale = zoom === 'actual' || !geo || !wrapWidth
    ? 1
    : Math.min(1, wrapWidth / geo.widthPx)
  const pageHeight = Math.max(sheetHeight, geo?.heightPx || 0)

  // The sheet grows with the roster; read its real height so the panel is
  // exactly as tall as the paper (the iframe has no scrollbar of its own).
  function measureSheet() {
    try {
      const body = frameRef.current?.contentDocument?.body
      if (body) setSheetHeight(body.scrollHeight)
    } catch {
      // cross-origin (never for srcDoc) — the A4 height stands in
    }
  }
  useEffect(() => { measureSheet() }, [sheet])

  function print() {
    if (!model) return
    try {
      printAttendanceHtml(doc === 'summary' ? buildTermSummaryHtml(model) : buildOfficialRegisterHtml(model))
    } catch (err) {
      toast.error(err.message || 'Could not open the print window.')
    }
  }

  return (
    <section className="theme-card border theme-border rounded-radius-md">
      <div className="flex flex-wrap items-center gap-2 p-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex items-center gap-2 theme-text font-black text-sm"
        >
          <span aria-hidden="true" className="theme-text-muted">{open ? '▾' : '▸'}</span>
          Paper preview
        </button>
        <span className="theme-text-muted text-xs hidden sm:inline">
          {doc === 'register' && open && sheet?.label
            ? `— ${sheet.label} — follows the month selected above · A4 landscape · exactly what prints`
            : 'Exactly what prints — updates as you mark.'}
        </span>
        {open && (
          <div className="flex flex-wrap items-center gap-2 ml-auto">
            <label className="sr-only" htmlFor="preview-doc">Preview document</label>
            <select id="preview-doc" value={doc} onChange={(e) => setDoc(e.target.value)}
              className="rounded-radius-md border theme-border theme-card theme-text px-2 py-1 text-xs font-bold">
              {PREVIEW_DOCUMENTS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
            <button type="button" onClick={() => setZoom((z) => (z === 'fit' ? 'actual' : 'fit'))}
              className="theme-text-muted text-xs font-black underline">
              {zoom === 'fit' ? 'Actual size' : 'Fit width'}
            </button>
            <Button type="button" size="sm" variant="secondary" onClick={print} disabled={!model}>
              Print
            </Button>
          </div>
        )}
      </div>

      {open && (
        <div className="px-3 pb-3 space-y-2">
          <p className="theme-text-muted text-xs">
            {sheet
              ? `A4 landscape · page ${sheet.page} of ${sheet.pages}${sheet.pages > 1 ? ' (one page per month)' : ''}`
              : 'Building the sheet…'}
            {sheet && ' · a grey line marks where a second sheet starts.'}
          </p>
          <div ref={wrapRef} className={`bg-slate-200 rounded-radius-md p-2 sm:p-4 ${zoom === 'actual' ? 'overflow-x-auto' : 'overflow-hidden'}`}>
            {sheet ? (
              <div style={{ width: geo.widthPx * scale, height: pageHeight * scale }}>
                <iframe
                  ref={frameRef}
                  title="Register paper preview"
                  srcDoc={sheet.html}
                  sandbox="allow-same-origin"
                  onLoad={measureSheet}
                  style={{
                    width: geo.widthPx,
                    height: pageHeight,
                    transform: `scale(${scale})`,
                    transformOrigin: 'top left',
                    border: 0,
                    display: 'block',
                    boxShadow: '0 1px 6px rgba(15, 23, 42, 0.25)',
                    background: '#fff',
                  }}
                />
              </div>
            ) : (
              <div className="h-40 rounded-radius-md bg-white/60" aria-hidden="true" />
            )}
          </div>
        </div>
      )}
    </section>
  )
}
