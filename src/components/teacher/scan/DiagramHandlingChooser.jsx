import { useState } from 'react'

import Button from '../../ui/Button'
import {
  DIAGRAM_HANDLING_OPTIONS,
  redrawTestPaperDiagram,
} from '../../../utils/testPaperDiagram'

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
 * The redraw/replace options call `redrawTestPaperDiagram`, which reuses a
 * matching ZedExams Diagram Library figure when one exists (no AI cost) and
 * otherwise generates a fresh black-and-white educational diagram.
 *
 * Props
 *   detected     — structured diagram description from Claude
 *                  ({ kind, caption, labels, elements, data, mathGroups })
 *   context      — { subject, grade, topic, subtopic } for grounding + library
 *   originalUrl  — storage URL of the cropped photo figure (optional)
 *   onResolved   — (result) => void; called with the chosen outcome
 *                  ({ action, url, source, ... })
 */
export default function DiagramHandlingChooser({
  detected,
  context = {},
  originalUrl = null,
  onResolved,
}) {
  const [busy, setBusy] = useState(null) // the option id currently running
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  const caption =
    (detected && (detected.caption || detected.kind)) || 'Detected figure'

  async function choose(option) {
    setError('')
    setBusy(option.id)
    try {
      const res = await redrawTestPaperDiagram({
        detected,
        handling: option.id,
        context,
        originalUrl,
      })
      setResult(res)
      if (typeof onResolved === 'function') onResolved(res)
    } catch (err) {
      setError(err?.message || 'Something went wrong. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  const resolvedUrl = result?.url || null
  const isRemoved = result?.action === 'removed'
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
          {originalUrl ? (
            <img
              src={originalUrl}
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
