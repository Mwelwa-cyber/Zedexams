/**
 * Export an assessment as a Word (.docx) file.
 *
 * Walks the same shared paper-layout blocks as the PDF exporter, so the
 * Word output stays in lock-step with the in-studio preview and PDF
 * export. Word can't reproduce the marble banner, so we render the
 * header as a centered 3-line stack (SCHOOL / TITLE / SUBJECT / [PAPER]).
 *
 * Two modes:
 *   - 'paper'  (default): printable paper for pupils.
 *   - 'scheme': marking key for teachers (answers + explanations).
 */

import { saveBlob } from './saveBlob.js'
import {
  AlignmentType,
  BorderStyle,
  Document,
  Header,
  HeadingLevel,
  HeightRule,
  ImageRun,
  Packer,
  PageBreak,
  Paragraph,
  Tab,
  TableCell,
  TableRow,
  Table,
  TabStopPosition,
  TabStopType,
  TextRun,
  WidthType,
} from 'docx'
import { attributionSection, attributionFooter, attributionWatermarkParagraph } from './docxAttribution.js'
import { buildPaperLayout, DEFAULT_ANSWER_LINES } from './assessmentPaperLayout.js'
import { resolveImageWidthPercent } from './imageWidth.js'
import { renderDiagramSvg } from '../components/diagrams/diagramCatalog.js'
import { svgToPngBytes } from './svgRasterizer.js'
import { hydrateTableData } from './tableData.js'
import { buildAnswerSheet } from './assessmentAnswerSheet.js'
import { splitStatementSegments, statementLabel } from './fillBlanks.js'
import { subPartLabel, splitPartBlanks, countPartBlanks } from './questionParts.js'
import { sanitizeXmlText } from './xmlText.js'
import { fetchImageBytes } from './fetchImageBytes.js'

const ANSWER_SHEET_LETTERS = 'ABCDEFGH'.split('')

const SECTION_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

// Re-exported from the shared xmlText.js so every exporter sanitises identically
// and the existing call sites / tests that import it from this module keep working.
export { sanitizeXmlText }

function runText(str, opts = {}) {
  return new TextRun({ text: sanitizeXmlText(str), ...opts })
}

function para(runs, opts = {}) {
  return new Paragraph({
    children: Array.isArray(runs) ? runs : [runs],
    spacing: { after: 120 },
    ...opts,
  })
}

function centeredPara(runs, opts = {}) {
  return new Paragraph({
    children: Array.isArray(runs) ? runs : [runs],
    alignment: AlignmentType.CENTER,
    spacing: { after: 100 },
    ...opts,
  })
}

const BORDER = {
  top:    { style: BorderStyle.SINGLE, size: 4, color: '888888' },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: '888888' },
  left:   { style: BorderStyle.SINGLE, size: 4, color: '888888' },
  right:  { style: BorderStyle.SINGLE, size: 4, color: '888888' },
}

// Render instructions with inline-bold option letters: "(A)", "(B)" etc.
// We can't use HTML, so we split the text on those tags and emit a TextRun
// per fragment, toggling the bold attribute. One paragraph per source
// paragraph, with the option letters bold inline.
function instructionParagraphs(text) {
  if (!text) return []
  const sourceParas = String(text).split(/\n\s*\n/)
  return sourceParas.map(sourcePara => {
    const collapsed = sourcePara.replace(/\n/g, ' ')
    const runs = []
    const pattern = /\(([A-D])\)/g
    let cursor = 0
    let match
    while ((match = pattern.exec(collapsed)) !== null) {
      const start = match.index
      if (start > cursor) runs.push(runText(collapsed.slice(cursor, start), { size: 22 }))
      runs.push(runText(`(${match[1]})`, { size: 22, bold: true }))
      cursor = start + match[0].length
    }
    if (cursor < collapsed.length) runs.push(runText(collapsed.slice(cursor), { size: 22 }))
    if (!runs.length) runs.push(runText('', { size: 22 }))
    return new Paragraph({
      children: runs,
      spacing: { after: 80 },
    })
  })
}

/**
 * Convert paper HTML (post-hydration, see safeRender.richTextToPaperHtml)
 * into a list of docx Paragraphs.
 *
 * The conversion is best-effort:
 *   - Plain text + bold/italic/underline marks  → run-level formatting
 *   - <sup>/<sub>                                → run-level super/subscript
 *   - <p>                                        → new Paragraph
 *   - Fraction span (.math-frac)                 → "whole num/den" with the
 *                                                  numerator on a stacked
 *                                                  visual via two runs
 *                                                  (Word lacks a native
 *                                                  inline frac without
 *                                                  using OMML field codes,
 *                                                  so we fall back to a
 *                                                  legible "a/b" form)
 *   - Number-base span (.num-base)               → number followed by a
 *                                                  subscript base
 *   - Vertical arithmetic div (.vert-arith)      → a monospace block of
 *                                                  paragraphs, one row per
 *                                                  line, with the
 *                                                  operator + numbers
 *                                                  right-aligned by
 *                                                  padding
 *
 * Returns an array of Paragraph objects.
 */
/**
 * Walk an option's pre-hydrated rich HTML and return a flat array of
 * docx TextRun / ImageRun-equivalent runs (no paragraph wrappers).
 *
 * Used by MCQ option rendering — each option is one row, so we want runs
 * that fit inside the existing single-paragraph layouts (text, image,
 * mixed). Falls back to a single plain-text run for legacy options.
 *
 * Supports the same marks as richHtmlToDocxParagraphs: bold / italic /
 * underline / strike / sup / sub, plus the Grade-7 math nodes.
 */
function optionRuns(html, baseOpts = { size: 20 }, fallback = '') {
  if (!html || typeof DOMParser === 'undefined') {
    return [runText(fallback ? String(fallback) : (html ? String(html).replace(/<[^>]+>/g, ' ') : ''), baseOpts)]
  }
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const runs = []
  const walk = (node, marks = {}) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || ''
      if (text) runs.push(runText(text, { ...baseOpts, ...marks }))
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node
    const tag = el.tagName.toUpperCase()

    if (el.classList?.contains('math-frac')) {
      const whole = el.getAttribute('data-whole') || ''
      const num = el.getAttribute('data-num') || ''
      const den = el.getAttribute('data-den') || ''
      if (whole) runs.push(runText(`${whole} `, { ...baseOpts, ...marks }))
      runs.push(runText(num, { ...baseOpts, ...marks, superScript: true }))
      runs.push(runText('⁄', { ...baseOpts, ...marks }))
      runs.push(runText(den, { ...baseOpts, ...marks, subScript: true }))
      return
    }
    if (el.classList?.contains('num-base')) {
      const number = el.getAttribute('data-number') || ''
      const base = el.getAttribute('data-base') || ''
      runs.push(runText(number, { ...baseOpts, ...marks }))
      if (base) runs.push(runText(base, { ...baseOpts, ...marks, subScript: true }))
      return
    }
    if (el.classList?.contains('vert-arith')) {
      // Vertical sums don't fit inside an option row (a stacked column
      // would break the layout). Emit a one-line text summary instead.
      const operator = el.getAttribute('data-operator') || '+'
      const lines = (el.getAttribute('data-lines') || '').split('|')
      const answer = el.getAttribute('data-answer') || ''
      runs.push(runText(
        `${lines.join(` ${operator} `)} = ${answer || '___'}`,
        { ...baseOpts, ...marks, font: 'Consolas' },
      ))
      return
    }

    const next = { ...marks }
    if (tag === 'STRONG' || tag === 'B') next.bold = true
    if (tag === 'EM' || tag === 'I') next.italics = true
    if (tag === 'U') next.underline = {}
    if (tag === 'S' || tag === 'STRIKE') next.strike = true
    if (tag === 'SUP') next.superScript = true
    if (tag === 'SUB') next.subScript = true
    if (tag === 'BR') {
      runs.push(runText('\n', { ...baseOpts, ...marks, break: 1 }))
      return
    }
    Array.from(el.childNodes).forEach((child) => walk(child, next))
  }
  Array.from(doc.body.childNodes).forEach((node) => walk(node, {}))
  if (!runs.length) return [runText(fallback ? String(fallback) : '', baseOpts)]
  return runs
}

