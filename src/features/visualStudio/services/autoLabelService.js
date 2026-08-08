/**
 * autoLabelService — client wrapper for the `autoLabelDiagram` Cloud Function
 * (Visual Studio v2, spec 1C).
 *
 * Converts the working image to a bounded PNG data URL (the callable takes
 * base64, same as the OCR pipelines) and returns the server's proposals
 * verbatim: `{ parts, grounded, failed, lowConfidenceThreshold }`. Mapping
 * proposals onto canvas objects is the pure lib/autoLabelClient.js's job.
 *
 * Browser-only (canvas); kept in services/ so the rest of the feature folder
 * never imports Firebase directly.
 */

import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../../../firebase/config'
import { loadImage } from '../../../utils/imageEnhance'

const functions = getFunctions(app, 'us-central1')
// Server has timeoutSeconds: 120; small client margin so the server's own
// error surfaces rather than the client giving up first.
const autoLabelCallable = httpsCallable(functions, 'autoLabelDiagram', { timeout: 130000 })

// Longest side sent to the vision model. Detection needs far less than print
// resolution, and this keeps the payload well under the server's 5 MB cap.
const MAX_DETECT_SIDE = 1280

/**
 * Any image URL (Storage URL, blob:, or already a data URL) → a bounded PNG
 * data URL. The image comes from our CORS-configured bucket and loads
 * `crossOrigin="anonymous"`, so the canvas stays untainted (same contract as
 * the bake path).
 */
export async function imageUrlToDataUrl(imageUrl) {
  if (/^data:image\//i.test(String(imageUrl))) return String(imageUrl)
  const img = await loadImage(imageUrl)
  const natW = img.naturalWidth || img.width || 1024
  const natH = img.naturalHeight || img.height || 768
  const scale = Math.min(1, MAX_DETECT_SIDE / Math.max(natW, natH))
  const w = Math.max(1, Math.round(natW * scale))
  const h = Math.max(1, Math.round(natH * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)
  return canvas.toDataURL('image/png')
}

/**
 * Ask the server to propose labels for the diagram.
 * @returns {Promise<{ parts: Array, grounded: boolean, failed: boolean, lowConfidenceThreshold: number }>}
 */
export async function requestAutoLabels({
  imageUrl, subject = '', grade = '', topic = '', subtopic = '', existingWords = [],
} = {}) {
  const dataUrl = await imageUrlToDataUrl(imageUrl)
  const res = await autoLabelCallable({
    dataUrl,
    subject,
    grade: String(grade ?? ''),
    topic,
    subtopic,
    existingWords,
  })
  return res?.data || { parts: [], grounded: false, failed: true }
}
