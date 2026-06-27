/**
 * scannedQuizImporterV2 — client orchestration wrapper that runs the shared
 * vision import pipeline with the V2 question normaliser.
 *
 * The V1 flow (`runVisionImport`) is unchanged. This module injects
 * `normaliseScannedQuestionV2` via the `normaliseQuestion` parameter so the
 * pipeline maps the 20+ vision-detected question types (fill_blanks, matching,
 * true_false, structured, etc.) to the correct editor types instead of
 * defaulting everything to 'mcq'.
 *
 * Usage:
 *   import { runVisionImportV2 } from './scannedQuizImporterV2.js'
 *   const result = await runVisionImportV2({ pageImages, callVision, onProgress })
 */

import { runVisionImport } from './scannedQuizImporter.js'
import { normaliseScannedQuestionV2 } from './normaliseScannedQuestionV2.js'

/**
 * Adapter: bridges the `deps.normaliseQuestion(raw, order, options, deps)`
 * calling convention used by `visionSectionsToLocal` to the V2 normaliser's
 * `(raw, { sourcePageIndex })` signature. The order argument is the editor
 * sequence counter (not a page index), so we read `raw.sourcePage` for the
 * actual page number when available.
 */
function normaliseQuestionV2Adapter(raw, _order, _options, _deps) {
  const sourcePageIndex = typeof raw?.sourcePage === 'number' ? raw.sourcePage : 0
  return normaliseScannedQuestionV2(raw, { sourcePageIndex })
}

/**
 * Source-agnostic V2 vision import: identical to `runVisionImport` but uses
 * the V2 question normaliser that maps 20+ question types to the editor shape.
 *
 * All parameters are forwarded to `runVisionImport` unchanged; only
 * `normaliseQuestion` is overridden. See `runVisionImport` in
 * `scannedQuizImporter.js` for the full parameter reference.
 */
export async function runVisionImportV2(options = {}) {
  return runVisionImport({
    ...options,
    normaliseQuestion: normaliseQuestionV2Adapter,
  })
}
