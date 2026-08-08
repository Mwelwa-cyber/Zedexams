/**
 * paperPageProvider — renders single pages of an uploaded past paper as
 * images, on demand, for the Quiz Editor's "Crop from page" flow.
 *
 * The editor knows which page a question is printed on (`question.sourcePage`,
 * importer-set) and which paper the quiz came from (`quiz.sourcePastPaperId` /
 * `quiz.linkedPaperId`). This module closes the gap: given the paper id and a
 * page number it loads the paper's uploaded assets, rasterises the requested
 * page (pdf.js for a PDF, the photo itself for page images) and returns a URL
 * ImageCropModal can display — so the admin crops the real picture out of the
 * source paper without re-running the import.
 *
 * Everything is lazy + cached per provider instance: the paper doc and the
 * PDF are fetched once, each rendered page once. dispose() revokes every
 * object URL the provider created (never the photo download URLs).
 *
 * Source selection reuses the figure-attach pass's pure rules
 * (pickPaperPageSource): first paper-role PDF wins; otherwise page N is the
 * Nth paper-role image; mark-scheme assets are never used.
 */

import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { resolvePaperUrl } from './pastPapers.js'
import { pickPaperPageSource } from './paperFigureAttachCore.js'

// Match the figure-attach pass's OCR-friendly render width so a crop taken
// here has the same quality as an automatically attached one.
const PAGE_TARGET_WIDTH = 1500

export function createPaperPageProvider(paperId) {
  let paperPromise = null
  let pdfPromise = null
  const pagePromises = new Map() // pageNumber -> Promise<{ url, revoke }>
  let disposed = false

  function loadPaper() {
    if (!paperPromise) {
      paperPromise = (async () => {
        const snap = await getDoc(doc(db, 'pastPapers', paperId))
        if (!snap.exists()) throw new Error('The source paper could not be found.')
        return { id: snap.id, ...snap.data() }
      })()
    }
    return paperPromise
  }

  function loadPdf(asset) {
    if (!pdfPromise) {
      pdfPromise = (async () => {
        const url = await resolvePaperUrl(asset.path)
        const res = await fetch(url)
        if (!res.ok) throw new Error(`Could not download the paper PDF (${res.status}).`)
        const blob = await res.blob()
        const file = new File([blob], asset.filename || 'paper.pdf', { type: 'application/pdf' })
        // Reuse the import pipeline's pdf.js loader (worker config included).
        const { loadPdfDocument } = await import('../components/quiz/documentQuizImporter.js')
        const { pdf } = await loadPdfDocument(file)
        return pdf
      })()
    }
    return pdfPromise
  }

  async function renderPage(pageNumber) {
    const paper = await loadPaper()
    const source = pickPaperPageSource(paper.assets, pageNumber)
    // Legacy papers store the PDF at paper.pdfPath rather than in assets[].
    if (!source && paper.pdfPath) {
      return renderPdfPage({ path: paper.pdfPath, filename: 'paper.pdf' }, pageNumber)
    }
    if (!source) {
      throw new Error(`The paper has no uploaded source for page ${pageNumber}.`)
    }
    if (source.kind === 'pdf') return renderPdfPage(source.asset, pageNumber)
    // A photographed page — the Storage download URL displays directly (the
    // bucket's CORS config already allows canvas-readable loads; the crop
    // modal loads it via loadCorsImage).
    const url = await resolvePaperUrl(source.asset.path)
    return { url, revoke: false }
  }

  async function renderPdfPage(asset, pageNumber) {
    const pdf = await loadPdf(asset)
    if (pageNumber > pdf.numPages) {
      throw new Error(`Page ${pageNumber} is beyond the PDF's ${pdf.numPages} pages.`)
    }
    const pdfPage = await pdf.getPage(pageNumber)
    const base = pdfPage.getViewport({ scale: 1 })
    const scale = Math.min(2, Math.max(1, PAGE_TARGET_WIDTH / base.width))
    const viewport = pdfPage.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d', { alpha: false })
    await pdfPage.render({ canvasContext: ctx, viewport }).promise
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not render the page image.'))), 'image/jpeg', 0.9)
    })
    return { url: URL.createObjectURL(blob), revoke: true }
  }

  return {
    /** Resolve page N of the paper to a displayable image URL (cached). */
    async getPageImage(pageNumber) {
      if (disposed) throw new Error('Page provider disposed.')
      const page = Number.parseInt(pageNumber, 10)
      if (!Number.isInteger(page) || page < 1) throw new Error('Invalid page number.')
      if (!pagePromises.has(page)) {
        const p = renderPage(page).catch(err => {
          // A failed render must not poison the cache — a retry re-renders.
          pagePromises.delete(page)
          throw err
        })
        pagePromises.set(page, p)
      }
      const { url } = await pagePromises.get(page)
      return url
    },

    /** Total page count of the source (PDF page count, or photo count). */
    async getPageCount() {
      const paper = await loadPaper()
      const source = pickPaperPageSource(paper.assets, 1)
      if (source?.kind === 'pdf' || (!source && paper.pdfPath)) {
        const pdf = await loadPdf(source?.asset || { path: paper.pdfPath, filename: 'paper.pdf' })
        return pdf.numPages
      }
      const assets = Array.isArray(paper.assets) ? paper.assets : []
      return assets.filter(a => a?.role !== 'mark-scheme' &&
        String(a?.contentType || '').toLowerCase().startsWith('image/')).length
    },

    /** Revoke every object URL this provider created. */
    dispose() {
      disposed = true
      for (const p of pagePromises.values()) {
        p.then(({ url, revoke }) => { if (revoke) URL.revokeObjectURL(url) }).catch(() => {})
      }
      pagePromises.clear()
    },
  }
}