function richHtmlToDocxParagraphs(html, baseOpts = { size: 22 }, opts = {}) {
  const { prefixRuns = [], suffixRuns = [], firstParaSpacing } = opts
  if (!html || typeof DOMParser === 'undefined') {
    const text = html ? String(html).replace(/<[^>]+>/g, ' ') : ''
    return [new Paragraph({
      children: [...prefixRuns, runText(text, baseOpts), ...suffixRuns],
      spacing: firstParaSpacing || { after: 80 },
    })]
  }
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')

  /** Accumulate runs into the current paragraph; spill into `out` on block. */
  const out = []
  // The prefix (e.g. the "12. " question number) is held separately and
  // prepended to the FIRST paragraph that actually has content. Block-level
  // wrappers flush on entry, so preloading the prefix into currentRuns put a
  // leading `<p>` question stem on its own line ("12." then "Work out:" below).
  let pendingPrefix = [...prefixRuns]
  let currentRuns = []
  let isFirstParagraph = true
  // Track the last emitted paragraph's runs so a trailing suffix (the marks
  // tag) can be re-attached to it inline instead of dropping onto its own line.
  let lastEmitted = null

  const flush = () => {
    if (!currentRuns.length) return
    const children = [...pendingPrefix, ...currentRuns]
    pendingPrefix = []
    const spacing = isFirstParagraph && firstParaSpacing
      ? firstParaSpacing
      : { after: 80 }
    out.push(new Paragraph({ children, spacing }))
    lastEmitted = { children, spacing, index: out.length - 1 }
    currentRuns = []
    isFirstParagraph = false
  }

  const walk = (node, marks = {}) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || ''
      if (!text) return
      currentRuns.push(runText(text, { ...baseOpts, ...marks }))
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return

    const el = node
    const tag = el.tagName.toUpperCase()

    // Special-case our Grade-7 math blocks.
    if (el.classList?.contains('vert-arith')) {
      flush()
      const operator = el.getAttribute('data-operator') || '+'
      const lines = (el.getAttribute('data-lines') || '').split('|')
      const answer = el.getAttribute('data-answer') || ''
      const width = Math.max(
        ...lines.map((l) => String(l ?? '').length),
        String(answer ?? '').length,
        1
      )
      const pad = (s) => String(s ?? '').padStart(width, ' ')
      lines.forEach((line, idx) => {
        const isOp = idx === lines.length - 1
        const opCol = isOp ? operator : ' '
        out.push(new Paragraph({
          children: [runText(`${opCol}  ${pad(line)}`, { ...baseOpts, font: 'Consolas' })],
          spacing: { after: 0 },
        }))
      })
      out.push(new Paragraph({
        children: [runText(`   ${'─'.repeat(width)}`, { ...baseOpts, font: 'Consolas' })],
        spacing: { after: 0 },
      }))
      out.push(new Paragraph({
        children: [runText(`   ${pad(answer)}`, { ...baseOpts, font: 'Consolas' })],
        spacing: { after: 120 },
      }))
      return
    }

    if (el.classList?.contains('math-frac')) {
      const whole = el.getAttribute('data-whole') || ''
      const num = el.getAttribute('data-num') || ''
      const den = el.getAttribute('data-den') || ''
      if (whole) currentRuns.push(runText(`${whole} `, { ...baseOpts, ...marks }))
      currentRuns.push(runText(num, { ...baseOpts, ...marks, superScript: true }))
      currentRuns.push(runText('⁄', { ...baseOpts, ...marks }))
      currentRuns.push(runText(den, { ...baseOpts, ...marks, subScript: true }))
      return
    }

    if (el.classList?.contains('num-base')) {
      const number = el.getAttribute('data-number') || ''
      const base = el.getAttribute('data-base') || ''
      currentRuns.push(runText(number, { ...baseOpts, ...marks }))
      if (base) currentRuns.push(runText(base, { ...baseOpts, ...marks, subScript: true }))
      return
    }

    // Block-level wrappers: flush and recurse.
    if (tag === 'P' || tag === 'DIV' || tag === 'BLOCKQUOTE' ||
        tag === 'H1' || tag === 'H2' || tag === 'H3' ||
        tag === 'UL' || tag === 'OL' || tag === 'LI') {
      flush()
      Array.from(el.childNodes).forEach((child) => walk(child, marks))
      flush()
      return
    }

    if (tag === 'BR') {
      // Hard line break inside the current paragraph.
      currentRuns.push(runText('\n', { ...baseOpts, ...marks, break: 1 }))
      return
    }

    const next = { ...marks }
    if (tag === 'STRONG' || tag === 'B') next.bold = true
    if (tag === 'EM' || tag === 'I') next.italics = true
    if (tag === 'U') next.underline = {}
    if (tag === 'S' || tag === 'STRIKE') next.strike = true
    if (tag === 'SUP') next.superScript = true
    if (tag === 'SUB') next.subScript = true

    Array.from(el.childNodes).forEach((child) => walk(child, next))
  }

  Array.from(doc.body.childNodes).forEach((node) => walk(node, {}))
  // Append suffix runs (the marks tag) to the last line of content. If the
  // content ended on a block boundary, re-open the last emitted paragraph so
  // the tag stays inline rather than starting a new paragraph.
  if (suffixRuns.length && !currentRuns.length && lastEmitted) {
    out[lastEmitted.index] = new Paragraph({
      children: [...lastEmitted.children, ...suffixRuns],
      spacing: lastEmitted.spacing,
    })
  } else {
    if (suffixRuns.length) currentRuns.push(...suffixRuns)
    flush()
  }
  return out.length ? out : [para([...prefixRuns, runText('', baseOpts), ...suffixRuns], firstParaSpacing || {})]
}

/**
 * Sniff the image format from its leading magic bytes.
 *
 * docx v9 made `ImageRun.type` REQUIRED — it builds the embedded media
 * file name as `${hash}.${type}`, so an undefined type yields a
 * `word/media/<hash>.undefined` part that Word can't map to an image MIME
 * and silently drops (the rest of the document still renders). That's why
 * question pictures were missing from the downloaded paper even though the
 * preview showed them. We detect the real type here and pass it through.
 *
 * docx only embeds jpg/png/gif/bmp; question/diagram images in the studio
 * are PNG (AI diagrams) or JPEG (compressed uploads), so PNG is a safe
 * default for the rare unknown header.
 */
export function detectImageType(bytes) {
  if (!bytes || bytes.length < 4) return 'png'
  const [b0, b1, b2, b3] = bytes
  if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47) return 'png'
  if (b0 === 0xff && b1 === 0xd8 && b2 === 0xff) return 'jpg'
  if (b0 === 0x47 && b1 === 0x49 && b2 === 0x46) return 'gif'
  if (b0 === 0x42 && b1 === 0x4d) return 'bmp'
  // RIFF....WEBP. docx CANNOT embed WEBP, so callers must transcode it (see
  // loadImageRun) before building an ImageRun — labelling WEBP bytes as png
  // would produce a media part Word renders as a broken image.
  if (bytes.length >= 12 &&
      b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'webp'
  return 'png'
}

const MIME_BY_TYPE = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp' }

/** Build an ImageRun with the format-detected `type` docx v9 requires. */
function imageRun(bytes, transformation, alt = '') {
  const altText = String(alt || '').trim()
  return new ImageRun({
    type: detectImageType(bytes),
    data: bytes,
    transformation,
    // Word screen-readers read the description; supply name/title too so the
    // alt text is exposed everywhere Word looks for it.
    ...(altText ? { altText: { name: altText, title: altText, description: altText } } : {}),
  })
}

