import { unzipSync, strFromU8 } from 'fflate'
import { loadPdfjs } from '../../utils/pdfjsLoader.js'
import { assertFileSignature } from '../../utils/fileSignature.js'
import { createPassageSection, createStandaloneSection } from '../../utils/quizSections.js'
import {
  metadataFromText as buildImportMetadata,
  processImportedQuestionBlocks,
} from './documentQuizParserCore.js'
import { buildDocxTableBlocks } from './documentQuizTableBlocks.js'
import { reconcileSmartSectionOrder, shouldRunSmartImport } from './documentQuizReconcile.js'
import { regroupComprehensionSections } from '../../utils/comprehensionGrouping.js'
import { consolidateOptionImageRuns } from './documentQuizParagraphRuns.js'
import { importMarkupToRichHtml, importMarkupToOptionHtml } from './importRichText.js'
import {
  wrapFormattedPieces,
  fixLeadingStructuralTokens,
  formatTokensToHtml,
  formatTokensToInlineHtml,
  stripFormatTokens,
} from './importFormatTokens.js'
import { buildImportFormatWarnings } from './importFormatChecks.js'
import { subPartsFromText } from '../../utils/stimulusQuestion.js'
import { richTextToPlainText } from '../../utils/quizRichText.js'
import { structureImportedQuiz, structureScannedQuiz } from '../../utils/aiAssistant'
import { analyzePaperLayout } from '../../utils/testPaperDiagram'
import {
  isLikelyScannedPdf,
  runScannedImport,
  runImageImport,
  isImageImportFile,
  normalizeImportInput,
  IMAGE_IMPORT_EXTENSIONS,
  DEFAULT_DIAGRAM_HANDLING,
} from './scannedQuizImporter.js'

// Version stamp surfaced in the import summary panel ("importer 2026.07.21…")
// so a stale service-worker bundle is observable rather than silent — the
// exact failure mode of the 2026-07-21 "still not working" report: the fix
// was deployed but the browser kept running the old cached parser. Bump when
// the document parser's behaviour changes materially.
export const DOC_IMPORTER_VERSION = '2026.07.21i-flat-table'

export const QUIZ_DOCUMENT_ACCEPT = [
  '.doc',
  '.docx',
  '.pdf',
  ...IMAGE_IMPORT_EXTENSIONS.map(ext => `.${ext}`),
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/webp',
].join(',')

const IMAGE_MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

// The genuine byte formats an import may be, for magic-byte verification —
// PDF, legacy .doc (OLE) + .docx (ZIP), and the picture formats.
const IMPORT_ALLOWED_MIMES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/webp',
]

// ─── Core Patterns ───────────────────────────────────────────────────────────

const IMAGE_HINT_RE = /\b(diagram|figure|picture|image|graph|chart|map|shown|label|observe|study the|look at)\b/i

function makeImportId(prefix = 'import') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function cleanText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/([a-z0-9])([.?!:;])([A-Z])/g, '$1$2 $3')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function splitLines(text) {
  return cleanText(text)
    .split(/\r?\n/)
    .map(line => cleanText(line))
    .filter(Boolean)
}

function extensionFromPath(path = '') {
  return path.split('.').pop()?.toLowerCase() || ''
}

function normalizePath(path) {
  const parts = []
  path.split('/').forEach(part => {
    if (!part || part === '.') return
    if (part === '..') parts.pop()
    else parts.push(part)
  })
  return parts.join('/')
}

function resolveTarget(baseDir, target) {
  if (!target) return ''
  if (/^https?:\/\//i.test(target)) return ''
  if (target.startsWith('/')) return normalizePath(target.slice(1))
  return normalizePath(`${baseDir}/${target}`)
}

function parseXml(xmlText, fileName) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml')
  const parserError = doc.getElementsByTagName('parsererror')[0]
  if (parserError) throw new Error(`Could not parse ${fileName}.`)
  return doc
}

function elementsByLocalName(root, name) {
  return Array.from(root.getElementsByTagName('*')).filter(node => node.localName === name)
}

function descendantsByLocalName(root, name) {
  return Array.from(root.getElementsByTagName('*')).filter(node => node.localName === name)
}

function attr(node, name) {
  if (!node) return ''
  return node.getAttribute(name) || node.getAttribute(`r:${name}`) || ''
}

function parseRelationships(zipEntries, relPath, baseDir) {
  const relBytes = zipEntries[relPath]
  if (!relBytes) return new Map()

  const relationships = new Map()
  const doc = parseXml(strFromU8(relBytes), relPath)
  elementsByLocalName(doc, 'Relationship').forEach(rel => {
    const id = rel.getAttribute('Id')
    const target = rel.getAttribute('Target')
    if (!id || !target) return
    relationships.set(id, {
      id,
      type: rel.getAttribute('Type') || '',
      target,
      path: resolveTarget(baseDir, target),
    })
  })
  return relationships
}

function makeImageAsset(bytesOrBlob, sourcePath, contentType, warnings) {
  const extension = extensionFromPath(sourcePath)
  const mime = contentType || IMAGE_MIME[extension]
  if (!mime || !Object.values(IMAGE_MIME).includes(mime)) {
    warnings.push(`Unsupported image skipped: ${sourcePath || 'unknown image'}.`)
    return null
  }

  const blob = bytesOrBlob instanceof Blob
    ? bytesOrBlob
    : new Blob([bytesOrBlob], { type: mime })
  const objectUrl = URL.createObjectURL(blob)
  const id = makeImportId('quiz-image')

  return {
    id,
    blob,
    objectUrl,
    imageUrl: objectUrl,
    contentType: mime,
    extension: extension || mime.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg',
    fileName: `${id}.${extension || 'jpg'}`,
    sourcePath,
  }
}

// Read a run's direct formatting (w:rPr). Returns { b, i, u, hl, sup, sub }
// when the run carries at least one format, else null. Toggle properties may
// be explicitly off (<w:b w:val="0|false"/>); underline/highlight use
// w:val="none" for off. Only DIRECT run formatting is read — style-inherited
// formatting (e.g. a Heading style's bold) is document styling, not the
// intentional word-level emphasis exam questions refer to.
function runFormatFlags(run) {
  const rPr = Array.from(run.children || []).find(child => child.localName === 'rPr')
  if (!rPr) return null
  const children = Array.from(rPr.children || [])
  const readVal = element =>
    (element?.getAttribute('w:val') || element?.getAttribute('val') || '').toLowerCase()
  const onFlag = name => {
    const el = children.find(child => child.localName === name)
    if (!el) return false
    const val = readVal(el)
    return !(val === '0' || val === 'false' || val === 'none' || val === 'off')
  }
  const vertAlign = readVal(children.find(child => child.localName === 'vertAlign'))
  const formats = {
    b: onFlag('b'),
    i: onFlag('i'),
    u: onFlag('u'),
    hl: onFlag('highlight'),
    sup: vertAlign === 'superscript',
    sub: vertAlign === 'subscript',
  }
  return formats.b || formats.i || formats.u || formats.hl || formats.sup || formats.sub
    ? formats
    : null
}

