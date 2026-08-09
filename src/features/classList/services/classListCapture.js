/**
 * classListCapture — the browser side of photographing a class list.
 *
 * Camera/gallery input, the image work a phone photograph needs before it is
 * worth sending (rotate, downscale, contrast), the content digest that catches
 * the same page picked twice, and the call to the extraction function.
 *
 * The DECISIONS about the pages — order, overlap, repeats, what to do with an
 * unreadable one — live in src/utils/captureSessionCore.js, which is pure and
 * tested. This file is the part that needs a canvas.
 *
 * TWO CONSTRAINTS SHAPE EVERYTHING HERE, and both come from the phones this
 * runs on rather than from the feature:
 *
 *   A photograph off a modern phone camera is 3–8 MB. Sending six of those
 *   over a Zambian mobile connection is minutes of upload the teacher pays
 *   for. Every page is downscaled to a long edge of 1600px and re-encoded as
 *   JPEG before it leaves the device — enough to read hand-writing from,
 *   roughly a twentieth of the bytes.
 *
 *   The pages are held in memory until the teacher finishes, so an object URL
 *   is revoked the moment its page is replaced or removed. A six-page session
 *   of un-revoked full-size bitmaps is how a low-cost Android tab runs out of
 *   memory mid-capture.
 */

import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../../../firebase/config'

// us-central1, where every HTTP/callable function in this project lives (the
// africa-south1 region is for Firestore-TRIGGERED functions only).
const functions = getFunctions(app, 'us-central1')

/** The long edge, in pixels, a page is downscaled to before upload. */
export const CAPTURE_LONG_EDGE = 1600
/** JPEG quality. High enough for pencil on ruled paper; a tenth of the bytes of PNG. */
const CAPTURE_QUALITY = 0.82
/** Pages per extraction call — must match MAX_PAGES_PER_CALL on the server. */
export const PAGES_PER_EXTRACTION_CALL = 6

export const ACCEPTED_CAPTURE_TYPES = 'image/*,application/pdf'

let pageCounter = 0
export function nextPageId() {
  pageCounter += 1
  return `page-${Date.now().toString(36)}-${pageCounter}`
}

/**
 * A short content digest of an image, for "is this the same photograph again".
 *
 * Deliberately a hash of the DOWNSCALED, re-encoded bytes rather than of the
 * original file: two shots of the same page are never byte-identical
 * originals, and the file name and size a gallery reports are not stable
 * either. This catches the case that actually happens — the same file picked
 * twice from the gallery — and the content comparison in captureSessionCore
 * catches the re-photographed page.
 */
export async function digestOf(blob) {
  const buffer = await blob.arrayBuffer()
  if (!globalThis.crypto?.subtle) {
    // Older WebViews with no SubtleCrypto: fall back to size + a sample of the
    // bytes. Weaker, and only ever used to spot an EXACT repeat, which the
    // content comparison would catch anyway.
    const view = new Uint8Array(buffer)
    let sum = 0
    for (let i = 0; i < view.length; i += 997) sum = (sum * 31 + view[i]) >>> 0
    return `fallback-${buffer.byteLength}-${sum.toString(36)}`
  }
  const hash = await globalThis.crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(hash)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('This file could not be opened as an image.'))
    img.src = src
  })
}

/**
 * Prepare one captured page for review and upload.
 *
 * @param {File|Blob} file
 * @param {object} [options]
 * @param {number} [options.rotation]  degrees clockwise: 0 | 90 | 180 | 270
 * @param {boolean} [options.enhance]  raise contrast for pencil on grey paper
 * @returns {Promise<{ blob, dataUrl, previewUrl, width, height, digest }>}
 */
export async function preparePageImage(file, { rotation = 0, enhance = false } = {}) {
  const sourceUrl = URL.createObjectURL(file)
  try {
    const img = await loadImage(sourceUrl)
    const turned = rotation === 90 || rotation === 270
    const srcW = img.naturalWidth || img.width
    const srcH = img.naturalHeight || img.height
    const longEdge = Math.max(srcW, srcH)
    const scale = longEdge > CAPTURE_LONG_EDGE ? CAPTURE_LONG_EDGE / longEdge : 1
    const drawW = Math.round(srcW * scale)
    const drawH = Math.round(srcH * scale)

    const canvas = document.createElement('canvas')
    canvas.width = turned ? drawH : drawW
    canvas.height = turned ? drawW : drawH
    const ctx = canvas.getContext('2d')
    // A white base: a JPEG has no transparency, and a PNG with one would
    // otherwise composite onto black and lose the writing entirely.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.translate(canvas.width / 2, canvas.height / 2)
    if (rotation) ctx.rotate((rotation * Math.PI) / 180)
    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH)

    if (enhance) applyContrast(ctx, canvas)

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', CAPTURE_QUALITY))
    if (!blob) throw new Error('This page could not be prepared for upload.')
    const dataUrl = canvas.toDataURL('image/jpeg', CAPTURE_QUALITY)
    return {
      blob,
      dataUrl,
      previewUrl: URL.createObjectURL(blob),
      width: canvas.width,
      height: canvas.height,
      digest: await digestOf(blob),
    }
  } finally {
    URL.revokeObjectURL(sourceUrl)
  }
}

