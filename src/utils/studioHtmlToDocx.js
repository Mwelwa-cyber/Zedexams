/**
 * studioHtmlToDocx.js
 *
 * Converts the Lesson Plan Studio's export HTML into a native WordprocessingML
 * .docx Blob using the `docx` npm library (Packer.toBlob).  This completely
 * replaces the vendored html-docx-js path which wraps the entire document body
 * in a `w:altChunk` / `afchunk.mht` MHTML part — a format that desktop Word
 * silently converts but Word for Android / iOS / Web CANNOT open, emitting
 * "This version of Word can't open files that contain alternate formats."
 *
 * The input HTML is the output of buildWordHtml() / buildBatchWordHtml() from
 * public/studio/10-export.js.  All remote images and <svg> elements have
 * already been resolved to inline `data:` URIs by prepareWordBody() before this
 * function is called, so we only need to handle `data:` src values.
 *
 * Design goals:
 *   - Never throw: a single bad node / image must not abort the whole export.
 *   - Preserve the free-plan watermark (reads window.__zxExportWatermark).
 *   - Unknown nodes recurse into their children rather than being dropped.
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  Header,
  HeadingLevel,
  ImageRun,
  Packer,
  PageBreak,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import { sanitizeXmlText } from './xmlText.js'

// ── helpers ────────────────────────────────────────────────────────────────

function run(str, opts = {}) {
  return new TextRun({ text: sanitizeXmlText(String(str ?? '')), ...opts })
}

function para(children, opts = {}) {
  return new Paragraph({
    children: Array.isArray(children) ? children : [children],
    spacing: { after: 120 },
    ...opts,
  })
}

const CELL_BORDER = {
  top:    { style: BorderStyle.SINGLE, size: 4, color: '888888' },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: '888888' },
  left:   { style: BorderStyle.SINGLE, size: 4, color: '888888' },
  right:  { style: BorderStyle.SINGLE, size: 4, color: '888888' },
}

// The reflowed metadata header (.word-meta-table — built by
// convertMetaGridsToTables in 10-export.js from the .official-meta /
// .meta-compact grids) is NOT a boxed grid. On screen it renders as a plain
// two-column block fenced by a single rule top and bottom only (lesson.css
// `.official-meta { border-top/border-bottom: 1.5px }`, mirrored by
// `.word-meta-table` in WORD_DOC_STYLES). Boxing every cell here made the
// download's header come out looking nothing like the preview — so meta cells
// get NO borders and the rule is drawn as the first row's top edge + the last
// row's bottom edge (size 12 = 1.5pt, black, matching the preview's --ink rule).
const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'auto' }
const META_RULE = { style: BorderStyle.SINGLE, size: 12, color: '000000' }
function metaCellBorders(isFirstRow, isLastRow) {
  return {
    top:    isFirstRow ? META_RULE : NO_BORDER,
    bottom: isLastRow ? META_RULE : NO_BORDER,
    left:   NO_BORDER,
    right:  NO_BORDER,
  }
}
const META_TABLE_BORDERS = {
  top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER,
  insideHorizontal: NO_BORDER, insideVertical: NO_BORDER,
}

// Decode a base64 data URI to a Uint8Array.  Uses the browser-safe atob path so
// the same code works in jsdom (tests) and in the bundled SPA — avoids Node
// Buffer which is absent in the browser.
function dataUriToUint8Array(dataUri) {
  try {
    const comma = dataUri.indexOf(',')
    if (comma === -1) return null
    const b64 = dataUri.slice(comma + 1)
    const binary = atob(b64)
    const len = binary.length
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

// Sniff the image type from magic bytes (same logic as lessonPlanToDocx.js).
function detectImageType(bytes) {
  if (!bytes || bytes.length < 4) return 'png'
  const [b0, b1, b2, b3] = bytes
  if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47) return 'png'
  if (b0 === 0xff && b1 === 0xd8 && b2 === 0xff) return 'jpg'
  if (b0 === 0x47 && b1 === 0x49 && b2 === 0x46) return 'gif'
  if (b0 === 0x42 && b1 === 0x4d) return 'bmp'
  return 'png'
}

// Extract MIME type from a data URI, e.g. "data:image/png;base64," → "image/png".
function mimeFromDataUri(src) {
  const m = /^data:([^;,]+)/.exec(src)
  return m ? m[1] : 'image/png'
}

// Map a MIME type to the docx ImageRun type string.
function mimeToDocxType(mime) {
  const lower = String(mime || '').toLowerCase()
  if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpg'
  if (lower.includes('gif')) return 'gif'
  if (lower.includes('bmp')) return 'bmp'
  return 'png'
}

// Parse width from an element's width attribute or inline style, returning
// a number (px) or null.
function parseWidth(el) {
  const attr = parseFloat(el.getAttribute('width'))
  if (attr > 0) return attr
  const style = el.getAttribute('style') || ''
  const m = /width\s*:\s*(\d+\.?\d*)(px)?/.exec(style)
  if (m) return parseFloat(m[1])
  return null
}

// Build an ImageRun for a `data:` src img element.  Returns null on failure.
function buildImageRun(el) {
  try {
    const src = el.getAttribute('src') || ''
    if (!src.startsWith('data:')) return null
    const bytes = dataUriToUint8Array(src)
    if (!bytes || bytes.length < 4) return null
    const mime = mimeFromDataUri(src)
    const type = mimeToDocxType(mime) || detectImageType(bytes)
    // Cap at 450 px to fit an A4 page with standard margins (~16mm each side).
    const MAX_W = 450
    const rawW = parseWidth(el) || MAX_W
    const width = Math.min(rawW, MAX_W)
    // docx transformation values are in EMU when supplied as a number in pixels
    // but the library accepts plain pixel integers and converts internally.
    return new ImageRun({
      type,
      data: bytes,
      transformation: { width, height: Math.max(1, Math.round(width * 0.62)) },
    })
  } catch {
    return null
  }
}

// ── node walker ────────────────────────────────────────────────────────────
//
// Returns a flat array of docx Paragraph / Table objects for a given DOM node.

function walkNode(node) {
  if (node.nodeType === 3 /* TEXT_NODE */) {
    const t = node.textContent || ''
    if (!t.trim()) return []
    return [para([run(t)])]
  }
  if (node.nodeType !== 1 /* ELEMENT_NODE */) return []

  const tag = node.tagName.toUpperCase()

  // Page break
  if (tag === 'DIV' && /page-break-before/i.test(node.getAttribute('style') || '')) {
    return [new Paragraph({ children: [new PageBreak()] })]
  }

  // Images
  if (tag === 'IMG') {
    const src = node.getAttribute('src') || ''
    if (!src.startsWith('data:')) return []  // non-inlined remote img — skip
    const imgRun = buildImageRun(node)
    if (!imgRun) return []
    return [new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [imgRun],
    })]
  }

  // Tables
  if (tag === 'TABLE') {
    return buildTable(node)
  }

  // Skip non-content wrappers we handle via children
  if (['THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD'].includes(tag)) {
    return walkChildren(node)
  }

  // Line breaks (inside a paragraph context — we'll emit an empty paragraph)
  if (tag === 'BR') {
    return [para([run('')])]
  }

  // Headings
  if (tag === 'H1' || node.classList?.contains('lp-title') || node.classList?.contains('school')) {
    return [new Paragraph({
      children: [run(node.textContent || '', { bold: true })],
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { before: 80, after: 120 },
    })]
  }
  if (tag === 'H2' || node.classList?.contains('sec') || node.classList?.contains('progression-title')) {
    return [new Paragraph({
      children: [run(node.textContent || '', { bold: true })],
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 200, after: 80 },
    })]
  }
  if (tag === 'H3') {
    return [new Paragraph({
      children: [run(node.textContent || '', { bold: true })],
      heading: HeadingLevel.HEADING_3,
      spacing: { before: 140, after: 60 },
    })]
  }

  // Lists
  if (tag === 'UL' || tag === 'OL') {
    return buildList(node, tag === 'OL')
  }
  if (tag === 'LI') {
    // Fallback: li outside ul/ol
    return [new Paragraph({
      children: inlineRuns(node),
      bullet: { level: 0 },
      spacing: { after: 60 },
    })]
  }

  // Paragraphs, divs, field-lines, callout-lines → emit a paragraph
  if (tag === 'P' || tag === 'DIV' || tag === 'SPAN') {
    // If the node contains block-level children (tables, headings, nested divs),
    // recurse into children to keep nesting correct.
    const hasBlock = Array.from(node.childNodes).some(c => {
      if (c.nodeType !== 1) return false
      const ct = c.tagName.toUpperCase()
      return ['TABLE', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'DIV', 'P'].includes(ct)
    })
    if (hasBlock) return walkChildren(node)
    const runs = inlineRuns(node)
    if (!runs.length) return []
    return [para(runs)]
  }

  // Everything else: recurse into children
  return walkChildren(node)
}