function paragraphText(paragraph) {
  const pieces = []
  ;(function walk(node, formats) {
    Array.from(node?.childNodes || []).forEach(child => {
      if (child.nodeType !== 1) return
      // Property containers hold METADATA, not content. Critically,
      // <w:pPr><w:tabs><w:tab w:pos="…"/></w:tabs></w:pPr> defines a
      // tab-STOP position — descending into it made the 'tab' branch below
      // emit a phantom leading "\t" on every paragraph that declares tab
      // stops, which pushed the real "1\t…" / "A\t…" prefixes off line
      // start and silently broke question/option/answer detection for the
      // whole document.
      if (child.localName === 'pPr' || child.localName === 'rPr') return
      if (child.localName === 't') {
        if (child.textContent) pieces.push({ text: child.textContent, formats })
        return
      }
      if (child.localName === 'tab') {
        // Preserve a real tab so we can detect tab-separated question /
        // option formats (`1\tStem`, `A\tAnswer`) before cleanText() strips
        // them. Replaced with a space inside normalizeTabbedQuestionLine().
        pieces.push({ text: '\t', formats: null })
        return
      }
      if (child.localName === 'br' || child.localName === 'cr') {
        pieces.push({ text: '\n', formats: null })
        return
      }
      if (child.localName === 'r') {
        // A run carries its own formatting; its w:t descendants inherit it.
        walk(child, runFormatFlags(child))
        return
      }
      walk(child, formats)
    })
  })(paragraph, null)
  // wrapFormattedPieces emits [[b]]/[[u]]/… tokens around formatted words
  // (dropping whole-paragraph styling); fixLeadingStructuralTokens then frees
  // "1." / "A." prefixes of tokens so the parser regexes still match.
  const withTokens = fixLeadingStructuralTokens(wrapFormattedPieces(pieces))
  return normalizeTabbedQuestionLine(withTokens)
}

// PRISCA / ECZ Word docs lay out questions in a 2-column table-less format:
//   `1\tWhich of the following...`  (no `.` or `)` after the number)
//   `A\tDifferent flowers`         (no `.` or `)` after the letter)
//
// Without this rewrite, only questions whose stem ends with `?` survive
// (via QUESTION_NO_PUNCT_RE), so any "Name the joint shown below." style
// stem would be silently dropped. We promote the tab into a `.` so the
// existing QUESTION_RE / OPTION_RE patterns match unchanged.
function normalizeTabbedQuestionLine(text) {
  let normalized = String(text || '')
  // `1\t…` → `1. …`
  normalized = normalized.replace(/^(\d{1,3})\t/gm, '$1. ')
  // `A\t…` → `A. …` (only single capital A-D at line start)
  normalized = normalized.replace(/^([A-Da-d])\t/gm, '$1. ')
  return cleanText(normalized)
}

/**
 * Returns the paragraph style value (e.g. "Heading1", "Normal") or empty string.
 * Used to detect document headings set via Word styles.
 */
function paragraphStyle(paragraph) {
  const pStyle = descendantsByLocalName(paragraph, 'pStyle')[0]
  return pStyle?.getAttribute('w:val') || ''
}

function paragraphHasNumbering(paragraph) {
  return descendantsByLocalName(paragraph, 'numPr').length > 0
}

function paragraphImages(paragraph, relationships, zipEntries, warnings) {
  const seen = new Set()
  return descendantsByLocalName(paragraph, 'blip')
    .map(blip => {
      const relId = attr(blip, 'embed') || attr(blip, 'link')
      const rel = relationships.get(relId)
      if (!rel?.path) {
        warnings.push('An image relationship could not be resolved.')
        return null
      }
      if (seen.has(rel.path)) return null
      seen.add(rel.path)
      const bytes = zipEntries[rel.path]
      if (!bytes) {
        warnings.push(`An image file was missing: ${rel.path}.`)
        return null
      }
      return makeImageAsset(bytes, rel.path, IMAGE_MIME[extensionFromPath(rel.path)], warnings)
    })
    .filter(Boolean)
}

// Matches a cell whose text is JUST an option label (A/B/C/D with optional
// punctuation and surrounding whitespace). Used to attribute that cell's
// inline image to the right option slot — "A." | "(A)" | "A)" | "A:" | "A".
const CELL_OPTION_LABEL_RE = /^\(?([A-Da-d])\)?[.):-]?\s*$/

// Matches a cell whose text BEGINS with an option label followed by content.
// Used when teachers type "A. Apple" or "(A) An animal" inside a single cell.
const CELL_OPTION_PREFIX_RE = /^\(?([A-Da-d])\)?\s*[.):-]\s*\S/

function detectOptionLetterInCell(text) {
  const normalized = String(text || '').trim()
  if (!normalized) return ''
  const labelOnly = normalized.match(CELL_OPTION_LABEL_RE)
  if (labelOnly) return labelOnly[1].toUpperCase()
  const prefix = normalized.match(CELL_OPTION_PREFIX_RE)
  if (prefix) return prefix[1].toUpperCase()
  return ''
}

function tableCellContent(cell, relationships, zipEntries, warnings) {
  const parts = []
  const assets = []

  Array.from(cell?.children || []).forEach(child => {
    if (child.localName === 'p') {
      const text = paragraphText(child)
      if (text) parts.push(text)
      const paragraphAssets = paragraphImages(child, relationships, zipEntries, warnings)
      if (paragraphAssets.length) assets.push(...paragraphAssets)
      return
    }

    if (child.localName === 'tbl') {
      const nestedText = descendantsByLocalName(child, 't')
        .map(node => cleanText(node.textContent))
        .filter(Boolean)
        .join('\n')
      if (nestedText) parts.push(nestedText)
    }
  })

  if (!parts.length && !assets.length) {
    const fallbackText = descendantsByLocalName(cell, 't')
      .map(node => cleanText(node.textContent))
      .filter(Boolean)
      .join('\n')
    if (fallbackText) parts.push(fallbackText)
  }

  const text = parts.join('\n')

  return {
    text,
    assets,
    // Detected option letter (A-D) when this cell sits inside an option
    // column of an MCQ table. Empty string if the cell isn't an option cell.
    // Phase 3: lets buildDocxTableBlocks attribute the cell's image to the
    // right optionMedia[] slot instead of dumping it on the question stem.
    optionLetter: detectOptionLetterInCell(text),
  }
}

function tableRows(table, relationships, zipEntries, warnings) {
  return Array.from(table?.children || [])
    .filter(child => child.localName === 'tr')
    .map(row => ({
      cells: Array.from(row.children || [])
        .filter(child => child.localName === 'tc')
        .map(cell => tableCellContent(cell, relationships, zipEntries, warnings)),
    }))
}

