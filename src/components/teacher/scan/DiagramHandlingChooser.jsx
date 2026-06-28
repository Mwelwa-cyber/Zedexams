import { useEffect, useState } from 'react'

import Button from '../../ui/Button'
import {
  DIAGRAM_HANDLING_OPTIONS,
  redrawTestPaperDiagram,
} from '../../../utils/testPaperDiagram'
import {
  cleanDiagramSource,
  isDiagramCleanSupported,
} from '../../../utils/diagramClean.js'

/**
 * DiagramHandlingChooser — per-figure control in the Test Paper Studio photo
 * import review screen.
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

  async function choose(option) {
    setError('')
    // Clean runs in-browser on the scanned crop. If there is no crop to clean,
    // say so instead of falling through to the server, which answers a clean
    // request with a null-url "kept_clean" the review screen silently drops —
    // leaving the teacher with no figure and no feedback.
    const haveOriginal = Boolean(pristineOriginalUrl || originalUrl)
    if (option.id === 'clean_original' && !haveOriginal) {
      setError('There is no scanned figure to clean here. Try "Redraw using AI" to generate one.')
      return
    }
    setBusy(option.id)
    try {
      // "Clean original drawing" runs locally on the scanned figure — no server
      // round-trip (which is why the old path could surface a bare "internal").
      const res =
        option.id === 'clean_original' && haveOriginal && isDiagramCleanSupported()
          ? await cleanOriginal()
          : await redrawTestPaperDiagram({
              detected,
              handling: option.id,
              context,
              originalUrl,
            })
      // Tag the result with the chosen option so the matching button highlights.
      const resolved = { ...res, handling: res?.handling || option.id }
      setResult(resolved)
      if (typeof onResolved === 'function') onResolved(resolved)
    } catch (err) {
      setError(err?.message || 'Something went wrong. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  const resolvedUrl = result?.url || null
  const isRemoved = result?.action === 'removed'
  const isCleaned = result?.action === 'cleaned'
  const reused = result?.source === 'library'

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

      <div className="flex flex-wrap gap-2">
        {DIAGRAM_HANDLING_OPTIONS.map((option) => (
          <Button
            key={option.id}
            size="sm"
            variant={result && result.handling === option.id ? 'primary' : 'secondary'}
            loading={busy === option.id}
            disabled={Boolean(busy)}
            onClick={() => choose(option)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