function walkChildren(node) {
  const out = []
  for (const child of Array.from(node.childNodes)) {
    try {
      const items = walkNode(child)
      out.push(...items)
    } catch {
      // bad node — skip
    }
  }
  return out
}

// Build inline TextRun array from an inline-content node, honouring bold/italic.
function inlineRuns(node, marks = {}) {
  const runs = []
  for (const child of Array.from(node.childNodes)) {
    try {
      if (child.nodeType === 3 /* TEXT_NODE */) {
        const t = child.textContent || ''
        if (t) runs.push(run(t, marks))
      } else if (child.nodeType === 1 /* ELEMENT_NODE */) {
        const ct = child.tagName.toUpperCase()
        if (ct === 'BR') {
          runs.push(new TextRun({ text: '', break: 1 }))
        } else if (ct === 'STRONG' || ct === 'B') {
          runs.push(...inlineRuns(child, { ...marks, bold: true }))
        } else if (ct === 'EM' || ct === 'I') {
          runs.push(...inlineRuns(child, { ...marks, italics: true }))
        } else if (ct === 'U') {
          runs.push(...inlineRuns(child, { ...marks, underline: {} }))
        } else if (ct === 'IMG') {
          const src = child.getAttribute('src') || ''
          if (src.startsWith('data:')) {
            const imgRun = buildImageRun(child)
            if (imgRun) runs.push(imgRun)
          }
        } else {
          // span, div, etc. — recurse
          runs.push(...inlineRuns(child, marks))
        }
      }
    } catch {
      // bad child — skip
    }
  }
  return runs
}