export async function extractDocx(file) {
  const warnings = []
  const buffer = await file.arrayBuffer()
  const zipEntries = unzipSync(new Uint8Array(buffer))
  const documentBytes = zipEntries['word/document.xml']

  if (!documentBytes) {
    throw new Error('This .docx file does not contain a readable Word document body.')
  }

  const doc = parseXml(strFromU8(documentBytes), 'word/document.xml')
  const body = elementsByLocalName(doc, 'body')[0]
  const relationships = parseRelationships(zipEntries, 'word/_rels/document.xml.rels', 'word')
  const blocks = []
  const imageAssets = []

  Array.from(body?.children || []).forEach(child => {
    if (child.localName === 'p') {
      const assets = paragraphImages(child, relationships, zipEntries, warnings)
      imageAssets.push(...assets)
      const text = paragraphText(child)
      const style = paragraphStyle(child)
      const isHeading = /^heading\d*$/i.test(style)
      if (text || assets.length) {
        blocks.push({
          text,
          assets,
          source: 'docx',
          numberedList: paragraphHasNumbering(child),
          // Expose Word heading style so the parser can use it as a section signal
          headingStyle: isHeading ? style.toLowerCase() : null,
          styleVal: style,
        })
      }
      return
    }

    if (child.localName === 'tbl') {
      const rows = tableRows(child, relationships, zipEntries, warnings)
      const { blocks: tableBlocks, warnings: tableWarnings } = buildDocxTableBlocks(rows)
      if (tableBlocks.length) {
        blocks.push(...tableBlocks)
        imageAssets.push(...tableBlocks.flatMap(block => block.assets || []))
      }
      if (tableWarnings.length) warnings.push(...tableWarnings)
    }
  })

  // Phase 4: detect non-table per-option image patterns. Teachers who lay out
  // image options as separate paragraphs ("A.\n<img>\nB.\n<img>\n…") instead
  // of a 5-cell table row used to lose the per-option attribution — every
  // image ended up on the question stem. consolidateOptionImageRuns walks
  // the linear block stream, recognises option-letter-only paragraphs that
  // either contain an inline image or are followed by an image-only
  // paragraph, and rewrites the preceding question block to be an
  // image-options block with optionAssetsByLetter.
  return { blocks: consolidateOptionImageRuns(blocks), imageAssets, warnings }
}

async function extractLegacyDoc(file) {
  const buffer = await file.arrayBuffer()
  const text = new TextDecoder('windows-1252').decode(buffer)
  const cleaned = text
    // Legacy .doc files contain raw byte sequences outside the printable
    // ASCII range; we keep tab/LF/CR (\x09/\x0a/\x0d) intact and normalise
    // everything else to a newline.
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x09\x0a\x0d\x20-\x7e]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
  return {
    blocks: splitLines(cleaned).map(line => ({ text: line, assets: [], source: 'doc' })),
    imageAssets: [],
    warnings: [
      'Legacy .doc extraction is best-effort. Save as .docx for better text and image extraction.',
      'Images from legacy .doc files could not be extracted in the browser.',
    ],
  }
}

function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.82) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('Could not render a PDF page image.')),
      type,
      quality,
    )
  })
}

/**
 * Groups PDF text items into logical lines using Y-coordinate proximity.
 * Threshold of 5 px handles slight baseline variations common in scanned
 * or mixed-font PDFs.
 *
 * Returns an array of `{ text, y }` rows sorted top-to-bottom. `y` is the
 * PDF-user-space Y of the baseline (origin bottom-left, Y up) — kept so
 * per-figure extraction (Phase 2) can map each figure to the question it
 * sits next to.
 */
function textContentToLineRecords(textContent) {
  const rows = []
  ;(textContent.items || []).forEach(item => {
    const str = cleanText(item.str)
    if (!str) return
    const transform = item.transform || []
    const x = Number(transform[4]) || 0
    const y = Math.round(Number(transform[5]) || 0)
    let row = rows.find(existing => Math.abs(existing.y - y) <= 5)
    if (!row) {
      row = { y, items: [] }
      rows.push(row)
    }
    row.items.push({ x, str })
  })

  return rows
    .sort((a, b) => b.y - a.y)
    .map(row => ({
      text: cleanText(row.items.sort((a, b) => a.x - b.x).map(item => item.str).join(' ')),
      y: row.y,
    }))
    .filter(row => row.text)
}

export async function renderPdfPageSnapshot(page, pageNumber, warnings) {
  try {
    const baseViewport = page.getViewport({ scale: 1 })
    const scale = Math.min(1.8, 1100 / baseViewport.width)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const context = canvas.getContext('2d', { alpha: false })
    await page.render({ canvasContext: context, viewport }).promise
    const blob = await canvasToBlob(canvas)
    return makeImageAsset(blob, `pdf-page-${pageNumber}.jpg`, 'image/jpeg', warnings)
  } catch (error) {
    warnings.push(`Could not create an image snapshot for PDF page ${pageNumber}.`)
    return null
  }
}

// ─── Phase 2: per-figure PDF image extraction ────────────────────────────────
//
// PDF.js exposes a content stream as an "operator list" — a flat array of
// (opcode, args) pairs. We walk it tracking the current transformation matrix
// (the same way a PDF renderer would) and, every time we hit a paint-image
// opcode, record the image's bounding box in PDF user space. Then we render
// the page once at high DPI and crop each figure out of the rendered canvas.
//
// Why crop from a rendered canvas instead of decoding the XObject directly?
//   1. Image XObjects come in many formats (JPEG, FlateDecode, JBIG2…) — PDF.js
//      already handles decoding when it renders, so we get correctness for
//      free.
//   2. Vector annotations or text labels drawn on top of the image are
//      preserved (labels of organs on a biology diagram, axis ticks on a graph).
//   3. We avoid needing access to PDF.js's private object store, which is
//      gated behind callbacks and not reliable across PDF.js versions.

// 6-element CTM: [a, b, c, d, e, f] represents
// | a  c  e |
// | b  d  f |
// | 0  0  1 |
const IDENTITY_CTM = [1, 0, 0, 1, 0, 0]

function multiplyCTM(left, right) {
  // PDF's `cm` operator postmultiplies: newCTM = left * right.
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ]
}

