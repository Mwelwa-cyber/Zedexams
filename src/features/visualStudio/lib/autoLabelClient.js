/**
 * Auto-label client decisions (Visual Studio v2, spec 1C — pure).
 *
 * The `autoLabelDiagram` callable returns proposals
 * `{ parts: [{ word, anchor, confidence }], grounded, failed }`; this module
 * turns them into ordinary editor label objects (proposals are just
 * PRE-FILLED MANUAL LABELS the teacher drags/renames/deletes) and owns the
 * confidence-flag and messaging decisions, so the component stays glue.
 * No DOM, no Firebase — tests run under plain `node`.
 */

import { readingOrder } from './diagramProjections.js'

// Fallback only — the server response carries its own threshold
// (functions/teacherTools/autoLabelCore.js is the source of truth).
export const LOW_CONFIDENCE_FALLBACK = 0.7

let _counter = 0
function defaultMakeId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `label-${crypto.randomUUID().slice(0, 8)}`
  }
  _counter += 1
  return `label-${Date.now()}-${_counter}`
}

/**
 * Map server proposals to v1 canvas label objects, ordered by READING ORDER
 * (top→bottom, left→right) so the canvas's array-order lettering hands P to
 * the topmost part — the same rule the v2 asset model derives letters by.
 * `confidence` rides along for the amber flag and is cleared when the
 * teacher edits the label (reviewing it is what removes the flag).
 */
export function proposalsToCanvasObjects(parts = [], { color = '#111111', makeId = defaultMakeId } = {}) {
  const ordered = readingOrder(
    parts.filter((p) => p && p.anchor && String(p.word || '').trim()),
  )
  return ordered.map((p) => ({
    id: makeId(),
    type: 'label',
    x: p.anchor.x,
    y: p.anchor.y,
    text: String(p.word).trim(),
    color,
    confidence: Number.isFinite(Number(p.confidence)) ? Number(p.confidence) : undefined,
  }))
}

/** Is this canvas object an AI proposal the teacher should double-check? */
export function isLowConfidence(obj, threshold = LOW_CONFIDENCE_FALLBACK) {
  return Boolean(obj)
    && obj.type === 'label'
    && Number.isFinite(Number(obj.confidence))
    && Number(obj.confidence) < threshold
}

/** Count of amber-flagged labels among the canvas objects. */
export function lowConfidenceCount(objects = [], threshold = LOW_CONFIDENCE_FALLBACK) {
  return objects.filter((o) => isLowConfidence(o, threshold)).length
}

/**
 * The one toast/notice line after an auto-label run. Honest by construction:
 * a failed run says so (and hands the teacher manual mode), an ungrounded run
 * says to check the words against the textbook, low-confidence proposals are
 * called out — never silently trusted.
 */
export function autoLabelResultMessage({ added = 0, grounded = true, failed = false, lowCount = 0 } = {}) {
  if (failed) {
    return 'Auto-label could not read this picture — add labels manually with the Label tool.'
  }
  if (added === 0) {
    return 'No parts found to label — add labels manually with the Label tool.'
  }
  const bits = [`${added} label${added === 1 ? '' : 's'} proposed — review, drag or rename each one`]
  if (lowCount > 0) {
    bits.push(`${lowCount} marked amber (low confidence)`)
  }
  if (!grounded) {
    bits.push('not grounded — check the words against the textbook')
  }
  return `${bits.join('; ')}.`
}
