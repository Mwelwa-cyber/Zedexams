import { useEffect, useRef, useState } from 'react'

import Button from '../../../../shared/components/Button'
import {
  DIAGRAM_HANDLING_OPTIONS,
  redrawTestPaperDiagram,
  rebuildTableFromImage,
} from '../../../../utils/testPaperDiagram'
import {
  cleanDiagramSource,
  isDiagramCleanSupported,
  sourceToBlob,
} from '../../../../utils/diagramClean.js'
import { matchLibraryShape } from '../../lib/matchLibraryShape.js'
import DiagramSvg from '../../../../components/diagrams/DiagramSvg.jsx'

// A photographed TABLE / pictograph is never improved by the AI image
// generator — redrawing it as line art just produces a wrong picture, and that
// generation is the flaky path that surfaces "the diagram service took too long
// or hit an error". Tables have a dedicated, reliable path ("Rebuild as table",
// Claude vision → editable typed table) that never touches image generation. So
// for table-like figures we (1) auto-run that path, (2) make it the primary
// recommended action, and (3) hide the two image-gen options.
function isTableLikeKind(kind) {
  const k = String(kind || '').toLowerCase()
  return (
    k.includes('table') ||
    k.includes('pictograph') ||
    k.includes('pictogram') ||
    k.includes('tally') ||
    k.includes('chart')
  )
}

// The image-generation options that are the wrong tool (and the flaky path) for
// a table — hidden when the figure is table-like.
const IMAGE_GEN_OPTION_IDS = new Set(['redraw', 'replace'])

/**
 * DiagramHandlingChooser — per-figure control in the Assessment Paper Studio
 * photo import review screen.
 *
 * For each diagram Claude detected on a scanned paper, the teacher decides what
 * to do with it. This renders the five product handling options
 * (keep / clean / redraw / replace / remove), shows the original cropped photo
 * and — once an AI option resolves — a side-by-side of the resulting figure, so
 * the teacher always has the final say before the diagram lands in the paper.
 *
 * "Clean original drawing" runs entirely in the browser via the
 * `cleanDiagramSource` pixel pipeline (auto-crop + whiten + sharpen + B&W) — no
 * Cloud Function, no AI cost. The cleaned PNG is uploaded through `onCleanUpload`
 * (the parent stores it in the same place a cropped figure goes) so the studio
 * model ends up with a real Storage URL rather than a giant data URL. The
 * redraw/replace options call `redrawTestPaperDiagram`, which reuses a matching
 * ZedExams Diagram Library figure when one exists (no AI cost) and otherwise
 * generates a fresh black-and-white educational diagram.
 *
 * Props
 *   detected      — structured diagram description from Claude
 *                   ({ kind, caption, labels, elements, data, mathGroups })
 *   context       — { subject, grade, topic, subtopic } for grounding + library
 *   originalUrl   — storage URL of the cropped photo figure (optional)
 *   onCleanUpload — optional async (blob) => url; persist the cleaned PNG and
 *                   return its URL. When absent, the cleaned data URL is used.
 *   onResolved    — (result) => void; called with the chosen outcome
 *                   ({ action, url, source, ... })
 */