// Map the four corners of the unit square (0,0)-(1,1) through the given CTM
// and return the axis-aligned bounding box {x, y, width, height} in PDF
// user space. Handles rotated/sheared images correctly.
function ctmToPdfBbox(ctm) {
  const corners = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ].map(([u, v]) => ({
    x: ctm[0] * u + ctm[2] * v + ctm[4],
    y: ctm[1] * u + ctm[3] * v + ctm[5],
  }))
  const xs = corners.map(c => c.x)
  const ys = corners.map(c => c.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

/**
 * Walks the operator list and returns the PDF-user-space bounding box of
 * every painted image XObject. Tracks save/restore/transform so nested
 * `q ... cm ... Do ... Q` blocks resolve to the right CTM.
 *
 * `pdfjsLib` is needed to read `OPS.*` numeric constants — these are stable
 * across pdfjs versions but reading them from the module makes the code
 * future-proof.
 */
function collectImageBboxes(operatorList, pdfjsLib) {
  const { OPS } = pdfjsLib
  // The bottom of the stack is the initial CTM. We push a fresh copy on
  // `q` (save) and pop on `Q` (restore).
  const stack = [IDENTITY_CTM.slice()]
  const figures = []

  // PDF.js's operator list lazy-loads image data; we only care about ops
  // whose presence we can detect synchronously from the op codes.
  const PAINT_IMAGE_OPS = new Set([
    OPS.paintImageXObject,
    OPS.paintImageMaskXObject,
    OPS.paintJpegXObject,
    OPS.paintInlineImage,
    OPS.paintInlineImageXObject,
  ].filter(value => typeof value === 'number'))

  const fnArray = operatorList.fnArray || []
  const argsArray = operatorList.argsArray || []

  for (let index = 0; index < fnArray.length; index += 1) {
    const fn = fnArray[index]
    const args = argsArray[index]

    if (fn === OPS.save) {
      stack.push(stack[stack.length - 1].slice())
      continue
    }
    if (fn === OPS.restore) {
      if (stack.length > 1) stack.pop()
      continue
    }
    if (fn === OPS.transform) {
      // args is [a, b, c, d, e, f] — postmultiply the top of the stack.
      const top = stack[stack.length - 1]
      stack[stack.length - 1] = multiplyCTM(top, args)
      continue
    }
    if (PAINT_IMAGE_OPS.has(fn)) {
      const bbox = ctmToPdfBbox(stack[stack.length - 1])
      // Drop degenerate boxes — these slip in when a page initialises an
      // image XObject far off-canvas as a measurement pass.
      if (bbox.width > 4 && bbox.height > 4) {
        figures.push(bbox)
      }
    }
  }

  return figures
}

/**
 * Render the page at high DPI once, then crop each detected figure out of
 * the rendered canvas. Returns the rendered canvas alongside the per-figure
 * assets so the caller can also use the full-page snapshot as a fallback
 * (e.g. when no figures were detected but the page has a diagram hint).
 *
 * Returns { canvas, viewport, figureAssets } where each figureAsset is
 *   { asset, pdfY, pdfHeight }
 * with `pdfY` in PDF user-space coordinates (origin bottom-left, Y up) so
 * we can match figures to text lines by Y proximity.
 */
async function renderPageAndCropFigures(page, pdfjsLib, pageNumber, bboxes, warnings) {
  const baseViewport = page.getViewport({ scale: 1 })
  // Same scale heuristic as renderPdfPageSnapshot — bigger pages need to fit
  // a maximum-width budget so the cropped figures stay readable.
  const scale = Math.min(1.8, 1100 / baseViewport.width)
  const viewport = page.getViewport({ scale })

  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const context = canvas.getContext('2d', { alpha: false })

  try {
    await page.render({ canvasContext: context, viewport }).promise
  } catch (error) {
    warnings.push(`Could not render PDF page ${pageNumber} for figure extraction.`)
    return { canvas: null, viewport, figureAssets: [] }
  }

  const figureAssets = []
  for (let index = 0; index < bboxes.length; index += 1) {
    const bbox = bboxes[index]
    // Convert the four corners of the PDF-space bbox into viewport pixel
    // coordinates and recompute an axis-aligned pixel rect. Padding (4px)
    // gives us a small margin around the figure so labels right on the
    // edge don't get clipped.
    const pixelCorners = [
      viewport.convertToViewportPoint(bbox.x, bbox.y),
      viewport.convertToViewportPoint(bbox.x + bbox.width, bbox.y),
      viewport.convertToViewportPoint(bbox.x, bbox.y + bbox.height),
      viewport.convertToViewportPoint(bbox.x + bbox.width, bbox.y + bbox.height),
    ]
    const pxXs = pixelCorners.map(p => p[0])
    const pxYs = pixelCorners.map(p => p[1])
    const padding = 4
    const left = Math.max(0, Math.floor(Math.min(...pxXs)) - padding)
    const top = Math.max(0, Math.floor(Math.min(...pxYs)) - padding)
    const right = Math.min(canvas.width, Math.ceil(Math.max(...pxXs)) + padding)
    const bottom = Math.min(canvas.height, Math.ceil(Math.max(...pxYs)) + padding)
    const cropWidth = right - left
    const cropHeight = bottom - top
    if (cropWidth < 8 || cropHeight < 8) continue

    const figureCanvas = document.createElement('canvas')
    figureCanvas.width = cropWidth
    figureCanvas.height = cropHeight
    const figureContext = figureCanvas.getContext('2d', { alpha: false })
    figureContext.drawImage(
      canvas,
      left, top, cropWidth, cropHeight,
      0, 0, cropWidth, cropHeight,
    )

    let blob
    try {
      blob = await canvasToBlob(figureCanvas)
    } catch (error) {
      warnings.push(`Could not encode figure ${index + 1} on PDF page ${pageNumber}.`)
      continue
    }

    const asset = makeImageAsset(
      blob,
      `pdf-page-${pageNumber}-figure-${figureAssets.length + 1}.jpg`,
      'image/jpeg',
      warnings,
    )
    if (!asset) continue

    figureAssets.push({
      asset,
      // pdfY is the center of the figure in PDF user space — what we'll use
      // to find the nearest text line.
      pdfY: bbox.y + bbox.height / 2,
      pdfHeight: bbox.height,
    })
  }

  return { canvas, viewport, figureAssets }
}

/**
 * Pick the figure whose center is closest to `lineY` (in PDF user space) and
 * within a reasonable vertical window. Reuses don't fight each other: figures
 * already attached to a line are skipped via `consumed`. Returns null if no
 * figure is within range — the line stays text-only, which is the right
 * call (forced attachment causes more confusion than missing diagrams).
 */
function pickFigureForLineY(figures, lineY, consumed) {
  let best = null
  let bestDistance = Infinity
  for (let index = 0; index < figures.length; index += 1) {
    if (consumed.has(index)) continue
    const figure = figures[index]
    const distance = Math.abs(figure.pdfY - lineY)
    // Vertical proximity threshold: the figure must overlap the line's
    // neighbourhood. Half the figure's height plus a generous 40-pt buffer
    // covers the typical "diagram immediately above the question stem" case
    // without grabbing figures from the next question down the page.
    const reach = figure.pdfHeight / 2 + 40
    if (distance <= reach && distance < bestDistance) {
      best = index
      bestDistance = distance
    }
  }
  return best
}

// Load a PDF once and hand back both the document and the pdfjs module so
// callers can reuse them (scanned-detection + extraction) without decoding
// the file twice.
export async function loadPdfDocument(file) {
  const buffer = await file.arrayBuffer()
  const pdfjsLib = await loadPdfjs()
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise
  return { pdf, pdfjsLib }
}

// Cheap scanned-vs-native check: sum the extractable text on the first few
// pages. A scanned (image-only) paper yields ~0 characters even on text-heavy
// pages, so a tiny sample is enough and avoids reading every page twice.
async function detectScannedPdf(pdf) {
  const sampledPages = Math.min(pdf.numPages, 4)
  let sampledChars = 0
  for (let i = 1; i <= sampledPages; i += 1) {
    try {
      const page = await pdf.getPage(i)
      const textContent = await page.getTextContent()
      sampledChars += (textContent.items || [])
        .reduce((sum, item) => sum + String(item.str || '').trim().length, 0)
    } catch {
      // Unreadable page text only pushes us towards the scanned path.
    }
  }
  return { sampledPages, sampledChars, scanned: isLikelyScannedPdf({ sampledChars, sampledPages }) }
}

export async function extractPdf(file, preloaded = null) {
  const warnings = [
    'PDF import extracts text and attaches per-figure crops (or full-page snapshots when figures cannot be isolated) to diagram-style questions. Review cropping before publishing.',
  ]
  const { pdf } = preloaded || await loadPdfDocument(file)
  const pdfjsLib = preloaded?.pdfjsLib || await loadPdfjs()
  const blocks = []
  const imageAssets = []
  const maxSnapshotPages = 25

  if (pdf.numPages > maxSnapshotPages) {
    warnings.push(`Only the first ${maxSnapshotPages} PDF pages were considered for diagram snapshots.`)
  }

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const textContent = await page.getTextContent()
    const lineRecords = textContentToLineRecords(textContent)
    const pageText = lineRecords.map(record => record.text).join('\n')

    // Phase 2: try to pull individual image XObjects out of the page. If we
    // find any, we'll render once and crop each figure rather than baking
    // the whole page into a single JPEG. The pre-Phase-2 fallback (full-page
    // snapshot for diagram-hint pages) only kicks in if figure extraction
    // returns nothing — vector-only diagrams hit that path.
    let figureAssets = []
    let pageAsset = null

    if (pageNumber <= maxSnapshotPages) {
      let bboxes = []
      try {
        const operatorList = await page.getOperatorList()
        bboxes = collectImageBboxes(operatorList, pdfjsLib)
      } catch (error) {
        warnings.push(`Could not read the content stream of PDF page ${pageNumber}; falling back to page snapshot if needed.`)
      }

      if (bboxes.length > 0) {
        const rendered = await renderPageAndCropFigures(page, pdfjsLib, pageNumber, bboxes, warnings)
        figureAssets = rendered.figureAssets
        // Surface every cropped figure in the top-level asset list so the
        // save pass can upload them. The per-line picker below also points
        // at the same asset objects.
        figureAssets.forEach(figure => imageAssets.push(figure.asset))
      }

      // Fallback: page looks image-heavy but no XObjects (e.g. vector chart,
      // font-based diagram). Use the existing whole-page snapshot logic.
      if (figureAssets.length === 0) {
        const hasNoText = pageText.length < 50
        const hasImageHint = IMAGE_HINT_RE.test(pageText)
        if (hasNoText || hasImageHint) {
          pageAsset = await renderPdfPageSnapshot(page, pageNumber, warnings)
          if (pageAsset) imageAssets.push(pageAsset)
        }
      }
    }

    if (!lineRecords.length && (pageAsset || figureAssets.length > 0)) {
      // Image-only page. If we extracted figures, take the largest; otherwise
      // the whole-page snapshot. Either way, emit one block that the
      // question builder treats as an image-based question.
      const fallbackAsset = pageAsset
        ?? figureAssets.reduce((largest, candidate) =>
          !largest || candidate.pdfHeight > largest.pdfHeight ? candidate : largest, null)?.asset
      if (fallbackAsset) {
        blocks.push({
          text: '',
          assets: [fallbackAsset],
          pageAsset: fallbackAsset,
          pageNumber,
          source: 'pdf-image',
        })
        warnings.push(`PDF page ${pageNumber} looked image-based. Review the imported diagram question before publishing.`)
      }
      continue
    }

    // Attach each cropped figure to the text line whose Y sits closest to
    // it (within a vertical window). A figure that doesn't claim any line
    // still appears in imageAssets so it isn't lost.
    const consumed = new Set()
    lineRecords.forEach(record => {
      const figureIndex = figureAssets.length
        ? pickFigureForLineY(figureAssets, record.y, consumed)
        : null
      let lineAsset = null
      let attachedAssets = []
      if (figureIndex !== null && figureIndex !== undefined) {
        consumed.add(figureIndex)
        lineAsset = figureAssets[figureIndex].asset
        attachedAssets = [lineAsset]
      }
      // `pageAsset` is only set when we fell back to a whole-page snapshot;
      // in that case every line on the page shares it.
      blocks.push({
        text: record.text,
        assets: attachedAssets,
        pageAsset: lineAsset || pageAsset,
        pageNumber,
        source: 'pdf',
      })
    })
  }

  // Phase 5: same per-option image consolidation we run on DOCX blocks. A
  // PDF line that's just "A." with a figure attached (via Phase 2's Y-proximity
  // matching in pickFigureForLineY) folds into the preceding question stem
  // with optionAssetsByLetter, so the figures land on the right option's
  // optionMedia slot instead of all bunching onto the question.
  return { blocks: consolidateOptionImageRuns(blocks), imageAssets, warnings }
}

