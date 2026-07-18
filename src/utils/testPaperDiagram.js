/**
 * Client wrapper for the `redrawTestPaperDiagram` Cloud Function.
 *
 * Used by the Assessment Paper Studio photo-import review screen: once Claude has
 * understood a paper and described each detected figure, the teacher picks one
 * of the five Diagram Handling Options for each one and this carries it out —
 * reusing a Diagram Library figure when one matches, otherwise generating a
 * fresh black-and-white educational diagram.
 *
 * Usage:
 *   const res = await redrawTestPaperDiagram({
 *     detected: { kind: 'plant', caption: 'Flowering plant', labels: ['stem','roots'] },
 *     handling: 'redraw',
 *     context: { subject: 'Science', grade: 'Grade 4', topic: 'Plants' },
 *     originalUrl,        // optional — kept for keep/clean options
 *   })
 *   // res -> { action, url, source, ... }
 */

import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../firebase/config'
import { messageFromError, messageFromTableError } from './testPaperDiagramErrors'

const functions = getFunctions(app, 'us-central1')
const redrawCallable = httpsCallable(functions, 'redrawTestPaperDiagram')
const rebuildTableCallable = httpsCallable(functions, 'rebuildTableFromImage')
const analyzeLayoutCallable = httpsCallable(functions, 'analyzePaperLayout')

// The product handling options, mirrored client-side so the review UI can render
// them without a round-trip. Kept in sync with diagramBrief.js. `rebuildsTable`
// marks the option that reconstructs the figure as an editable typed table
// (tableData) rather than producing/keeping an image.
export const DIAGRAM_HANDLING_OPTIONS = [
  { id: 'keep_original', label: 'Keep original image', generates: false },
  { id: 'clean_original', label: 'Clean original drawing', generates: false },
  { id: 'convert_svg', label: 'Convert to editable SVG', generates: false, convertsSvg: true },
  { id: 'redraw', label: 'Redraw using AI', generates: true },
  { id: 'rebuild_as_table', label: 'Rebuild as table', generates: true, rebuildsTable: true },
  { id: 'replace', label: 'Replace with a better educational diagram', generates: true },
  { id: 'remove', label: 'Remove diagram and leave blank space', generates: false },
]

// Server has timeoutSeconds: 300; allow a small margin so a slow-but-valid
// generation completes and a real server error surfaces, rather than the client
// giving up first (and never letting the server's descriptive error through).
const REDRAW_TIMEOUT_MS = 310000

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Diagram redraw timed out. Please try again.')),
      ms,
    )
    promise
      .then(
        value => { clearTimeout(timer); resolve(value) },
        err => { clearTimeout(timer); reject(err) },
      )
      .catch(err => { clearTimeout(timer); reject(err) })
  })
}

export async function redrawTestPaperDiagram({
  detected,
  handling,
  context,
  originalUrl,
  forceNew,
} = {}) {
  if (!detected || typeof detected !== 'object') {
    throw new Error('No diagram description was provided.')
  }
  if (!DIAGRAM_HANDLING_OPTIONS.some(o => o.id === handling)) {
    throw new Error(`Unknown diagram handling option: ${handling}.`)
  }
  try {
    const result = await withTimeout(
      redrawCallable({ detected, handling, context, originalUrl, forceNew }),
      REDRAW_TIMEOUT_MS,
    )
    return result?.data || {}
  } catch (error) {
    throw new Error(messageFromError(error))
  }
}

/**
 * Cheap layout-first pass over ONE page image (data URL). Returns the page's
 * object inventory ({ objects:[{type,box,confidence,route}], summary }). This is
 * ADVISORY — on any failure it resolves to an empty inventory so the caller can
 * carry on with the main extraction rather than sinking the whole import.
 */
export async function analyzePaperLayout(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') {
    return { objects: [], summary: { total: 0 }, degraded: true }
  }
  try {
    const result = await withTimeout(analyzeLayoutCallable({ dataUrl }), 65000)
    return result?.data || { objects: [], summary: { total: 0 }, degraded: true }
  } catch {
    return { objects: [], summary: { total: 0 }, degraded: true }
  }
}

/**
 * Rebuild a photographed table/pictograph into editable tableData via Claude
 * vision. `imageUrl` must be an UPLOADED (https) URL the server can fetch.
 * Returns { action: 'rebuilt_table', tableData: { headers, rows }, caption }.
 */
export async function rebuildTableFromImage({ detected, context, imageUrl } = {}) {
  if (!imageUrl || typeof imageUrl !== 'string') {
    throw new Error('No table image was provided.')
  }
  try {
    const result = await withTimeout(
      rebuildTableCallable({ detected, context, imageUrl }),
      130000,
    )
    return result?.data || {}
  } catch (error) {
    throw new Error(messageFromTableError(error))
  }
}
