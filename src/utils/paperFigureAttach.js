/**
 * paperFigureAttach — attaches the printed figures/maps the past-paper
 * importer LOCATED to their passage blocks as real images.
 *
 * The server-side importer (functions/teacherTools/pastPaperImport.js) has no
 * rasteriser, so it cannot crop the figure itself — it returns `figures` in
 * the import report ({passageId, sourcePage, box}) and persists the same
 * `figureMeta` on each quiz passage. This module closes the loop in the
 * browser, where the uploaded paper *is* available:
 *
 *   1. plan   — planFigureAttachments (paperFigureAttachCore.js, pure +
 *               node-tested): pick each figure's uploaded asset + page.
 *   2. crop   — rasterise that page (pdfjs for a PDF, <img> for a photo),
 *               crop the reported box (whole page when no box).
 *   3. upload — store the crop under the paper's Storage folder and write its
 *               URL onto the matching passage in the quiz doc — exactly what
 *               the quiz runner renders (`passage.imageUrl`).
 *
 * Every step is best-effort per figure: one failed crop never sinks the
 * import or the other figures. The caller reports attached/failed counts.
 */

import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { getDownloadURL, ref as storageRef } from 'firebase/storage'
import { uploadBytes } from '../firebase/attestedStorage'
import { db, storage } from '../firebase/config'
import { resolvePaperUrl } from './pastPapers.js'
import { loadPdfDocument } from '../components/quiz/documentQuizImporter.js'
import { planFigureAttachments, mergeFigureUrlsIntoPassages, padAndClampBox } from './paperFigureAttachCore.js'

export { planFigureAttachments, mergeFigureUrlsIntoPassages, padAndClampBox }

// OCR-friendly render width for a PDF page; crops stay legible at print size.
const PAGE_TARGET_WIDTH = 1500

async function fileForAsset(asset, localFiles) {
  // Prefer the in-memory File from this session's upload; otherwise download
  // the asset back from Storage (re-runs on an old paper have no local File).
  const local = localFiles && asset?.path ? localFiles[asset.path] : null
  if (local) return local
  const url = await resolvePaperUrl(asset.path)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not download ${asset.path} (${res.status})`)
  const blob = await res.blob()
  return new File([blob], asset.filename || 'asset', { type: asset.contentType || blob.type })
}

function loadImageEl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not decode the page image.'))
    img.src = url
  })
}

function cropCanvas(sourceCanvasOrImg, W, H, box) {
  const sx = box ? Math.max(0, Math.round(box.x * W)) : 0
  const sy = box ? Math.max(0, Math.round(box.y * H)) : 0
  const sw = box ? Math.max(1, Math.min(W - sx, Math.round(box.w * W))) : W
  const sh = box ? Math.max(1, Math.min(H - sy, Math.round(box.h * H))) : H
  const out = document.createElement('canvas')
  out.width = sw
  out.height = sh
  const ctx = out.getContext('2d', { alpha: false })
  ctx.drawImage(sourceCanvasOrImg, sx, sy, sw, sh, 0, 0, sw, sh)
  return out
}

function canvasToJpegBlob(canvas, quality = 0.87) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not encode the figure crop.'))), 'image/jpeg', quality)
  })
}

async function renderFigureCrop(item, localFiles, pdfCache) {
  const { source, page } = item
  // Automatic crop process (Phase 9): pad the AI-detected box outward a
  // little before cropping so an arrowhead, axis, or label sitting right at
  // the reported edge isn't sliced off. A missing box (whole-page figure)
  // stays null — nothing to pad.
  const box = item.box ? padAndClampBox(item.box) : null
  if (source.kind === 'pdf') {
    // Load (and cache) the PDF once for all figures on this paper. The cache
    // holds the PROMISE (assigned synchronously) so concurrent callers can
    // never race a second decode of the same document.
    if (!pdfCache.promise) {
      pdfCache.promise = (async () => {
        const file = await fileForAsset(source.asset, localFiles)
        const { pdf } = await loadPdfDocument(file)
        return pdf
      })()
    }
    const pdf = await pdfCache.promise
    if (page > pdf.numPages) throw new Error(`Figure page ${page} is beyond the PDF's ${pdf.numPages} pages.`)
    const pdfPage = await pdf.getPage(page)
    const base = pdfPage.getViewport({ scale: 1 })
    const scale = Math.min(2, Math.max(1, PAGE_TARGET_WIDTH / base.width))
    const viewport = pdfPage.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d', { alpha: false })
    await pdfPage.render({ canvasContext: ctx, viewport }).promise
    return canvasToJpegBlob(cropCanvas(canvas, canvas.width, canvas.height, box))
  }
  // A photographed page: crop the uploaded image directly.
  const file = await fileForAsset(source.asset, localFiles)
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImageEl(url)
    const W = img.naturalWidth || img.width
    const H = img.naturalHeight || img.height
    if (!W || !H) throw new Error('Page image had no readable dimensions.')
    return canvasToJpegBlob(cropCanvas(img, W, H, box))
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Crop + upload + persist every located figure onto its quiz passage.
 * Best-effort per figure; returns {attached, failed, skipped} counts so the
 * studio can tell the admin exactly what happened (never silent).
 */
export async function attachPaperFigures({ uid, paperId, quizId, figures, assets, localFiles }) {
  const { plan, skipped } = planFigureAttachments(figures, assets)
  if (!plan.length) return { attached: 0, failed: 0, skipped: skipped.length }

  const pdfCache = {}
  const attachedById = {}
  let failed = 0
  for (const item of plan) {
    try {
      const blob = await renderFigureCrop(item, localFiles || {}, pdfCache)
      const path = `papers/${uid}/${paperId}/figures/${item.passageId}-${Date.now().toString(36)}.jpg`
      await uploadBytes(storageRef(storage, path), blob, { contentType: 'image/jpeg' })
      const url = await getDownloadURL(storageRef(storage, path))
      attachedById[item.passageId] = {
        url,
        alt: item.title || `Figure from page ${item.page} of the paper`,
      }
    } catch (err) {
      console.warn('[paperFigureAttach] figure attach failed', item.passageId, err?.message)
      failed += 1
    }
  }

  const attached = Object.keys(attachedById).length
  if (attached) {
    // Rewrite the quiz doc's passages array with the fresh figure URLs.
    const quizRef = doc(db, 'quizzes', quizId)
    const snap = await getDoc(quizRef)
    const passages = Array.isArray(snap.data()?.passages) ? snap.data().passages : []
    await setDoc(quizRef, {
      passages: mergeFigureUrlsIntoPassages(passages, attachedById),
      updatedAt: serverTimestamp(),
    }, { merge: true })
  }
  return { attached, failed, skipped: skipped.length }
}