// Convert AI correctAnswer (number | "A"/"B" letter | option text) to a 0-based
// index against the option list. Defaults to 0 when nothing matches so the
// editor still renders an answer choice teachers can adjust.
function correctAnswerToIndex(value, options) {
  if (Number.isInteger(value)) return value
  const s = String(value || '').trim()
  if (!s) return 0
  if (/^[A-Da-d]$/.test(s)) return s.toUpperCase().charCodeAt(0) - 65
  const idx = options.findIndex(o => String(o).trim().toLowerCase() === s.toLowerCase())
  return idx >= 0 ? idx : 0
}

// Map a True/False answer (word, single letter, boolean, or 0/1 index) onto
// the fixed 0=True / 1=False option order the tf editor + runner expect.
// Defaults to True so a missing/odd answer still renders a selectable choice.
function trueFalseToIndex(value) {
  if (typeof value === 'boolean') return value ? 0 : 1
  if (Number.isInteger(value)) return value === 1 ? 1 : 0
  const s = String(value ?? '').trim().toLowerCase()
  if (s === 'false' || s === 'f' || s === 'b' || s === '1') return 1
  return 0
}

/* ── DOCX formatting-token conversion (deterministic path) ────────────────
 * extractDocx emits [[b]]/[[u]]/[[i]]/[[hl]]/[[sup]]/[[sub]] tokens around
 * words the Word document formatted (see importFormatTokens.js). After the
 * parser has done its structural work, these convert into the editor HTML the
 * sanitiser allows. Fields without tokens pass through completely unchanged,
 * so plain imports behave exactly as before. The smart-import path converts
 * its own tokens inside importMarkupToRichHtml, so its output never carries
 * tokens into these helpers (which then no-op on it). */

function convertQuestionFormatTokens(question) {
  if (!question || typeof question !== 'object') return question
  const next = { ...question }
  if (typeof question.text === 'string') next.text = formatTokensToHtml(question.text)
  if (typeof question.explanation === 'string') next.explanation = formatTokensToHtml(question.explanation)
  if (typeof question.sharedInstruction === 'string') next.sharedInstruction = formatTokensToHtml(question.sharedInstruction)
  if (Array.isArray(question.options)) {
    next.options = question.options.map(option =>
      typeof option === 'string' ? formatTokensToInlineHtml(option) : option,
    )
  }
  return next
}

function convertFormatTokensInSections(sections) {
  if (!Array.isArray(sections)) return sections
  return sections.map(section => {
    if (!section) return section
    if (section.kind === 'passage' && section.passage) {
      const passage = section.passage
      return {
        ...section,
        passage: {
          ...passage,
          // Titles render as plain text (h2), so tokens are stripped, not converted.
          title: typeof passage.title === 'string' ? stripFormatTokens(passage.title) : passage.title,
          instructions: typeof passage.instructions === 'string' ? formatTokensToHtml(passage.instructions) : passage.instructions,
          passageText: typeof passage.passageText === 'string' ? formatTokensToHtml(passage.passageText) : passage.passageText,
          questions: Array.isArray(passage.questions)
            ? passage.questions.map(convertQuestionFormatTokens)
            : passage.questions,
        },
      }
    }
    if (section.question) {
      return { ...section, question: convertQuestionFormatTokens(section.question) }
    }
    return section
  })
}

function convertFormatTokensInParts(parts) {
  if (!Array.isArray(parts)) return parts
  return parts.map(part => {
    if (!part || typeof part !== 'object') return part
    return {
      ...part,
      title: typeof part.title === 'string' ? stripFormatTokens(part.title) : part.title,
      instructions: typeof part.instructions === 'string' ? formatTokensToHtml(part.instructions) : part.instructions,
      example: typeof part.example === 'string' ? formatTokensToHtml(part.example) : part.example,
    }
  })
}