export default function DiagramHandlingChooser({
  detected,
  context = {},
  originalUrl = null,
  onCleanUpload = null,
  onResolved,
  onError = null,
}) {
  const [busy, setBusy] = useState(null) // the option id currently running
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  // The pristine scanned crop, captured BEFORE any clean/redraw resolves. Once a
  // result exists we freeze it, because resolving patches the parent's
  // ref.imageUrl to the cleaned/redrawn figure — and `originalUrl` mirrors that.
  // Without this freeze the "Original" preview (and the clean source) would flip
  // to the cleaned image too, destroying the before/after comparison.
  const [pristineOriginalUrl, setPristineOriginalUrl] = useState(originalUrl)
  useEffect(() => {
    if (!result && originalUrl) setPristineOriginalUrl(originalUrl)
  }, [originalUrl, result])

  const caption =
    (detected && (detected.caption || detected.kind)) || 'Detected figure'

  // A table/pictograph: reroute away from the flaky image generator and onto the
  // reliable "Rebuild as table" path. We can only rebuild when there's a crop to
  // read and an uploader to stage it through (the review screen always wires one).
  const isTable = isTableLikeKind(detected && detected.kind)
  const canRebuildTable =
    isTable &&
    typeof onCleanUpload === 'function' &&
    Boolean(pristineOriginalUrl || originalUrl)

  // Clean the scanned figure in-browser, upload it, and return the result the
  // chooser surfaces. Kept separate so a cleaning failure (e.g. a cross-origin
  // figure that taints the canvas) surfaces a clear, actionable message rather
  // than the raw DOM SecurityError. Always cleans the PRISTINE original so a
  // second click never re-cleans an already-cleaned figure.
  async function cleanOriginal() {
    let cleaned
    try {
      cleaned = await cleanDiagramSource(pristineOriginalUrl || originalUrl, {
        blackAndWhite: true,
        autoCrop: true,
        whiten: true,
      })
    } catch {
      throw new Error(
        'Could not clean this figure automatically. Keep the original, or redraw it with AI.',
      )
    }
    // Persist the cleaned PNG. When an uploader is wired (the review screen
    // always wires one), a falsy return means the Storage upload failed — fail
    // loudly rather than silently persisting the giant inline data URL into the
    // studio model (and eventually a Firestore doc). The data-URL fallback is
    // only for preview-only callers that wire no uploader at all.
    if (typeof onCleanUpload === 'function') {
      const uploaded = await onCleanUpload(cleaned.blob)
      if (!uploaded) {
        throw new Error('Could not save the cleaned figure. Please try again.')
      }
      return { action: 'cleaned', url: uploaded, source: 'cleaned', cleaned: true }
    }
    return { action: 'cleaned', url: cleaned.dataUrl, source: 'cleaned', cleaned: true }
  }

  // Reconstruct the scanned figure as an editable typed table. Uploads the
  // ORIGINAL crop (CORS-safe), then a vision model reads it into tableData.
  async function rebuildAsTable() {
    if (typeof onCleanUpload !== 'function') {
      throw new Error('Rebuilding as a table is not available here.')
    }
    let blob
    try {
      blob = await sourceToBlob(pristineOriginalUrl || originalUrl)
    } catch {
      throw new Error('Could not read the table image. Keep the original, or crop it tighter.')
    }
    const uploadedUrl = await onCleanUpload(blob)
    if (!uploadedUrl) {
      throw new Error('Could not prepare the table image. Please try again.')
    }
    return rebuildTableFromImage({ detected, context, imageUrl: uploadedUrl })
  }

  async function choose(option) {
    setError('')
    // Clean and rebuild-as-table both operate on the scanned crop. If there is
    // no crop here, say so instead of falling through to the server, which would
    // answer with a null result the review screen silently drops.
    const haveOriginal = Boolean(pristineOriginalUrl || originalUrl)
    const needsCrop = option.id === 'clean_original' || option.id === 'rebuild_as_table'
    if (needsCrop && !haveOriginal) {
      setError('There is no scanned figure here to work with. Try "Redraw using AI" to generate one.')
      return
    }
    setBusy(option.id)
    try {
      // "Clean original drawing" runs locally on the scanned figure — no server
      // round-trip (which is why the old path could surface a bare "internal").
      let res
      if (option.id === 'clean_original' && haveOriginal && isDiagramCleanSupported()) {
        res = await cleanOriginal()
      } else if (option.id === 'rebuild_as_table' && haveOriginal) {
        res = await rebuildAsTable()
      } else if (option.id === 'convert_svg') {
        // Library-first, zero-cost: only convert when the figure clearly names a
        // catalogue shape. Otherwise keep the teacher honest — don't fake a
        // vector shape that misrepresents the paper.
        const match = matchLibraryShape(detected)
        if (!match) {
          throw new Error(
            "This figure doesn't match an editable library shape. Keep the original, or redraw it with AI.",
          )
        }
        res = { action: 'converted_svg', imageDiagram: match, source: 'library' }
      } else {
        res = await redrawTestPaperDiagram({
          detected,
          handling: option.id,
          context,
          originalUrl,
        })
      }
      // Tag the result with the chosen option so the matching button highlights.
      const resolved = { ...res, handling: res?.handling || option.id }
      setResult(resolved)
      if (typeof onError === 'function') onError(null)
      if (typeof onResolved === 'function') onResolved(resolved)
    } catch (err) {
      const message = err?.message || 'Something went wrong. Please try again.'
      setError(message)
      if (typeof onError === 'function') onError(message)
    } finally {
      setBusy(null)
    }
  }

  // Table/pictograph figures rebuild themselves automatically (once) the moment
  // a crop + uploader are available, so the teacher lands on a clean editable
  // table instead of having to find the right button — and never gets routed
  // into the image generator that was failing. If the rebuild errors, the
  // options stay visible for a manual retry (or to keep the original).
  const autoRebuiltRef = useRef(false)
  useEffect(() => {
    if (autoRebuiltRef.current) return
    if (result || busy) return
    if (!canRebuildTable) return
    autoRebuiltRef.current = true
    const option = DIAGRAM_HANDLING_OPTIONS.find((o) => o.id === 'rebuild_as_table')
    if (option) choose(option)
    // choose is stable enough for this one-shot guarded effect; deps cover the
    // inputs that gate whether an auto-rebuild is possible.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRebuildTable, result, busy])

  // For a table, hide the image-generation options (wrong tool + flaky path) and
  // surface "Rebuild as table" first as the recommended primary action.
  const visibleOptions = isTable
    ? [
        ...DIAGRAM_HANDLING_OPTIONS.filter((o) => o.id === 'rebuild_as_table'),
        ...DIAGRAM_HANDLING_OPTIONS.filter(
          // A table doesn't map to a vector shape, so hide "Convert to SVG"
          // (and the image-gen options) alongside the primary rebuild.
          (o) => o.id !== 'rebuild_as_table' && o.id !== 'convert_svg' && !IMAGE_GEN_OPTION_IDS.has(o.id),
        ),
      ]
    : DIAGRAM_HANDLING_OPTIONS

  const resolvedUrl = result?.url || null
  const isRemoved = result?.action === 'removed'
  const isCleaned = result?.action === 'cleaned'
  const isRebuiltTable = result?.action === 'rebuilt_table'
  const isConvertedSvg = result?.action === 'converted_svg'
  const resolvedTable = isRebuiltTable ? result?.tableData : null
  const reused = result?.source === 'library' && !isConvertedSvg

  return (
    <div className="theme-card border theme-border rounded-2xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-black theme-text text-sm">{caption}</p>
          {detected?.kind ? (
            <p className="text-xs theme-text-muted capitalize">
              {String(detected.kind).replace(/_/g, ' ')}
            </p>
          ) : null}
        </div>
        {result ? (
          <span className="text-xs font-black theme-accent-text">
            {isRemoved
              ? 'Removed'
              : isRebuiltTable
                ? 'Rebuilt as table'
                : isConvertedSvg
                  ? 'Converted to SVG'
                  : isCleaned
                    ? 'Cleaned'
                    : reused
                      ? 'Reused from library'
                      : result.source === 'generated'
                        ? 'Redrawn'
                        : 'Kept original'}
          </span>
        ) : null}
      </div>

      {/* Original vs result preview */}
      <div className="grid grid-cols-2 gap-3">
        <figure className="space-y-1">
          <figcaption className="text-[11px] uppercase tracking-wide theme-text-muted">
            Original
          </figcaption>
          {pristineOriginalUrl ? (
            <img
              src={pristineOriginalUrl}
              alt="Original scanned figure"
              className="w-full rounded-lg border theme-border bg-white object-contain max-h-40"
            />
          ) : (
            <div className="w-full h-24 rounded-lg border border-dashed theme-border grid place-items-center text-xs theme-text-muted">
              No crop
            </div>
          )}
        </figure>
        <figure className="space-y-1">
          <figcaption className="text-[11px] uppercase tracking-wide theme-text-muted">
            Result
          </figcaption>
          {isRemoved ? (
            <div className="w-full h-24 rounded-lg border border-dashed theme-border grid place-items-center text-xs theme-text-muted">
              Blank space
            </div>
          ) : isConvertedSvg && result?.imageDiagram ? (
            <div className="w-full max-h-40 overflow-hidden rounded-lg border theme-border bg-white p-2 grid place-items-center">
              <DiagramSvg
                libraryKey={result.imageDiagram.libraryKey}
                params={result.imageDiagram.params}
                className="max-h-36"
                alt="Editable vector shape"
              />
            </div>
          ) : resolvedTable ? (
            <div className="w-full max-h-40 overflow-auto rounded-lg border theme-border bg-white p-1">
              <table className="w-full border-collapse text-[10px] leading-tight">
                {resolvedTable.headers?.length ? (
                  <thead>
                    <tr>
                      {resolvedTable.headers.map((h, i) => (
                        <th key={i} className="border border-slate-500 px-1 py-0.5 font-black text-slate-900">{h}</th>
                      ))}
                    </tr>
                  </thead>
                ) : null}
                <tbody>
                  {(resolvedTable.rows || []).map((row, ri) => (
                    <tr key={ri}>
                      {row.map((cell, ci) => (
                        <td key={ci} className="border border-slate-500 px-1 py-0.5 text-slate-900">{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : resolvedUrl ? (
            <img
              src={resolvedUrl}
              alt="Resulting figure"
              className="w-full rounded-lg border theme-border bg-white object-contain max-h-40"
            />
          ) : (
            <div className="w-full h-24 rounded-lg border border-dashed theme-border grid place-items-center text-xs theme-text-muted">
              Choose an option
            </div>
          )}
        </figure>
      </div>

      {error ? (
        <p className="text-xs font-bold text-[color:var(--danger)]">{error}</p>
      ) : null}

      {/* Table figures: explain why we rebuild rather than redraw, so the lone
          recommended action doesn't look like a missing feature. */}
      {isTable ? (
        <p className="text-[11px] theme-text-muted">
          This looks like a table — it’s rebuilt as a clean, editable table
          rather than redrawn as a picture.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {visibleOptions.map((option) => {
          const recommended = isTable && option.id === 'rebuild_as_table'
          const isActive = result && result.handling === option.id
          return (
            <Button
              key={option.id}
              size="sm"
              variant={isActive || recommended ? 'primary' : 'secondary'}
              loading={busy === option.id}
              disabled={Boolean(busy)}
              onClick={() => choose(option)}
            >
              {recommended ? `${option.label} (recommended)` : option.label}
            </Button>
          )
        })}
      </div>
    </div>
  )
}