// Fit (w,h) inside a box, preserving aspect ratio (never upscaling). The
// studio preview scales pictures with `max-width`, so a fixed width×height
// here would stretch them; this keeps the downloaded paper matching the
// preview. Falls back to the box when natural dimensions are unknown.
function fitWithin(width, height, maxWidth, maxHeight) {
  if (!width || !height) return { width: maxWidth, height: maxHeight }
  const scale = Math.min(maxWidth / width, maxHeight / height, 1)
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

// Decode image bytes in the browser to read natural dimensions and, for
// formats Word can't embed (WEBP — which the picture bank stores as-is),
// transcode to PNG. An object URL keeps the canvas same-origin so it is
// never CORS-tainted. Returns { bytes, width, height } or null when there is
// no DOM (e.g. the node test harness).
async function decodeImage(bytes, type) {
  if (typeof document === 'undefined' || typeof Image === 'undefined' || !globalThis.URL?.createObjectURL) {
    return null
  }
  const objectUrl = URL.createObjectURL(new Blob([bytes], { type: MIME_BY_TYPE[type] || 'application/octet-stream' }))
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('decode failed'))
      el.src = objectUrl
    })
    const width = img.naturalWidth || img.width || 0
    const height = img.naturalHeight || img.height || 0
    let outBytes = bytes
    if (type === 'webp' && width && height) {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d').drawImage(img, 0, 0)
      const pngBlob = await new Promise((res) => canvas.toBlob(res, 'image/png'))
      if (pngBlob) outBytes = new Uint8Array(await pngBlob.arrayBuffer())
    }
    return { bytes: outBytes, width, height }
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

// Fetch, transcode (WEBP→PNG), and aspect-fit an image, returning a ready
// ImageRun or null. Centralising this guarantees WEBP is always transcoded
// before it reaches imageRun — docx would otherwise reject the format.
async function loadImageRun(url, { width = 360, height = 220, alt = '' } = {}) {
  const bytes = await fetchImageBytes(url)
  if (!bytes) return null
  const type = detectImageType(bytes)
  const decoded = await decodeImage(bytes, type)
  if (!decoded) {
    // No DOM (tests): embed jpg/png/gif/bmp as-is; WEBP can't be transcoded
    // without a canvas, so skip it rather than write a broken media part.
    if (type === 'webp') return null
    return imageRun(bytes, { width, height }, alt)
  }
  return imageRun(decoded.bytes, fitWithin(decoded.width, decoded.height, width, height), alt)
}

// Read the intrinsic aspect ratio from an SVG's viewBox so the rasterized PNG
// isn't squashed. Falls back to 4:3.
function svgAspect(svg) {
  const m = /viewBox="[\d.]+ [\d.]+ ([\d.]+) ([\d.]+)"/.exec(svg || '')
  const w = m ? parseFloat(m[1]) : 0
  const h = m ? parseFloat(m[2]) : 0
  return w > 0 && h > 0 ? w / h : 4 / 3
}

// Render a deterministic library diagram ({libraryKey, params}) to an embedded
// ImageRun by rasterizing its SVG to PNG. Browser-only (canvas); returns null
// in a DOM-less context (node tests) so the caller falls back to alt text.
async function diagramImageRun(diagram, { maxWidth = 360, maxHeight = 220 } = {}) {
  if (!diagram || !diagram.libraryKey) return null
  const svg = renderDiagramSvg(diagram.libraryKey, diagram.params || {}, '#1c1612')
  if (!svg) return null
  const aspect = svgAspect(svg)
  // Rasterize at ~2× the embed size for a crisp print, fitting the box.
  let width = maxWidth
  let height = Math.round(maxWidth / aspect)
  if (height > maxHeight) { height = maxHeight; width = Math.round(maxHeight * aspect) }
  try {
    const bytes = await svgToPngBytes(svg, width * 2, height * 2)
    return imageRun(bytes, { width, height })
  } catch {
    return null
  }
}

async function imageParagraph(url, opts = {}) {
  if (!url) return null
  // A width preset scales the fit-box down from the full-width default so a
  // teacher's "Small/Medium/Large" choice carries into the Word download.
  const baseWidth = opts.width || 360
  const baseHeight = opts.height || 220
  const pct = opts.widthPreset ? resolveImageWidthPercent(opts.widthPreset) / 100 : 1
  const run = await loadImageRun(url, {
    width: Math.round(baseWidth * pct),
    height: Math.round(baseHeight * pct),
    alt: opts.alt || '',
  })
  return run ? centeredPara([run]) : null
}