function aiQuestionToLocalOverrides(q) {
  const rawOptions = Array.isArray(q.options) && q.options.length ? q.options : ['', '', '', '']
  const type = ['mcq', 'truefalse', 'short_answer', 'diagram'].includes(q.type) ? q.type : (rawOptions.length >= 2 ? 'mcq' : 'short_answer')
  const isTrueFalse = type === 'truefalse'
  // mcq resolves the answer index against the ORIGINAL option text (before
  // markup conversion) so a text-matched correctAnswer still lines up; tf
  // stores a fixed two-option list with an index answer (0=True/1=False) — the
  // same shape the editor expects — so a smart-imported tf question lands with
  // its answer pre-selected instead of an unmatched "True"/"False" string.
  return {
    text: importMarkupToRichHtml(q.text || ''),
    options: isTrueFalse ? ['True', 'False'] : rawOptions.map(opt => importMarkupToOptionHtml(opt)),
    correctAnswer: type === 'mcq'
      ? correctAnswerToIndex(q.correctAnswer, rawOptions)
      : isTrueFalse
        ? trueFalseToIndex(q.correctAnswer)
        : (q.correctAnswer ?? ''),
    explanation: importMarkupToRichHtml(q.explanation || ''),
    type,
    detectedType: type,
    // Carry the printed question number into the editor so the structural
    // numbering analysis (missing/duplicate/out-of-order) can run on real
    // source numbers instead of a synthetic 1..N.
    sourceQuestionNumber: (() => {
      const n = Number(q.sourceQuestionNumber)
      return Number.isInteger(n) && n >= 1 && n <= 9999 ? n : null
    })(),
  }
}

// Recover crammed "(a) … (b) … (c) …" short-answer questions on import. A
// document/scan often collapses an instruction + lettered follow-ups into one
// question body (the Q18 bug); this splits any such STANDALONE short-answer /
// diagram section into an instruction stem + inline-blank sub-parts so it prints
// like the hand-fixed Q17. Passage sub-questions are already split per part, so
// they're left untouched. Questions that already carry subParts are skipped.
// Pure (operates on studio section objects) so it can run after every import
// variant — Word, text PDF, scanned PDF and pictures.
const SUBPART_SPLITTABLE_TYPES = new Set(['short_answer', 'short', 'fill', 'diagram'])
function splitStandaloneSubParts(sections) {
  if (!Array.isArray(sections)) return sections
  return sections.map(section => {
    if (!section || section.kind !== 'standalone' || !section.question) return section
    const q = section.question
    if (!SUBPART_SPLITTABLE_TYPES.has(q.type || 'mcq')) return section
    if (Array.isArray(q.subParts) && q.subParts.length) return section
    const split = subPartsFromText(richTextToPlainText(q.text))
    if (!split) return section
    const marks = split.subParts.reduce((sum, p) => sum + (Number(p.marks) || 0), 0)
    const note = 'Auto-split into lettered sub-parts on import — check the parts and fill in the marking answers.'
    return {
      ...section,
      question: {
        ...q,
        text: importMarkupToRichHtml(split.stem || ''),
        subParts: split.subParts,
        marks,
        correctAnswer: '',
        requiresReview: true,
        reviewNotes: [...(Array.isArray(q.reviewNotes) ? q.reviewNotes : []), note],
      },
    }
  })
}

function smartSectionsToLocal(aiSections) {
  return aiSections
    .map(section => {
      if (section.kind === 'passage') {
        const questions = (section.questions || []).map(q => aiQuestionToLocalOverrides(q))
        if (!questions.length) return null
        return createPassageSection({
          title: section.title || '',
          instructions: importMarkupToRichHtml(section.instructions || ''),
          passageText: importMarkupToRichHtml(section.passageText || ''),
          questions,
        })
      }
      const q = section.question
      if (!q || (!q.text && !(q.options || []).length)) return null
      return createStandaloneSection(aiQuestionToLocalOverrides(q))
    })
    .filter(Boolean)
}

// Count the questions a section list represents — passage sections own a
// list of sub-questions, standalone sections own exactly one. Used to compare
// the AI smart-import result against the deterministic parser so the AI can
// never silently drop questions (see the reconciliation in importQuizDocument).
function countSectionQuestions(sections = []) {
  return sections.reduce((total, section) => {
    if (section?.kind === 'passage') {
      return total + (section.passage?.questions?.length || 0)
    }
    return total + 1
  }, 0)
}

function rawTextFromExtracted(extracted) {
  return (extracted.blocks || [])
    .map(block => block.text || '')
    .filter(Boolean)
    .join('\n')
    .trim()
}

// Smart import — Gemini + Claude pipeline behind the structureImportedQuiz
// callable. Runs for both Word and PDF documents. PDF text is noisier (page
// numbers, broken layouts, OCR drift), but the smart-import prompts now
// normalise that noise AND emit fraction / vertical-arithmetic / inline-math /
// table markup that importRichText converts into real editor nodes — exactly
// the structure the deterministic parser flattens to plain text. The callable
// is daily-limited server-side, and any failure falls back to the local
// parser, so the worst case is "no worse than before".
// Is a smart-import failure worth one retry? Transient failures — the callable
// riding into its deadline on a long paper, a dropped connection, a slow AI
// response — usually succeed on a second try; hard failures (daily limit,
// permission, bad request) fail identically, so retrying just wastes time.
function isTransientSmartImportError(error) {
  const code = String(error?.code || '').toLowerCase()
  if (code) {
    if (/resource-exhausted|permission-denied|unauthenticated|invalid-argument|failed-precondition|not-found/.test(code)) return false
    if (/deadline|timeout|internal|unavailable|aborted|cancelled|unknown/.test(code)) return true
  }
  const message = String(error?.message || '').toLowerCase()
  if (/daily limit|usage limit|limit reached|sign in|permission|not allowed/.test(message)) return false
  // The friendly wrapper for a timed-out callable reads "taking longer than usual".
  return /taking longer|timed out|timeout|deadline|temporarily|try again|network|connection|unavailable/.test(message)
}

async function trySmartImport(extracted, file) {
  const documentText = rawTextFromExtracted(extracted)
  if (documentText.length < 120) return null
  const localDraft = (extracted.blocks || [])
    .slice(0, 60)
    .map(b => b.text)
    .filter(Boolean)
    .join('\n')
    .slice(0, 8000)
  const payload = {
    fileName: file.name,
    // Must match the server-side LIMITS.importDocumentText cap. A full
    // 60-question paper extracts to ~80K chars; slicing shorter silently
    // dropped the back half of the paper before the AI ever saw it.
    documentText: documentText.slice(0, 90000),
    localDraft,
  }

  // Two attempts, but only when the first failed FAST. The smart-import
  // callable can fail transiently (cold start, dropped connection) and a
  // quick retry recovers that. A failure that arrives after a long ride —
  // the callable's own deadline — will fail identically on a second try,
  // so retrying it just doubles the wait AND the provider spend for zero
  // benefit ("it keeps losing credits and nothing imports").
  const QUICK_FAILURE_MS = 30000
  let lastError = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const startedAt = Date.now()
    try {
      const ai = await structureImportedQuiz(payload)
      const aiSections = Array.isArray(ai.sections) ? ai.sections : []
      if (!aiSections.length) return null
      const localSections = smartSectionsToLocal(aiSections)
      if (!localSections.length) return null
      return { sections: localSections, warnings: Array.isArray(ai.warnings) ? ai.warnings : [] }
    } catch (error) {
      lastError = error
      const failedFast = Date.now() - startedAt < QUICK_FAILURE_MS
      if (attempt === 0 && failedFast && isTransientSmartImportError(error)) {
        await new Promise(resolve => setTimeout(resolve, 1500))
        continue
      }
      break
    }
  }
  // Swallow — the caller falls back to local parsing. The warning gets surfaced
  // so teachers know smart import didn't apply.
  return { error: lastError?.message || 'Smart import unavailable' }
}

