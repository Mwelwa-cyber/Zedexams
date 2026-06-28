import { useMemo, useState } from 'react'

import Button from '../../ui/Button'
import ImageCropModal from '../../quiz/ImageCropModal'
import DiagramHandlingChooser from './DiagramHandlingChooser'
import {
  buildReviewModel,
  pageKey,
  isReviewComplete,
} from './importReviewModel'

/**
 * ImportReviewScreen — the photo-import review step for the Test Paper Studio.
 *
 * After a photographed/scanned paper is reconstructed into studio sections, this
 * full-screen overlay lets the teacher check the reconstruction page-by-page
 * before it lands in the builder: it highlights what needs attention (no answer
 * yet, low-confidence OCR, a detected-but-missing figure), shows each detected
 * figure beside its AI options (keep / clean / redraw / replace / remove via
 * DiagramHandlingChooser), and lets the teacher fix the stem, pick the answer
 * and approve each page. Nothing is flattened — every edit writes straight back
 * into the editable studio model. The teacher always has the final say.
 *
 * Presentational: all data comes from `sections` and all edits go out through
 * `onPatchItem`, so the screen reflects live studio state and stays testable.
 *
 * Props
 *   open          — render the overlay
 *   sections      — current studio sections (the reconstructed paper)
 *   context       — { subject, grade, topic, subtopic } for diagram grounding
 *   pageImageUrls — optional { [pageNumber]: url } of the original page photos
 *   onPatchItem   — (item, patch) => void; merges patch into the item's question
 *                   or passage (the studio routes by item.kind)
 *   onAddQuestion — optional () => void; append a blank question the OCR missed
 *   onCropFigure  — optional (item, blob) => void|Promise; replace an item's
 *                   figure with a teacher-cropped PNG blob (uploaded by parent)
 *   onCleanFigure — optional async (item, blob) => url; persist the cleaned PNG
 *                   produced by "Clean original drawing" and return its URL
 *   onClose       — dismiss without finishing (keeps the import)
 *   onDone        — finish review and go to the builder
 */