// Base64-encode raw bytes for an inline data URL. Browser-only (uses btoa);
// chunked so a large diagram doesn't blow the argument limit of fromCharCode.
function bytesToBase64(bytes) {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

// Escape text destined for an SVG <text> node. The href is a data: URL (safe
// chars only) so it's left alone, but a label can carry &, <, > from a teacher.
function escapeSvgText(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Build an SVG that draws the question image with its label markers baked on
// top. Word can't reliably overlay positioned elements on an inline image, so
// we composite them into one PNG instead — this is what makes a downloaded
// diagram paper match the studio preview / PDF, where the markers are
// absolutely-positioned DOM (src/components/teacher/views/PaperBlocks.jsx).
//
// Two `mode`s, mirroring the preview's two diagram modes:
//   - 'identify' (default): numbered black circles (1, 2, 3…) — the on-image
//     marker is just the number; the answer text goes on the blanks below.
//   - 'labeled': white text pills carrying each label's text, the way a labelled
//     diagram prints. Without this the Word export flattened labelled diagrams to
//     a "Labels: 1. … 2. …" text list that threw away which label points where.
//
// `labels` carry x/y (0..1 ratios of the image) for the marker and optional
// tx/ty for the leader-tip. Pure string builder so the geometry is unit-tested;
// the raster step (svgToPngBytes) is the only browser-only part.
export function buildDiagramIdentifySvg({ href, width, height, labels = [], mode = 'identify' }) {
  const W = Math.max(1, Math.round(width))
  const H = Math.max(1, Math.round(height))
  const clamp01 = n => Math.max(0, Math.min(1, Number(n) || 0))
  // Marker sizing tracks the smaller edge so circles stay readable but never
  // swamp a tall/narrow figure; mirrors the preview's ~20px badge proportion.
  const minEdge = Math.min(W, H)
  const r = Math.max(9, Math.round(minEdge * 0.035))
  const fs = Math.max(10, Math.round(r * 1.25))
  const dot = Math.max(2, Math.round(minEdge * 0.012))
  const sw = Math.max(1, Math.round(minEdge * 0.006))
  const parts = [`<image href="${href}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none"/>`]
  labels.forEach((l, i) => {
    const cx = clamp01(l.x) * W
    const cy = clamp01(l.y) * H
    // Leader line + tip dot on the part the label points at (both modes).
    if (Number.isFinite(Number(l.tx)) && Number.isFinite(Number(l.ty))) {
      const tx = clamp01(l.tx) * W
      const ty = clamp01(l.ty) * H
      parts.push(`<line x1="${cx.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${tx.toFixed(1)}" y2="${ty.toFixed(1)}" stroke="#000" stroke-width="${sw}"/>`)
      parts.push(`<circle cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="${dot}" fill="#000"/>`)
    }
    if (mode === 'labeled') {
      // A white text pill carrying the label, mirroring the preview's
      // absolutely-positioned label badge. The layout already drops empty
      // labelled pills, but guard so a stray blank never draws an empty box.
      const labelText = String(l.text == null ? '' : l.text).trim()
      if (!labelText) return
      const padX = Math.max(4, Math.round(fs * 0.5))
      const boxW = Math.round(labelText.length * fs * 0.6 + padX * 2)
      const boxH = Math.round(fs * 1.7)
      const x = cx - boxW / 2
      const y = cy - boxH / 2
      const rad = Math.max(2, Math.round(boxH * 0.18))
      parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${boxW}" height="${boxH}" rx="${rad}" ry="${rad}" fill="#fff" stroke="#000" stroke-width="${sw}"/>`)
      parts.push(`<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" fill="#000" font-size="${fs}" font-family="Arial, Helvetica, sans-serif" text-anchor="middle" dominant-baseline="central">${escapeSvgText(labelText)}</text>`)
      return
    }
    // identify: numbered black circle with white text.
    parts.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r}" fill="#000" stroke="#fff" stroke-width="${sw}"/>`)
    parts.push(`<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" fill="#fff" font-size="${fs}" font-weight="700" font-family="Arial, Helvetica, sans-serif" text-anchor="middle" dominant-baseline="central">${i + 1}</text>`)
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`
}

// Render a question image with its label markers composited on top, returning a
// centered ImageRun paragraph. `opts.mode` is 'identify' (numbered circles) or
// 'labeled' (text pills). Browser-only: needs a canvas to decode the image and
// rasterize the overlay SVG. Returns null in a DOM-less context (node tests) or
// on any failure, so the caller falls back to the plain image (+ a text list for
// labelled diagrams, the numbered answer blanks for identify).
async function diagramLabelImageParagraph(url, labels, opts = {}) {
  try {
    const bytes = await fetchImageBytes(url)
    if (!bytes) return null
    const type = detectImageType(bytes)
    const decoded = await decodeImage(bytes, type)
    if (!decoded || !decoded.width || !decoded.height) return null
    // decodeImage transcodes WEBP→PNG; everything else keeps its original mime.
    const mime = type === 'webp' ? 'image/png' : (MIME_BY_TYPE[type] || 'image/png')
    const href = `data:${mime};base64,${bytesToBase64(decoded.bytes)}`
    const svg = buildDiagramIdentifySvg({ href, width: decoded.width, height: decoded.height, labels, mode: opts.mode || 'identify' })
    const baseWidth = opts.width || 360
    const baseHeight = opts.height || 220
    const pct = opts.widthPreset ? resolveImageWidthPercent(opts.widthPreset) / 100 : 1
    const fit = fitWithin(decoded.width, decoded.height, Math.round(baseWidth * pct), Math.round(baseHeight * pct))
    // Rasterize at ~2× the embed size for a crisp print.
    const pngBytes = await svgToPngBytes(svg, fit.width * 2, fit.height * 2)
    const run = imageRun(pngBytes, fit, opts.alt || '')
    return run ? centeredPara([run]) : null
  } catch {
    return null
  }
}

// A visible placeholder for a figure that was expected but could not be
// embedded — typically because the image bytes couldn't be read
// cross-origin (Storage CORS not yet applied) or the URL is broken. Without
// this the picture silently vanished, leaving a confusing blank gap that
// teachers only noticed after printing. A dashed red box makes the gap
// obvious and tells them how to recover.
function imageFallbackBlock(alt = '') {
  const label = String(alt || '').trim()
  const dashed = { style: BorderStyle.DASHED, size: 6, color: 'B91C1C' }
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({
      children: [new TableCell({
        borders: { top: dashed, bottom: dashed, left: dashed, right: dashed },
        children: [
          centeredPara(runText(
            `⚠ Figure could not be embedded${label ? ` (${label})` : ''}.`,
            { bold: true, size: 18, color: 'B91C1C' },
          )),
          centeredPara(runText(
            'Open the paper in the studio, regenerate or re-upload the image, then download again.',
            { italics: true, size: 16, color: '6B7280' },
          )),
        ],
      })],
    })],
  })
}

/**
 * Walk a list of paper-layout blocks (from buildPaperLayout or any adapter
 * that emits the same shapes, e.g. buildSbaPaperBlocks) into a flat array of
 * docx children. Shared so the SBA Word export renders the exam paper through
 * the exact same block renderer as the Assessment Studio download.
 *
 * `stats` (optional) is a mutable accumulator: every figure that could not be
 * embedded (and rendered as the dashed-red placeholder instead) pushes its
 * label onto `stats.failedImages`, so callers can warn the teacher instead of
 * shipping a silently-degraded paper.
 */
export async function renderPaperBlocksToDocx(blocks = [], stats = null) {
  const children = []
  for (const block of blocks) {
    const rendered = await renderBlock(block, stats)
    if (Array.isArray(rendered)) children.push(...rendered)
    else if (rendered) children.push(rendered)
  }
  return children
}

function recordImageFailure(stats, label) {
  if (stats && Array.isArray(stats.failedImages)) {
    stats.failedImages.push(String(label || '').trim() || 'figure')
  }
}

async function renderBlock(block, stats = null) {
  switch (block.kind) {
    // The paper banner (school / title / subject / paper) is NOT body content —
    // it is rendered as a real Word page header by paperSectionShell(), so it
    // sits in the header region and matches the preview's banner instead of
    // being the first lines of body text. Skip it here.
    case 'header': return []
    case 'learnerFields': return renderLearnerFields(block)
    case 'instructions': return renderInstructions(block)
    case 'sectionHeader': return renderSectionHeader(block)
    case 'passage': return renderPassage(block, stats)
    case 'question': return renderQuestion(block, stats)
    case 'passageTotal': return [new Paragraph({
      children: [runText(`Total: ${block.totalMarks} mark${block.totalMarks === 1 ? '' : 's'}`, { bold: true, size: 22 })],
      alignment: AlignmentType.RIGHT,
      spacing: { after: 160 },
    })]
    case 'pagebreak': return [new Paragraph({ children: [new PageBreak()] })]
    case 'endOfPaper': return [centeredPara(runText(block.text, { italics: true, size: 20, color: '555555' }))]
    case 'footerCode': return [new Paragraph({
      children: [runText(block.code, { size: 18, color: '555555' })],
      alignment: AlignmentType.RIGHT,
      spacing: { before: 200 },
    })]
    // School footer line (Teacher Settings → My School → Branding).
    case 'schoolFooter': return [centeredPara(runText(block.text, { size: 18, color: '555555' }), { spacing: { before: 120 } })]
    default: return []
  }
}

// The banner paragraphs (school / title / subject / paper) for the paper's real
// Word header. Word can't reproduce the preview's marble banner, so we render
// the same 2–4 line centred stack the body version used, capped with a thin
// rule that divides the header region from the body — mirroring the bottom edge
// of the preview's `.sv-paper-banner` box.
function headerParagraphs(b, logoRun = null) {
  if (!b) return []
  const out = []
  // School logo image, pre-fetched as an ImageRun by the async caller and passed
  // in here. Rendered above the school name, mirroring the PDF and preview banner.
  if (logoRun) {
    out.push(centeredPara([logoRun], { spacing: { after: 40 } }))
  }
  out.push(centeredPara(runText((b.schoolName || 'YOUR SCHOOL NAME').toUpperCase(), { bold: true, size: 32 }), { spacing: { after: 40 } }))
  // School identity lines from Teacher Settings → My School (all optional).
  const addressLine = [b.address, b.emisNumber ? `EMIS: ${b.emisNumber}` : '']
    .filter(Boolean).join(' · ')
  if (addressLine) out.push(centeredPara(runText(addressLine, { size: 18 }), { spacing: { after: 30 } }))
  if (b.motto) out.push(centeredPara(runText(`“${b.motto}”`, { italics: true, size: 18 }), { spacing: { after: 40 } }))
  out.push(centeredPara(runText(b.title, { bold: true, size: 22 }), { spacing: { after: 40 } }))
  if (b.subject) out.push(centeredPara(runText(b.subject, { bold: true, size: 24 }), { spacing: { after: 40 } }))
  if (b.paperName) out.push(centeredPara(runText(b.paperName, { bold: true, size: 22 }), { spacing: { after: 40 } }))
  out.push(new Paragraph({
    children: [runText('')],
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '000000', space: 1 } },
    spacing: { after: 60 },
  }))
  return out
}

/**
 * Build the Word section shell (page headers / footers / title-page flag) for a
 * paper export from its layout blocks. The banner becomes a real **first-page**
 * Word header so it appears once at the top — matching the preview and the PDF,
 * which both show the banner a single time — rather than repeating on every page
 * or living as the opening lines of body text.
 *
 * Free-plan exports (`attribution`) keep the diagonal ZedExams watermark: a Word
 * section has only one header per type, so the watermark is composed INTO the
 * first-page header (above the banner) and a running `default` header carries it
 * onto pages 2+. Paid/admin exports stay clean.
 *
 * Spread into the section literal: `{ ...paperSectionShell(blocks, opts), children }`.
 */
export function paperSectionShell(blocks = [], { attribution = false, logoRun = null } = {}) {
  const headerBlock = blocks.find((b) => b.kind === 'header')
  const banner = headerParagraphs(headerBlock, logoRun)
  const shell = {}
  const headers = {}

  if (banner.length) {
    headers.first = new Header({
      children: [...(attribution ? [attributionWatermarkParagraph()] : []), ...banner],
    })
    // titlePage routes the FIRST page to `headers.first` (the banner) and every
    // later page to `headers.default`, so the banner is printed exactly once.
    shell.properties = { titlePage: true }
  }

  if (attribution) {
    headers.default = new Header({ children: [attributionWatermarkParagraph()] })
    shell.footers = { default: attributionFooter() }
  }

  if (Object.keys(headers).length) shell.headers = headers
  return shell
}

// Pupil's Name / Date / Class render as plain underlined lines — NOT a
// bordered table. The old version wrapped them in a Word table with grey
// cell borders, which printed an ugly box around the name/date section.
// The studio preview and the PDF export both use borderless fill-in lines,
// so the Word output now matches them: Name on the left, Date pushed to
// the right margin via a right tab stop (mirrors the preview's
// space-between row).
function renderLearnerFields(b) {
  if (!b.name && !b.date && !b.classField && !b.marks) return []
  const out = []
  if (b.name || b.date) {
    const children = []
    if (b.name) {
      children.push(runText("Pupil's Name: ", { size: 22, bold: true }))
      children.push(runText('______________________________________', { size: 22 }))
    }
    if (b.date) {
      // Right tab stop at the page margin pushes the date field to the
      // far right, the way the preview's flex row does.
      if (b.name) children.push(new Tab())
      children.push(runText('Date: ', { size: 22, bold: true }))
      children.push(runText('____________________', { size: 22 }))
    }
    out.push(new Paragraph({
      children,
      tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
      spacing: { before: 120, after: b.classField ? 80 : 160 },
    }))
  }
  if (b.classField) {
    out.push(new Paragraph({
      children: [
        runText('Class: ', { size: 22, bold: true }),
        runText('____________________________________', { size: 22 }),
      ],
      spacing: { after: 160 },
    }))
  }
  if (b.marks) {
    out.push(new Paragraph({
      children: [runText(`TOTAL MARKS: _________ / ${b.totalMarks || '____'}`, { bold: true, size: 22 })],
      alignment: AlignmentType.RIGHT,
      spacing: { before: 100, after: 200 },
    }))
  }
  return out
}

function renderInstructions(b) {
  // The preview labels this box "Marking key" in scheme mode and "Instructions"
  // otherwise, and shows it even with no prose (the label alone). The DOCX used
  // to hardcode "Instructions" and drop the whole block when the text was empty,
  // so a marking key with no cover instructions lost its "Marking key" heading.
  const label = b.isMarkingKey ? 'Marking key' : 'Instructions'
  if (!b.text && !b.isMarkingKey) return []
  const out = [para(runText(label, { bold: true, size: 22 }))]
  if (b.text) out.push(...instructionParagraphs(b.text))
  out.push(new Paragraph({ children: [runText('')], spacing: { after: 100 } }))
  return out
}

function renderSectionHeader(b) {
  const title = b.title ? `Section ${b.letter} — ${b.title}` : `Section ${b.letter}`
  const out = [
    new Paragraph({
      children: [
        runText(title.toUpperCase(), { bold: true, size: 26 }),
        runText(`  (${b.marks} mark${b.marks === 1 ? '' : 's'})`, { size: 22, color: '6b7280', italics: true }),
      ],
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 280, after: 100 },
      border: {
        bottom: { color: '000000', size: 6, style: BorderStyle.SINGLE, space: 1 },
      },
    }),
  ]
  if (b.instructions) {
    out.push(para(runText(b.instructions, { italics: true, size: 22, color: '4b5563' })))
  }
  return out
}

async function renderPassage(b, stats = null) {
  const out = []
  if (b.title) {
    out.push(para(runText(b.title.toUpperCase(), { bold: true, size: 22 })))
  }
  if (b.text) {
    b.text.split(/\n\s*\n/).forEach(p => {
      out.push(para(runText(p.replace(/\n/g, ' '), { size: 22, italics: true })))
    })
  }
  if (b.imageUrl) {
    const img = await imageParagraph(b.imageUrl, { width: 380, height: 220, alt: b.imageAlt || b.title || '' })
    if (!img) recordImageFailure(stats, b.imageAlt || b.title)
    out.push(img || imageFallbackBlock(b.imageAlt || b.title || ''))
  }
  if (b.imageDiagram?.libraryKey) {
    const run = await diagramImageRun(b.imageDiagram, { maxWidth: 360, maxHeight: 240 })
    if (run) out.push(new Paragraph({ children: [run], alignment: AlignmentType.CENTER, spacing: { after: 80 } }))
  }
  out.push(new Paragraph({ children: [runText('')], spacing: { after: 100 } }))
  return out
}

// Blank answer space for a written-answer question, honouring the teacher's
// answerFormat: 'none' (no space), 'labelled_blanks' (one "Label: ____" row
// per blankLabels entry), or the default N ruled underscore lines.
const ANSWER_RULE = '______________________________________________________'
function answerSpaceParas(b, defaultLines) {
  if (b.answerFormat === 'none') return []
  if (b.answerFormat === 'labelled_blanks' && Array.isArray(b.blankLabels) && b.blankLabels.length) {
    return b.blankLabels.map(label => para([
      runText(`${label}:  `, { bold: true, size: 20 }),
      runText('________________________________________', { size: 20 }),
    ]))
  }
  // `answerLines == null` means "not set → use the default". The `!= null`
  // guard matters because Number(null) is 0, which would otherwise satisfy
  // `isFinite && >= 0` and collapse every default-spaced question (essay /
  // short / diagram) to ZERO ruled lines — the default-lines fallback was dead.
  // An explicit 0 still prints no lines (use answerFormat 'none' for that too).
  const n = b.answerLines != null && Number.isFinite(Number(b.answerLines)) && Number(b.answerLines) >= 0
    ? Number(b.answerLines)
    : defaultLines
  const out = []
  for (let i = 0; i < n; i += 1) {
    out.push(para(runText(ANSWER_RULE, { size: 20 })))
  }
  return out
}

// A fixed-width dotted gap for an inline sub-part blank ("called …………… [1]").
const INLINE_GAP = '………………………'

// Render a question's short-answer SUB-PARTS as Word paragraphs:
//   (a)  <sentence with an inline dotted blank>           [1]
// honouring each part's answer-space choice ('inline' dotted gap — the default;
// 'lines' ruled lines below the part; or 'none'). The answers themselves are
// printed in the green marking-key block, not here.
function subPartParas(subParts) {
  const out = []
  subParts.forEach((part, i) => {
    const label = subPartLabel(i)
    const text = String(part?.text ?? '')
    const format = part?.answerFormat || 'inline'
    const marks = Number(part?.marks) || 0
    const marksTag = marks > 0 ? `  [${marks}]` : ''
    const runs = [runText(`(${label})  `, { bold: true, size: 22 })]
    if (format === 'inline') {
      if (countPartBlanks(text) > 0) {
        const segments = splitPartBlanks(text)
        segments.forEach((segment, k) => {
          if (segment) runs.push(runText(segment, { size: 22 }))
          if (k < segments.length - 1) runs.push(runText(` ${INLINE_GAP} `, { size: 22 }))
        })
      } else {
        if (text) runs.push(runText(`${text} `, { size: 22 }))
        runs.push(runText(INLINE_GAP, { size: 22 }))
      }
    } else {
      runs.push(runText(text, { size: 22 }))
    }
    if (marksTag) runs.push(runText(marksTag, { size: 20, color: '6b7280', italics: true }))
    out.push(new Paragraph({ children: runs, spacing: { before: 60, after: format === 'lines' ? 20 : 40 } }))
    if (format === 'lines') {
      const lines = part?.answerLines != null && Number.isFinite(Number(part.answerLines)) && Number(part.answerLines) >= 0
        ? Number(part.answerLines)
        : DEFAULT_ANSWER_LINES.short
      for (let k = 0; k < lines; k += 1) out.push(para(runText(ANSWER_RULE, { size: 20 })))
    }
  })
  return out
}

async function renderQuestion(b, stats = null) {
  const out = []
  const marks = b.marks ?? 1
  const marksTag = marks >= 1 ? `  (${marks} mark${marks === 1 ? '' : 's'})` : ''

  // When the question carries pre-hydrated rich HTML, walk it so the
  // Grade-7 math blocks (vertical sums, fractions, number bases) come
  // out with the right Word formatting instead of being flattened to
  // plain text. Otherwise fall back to the simple single-line render.
  if (b.textHtml && b.textHtml.trim()) {
    const richParas = richHtmlToDocxParagraphs(b.textHtml, { size: 22 }, {
      prefixRuns: [runText(`${b.number}. `, { bold: true, size: 22 })],
      suffixRuns: marksTag
        ? [runText(marksTag, { size: 20, color: '6b7280', italics: true })]
        : [],
      firstParaSpacing: { before: 160, after: 80 },
    })
    out.push(...richParas)
  } else {
    out.push(new Paragraph({
      children: [
        runText(`${b.number}. `, { bold: true, size: 22 }),
        runText(b.text || '(no question text)', { size: 22 }),
        runText(marksTag, { size: 20, color: '6b7280', italics: true }),
      ],
      spacing: { before: 160, after: 80 },
    }))
  }

  if (b.imageUrl) {
    const labels = Array.isArray(b.diagramLabels) ? b.diagramLabels : []
    const isIdentify = b.diagramMode === 'identify'
    // Bake the hotspot markers onto the image — identify: numbered circles so
    // the answer blanks below point at something; labeled: the label text pills
    // the preview overlays — since Word can't overlay positioned elements. Falls
    // back to the plain image (+ a text list for labelled diagrams) when the
    // composite is unavailable (no DOM / fetch failure). Skipped for MCQs, whose
    // image lives in the option grid, not the stem.
    let img = null
    let composited = false
    if (b.type !== 'mcq' && labels.length) {
      img = await diagramLabelImageParagraph(b.imageUrl, labels, {
        mode: isIdentify ? 'identify' : 'labeled',
        alt: b.imageAlt || '',
        widthPreset: b.imageWidth,
      })
      composited = Boolean(img)
    }
    if (!img) img = await imageParagraph(b.imageUrl, { alt: b.imageAlt || '', widthPreset: b.imageWidth })
    if (!img) recordImageFailure(stats, b.imageAlt || (b.number != null ? `question ${b.number}` : ''))
    out.push(img || imageFallbackBlock(b.imageAlt || ''))
    if (labels.length) {
      if (isIdentify && b.type !== 'mcq') {
        // Identify mode: emit numbered blank-answer lines below the image
        // for the student to fill in (the preview shows the same list). The
        // expected answers go into the marking key paragraph (below, in the
        // showAnswer branch). Skipped for MCQs, whose A/B/C/D options already
        // are the answer space.
        for (let i = 0; i < labels.length; i += 1) {
          out.push(para([
            runText(`${i + 1}. `, { bold: true, size: 20 }),
            runText('______________________________________________________', { size: 20 }),
          ]))
        }
      } else if (!isIdentify && !composited) {
        // Labelled mode, but the on-image pill composite wasn't available (no
        // DOM / unreadable image) — fall back to a numbered text list so the
        // labels aren't lost, ordered top-to-bottom then left-to-right. When the
        // composite DID render, the pills are on the image and this would be a
        // duplicate, so it's skipped (matching the preview, which shows no list).
        const sorted = [...labels].sort((a, c) => (a.y - c.y) || (a.x - c.x))
        const text = sorted.map((l, i) => `${i + 1}. ${l.text}`).join('   ')
        out.push(para([
          runText('Labels: ', { bold: true, size: 20 }),
          runText(text, { size: 20 }),
        ]))
      }
    }
  }
  // Additional figures stacked below the primary (multi-figure questions). Each
  // is fetched independently; a failed fetch shows the dashed-red placeholder.
  if (Array.isArray(b.images)) {
    for (const extra of b.images) {
      if (extra && extra.url) {
        const run = await imageParagraph(extra.url, { alt: extra.alt || '', widthPreset: extra.width })
        if (!run) recordImageFailure(stats, extra.alt || (b.number != null ? `question ${b.number}` : ''))
        out.push(run || imageFallbackBlock(extra.alt || ''))
      }
    }
  }
  if (b.imageDiagram?.libraryKey) {
    const run = await diagramImageRun(b.imageDiagram, { maxWidth: 360, maxHeight: 240 })
    if (run) out.push(centeredPara([run]))
  }
  if (b.tableData) {
    // Unfold the persisted { cells } row shape when the block came straight
    // from a Firestore doc (see src/utils/tableData.js); in-memory string[][]
    // rows pass through unchanged.
    const table = hydrateTableData(b.tableData) || { headers: [], rows: [] }
    const headers = table.headers
    const rows = table.rows
    if (headers.length) {
      const headerRow = new TableRow({
        children: headers.map(h => new TableCell({
          width: { size: Math.floor(100 / headers.length), type: WidthType.PERCENTAGE },
          children: [para(runText(String(h || ''), { bold: true, size: 20 }))],
        })),
      })
      const bodyRows = rows.map(row => new TableRow({
        children: headers.map((_, j) => new TableCell({
          children: [para(runText(String((Array.isArray(row) ? row[j] : '') || ''), { size: 20 }))],
        })),
      }))
      out.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [headerRow, ...bodyRows],
      }))
    }
  }
  if (b.type !== 'fill_blanks' && b.wordBank && b.wordBank.length) {
    out.push(para([
      runText('Word bank: ', { bold: true, size: 20 }),
      runText(b.wordBank.join(' · '), { size: 20 }),
    ]))
  }

  if (b.type === 'fill_blanks') {
    // Fill-in-the-Blanks: an optional word-bank line, then each statement on
    // its own paragraph ("A. … __________ …") with generous spacing. In the
    // marking key (showAnswer) each blank is filled with its answer in green.
    if (b.wordBank && b.wordBank.length) {
      out.push(para([
        runText('Word Bank: ', { bold: true, size: 22 }),
        runText(b.wordBank.join(', '), { size: 22 }),
      ], { spacing: { after: 160 } }))
    }
    const statements = Array.isArray(b.statements) ? b.statements : []
    statements.forEach((statement, i) => {
      const runs = [runText(`${statementLabel(i)}.  `, { bold: true, size: 22 })]
      const segments = splitStatementSegments(String(statement?.text ?? ''))
      const answers = Array.isArray(statement?.answers) ? statement.answers : []
      segments.forEach((segment, segIndex) => {
        if (segment) runs.push(runText(segment, { size: 22 }))
        if (segIndex < segments.length - 1) {
          const answer = answers[segIndex]
          if (b.showAnswer && answer) {
            runs.push(runText(answer, { size: 22, bold: true, color: '047857' }))
          } else {
            runs.push(runText(' __________ ', { size: 22 }))
          }
        }
      })
      out.push(para(runs, { spacing: { after: 200 } }))
    })
  } else if (b.type === 'mcq' || b.type === 'truefalse' || b.type === 'true_false' || b.type === 'tf') {
    // True/False renders identically to a 2-option MCQ — buildQuestionBlock
    // defaults its options to ['True','False'] and keeps correctAnswer as the
    // index, so the same option-row + marking-key code handles both.
    const optsHtml = b.optionsHtml || []
    const optsPlain = b.optionsPlain || []
    if (b.optionsMode === 'image') {
      const opts = b.options || []
      for (let row = 0; row < Math.ceil(opts.length / 2); row += 1) {
        const cells = []
        for (let col = 0; col < 2; col += 1) {
          const i = row * 2 + col
          if (i >= opts.length) break
          const media = b.optionMedia?.[i]
          const cellChildren = []
          if (media?.diagram?.libraryKey) {
            const run = await diagramImageRun(media.diagram, { maxWidth: 150, maxHeight: 150 })
            if (run) cellChildren.push(centeredPara([run]))
          } else if (media?.imageUrl) {
            const run = await loadImageRun(media.imageUrl, { width: 140, height: 140, alt: media.alt || '' })
            if (run) cellChildren.push(centeredPara([run]))
          }
          const isCorrect = b.showAnswer && Number(b.correctAnswer) === i
          const labelOpts = { bold: true, size: 20, color: isCorrect ? '047857' : undefined }
          const runOpts = { size: 20, color: isCorrect ? '047857' : undefined, bold: isCorrect }
          const optRunsList = optionRuns(optsHtml[i], runOpts, optsPlain[i] || opts[i] || '')
          cellChildren.push(centeredPara([
            runText(`${SECTION_LETTERS[i]}.`, labelOpts),
            ...(optsPlain[i] || opts[i] ? [runText(' ', runOpts), ...optRunsList] : []),
            isCorrect ? runText(' ✓', { bold: true, color: '047857', size: 20 }) : runText(''),
          ]))
          cells.push(new TableCell({
            children: cellChildren,
            borders: BORDER,
            width: { size: 50, type: WidthType.PERCENTAGE },
          }))
        }
        if (cells.length) {
          out.push(new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [new TableRow({ children: cells })],
          }))
        }
      }
    } else if (b.optionsMode === 'mixed') {
      for (let i = 0; i < (b.options || []).length; i += 1) {
        const media = b.optionMedia?.[i]
        const isCorrect = b.showAnswer && Number(b.correctAnswer) === i
        const labelOpts = { bold: true, size: 20, color: isCorrect ? '047857' : undefined }
        const runOpts = { size: 20, color: isCorrect ? '047857' : undefined, bold: isCorrect }
        const runs = [runText(`   ${SECTION_LETTERS[i]}. `, labelOpts)]
        if (media?.diagram?.libraryKey) {
          const run = await diagramImageRun(media.diagram, { maxWidth: 60, maxHeight: 60 })
          if (run) {
            runs.push(run)
            runs.push(runText('  ', { size: 20 }))
          }
        } else if (media?.imageUrl) {
          const run = await loadImageRun(media.imageUrl, { width: 50, height: 50, alt: media.alt || '' })
          if (run) {
            runs.push(run)
            runs.push(runText('  ', { size: 20 }))
          }
        }
        runs.push(...optionRuns(optsHtml[i], runOpts, optsPlain[i] ?? b.options[i] ?? ''))
        if (isCorrect) runs.push(runText(' ✓', { bold: true, color: '047857', size: 20 }))
        out.push(para(runs))
      }
    } else if (b.mcqLayout === 'horizontal') {
      // All options on one line, e.g. "A. red    B. blue    C. green".
      const runs = []
      ;(b.options || []).forEach((opt, i) => {
        const isCorrect = b.showAnswer && Number(b.correctAnswer) === i
        const labelOpts = { bold: true, size: 20, color: isCorrect ? '047857' : undefined }
        const runOpts = { size: 20, color: isCorrect ? '047857' : undefined, bold: isCorrect }
        runs.push(runText(`${i === 0 ? '   ' : '      '}${SECTION_LETTERS[i]}. `, labelOpts))
        runs.push(...optionRuns(optsHtml[i], runOpts, optsPlain[i] ?? opt ?? ''))
        if (isCorrect) runs.push(runText(' ✓', { bold: true, color: '047857', size: 20 }))
      })
      out.push(new Paragraph({ children: runs, spacing: { after: 40 } }))
    } else {
      ;(b.options || []).forEach((opt, i) => {
        const isCorrect = b.showAnswer && Number(b.correctAnswer) === i
        const labelOpts = { bold: true, size: 20, color: isCorrect ? '047857' : undefined }
        const runOpts = { size: 20, color: isCorrect ? '047857' : undefined, bold: isCorrect }
        out.push(new Paragraph({
          children: [
            runText(`   ${SECTION_LETTERS[i]}. `, labelOpts),
            ...optionRuns(optsHtml[i], runOpts, optsPlain[i] ?? opt ?? ''),
            isCorrect ? runText('  ✓', { bold: true, color: '047857', size: 20 }) : runText(''),
          ],
          spacing: { after: 40 },
        }))
      })
    }
  } else if (b.type === 'short_answer' || b.type === 'short' || b.type === 'fill') {
    if (Array.isArray(b.subParts) && b.subParts.length > 0) {
      subPartParas(b.subParts).forEach(p => out.push(p))
    } else {
      answerSpaceParas(b, DEFAULT_ANSWER_LINES.short).forEach(p => out.push(p))
    }
  } else if (b.type === 'numeric') {
    // One short blank line followed by the unit (if any). Fixed-width
    // underscore run roughly matches the 160pt line in the PDF.
    const unitSuffix = b.numericUnit ? ` ${b.numericUnit}` : ''
    out.push(para([
      runText('___________________', { size: 20 }),
      runText(unitSuffix, { size: 20 }),
    ]))
  } else if (b.type === 'matching') {
    // Two-column table with the left prompts and right options. We use
    // a real Word table so the columns stay aligned even when Word
    // reflows the page; students draw lines between them by hand.
    const left = Array.isArray(b.matchingLeft) ? b.matchingLeft : []
    const right = Array.isArray(b.matchingRight) ? b.matchingRight : []
    const rows = Math.max(left.length, right.length)
    const tableRows = []
    for (let i = 0; i < rows; i += 1) {
      tableRows.push(new TableRow({
        children: [
          new TableCell({
            width: { size: 50, type: WidthType.PERCENTAGE },
            children: [para([
              runText(`${i + 1}. `, { bold: true, size: 20 }),
              runText(String(left[i] || ''), { size: 20 }),
            ])],
          }),
          new TableCell({
            width: { size: 50, type: WidthType.PERCENTAGE },
            children: [para([
              runText(`${SECTION_LETTERS[i] || '?'}. `, { bold: true, size: 20 }),
              runText(String(right[i] || ''), { size: 20 }),
            ])],
          }),
        ],
      }))
    }
    if (tableRows.length) {
      out.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: tableRows }))
    }
  } else if (b.type === 'sequence') {
    // One line per item, prefixed with a short blank where the student
    // writes the correct position.
    const items = Array.isArray(b.sequenceItems) ? b.sequenceItems : []
    for (const it of items) {
      out.push(para([
        runText('______  ', { size: 20 }),
        runText(String(it || ''), { size: 20 }),
      ]))
    }
  }

  // Drawing canvas, THEN (for diagram/essay) the ruled answer lines — the same
  // block order the preview uses (PaperBlocks.jsx draws the canvas above the
  // type-specific answer space). The DOCX used to print the ruled lines first
  // and drop the canvas underneath, flipping the layout for a Draw-&-Label /
  // essay question that also carried a drawing canvas.
  if (Number.isFinite(Number(b.drawingHeight)) && Number(b.drawingHeight) > 0) {
    // Word doesn't have a native "blank canvas" primitive, but a single
    // 1×1 table with a fixed row height + thin borders gives students
    // a clean box to draw inside. height is in twentieths of a point
    // (twips), so multiply pt by 20.
    const heightTwips = Math.round(Number(b.drawingHeight) * 20)
    out.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [new TableRow({
        height: { value: heightTwips, rule: HeightRule.ATLEAST },
        children: [new TableCell({
          children: [para(runText('', { size: 20 }))],
        })],
      })],
    }))
  }

  if (b.type === 'diagram') {
    answerSpaceParas(b, DEFAULT_ANSWER_LINES.diagram).forEach(p => out.push(p))
  } else if (b.type === 'essay') {
    answerSpaceParas(b, DEFAULT_ANSWER_LINES.essay).forEach(p => out.push(p))
  }

  if (b.showAnswer) {
    if (Array.isArray(b.subParts) && b.subParts.length > 0) {
      const pairs = b.subParts
        .map((p, i) => `(${subPartLabel(i)}) ${String(p?.answer ?? '').trim() || '—'}`)
        .join('   ')
      out.push(para([
        runText('Answers: ', { bold: true, size: 20, color: '047857' }),
        runText(pairs, { size: 20, color: '047857' }),
      ]))
    } else if (b.type === 'diagram' && b.diagramMode === 'identify' && Array.isArray(b.diagramLabels) && b.diagramLabels.length) {
      const pairs = b.diagramLabels.map((l, i) => `${i + 1}. ${l.text || '—'}`).join('   ')
      out.push(para([
        runText('Answers: ', { bold: true, size: 20, color: '047857' }),
        runText(pairs, { size: 20, color: '047857' }),
      ]))
    } else if (b.type === 'mcq' || b.type === 'truefalse' || b.type === 'true_false' || b.type === 'tf') {
      const i = Number(b.correctAnswer)
      const letter = SECTION_LETTERS[i] || '?'
      // Plain mirror first so a rich fraction option reads as "1/3" rather than
      // its literal `<span class="math-frac">` HTML.
      const opt = b.optionsPlain?.[i] ?? b.options?.[i] ?? ''
      out.push(para([
        runText('Answer: ', { bold: true, size: 20, color: '047857' }),
        runText(`${letter}. ${opt}`, { size: 20, color: '047857' }),
      ]))
    } else if (b.type === 'numeric') {
      const value = String(b.correctAnswer ?? '')
      const unit = b.numericUnit ? ` ${b.numericUnit}` : ''
      const tol = Number(b.numericTolerance) > 0 ? ` (±${b.numericTolerance})` : ''
      out.push(para([
        runText('Expected answer: ', { bold: true, size: 20, color: '047857' }),
        runText(`${value}${unit}${tol}`, { size: 20, color: '047857' }),
      ]))
    } else if (b.type === 'matching') {
      const left = Array.isArray(b.matchingLeft) ? b.matchingLeft : []
      const right = Array.isArray(b.matchingRight) ? b.matchingRight : []
      const answer = Array.isArray(b.matchingAnswer) ? b.matchingAnswer : []
      const pairs = left.map((_, i) => {
        const j = Number(answer[i])
        if (!Number.isInteger(j) || j < 0) return `${i + 1}→—`
        const letter = SECTION_LETTERS[j] || '?'
        const r = right[j] || ''
        return `${i + 1}→${letter}${r ? ` (${r})` : ''}`
      }).join('   ')
      out.push(para([
        runText('Answer: ', { bold: true, size: 20, color: '047857' }),
        runText(pairs, { size: 20, color: '047857' }),
      ]))
    } else if (b.type === 'sequence') {
      const items = Array.isArray(b.sequenceItems) ? b.sequenceItems : []
      const answer = Array.isArray(b.sequenceAnswer) ? b.sequenceAnswer : []
      const ordered = items
        .map((it, idx) => ({ pos: Number(answer[idx]) || 999, text: it }))
        .sort((a, b2) => a.pos - b2.pos)
      const seq = ordered.map(e => {
        const label = e.pos < 999 ? `${e.pos}.` : '?'
        return `${label} ${e.text || '—'}`
      }).join('   ')
      out.push(para([
        runText('Correct order: ', { bold: true, size: 20, color: '047857' }),
        runText(seq, { size: 20, color: '047857' }),
      ]))
    } else if (b.type === 'fill_blanks') {
      // Fill-in-the-blanks answers are already rendered inline (green) on each
      // statement in the marking-key pass above — nothing more to print here.
    } else {
      out.push(para([
        runText('Expected answer: ', { bold: true, size: 20, color: '047857' }),
        runText(String(b.correctAnswer ?? ''), { size: 20, color: '047857' }),
      ]))
    }
    if (b.explanation) {
      out.push(para([
        runText('Notes: ', { bold: true, size: 18, color: '6b7280' }),
        runText(b.explanation, { size: 18, color: '6b7280', italics: true }),
      ]))
    }
  }
  return out
}

export async function buildAssessmentDocument(assessment, questions, { mode = 'paper', attribution = false, stats = null } = {}) {
  const blocks = buildPaperLayout(assessment, questions, { mode })
  const children = await renderPaperBlocksToDocx(blocks, stats)

  // Pre-fetch the school logo for the Word header. The PDF reads b.logoUrl ||
  // b.schoolLogoUrl; mirror that lookup so both exports stay in step.
  const headerBlock = blocks.find((b) => b.kind === 'header')
  let logoRun = null
  const logoUrl = headerBlock && (headerBlock.logoUrl || headerBlock.schoolLogoUrl)
  if (logoUrl) {
    logoRun = await loadImageRun(logoUrl, { width: 60, height: 60, alt: 'School logo' })
    if (!logoRun) recordImageFailure(stats, 'school logo')
  }

  const title = sanitizeXmlText(mode === 'scheme'
    ? `${assessment.title || 'Assessment'} — Marking Key`
    : (assessment.title || 'Assessment'))

  return new Document({
    creator: 'zedexams.com',
    title,
    description: 'Generated by ZedExams Test Paper Studio',
    styles: {
      default: {
        document: { run: { font: 'Times New Roman', size: 22 } },
      },
    },
    sections: [{ ...paperSectionShell(blocks, { attribution, logoRun }), children }],
  })
}

// Build the answer-sheet rows as a two-column table: each cell is
// "N.  (A) (B) (C) (D)" for an MCQ, or "N.  ____" for a write-in question.
function answerSheetCell(item) {
  if (!item) return new TableCell({ children: [para(runText(''))], borders: NO_BORDER })
  const runs = [runText(`${item.number}.  `, { bold: true, size: 22 })]
  if (item.kind === 'mcq') {
    ANSWER_SHEET_LETTERS.slice(0, item.optionCount).forEach((letter) => {
      runs.push(runText(`(${letter})  `, { size: 22 }))
    })
  } else {
    runs.push(runText('______________________', { size: 22 }))
  }
  return new TableCell({ children: [para(runs, { spacing: { after: 40 } })], borders: NO_BORDER })
}

const NO_BORDER = {
  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
}

export async function buildAnswerSheetDocument(assessment, questions, { attribution = false } = {}) {
  const sheet = buildAnswerSheet(assessment, questions)
  const children = []
  children.push(centeredPara(runText((sheet.schoolName || 'YOUR SCHOOL NAME').toUpperCase(), { bold: true, size: 30 })))
  children.push(centeredPara(runText(sheet.title, { bold: true, size: 22 })))
  if (sheet.subject) children.push(centeredPara(runText(sheet.subject, { bold: true, size: 24 })))
  children.push(centeredPara(runText('ANSWER SHEET', { bold: true, size: 20, color: '555555' })))
  children.push(new Paragraph({ children: [runText('')], spacing: { after: 100 } }))

  if (sheet.name || sheet.date) {
    const parts = []
    if (sheet.name) parts.push(runText("Name: ______________________________________", { size: 22 }))
    if (sheet.name && sheet.date) parts.push(runText('    ', { size: 22 }))
    if (sheet.date) parts.push(runText('Date: ____________________', { size: 22 }))
    children.push(para(parts, { spacing: { after: 120 } }))
  }
  children.push(para(runText('Shade or circle the letter of your chosen answer.', { italics: true, size: 18, color: '555555' })))

  // Two columns: pair up consecutive items left→right.
  const rows = []
  for (let i = 0; i < sheet.items.length; i += 2) {
    rows.push(new TableRow({
      children: [answerSheetCell(sheet.items[i]), answerSheetCell(sheet.items[i + 1])],
    }))
  }
  if (rows.length) {
    children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }))
  } else {
    children.push(para(runText('No questions to answer yet.', { italics: true, size: 20, color: '777777' })))
  }

  return new Document({
    creator: 'zedexams.com',
    title: sanitizeXmlText(`${sheet.title} — Answer Sheet`),
    description: 'Answer sheet generated by ZedExams Test Paper Studio',
    styles: { default: { document: { run: { font: 'Times New Roman', size: 22 } } } },
    sections: [{ ...attributionSection({ attribution }), children }],
  })
}

export async function downloadAnswerSheetDocx(assessment, questions, filename = 'answer-sheet.docx', opts = {}) {
  const doc = await buildAnswerSheetDocument(assessment, questions, opts)
  const blob = await Packer.toBlob(doc)
  await saveBlob(blob, filename)
}

export async function downloadAssessmentDocx(assessment, questions, filename = 'assessment.docx', opts = {}) {
  // Collect figure-embed failures during the build so the studio can warn the
  // teacher — the paper still downloads (placeholders mark the gaps), but the
  // loss must not be silent.
  const stats = { failedImages: [] }
  const doc = await buildAssessmentDocument(assessment, questions, { ...opts, stats })
  const blob = await Packer.toBlob(doc)
  await saveBlob(blob, filename)
  return { failedImages: stats.failedImages.length }
}
