// src/features/notes/lib/noteImport.js
//
// Client orchestrator for Notes document import. Reuses the quiz importer's
// DOCX/PDF extraction primitives and image-upload helper; calls the
// structureImportedNote / ocrNotePages callables; resolves [[IMAGE:id]] markers
// to uploaded Storage URLs. Returns { blocks, warnings } for the editor.
//
// Pure helpers (buildDocumentTextWithMarkers, resolveImageBlocks, IMAGE_MARKER_RE)
// live in noteImportCore.js so they can be unit-tested under plain node.

import { extractDocx, extractPdf, loadPdfDocument, renderPdfPageSnapshot } from '../../../services/quizImport/documentQuizImporter.js'
import { uploadImportedAssets } from '../../../utils/quizDocumentImport.js'
import { structureImportedNote, ocrNotePages } from '../../../utils/aiAssistant'
import { coerceStudyBlocks } from './studySchema'
import { storage } from '../../../firebase/config'
import { buildDocumentTextWithMarkers, resolveImageBlocks } from './noteImportCore.js'

export { IMAGE_MARKER_RE, buildDocumentTextWithMarkers, resolveImageBlocks } from './noteImportCore.js'

const OCR_BATCH = 6      // pages per ocrNotePages call (server caps at 8)
const MAX_OCR_PAGES = 40 // bound total scanned pages per import
// Global so .replace() strips EVERY marker (not just the first).
const IMAGE_MARKER_GLOBAL_RE = /\[\[IMAGE:[A-Za-z0-9_-]+\]\]/g

// Collect the flat {id: asset} map referenced by markers in `blocks`.
function assetMapFor(extractedBlocks) {
  const map = {}
  for (const b of extractedBlocks || []) {
    for (const a of b?.assets || []) if (a?.id) map[a.id] = a
  }
  return map
}

// Release object URLs created by the extractor so they don't leak for the tab's
// lifetime once the import is done (success or failure).
function revokeAssets(assets) {
  for (const a of Object.values(assets || {})) {
    if (a?.objectUrl) { try { URL.revokeObjectURL(a.objectUrl) } catch { /* ignore */ } }
  }
}

async function extractTextNote(file) {
  const isPdf = /\.pdf$/i.test(file.name)
  const extracted = isPdf ? await extractPdf(file) : await extractDocx(file)
  const documentText = buildDocumentTextWithMarkers(extracted.blocks)
  return { documentText, assets: assetMapFor(extracted.blocks), warnings: extracted.warnings || [] }
}

async function ocrScannedPdf(file, onProgress) {
  const { pdf } = await loadPdfDocument(file)
  const total = Math.min(pdf.numPages, MAX_OCR_PAGES)
  const pageImages = []
  for (let n = 1; n <= total; n++) {
    onProgress?.({ phase: 'rendering', current: n, total })
    const page = await pdf.getPage(n)
    const asset = await renderPdfPageSnapshot(page, n, [])
    if (asset?.blob) {
      const dataUrl = await blobToDataUrl(asset.blob)
      pageImages.push({ pageNumber: n, dataUrl })
    }
  }
  let text = ''
  let done = 0
  for (let i = 0; i < pageImages.length; i += OCR_BATCH) {
    const batch = pageImages.slice(i, i + OCR_BATCH)
    const res = await ocrNotePages({ pages: batch })
    text += '\n\n' + (res.text || '')
    done += batch.length
    onProgress?.({ phase: 'reading', current: done, total: pageImages.length })
  }
  return { documentText: text.trim(), assets: {}, warnings: [] }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = reject
    r.readAsDataURL(blob)
  })
}

// Heuristic: a PDF with almost no extractable text is "scanned". Extract first,
// fall back to OCR when the text is too thin.
async function looksScanned(file) {
  try {
    const extracted = await extractPdf(file)
    const txt = buildDocumentTextWithMarkers(extracted.blocks).replace(IMAGE_MARKER_GLOBAL_RE, '').trim()
    return txt.length < 200
  } catch {
    return true
  }
}

/**
 * Import a document into study blocks.
 * @param {{ kind:'paste'|'file', file?:File, text?:string, uid:string, onProgress?:Function }} args
 * @returns {Promise<{ blocks: object[], warnings: string[] }>}
 */
export async function importNoteDocument({ kind, file, text, uid, onProgress }) {
  let documentText = ''
  let assets = {}
  let warnings = []

  try {
    if (kind === 'paste') {
      documentText = String(text || '')
    } else if (file) {
      const isScanned = /\.pdf$/i.test(file.name) && (await looksScanned(file))
      const r = isScanned ? await ocrScannedPdf(file, onProgress) : await extractTextNote(file)
      documentText = r.documentText; assets = r.assets; warnings = r.warnings
    }

    if (!documentText || documentText.trim().length < 80) {
      throw new Error('Not enough readable text was found in this document.')
    }

    const structured = await structureImportedNote({ fileName: file?.name || 'pasted text', documentText })
    warnings = warnings.concat(structured.warnings || [])

    // Resolve any [[IMAGE]] blocks the model emitted.
    const referenced = new Set(structured.blocks.filter(b => b?.type === 'image' && b.assetRef).map(b => b.assetRef))
    let urlById = new Map()
    if (referenced.size > 0 && Object.keys(assets).length > 0) {
      urlById = await uploadImportedAssets({
        storage, uid, assets, assetIds: [...referenced], kindSlug: 'note',
        sourceFileName: file?.name || '',
      })
    }
    const resolved = resolveImageBlocks(structured.blocks, urlById)
    return { blocks: coerceStudyBlocks(resolved), warnings }
  } finally {
    revokeAssets(assets)
  }
}