export default function ImportReviewScreen({
  open,
  sections = [],
  context = {},
  pageImageUrls = {},
  onPatchItem,
  onAddQuestion,
  onCropFigure,
  onCleanFigure,
  onClose,
  onDone,
}) {
  const [approved, setApproved] = useState(() => new Set())
  // The item whose figure is being re-cropped (drives the crop modal).
  const [croppingItem, setCroppingItem] = useState(null)

  const model = useMemo(
    () => buildReviewModel(sections, pageImageUrls),
    [sections, pageImageUrls],
  )

  if (!open) return null

  const { summary } = model
  const complete = isReviewComplete(model, approved)

  function toggleApproved(page) {
    const key = pageKey(page)
    setApproved((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function applyDiagram(item, result) {
    if (typeof onPatchItem !== 'function') return
    if (result?.action === 'removed') {
      onPatchItem(item, { imageUrl: '', imageAssetId: '', diagramText: '' })
      return
    }
    if (result?.action === 'rebuilt_table' && result.tableData) {
      // The figure becomes an editable typed table — drop the image (and any
      // stacked extras) so the question renders the table, not the photo.
      onPatchItem(item, {
        tableData: result.tableData,
        imageUrl: '',
        imageAssetId: '',
        images: [],
        diagramText: '',
      })
      return
    }
    if (result?.url) {
      // The new figure is a remote/library URL, so drop the in-memory crop id.
      onPatchItem(item, { imageUrl: result.url, imageAssetId: '' })
    }
  }

  function detectedFor(item) {
    const ref = item.ref || {}
    const first = Array.isArray(ref.detectedDiagrams) ? ref.detectedDiagrams[0] : null
    return {
      kind: (first && first.kind) || 'other',
      caption: item.preview ? item.preview.slice(0, 80) : item.label,
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 theme-bg overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Review imported paper"
    >
      {/* Sticky header with the review tally + actions */}
      <header className="sticky top-0 z-10 theme-card border-b theme-border px-4 py-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-black theme-text text-base">Review imported paper</h2>
          <p className="text-xs theme-text-muted">
            {summary.totalItems} question{summary.totalItems === 1 ? '' : 's'} on{' '}
            {summary.pageCount} page{summary.pageCount === 1 ? '' : 's'}
            {summary.needsReview ? ` · ${summary.needsReview} to check` : ''}
            {summary.noAnswer ? ` · ${summary.noAnswer} need an answer` : ''}
            {summary.missingDiagrams ? ` · ${summary.missingDiagrams} missing figure` : ''}
            {summary.missingLabels ? ` · ${summary.missingLabels} need labels` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button
            size="sm"
            onClick={onDone}
            title={complete ? '' : 'Approve every page first, or open the builder anyway'}
          >
            {complete ? 'Open in builder' : 'Open in builder anyway'}
          </Button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto p-4 space-y-6">
        {model.pages.map((pageGroup) => {
          const key = pageKey(pageGroup.page)
          const isApproved = approved.has(key)
          return (
            <section key={key} className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-black theme-text text-sm">
                  {pageGroup.page == null ? 'Unplaced items' : `Page ${pageGroup.page}`}
                </h3>
                <label className="inline-flex items-center gap-2 text-xs font-bold theme-text cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isApproved}
                    onChange={() => toggleApproved(pageGroup.page)}
                  />
                  Approve this page
                </label>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                {/* Left: original photograph of the page, when available */}
                <div className="md:sticky md:top-20 self-start">
                  <p className="text-[11px] uppercase tracking-wide theme-text-muted mb-1">
                    Original
                  </p>
                  {pageGroup.originalUrl ? (
                    <img
                      src={pageGroup.originalUrl}
                      alt={`Original page ${pageGroup.page}`}
                      className="w-full rounded-lg border theme-border bg-white object-contain"
                    />
                  ) : (
                    <div className="rounded-lg border border-dashed theme-border p-6 text-xs theme-text-muted text-center">
                      Original page preview not available — each figure below is
                      shown beside its result.
                    </div>
                  )}
                </div>

                {/* Right: reconstructed items for this page */}
                <div className="space-y-3">
                  {pageGroup.items.map((item) => (
                    <ReviewItemCard
                      key={item.key}
                      item={item}
                      context={context}
                      detected={detectedFor(item)}
                      onPatch={onPatchItem}
                      onDiagram={(res) => applyDiagram(item, res)}
                      onCrop={onCropFigure ? () => setCroppingItem(item) : null}
                      onClean={onCleanFigure ? (blob) => onCleanFigure(item, blob) : null}
                    />
                  ))}
                </div>
              </div>
            </section>
          )
        })}

        {/* Add a question the OCR missed entirely. */}
        {typeof onAddQuestion === 'function' ? (
          <div className="pt-2">
            <Button variant="secondary" size="sm" onClick={onAddQuestion}>
              + Add a missing question
            </Button>
          </div>
        ) : null}
      </div>

      {/* Re-crop a figure straight from the review screen (reuses the studio's
          drag-to-crop modal; the parent uploads the returned PNG blob). */}
      {croppingItem && croppingItem.ref?.imageUrl ? (
        <ImageCropModal
          imageUrl={croppingItem.ref.imageUrl}
          onCropped={(blob) => {
            const target = croppingItem
            setCroppingItem(null)
            if (typeof onCropFigure === 'function') onCropFigure(target, blob)
          }}
          onCancel={() => setCroppingItem(null)}
        />
      ) : null}
    </div>
  )
}

function Badge({ children, tone = 'warn' }) {
  const cls =
    tone === 'danger'
      ? 'bg-[color:var(--danger)] text-white'
      : 'theme-bg-subtle theme-accent-text'
  return (
    <span className={`text-[11px] font-black px-2 py-0.5 rounded-full ${cls}`}>
      {children}
    </span>
  )
}

// Per-item readiness summary: Ready (green) / Needs review (amber) / Failed (red,
// set when a figure clean/redraw/rebuild errored). Mirrors the product spec's
// review-screen status.
function StatusChip({ status }) {
  const map = {
    ready: { label: 'Ready', cls: 'bg-green-600 text-white' },
    review: { label: 'Needs review', cls: 'theme-bg-subtle theme-accent-text' },
    failed: { label: 'Failed', cls: 'bg-[color:var(--danger)] text-white' },
  }
  const s = map[status] || map.review
  return (
    <span className={`text-[11px] font-black px-2 py-0.5 rounded-full ${s.cls}`}>
      {s.label}
    </span>
  )
}

function ReviewItemCard({ item, context, detected, onPatch, onDiagram, onCrop, onClean }) {
  const ref = item.ref || {}
  const { signals } = item
  const isPassage = item.kind === 'passage'
  const options = Array.isArray(ref.options) ? ref.options : []
  // True once a figure clean/redraw/rebuild has failed for this item, so the
  // status flips to "Failed" until the teacher succeeds with another option.
  const [figureFailed, setFigureFailed] = useState(false)

  function patch(p) {
    if (typeof onPatch === 'function') onPatch(item, p)
  }

  const status = figureFailed ? 'failed' : signals.status || (signals.issues.length ? 'review' : 'ready')
  const confidencePct =
    signals.confidence != null ? Math.round(signals.confidence * 100) : null

  return (
    <div className="theme-card border theme-border rounded-2xl p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="font-black theme-text text-sm">{item.label}</p>
        <div className="flex flex-wrap items-center gap-1 justify-end">
          <StatusChip status={status} />
          {confidencePct != null ? (
            <span className="text-[11px] font-bold theme-text-muted" title="Figure detection confidence">
              {confidencePct}% match
            </span>
          ) : null}
          {signals.issues.map((issue) => (
            <Badge key={issue} tone={issue === 'No answer' || issue === 'Missing diagram' ? 'danger' : 'warn'}>
              {issue}
            </Badge>
          ))}
          {/* Re-crop the attached figure (only when one is present). */}
          {onCrop && ref.imageUrl ? (
            <button
              type="button"
              className="text-[11px] font-black theme-accent-text underline"
              onClick={onCrop}
            >
              Crop figure
            </button>
          ) : null}
        </div>
      </div>

      {/* Editable stem / passage text — OCR output is plain, so a textarea is
          safe and lets the teacher fix wording without leaving the screen. */}
      <textarea
        className="w-full text-sm theme-bg border theme-border rounded-lg p-2 theme-text"
        rows={isPassage ? 4 : 2}
        defaultValue={item.preview}
        aria-label={`${item.label} text`}
        onBlur={(e) => {
          const value = e.target.value
          if (value !== item.preview) patch(isPassage ? { passageText: value } : { text: value })
        }}
      />

      {/* MCQ answer picker — clears the most common "No answer" flag inline. */}
      {!isPassage && options.length > 0 ? (
        <fieldset className="space-y-1">
          <legend className="text-[11px] uppercase tracking-wide theme-text-muted">
            Correct answer
          </legend>
          {options.map((opt, i) => (
            <label key={i} className="flex items-center gap-2 text-sm theme-text cursor-pointer">
              <input
                type="radio"
                name={`${item.key}-answer`}
                checked={Number(ref.correctAnswer) === i}
                onChange={() => patch({ correctAnswer: i, requiresReview: false })}
              />
              <span>{String.fromCharCode(65 + i)}. {opt || <em className="theme-text-muted">blank</em>}</span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {/* Diagram handling — the five options, original vs result. Shown when a
          figure was detected or one is already attached. */}
      {signals.hasDiagram ? (
        <DiagramHandlingChooser
          detected={detected}
          context={context}
          originalUrl={ref.imageUrl || null}
          onCleanUpload={onClean}
          onResolved={onDiagram}
          onError={(msg) => setFigureFailed(Boolean(msg))}
        />
      ) : null}

      {/* Additional figures kept from a multi-figure question — the teacher can
          drop any false positives here (they render stacked below the primary
          in the paper). */}
      {Array.isArray(ref.images) && ref.images.length > 0 ? (
        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-wide theme-text-muted">
            Additional figures ({ref.images.length}) — stacked below the main one
          </p>
          <div className="grid grid-cols-2 gap-2">
            {ref.images.map((img, i) => (
              <figure key={img.url || i} className="space-y-1">
                <img
                  src={img.url}
                  alt={img.alt || `Additional figure ${i + 2}`}
                  className="w-full rounded-lg border theme-border bg-white object-contain max-h-40"
                />
                <button
                  type="button"
                  className="text-[11px] font-black text-[color:var(--danger)] underline"
                  onClick={() => patch({ images: ref.images.filter((_, j) => j !== i) })}
                >
                  Remove figure
                </button>
              </figure>
            ))}
          </div>
        </div>
      ) : null}

      {/* Figures detected but not attachable (e.g. a crop that failed) — point
          the teacher at the Diagram Scanner to add them by hand. */}
      {signals.extraDiagrams > 0 ? (
        <p className="text-[11px] font-bold theme-text-muted">
          ➕ {signals.extraDiagrams} more figure
          {signals.extraDiagrams === 1 ? ' was' : 's were'} detected on this
          question but could not be cropped — add{' '}
          {signals.extraDiagrams === 1 ? 'it' : 'them'} with the Diagram Scanner.
        </p>
      ) : null}
    </div>
  )
}