// Scanned (image-only) PDF import. Bypasses the text parser entirely and runs
// the dual-model vision OCR pipeline over rendered page images. Returns the
// same output shape as importQuizDocument so the editor handles it identically.
async function importScannedPdfQuiz({ pdf, file, importOptions }) {
  const metadata = buildImportMetadata('', file.name)
  const onProgress = typeof importOptions.onProgress === 'function' ? importOptions.onProgress : null

  const result = await runScannedImport({
    pdf,
    file,
    subjectHint: metadata.subject || '',
    gradeHint: metadata.grade || '',
    callVision: structureScannedQuiz,
    // Layout-first: a cheap per-page classifier runs before extraction so a
    // missed table/figure is reconciled. Advisory; opt out with layout:false.
    callLayout: importOptions.layout === false ? undefined : analyzePaperLayout,
    onProgress,
    diagramHandling: importOptions.diagramHandling,
  })

  const warnings = result.warnings || []
  const importStatus = 'needs_review'

  return {
    quiz: {
      ...metadata,
      mode: 'imported_document',
      importStatus,
      sourceFileName: file.name,
      sourceContentType: 'application/pdf',
      importWarnings: warnings,
    },
    sections: splitStandaloneSubParts(result.sections),
    parts: result.parts || [],
    questions: [],
    documentInstruction: '',
    imageAssets: result.imageAssets,
    pageImageUrls: result.pageImageUrls,
    importStatus,
    warnings,
    smartApplied: true,
    scanned: true,
    summary: result.summary,
  }
}

// Picture import. A teacher photographs or screenshots a paper; each image is
// treated as one page and fed through the same dual-model vision OCR pipeline as
// scanned PDFs. Several images can be imported at once (one per page). Returns
// the same output shape as importQuizDocument so the editor handles it the same.
async function importImageQuiz({ files, importOptions }) {
  const list = normalizeImportInput(files)
  const primary = list[0]
  const metadata = buildImportMetadata('', primary.name)
  const onProgress = typeof importOptions.onProgress === 'function' ? importOptions.onProgress : null

  const result = await runImageImport({
    files: list,
    subjectHint: metadata.subject || '',
    gradeHint: metadata.grade || '',
    callVision: structureScannedQuiz,
    // Layout-first: a cheap per-page classifier runs before extraction so a
    // missed table/figure is reconciled. Advisory; opt out with layout:false.
    callLayout: importOptions.layout === false ? undefined : analyzePaperLayout,
    onProgress,
    diagramHandling: importOptions.diagramHandling,
  })

  const warnings = result.warnings || []
  const importStatus = 'needs_review'
  const contentType = primary.type
    || IMAGE_MIME[extensionFromPath(primary.name)]
    || 'image/jpeg'

  return {
    quiz: {
      ...metadata,
      mode: 'imported_document',
      importStatus,
      sourceFileName: list.length > 1 ? `${primary.name} (+${list.length - 1} more)` : primary.name,
      sourceContentType: contentType,
      importWarnings: warnings,
    },
    sections: splitStandaloneSubParts(result.sections),
    parts: result.parts || [],
    questions: [],
    documentInstruction: '',
    imageAssets: result.imageAssets,
    pageImageUrls: result.pageImageUrls,
    importStatus,
    warnings,
    smartApplied: true,
    scanned: true,
    summary: result.summary,
  }
}

// Import options surfaced in the UI (ImportQuizPanel), both default ON:
//   preserveNumbering  — keep each question's original number from the doc.
//   groupComprehension — attach comprehension questions to their passage.
//   onProgress         — optional ({ phase, current, total }) callback used by
//                        the scanned-PDF path to drive the import progress UI.
// Defaults reproduce the correct G7 English behaviour.
export const DEFAULT_IMPORT_OPTIONS = {
  preserveNumbering: true,
  groupComprehension: true,
  // How scanned diagrams are handled. Default 'keep' — never drop figures by
  // default, because many Zambian assessment questions depend on them. The
  // teacher can choose 'clean', 'text' (leave out), or 'ask' in the importer.
  diagramHandling: DEFAULT_DIAGRAM_HANDLING,
}