function buildList(listEl, ordered) {
  const items = Array.from(listEl.querySelectorAll('li'))
  if (!items.length) return []
  return items.map((li, idx) => {
    const runs = inlineRuns(li)
    if (!runs.length) runs.push(run(''))
    if (ordered) {
      // Prepend the number as part of the text (no native numbering needed for
      // the simple lists the studio generates).
      return new Paragraph({
        children: [run(`${idx + 1}. `, { bold: true }), ...runs],
        spacing: { after: 60 },
      })
    }
    return new Paragraph({
      children: runs,
      bullet: { level: 0 },
      spacing: { after: 60 },
    })
  })
}

function buildTable(tableEl) {
  // The metadata header is a borderless top/bottom-ruled block, not a boxed
  // grid (see metaCellBorders). Every other table (lesson progression, batch
  // cover sheet) keeps the full single-line cell box.
  const isMeta = !!(tableEl.classList && tableEl.classList.contains('word-meta-table'))
  const rows = []
  const trEls = Array.from(tableEl.querySelectorAll('tr'))
  const lastRowIdx = trEls.length - 1
  trEls.forEach((trEl, rowIdx) => {
    const cells = []
    const tdEls = Array.from(trEl.children).filter(c =>
      c.tagName.toUpperCase() === 'TH' || c.tagName.toUpperCase() === 'TD'
    )
    for (const tdEl of tdEls) {
      const isHeader = tdEl.tagName.toUpperCase() === 'TH'
      const colspanAttr = parseInt(tdEl.getAttribute('colspan') || '1', 10)
      const colspan = isFinite(colspanAttr) && colspanAttr > 1 ? colspanAttr : 1
      const runs = inlineRuns(tdEl)
      if (isHeader) runs.forEach(r => { try { r.options && (r.options.bold = true) } catch {} })
      const childParas = walkChildren(tdEl)
      const cellChildren = childParas.length
        ? childParas
        : [para(runs.length ? runs : [run('')])]
      cells.push(new TableCell({
        children: cellChildren,
        borders: isMeta ? metaCellBorders(rowIdx === 0, rowIdx === lastRowIdx) : CELL_BORDER,
        ...(colspan > 1 ? { columnSpan: colspan } : {}),
      }))
    }
    if (cells.length) rows.push(new TableRow({ children: cells }))
  })
  if (!rows.length) return []
  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    ...(isMeta ? { borders: META_TABLE_BORDERS } : {}),
    rows,
  })]
}

// ── watermark header ───────────────────────────────────────────────────────

// Build a simple centred paragraph with light-grey text for use as a document
// header watermark on free-plan exports.
function watermarkHeader(text) {
  return new Header({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: sanitizeXmlText(text), color: 'CCCCCC', size: 18 })],
    })],
  })
}

// ── public API ─────────────────────────────────────────────────────────────

/**
 * Convert the studio's export HTML into a native .docx Blob.
 *
 * @param {string} html  Full HTML document (or body fragment) to convert.
 * @param {object} [opts]  Reserved for future options.
 * @returns {Promise<Blob>}  A OOXML .docx Blob with no altChunk parts.
 */
export async function htmlToDocxBlob(html, opts = {}) {
  void opts  // reserved

  // Parse the HTML string into a DOM.  DOMParser is available in browsers and
  // in jsdom (the Vitest test environment).
  const parsed = new DOMParser().parseFromString(String(html || ''), 'text/html')

  // The studio wraps the plan content in <div class="WordSection1">; fall back
  // to body if that container is absent.
  const root = parsed.querySelector('.WordSection1') || parsed.body

  const bodyChildren = []
  for (const node of Array.from(root.childNodes)) {
    try {
      bodyChildren.push(...walkNode(node))
    } catch {
      // defective node — skip
    }
  }

  // Ensure the document has at least one paragraph (Word rejects an empty body).
  if (!bodyChildren.length) {
    bodyChildren.push(para([run('')]))
  }

  // Watermark: read the free-plan signal the React component sets.
  const watermarkText =
    typeof window !== 'undefined' && window.__zxExportWatermark
      ? String(window.__zxExportWatermark)
      : ''

  const sectionHeaders = watermarkText
    ? { default: watermarkHeader(watermarkText) }
    : undefined

  const doc = new Document({
    sections: [{
      ...(sectionHeaders ? { headers: sectionHeaders } : {}),
      properties: {},
      children: bodyChildren,
    }],
  })

  return Packer.toBlob(doc)
}
