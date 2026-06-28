/**
 * Client wrapper for the `redrawTestPaperDiagram` Cloud Function.
 *
 * Used by the Test Paper Studio photo-import review screen: once Claude has
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

const functions = getFunctions(app, 'us-central1')
const redrawCallable = httpsCallable(functions, 'redrawTestPaperDiagram')
const rebuildTableCallable = httpsCallable(functions, 'rebuildTableFromImage')

// The product handling options, mirrored client-side so the review UI can render
// them without a round-trip. Kept in sync with diagramBrief.js. `rebuildsTable`
// marks the option that reconstructs the figure as an editable typed table
// (tableData) rather than producing/keeping an image.
export const DIAGRAM_HANDLING_OPTIONS = [
  { id: 'keep_original', label: 'Keep original image', generates: false },
  { id: 'clean_original', label: 'Clean original drawing', generates: false },
  { id: 'redraw', label: 'Redraw using AI', generates: true },
  { id: 'rebuild_as_table', label: 'Rebuild as table', generates: true, rebuildsTable: true },
  { id: 'replace', label: 'Replace with a better educational diagram', generates: true },
  { id: 'remove', label: 'Remove diagram and leave blank space', generates: false },
]

// Server has timeoutSeconds: 300; allow a small margin so a slow-but-valid
// generation completes and a real server error surfaces, rather than the client
// giving up first (and never letting the server's descriptive error through).
const REDRAW_TIMEOUT_MS = 310000

function messageFromError(error) {
  const code = error?.code || ''
  const msg = error?.message || ''
  if (code.includes('resource-exhausted')) {
    return 'Monthly diagram limit reached. Upgrade your plan or try again next month.'
  }
  if (code.includes('permission-denied')) {
    return 'Diagram tools are only available to approved teachers.'
  }
  if (code.includes('unauthenticated')) {
    return 'Please sign in to redraw diagrams.'
  }
  if (code.includes('failed-precondition') && /not configured/i.test(msg)) {
    return 'Diagram generation is not available — admin needs to configure the image key.'
  }
  // A bare "internal" (no descriptive message) means the function instance was
  // aborted by the platform — a slow image generation that ran past the timeout
  // or ran out of memory — so the server's own try/catch never got to attach a
  // reason. Surface something actionable instead of the cryptic word "internal".
  if (code.includes('internal') || !msg || msg.toLowerCase() === 'internal') {
    return 'The diagram service took too long or hit an error. Try again, or keep / clean the original image instead.'
  }
  return msg || 'Could not process that diagram. Please try again.'
}

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

function messageFromTableError(error) {
  const code = error?.code || ''
  const msg = error?.message || ''
  if (code.includes('resource-exhausted')) {
    return 'Monthly limit reached. Try again next month or upgrade your plan.'
  }
  if (code.includes('permission-denied')) {
    return 'Table tools are only available to approved teachers.'
  }
  if (code.includes('unauthenticated')) {
    return 'Please sign in to rebuild tables.'
  }
  // The server attaches a helpful, specific reason for these (e.g. "No table
  // could be read from this figure. Try Redraw…") — surface it as-is.
  if (code.includes('failed-precondition') && msg) return msg
  if (code.includes('internal') || !msg || msg.toLowerCase() === 'internal') {
    return 'Could not rebuild this table automatically. Please choose another option below.'
  }
  return msg || 'Could not rebuild this table. Please try again.'
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