export async function importQuizDocument(input, options = {}) {
  // Accept a single File (Word/PDF/image) or several image Files at once.
  const files = normalizeImportInput(input)
  if (!files.length) throw new Error('Choose a Word, PDF, or image file first.')

  // Verify each file's real leading bytes BEFORE any parser (fflate/adm-zip,
  // mammoth, pdfjs) touches it — the extension/declared type is the client's
  // word, and a disguised payload is exactly how a hostile .docx reaches the
  // ZIP parser (STOR-003 / SEC-007). A payload that isn't a genuine PDF / OLE /
  // ZIP / JPEG / PNG / WebP is rejected here rather than fed to a parser.
  for (const file of files) {
    await assertFileSignature(file, IMPORT_ALLOWED_MIMES, { label: 'a Word, PDF or image file' })
  }

  const importOptions = { ...DEFAULT_IMPORT_OPTIONS, ...options }

  // Picture import: any selected image routes to the vision OCR pipeline. We
  // don't mix pictures and documents in one import — the parsers are different.
  if (files.some(isImageImportFile)) {
    const images = files.filter(isImageImportFile)
    if (images.length !== files.length) {
      throw new Error('Import pictures on their own, or a single Word/PDF document — not both at once.')
    }
    return await importImageQuiz({ files: images, importOptions })
  }

  if (files.length > 1) {
    throw new Error('Import one Word or PDF document at a time.')
  }

  const file = files[0]
  const lowerName = file.name.toLowerCase()
  let extracted
  let isWord = false

  if (lowerName.endsWith('.docx')) {
    extracted = await extractDocx(file)
    isWord = true
  } else if (lowerName.endsWith('.doc')) {
    extracted = await extractLegacyDoc(file)
    isWord = true
  } else if (lowerName.endsWith('.pdf') || file.type === 'application/pdf') {
    // Decode the PDF once, then branch: image-only (scanned) papers go through
    // the vision OCR pipeline; PDFs with a real text layer use the existing
    // text + figure extractor.
    const preloaded = await loadPdfDocument(file)
    const { scanned } = await detectScannedPdf(preloaded.pdf)
    if (scanned) {
      return await importScannedPdfQuiz({ pdf: preloaded.pdf, file, importOptions })
    }
    extracted = await extractPdf(file, preloaded)
  } else {
    throw new Error('Please upload a .doc, .docx, .pdf, or image (JPG/PNG/WEBP) file.')
  }

  const local = processImportedQuestionBlocks(extracted.blocks, extracted.warnings, importOptions)
  const metadata = buildImportMetadata(
    // Formatting tokens ([[b]]…) would pollute title/subject detection.
    stripFormatTokens(local.processedBlocks.map(block => block.text).join('\n')),
    file.name,
  )

  let sections = local.sections
  let parts = local.parts || []
  let questions = local.questions
  let summary = local.summary
  let smartApplied = false
  const warnings = [...extracted.warnings]

  // Smart import now runs for PDFs too (not just Word). It is the only path
  // that recovers fractions, vertical arithmetic, and tables as editor nodes
  // instead of flat text — which is precisely what past-paper PDFs need.
  //
  // But it must NOT touch a clean, complete deterministic parse of a plain
  // prose paper. The LLM re-read does not reliably preserve question order and
  // can merge or drop a long option — which is exactly the "English paper
  // imports jumbled, a choice is missing" failure. shouldRunSmartImport keeps
  // the deterministic result unless the parse needs help OR the document
  // carries the rich structure smart import exists to recover.
  const rawDocumentText = rawTextFromExtracted(extracted)
  if ((isWord || extracted.blocks?.length) && shouldRunSmartImport(local, rawDocumentText)) {
    const smart = await trySmartImport(extracted, file)
    if (smart?.sections) {
      // Reconcile against the deterministic parser before accepting the AI
      // result. The smart import's value is recovering rich structure
      // (fractions, vertical arithmetic, tables) — NOT reducing the question
      // count. A non-deterministic LLM that returns fewer questions than the
      // parser found has dropped or merged questions, which is exactly the
      // "questions missing / sitting in the wrong place" failure teachers hit.
      // In that case we keep the parser's output, which preserves every
      // numbered question in document order, and surface a warning.
      const localCount = local.summary?.questions || 0
      const smartCount = countSectionQuestions(smart.sections)
      if (smartCount > 0 && smartCount >= localCount) {
        // Re-anchor the AI's sections to the deterministic parser's document
        // order and carry the parser's part structure onto them. The smart
        // import's value is recovering rich structure (fractions, vertical
        // arithmetic, tables) — NOT deciding question order, which an LLM does
        // NOT preserve reliably. reconcileSmartSectionOrder matches each smart
        // section to the parser section it represents *by content* and orders
        // the result by the parser's document position, so a shuffled, grouped,
        // or split AI response can no longer jumble the questions.
        const reconciled = reconcileSmartSectionOrder(local, smart.sections)
        sections = reconciled.sections
        parts = reconciled.parts
        questions = []
        summary = { ...local.summary, needsReview: 0, total: smart.sections.length, smartImportSections: smart.sections.length }
        smartApplied = true
        if (Array.isArray(smart.warnings)) warnings.push(...smart.warnings)
      } else {
        warnings.push(
          `Smart import returned ${smartCount} question${smartCount === 1 ? '' : 's'} but the document parser found ${localCount}; kept the parsed version so no questions were dropped. Please review.`,
        )
      }
    } else if (smart?.error) {
      warnings.push(`Smart import unavailable, used standard parser. (${smart.error})`)
    }
  }

  // Convert the DOCX run-formatting tokens extractDocx captured into editor
  // HTML on every text field (question stems, options, passages, part
  // instructions). Runs before the comprehension regroup + sub-part split so
  // those heuristics see the same HTML shape the smart-import path already
  // produces. Fields without tokens pass through untouched, and smart-import
  // output never carries tokens (importMarkupToRichHtml consumes them), so
  // this is a no-op for everything except formatted Word imports.
  sections = convertFormatTokensInSections(sections)
  questions = Array.isArray(questions) ? questions.map(convertQuestionFormatTokens) : questions
  parts = convertFormatTokensInParts(parts)

  // Safety net for the smart-import path: the deterministic parser already
  // regroups comprehension questions, but reconcileSmartSectionOrder takes its
  // passage questions from the (LLM) smart sections, which can re-pile every
  // question onto the last passage. Re-run the keyword regroup on the final
  // sections — it only acts on degenerate runs (a passage left empty while a
  // sibling has questions), so correctly-grouped imports pass through unchanged.
  {
    const regrouped = regroupComprehensionSections(sections)
    if (regrouped.changed) {
      sections = regrouped.sections
      warnings.push('Comprehension questions were re-grouped by passage — please confirm each text has the right questions.')
    }
  }

  // Recover crammed "(a)(b)(c)" short-answer questions into instruction + parts.
  {
    const before = sections
    sections = splitStandaloneSubParts(sections)
    if (sections.some((s, i) => s !== before[i])) {
      warnings.push('Some questions were split into lettered sub-parts (a, b, c) — review the parts and add the marking answers.')
    }
  }

  // Formatting sanity checks: a question that says "the underlined word" must
  // actually contain (or sit under a passage containing) underlined text —
  // same for bold / italics / highlight, plus passage-reference and
  // empty-option checks. Pure inspection, never mutates the questions.
  warnings.push(...buildImportFormatWarnings(sections))

  const importStatus = summary.needsReview > 0 || warnings.length
    ? 'needs_review'
    : 'success'

  // Stamp the parser version so the summary panel shows which importer
  // actually ran in this browser (scanned/image paths stamp their own).
  summary = { ...summary, importerVersion: DOC_IMPORTER_VERSION }

  const output = {
    quiz: {
      ...metadata,
      mode: 'imported_document',
      importStatus,
      sourceFileName: file.name,
      sourceContentType: file.type || (
        lowerName.endsWith('.pdf') ? 'application/pdf'
          : lowerName.endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            : 'application/msword'
      ),
      importWarnings: warnings,
    },
    sections,
    parts,
    questions,
    documentInstruction: formatTokensToHtml(local.documentInstruction || ''),
    imageAssets: extracted.imageAssets,
    importStatus,
    warnings,
    smartApplied,
    summary,
  }

  // Dev-only trace so we can see exactly how a document mapped onto the
  // quiz state when triaging a "wrong field" report. Wrapped in
  // `import.meta.env.DEV` so the logs never ship to production users.
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV) {
    const standaloneQuestions = sections
      .filter(s => s.kind !== 'passage')
      .map(s => s.question)
    console.groupCollapsed(`[importQuizDocument] ${file.name}`)
    console.log('Detected metadata:', metadata)
    console.log('Detected document instruction:', output.documentInstruction || '(none)')
    console.log('Detected parts:', parts.map(p => ({
      title: p.title,
      instructions: typeof p.instructions === 'string' ? p.instructions : '(rich)',
    })))
    console.log('Detected questions:', standaloneQuestions.map(q => ({
      n: q.sourceQuestionNumber,
      type: q.type,
      text: typeof q.text === 'string' ? q.text : '(rich)',
      sharedInstruction: typeof q.sharedInstruction === 'string' ? q.sharedInstruction : '(rich)',
    })))
    console.log('Detected options:', standaloneQuestions.map(q => ({
      n: q.sourceQuestionNumber,
      options: q.options,
    })))
    console.log('Detected answers:', standaloneQuestions.map(q => ({
      n: q.sourceQuestionNumber,
      correctAnswer: q.correctAnswer,
    })))
    console.log('Detected diagrams:', standaloneQuestions
      .filter(q => q.diagramText || q.imageUrl)
      .map(q => ({ n: q.sourceQuestionNumber, diagramText: q.diagramText, imageUrl: q.imageUrl })))
    console.log('Final mapped quiz object:', output)
    console.groupEnd()
  }

  return output
}

export function revokeImportedQuizAssets(assets = {}) {
  Object.values(assets).forEach(asset => {
    if (asset?.objectUrl && typeof URL !== 'undefined' && URL.revokeObjectURL) {
      URL.revokeObjectURL(asset.objectUrl)
    }
  })
}
