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

// The five product handling options, mirrored client-side so the review UI can
// render them without a round-trip. Kept in sync with diagramBrief.js.
export const DIAGRAM_HANDLING_OPTIONS = [
  { id: 'keep_original', label: 'Keep original image', generates: false },
  { id: 'clean_original', label: 'Clean original drawing', generates: false },
  { id: 'redraw', label: 'Redraw using AI', generates: true },
  { id: 'replace', label: 'Replace with a better educational diagram', generates: true },
  { id: 'remove', label: 'Remove diagram and leave blank space', generates: false },
]

// Server has timeoutSeconds: 120; allow a small margin so the server error
// surfaces rather than the client giving up first.
const REDRAW_TIMEOUT_MS = 130000

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