/**
 * A gentle contrast lift, for pencil on grey exercise-book paper.
 *
 * Deliberately not a threshold to pure black and white: a threshold that gets
 * its cut point wrong erases a whole column of faint hand-writing, and there
 * is no way to tell from the result that it did. This only stretches the
 * existing range, so the worst case is a page that looks much as it did.
 */
function applyContrast(ctx, canvas) {
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = image.data
  const factor = 1.35
  const intercept = 128 * (1 - factor)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.min(255, Math.max(0, data[i] * factor + intercept))
    data[i + 1] = Math.min(255, Math.max(0, data[i + 1] * factor + intercept))
    data[i + 2] = Math.min(255, Math.max(0, data[i + 2] * factor + intercept))
  }
  ctx.putImageData(image, 0, 0)
}

/**
 * Render every page of a PDF to an image, so an emailed or scanned class list
 * enters the same review as a photograph.
 *
 * Via the shared `loadPdfjs()` rather than a direct import: that loader exists
 * because the module Worker PDF.js reaches for by default cannot start on the
 * older Android System WebViews a large share of this product's teachers run,
 * and it fails in a way that looks like a broken file rather than a broken
 * worker. It is lazily imported there too, so a teacher photographing pages
 * never pays for it.
 */
export async function pdfToPageImages(file, { maxPages = 20 } = {}) {
  const { loadPdfjs } = await import('../../../utils/pdfjsLoader.js')
  const pdfjs = await loadPdfjs()

  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  const out = []
  const count = Math.min(doc.numPages, maxPages)
  for (let n = 1; n <= count; n += 1) {
    const page = await doc.getPage(n)
    const base = page.getViewport({ scale: 1 })
    const scale = CAPTURE_LONG_EDGE / Math.max(base.width, base.height)
    const viewport = page.getViewport({ scale: Math.min(scale, 3) })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport }).promise
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', CAPTURE_QUALITY))
    out.push({
      blob,
      dataUrl: canvas.toDataURL('image/jpeg', CAPTURE_QUALITY),
      previewUrl: URL.createObjectURL(blob),
      width: canvas.width,
      height: canvas.height,
      digest: await digestOf(blob),
    })
  }
  return { images: out, totalPages: doc.numPages, truncated: doc.numPages > count }
}

/**
 * Send the captured pages for reading, in batches the callable accepts.
 *
 * `onProgress` is called after every batch, because six pages over a slow
 * connection is a minute of waiting and a progress bar that only knows "busy"
 * is a progress bar a teacher assumes has hung.
 *
 * A batch that FAILS marks only its own pages as failed and the remaining
 * batches still run — losing five readable pages because the third one timed
 * out is a worse outcome than reporting one unreadable page.
 */
export async function extractClassListPages(pages, { onProgress } = {}) {
  const callable = httpsCallable(functions, 'extractClassListPages', { timeout: 240000 })
  const results = new Map()
  let done = 0

  for (let i = 0; i < pages.length; i += PAGES_PER_EXTRACTION_CALL) {
    const batch = pages.slice(i, i + PAGES_PER_EXTRACTION_CALL)
    try {
      const response = await callable({
        pages: batch.map((p) => ({ pageNumber: p.position, dataUrl: p.dataUrl })),
      })
      for (const page of (response.data?.pages || [])) {
        results.set(page.pageNumber, page)
      }
      for (const rejected of (response.data?.rejectedPages || [])) {
        results.set(rejected.pageNumber, {
          pageNumber: rejected.pageNumber,
          status: 'failed',
          note: 'This page could not be sent as an image.',
          rows: [],
        })
      }
    } catch (err) {
      console.warn('[classListCapture] extraction batch failed', err)
      for (const page of batch) {
        results.set(page.position, {
          pageNumber: page.position,
          status: 'failed',
          note: err?.message || 'This page could not be read.',
          rows: [],
        })
      }
    }
    done += batch.length
    onProgress?.({ done, total: pages.length })
  }

  return pages.map((page) => {
    const result = results.get(page.position)
    return {
      ...page,
      status: result?.status || 'failed',
      extractionNote: result?.note || null,
      rows: result?.rows || [],
    }
  })
}
