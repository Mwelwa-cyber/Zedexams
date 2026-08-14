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
  PageOrientation,
  Paragraph,
  Tab,
  TableCell,
  TableRow,
  Table,
  TabStopPosition,
  TabStopType,
  TextRun,
  WidthType,
  Math as OMath,
  MathRun,
  MathFraction,
  MathRadical,
  MathSuperScript,
  MathSubScript,
} from 'docx'
import { attributionSection, attributionFooter, attributionWatermarkParagraph } from './docxAttribution.js'
import { DEFAULT_ANSWER_LINES } from './assessmentPaperLayout.js'
import { buildAssessmentDocument } from './assessmentDocument.js'
import { mmToTwip } from '../config/paperLayoutTokens.js'
import { resolveImageWidthPercent } from './imageWidth.js'
import { figureBox, embedBox } from './figureSizing.js'
import {
  censusFromPixels, summariseColours, assessFigurePrintability, figurePrintWarning,
} from './figureContrast.js'
import { resolveFigureLabels, resolveAnswerKeyLabels } from './figureLabelLayout.js'
import {
  unresolvedFigure, unresolvedFigureMessage, UnresolvedFigureError,
} from './unresolvedFigures.js'
import { seedBandForLevel } from './assessmentBandService.js'
import { renderDiagramSvg } from '../curriculum/diagrams/diagramCatalog.js'
import { svgToPngBytes, decodeImageBytes } from './svgRasterizer.js'
import { hydrateTableData } from './tableData.js'
import {
  parsePaperContent, contentToPlainText, columnWidth,
} from './paperContentModel.js'
import { latexToMathTree, needsEquation } from './latexToUnicode.js'
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

/**
 * Word's keep-together flags (§4.5).
 *
 * `keepNext` binds a paragraph to the one after it; `keepLines` stops a single
 * paragraph splitting mid-way. Together they prevent the three layout failures
 * the brief names: a section heading stranded alone at the foot of a page, a
 * figure detached from the question it belongs to, and a question stem broken
 * across a page break.
 *
 * Applied deliberately narrowly — to headings, question stems and figures, never
 * to answer lines. `keepNext` on everything would chain the whole paper into one
 * unbreakable block and Word would push it onto a fresh page, leaving exactly the
 * big gaps this is meant to avoid.
 */
const KEEP_WITH_NEXT = { keepNext: true, keepLines: true }

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
 * Turn the shared content model into Word runs and paragraphs (§4.1).
 *
 * This file used to carry its own DOM walker over the paper HTML — marks,
 * sup/sub, stacked fractions, number bases, vertical arithmetic, line breaks —
 * duplicating the parse the print window was doing separately over the same
 * string. Two parsers over one format is the drift the shared block model exists
 * to prevent: a fix to one silently left the other behind.
 *
 * The parse now happens once, in paperContentModel.js, and everything below is a
 * MAPPING from typed nodes onto docx objects. No tag names, no attributes, no
 * classList checks — if a construct is missing here it is missing from the model,
 * which is one place to look instead of three.
 */

/** The content-model marks, as docx run properties. */
function runMarks(marks = {}) {
  const out = {}
  if (marks.bold) out.bold = true
  if (marks.italic) out.italics = true
  if (marks.underline) out.underline = {}
  if (marks.strike) out.strike = true
  if (marks.sup) out.superScript = true
  if (marks.sub) out.subScript = true
  return out
}

/**
 * A structured fraction in Word: superscript-numerator, solidus,
 * subscript-denominator.
 *
 * This is NOT the school notation the rest of the phase enforces, and the gap
 * is deliberate rather than overlooked. §5 rules out both the diagonal solidus
 * and a superscript-over-subscript imitation, and nothing in
 * WordprocessingML puts one number above another except an OMML equation — so
 * the fix is to emit one, and the machinery to do it is already in this file
 * (`mathTreeToOmml`, used for LaTeX-derived formulas).
 *
 * It was tried, and the visual gate refused it: rendered through LibreOffice,
 * the digits inside the equation stop appearing in the PDF's text layer, so
 * `assertPagePrintsItsContent` reported vr-001 as a paper missing its own
 * denominator. No fixture has ever routed content through the OMML path, so
 * the existing LaTeX equations are unverified through LibreOffice too — this
 * change was simply the first thing to ask the question.
 *
 * Whether LibreOffice DRAWS the equation and merely omits it from the text
 * layer, or does not draw it at all, is not something this repository can
 * currently answer, and the two differ by every fraction on every maths paper
 * for the many Zambian schools on LibreOffice. §9's own wording is "use native
 * equation support where the current exporter can do so RELIABLY... where a
 * native equation is not available, use the project's validated mathematics
 * fallback." Unverifiable is not reliable, so the validated fallback stands
 * until someone can confirm a real LibreOffice render.
 *
 * The preview, the print window and the PDF all draw a true horizontal bar
 * today; Word is the one renderer still on this form.
 */
function fractionRuns(node, baseOpts, marks) {
  const num = String(node.numerator ?? '')
  const den = String(node.denominator ?? '')
  return [
    ...(node.whole ? [runText(`${node.whole} `, { ...baseOpts, ...marks })] : []),
    runText(num, { ...baseOpts, ...marks, superScript: true }),
    runText('⁄', { ...baseOpts, ...marks }),
    runText(den, { ...baseOpts, ...marks, subScript: true }),
  ]
}

/** One inline node as docx runs. */
function inlineRuns(node, baseOpts) {
  const marks = runMarks(node.marks)
  if (node.type === 'text') return [runText(node.value, { ...baseOpts, ...marks })]
  if (node.type === 'break') return [runText('\n', { ...baseOpts, break: 1 })]
  if (node.type === 'fraction') return fractionRuns(node, baseOpts, marks)
  if (node.type === 'numberBase') {
    const runs = [runText(node.number, { ...baseOpts, ...marks })]
    if (node.base) runs.push(runText(node.base, { ...baseOpts, ...marks, subScript: true }))
    return runs
  }
  if (node.type === 'math') return mathNodeRuns(node, baseOpts)
  return []
}

/**
 * A math tree as OMML — a real Word equation object (§4.2).
 *
 * "For DOCX, emit real OMML equations — Word mangles anything else." A stacked
 * fraction, a radical with its vinculum and a properly-set exponent are what
 * make a maths paper look typeset rather than transcribed, and Word can only
 * draw them from its own equation markup.
 *
 * Only genuinely two-dimensional formulas come through here (see
 * `needsEquation`). An inline power or a chemical formula stays as ordinary text
 * runs with real superscript/subscript: Word renders those perfectly, a teacher
 * can still edit them as text, and wrapping "H₂SO₄" in an equation object makes
 * a worse artefact than the text it replaced.
 */
function mathTreeToOmml(nodes) {
  const out = []
  for (const node of nodes || []) {
    if (node.type === 'run') {
      out.push(new MathRun(sanitizeXmlText(node.text)))
      continue
    }
    if (node.type === 'frac') {
      out.push(new MathFraction({
        numerator: mathTreeToOmml(node.numerator),
        denominator: mathTreeToOmml(node.denominator),
      }))
      continue
    }
    if (node.type === 'radical') {
      out.push(new MathRadical({
        children: mathTreeToOmml(node.radicand),
        ...(node.degree ? { degree: mathTreeToOmml(node.degree) } : {}),
      }))
      continue
    }
    if (node.type === 'sup') {
      out.push(new MathSuperScript({
        children: mathTreeToOmml(node.base),
        superScript: mathTreeToOmml(node.script),
      }))
      continue
    }
    if (node.type === 'sub') {
      out.push(new MathSubScript({
        children: mathTreeToOmml(node.base),
        subScript: mathTreeToOmml(node.script),
      }))
      continue
    }
  }
  return out
}

/**
 * A formula as either a Word equation or the pre-flattened text runs.
 *
 * The brief's fallback rule read strictly: never silently drop a formula. If the
 * tree cannot be built, or OMML construction throws on some construct this does
 * not model, the linear rendering the content model already carries is used —
 * which is exactly what the paper printed before OMML existed, so the worst case
 * is no worse than the status quo.
 */
function mathNodeRuns(node, baseOpts) {
  const fallback = () => (node.fallback || []).flatMap((n) => inlineRuns(n, baseOpts))
  if (!node.tex) return fallback()
  try {
    const tree = latexToMathTree(node.tex)
    if (!tree.length || !needsEquation(tree)) return fallback()
    const children = mathTreeToOmml(tree)
    if (!children.length) return fallback()
    return [new OMath({ children })]
  } catch (err) {
    console.warn('[assessmentToDocx] OMML build failed, using the text form', err)
    return fallback()
  }
}

/** Every inline node of a paragraph, flattened to runs. */
function paragraphRuns(block, baseOpts) {
  return (block.children || []).flatMap((node) => inlineRuns(node, baseOpts))
}

/**
 * A vertical sum as a monospace column stack. The padding matches
 * paperContentModel's own HTML rendering (both call columnWidth), so the printed
 * paper and the Word download line up digit for digit.
 */
function verticalArithmeticParagraphs(block, baseOpts) {
  const width = columnWidth(block)
  const pad = (v) => String(v ?? '').padStart(width, ' ')
  const mono = { ...baseOpts, font: 'Consolas' }
  const out = block.lines.map((line, i) => new Paragraph({
    children: [runText(`${i === block.lines.length - 1 ? block.operator : ' '}  ${pad(line)}`, mono)],
    spacing: { after: 0 },
  }))
  out.push(new Paragraph({
    children: [runText(`   ${'─'.repeat(width)}`, mono)],
    spacing: { after: 0 },
  }))
  out.push(new Paragraph({
    children: [runText(`   ${pad(block.answer)}`, mono)],
    spacing: { after: block.working ? 0 : 120 },
  }))
  // Ruled space for a learner to show their method. The editor offers it per
  // sum and the preview draws it; Word dropped it, because the flag never got
  // as far as the content model. Two underlined blank lines is the same
  // affordance the answer-lines elsewhere on the paper use.
  if (block.working) {
    for (let i = 0; i < 2; i += 1) {
      out.push(new Paragraph({
        children: [runText('   ' + ' '.repeat(Math.max(width, 4)), mono)],
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '888888' } },
        spacing: { after: i === 1 ? 120 : 60 },
      }))
    }
  }
  return out
}

/**
 * Content model → docx Paragraphs.
 *
 * @param {object[]} nodes  content-model blocks
 * @param {object} baseOpts run options every run inherits (size, font)
 * @param {object} [opts]   prefixRuns / suffixRuns / firstParaSpacing /
 *   paragraphOpts, as the old HTML entry point took
 */
function contentToDocxParagraphs(nodes, baseOpts = { size: 22 }, opts = {}) {
  const { prefixRuns = [], suffixRuns = [], firstParaSpacing, paragraphOpts = {} } = opts
  const blocks = Array.isArray(nodes) ? nodes : []
  const out = []
  let pendingPrefix = [...prefixRuns]
  let isFirst = true
  let lastParagraphIndex = -1
  let lastChildren = null
  let lastSpacing = null

  for (const block of blocks) {
    if (block.type === 'table') {
      out.push(contentTableToDocx(block, baseOpts))
      lastParagraphIndex = -1
      continue
    }
    if (block.type === 'verticalArithmetic') {
      out.push(...verticalArithmeticParagraphs(block, baseOpts))
      lastParagraphIndex = -1
      continue
    }
    const runs = paragraphRuns(block, baseOpts)
    if (!runs.length) continue
    // The prefix (the "12. " question number) attaches to the first paragraph
    // that actually has content, so a leading empty block cannot strand the
    // number on a line of its own.
    const children = [...pendingPrefix, ...runs]
    pendingPrefix = []
    const spacing = isFirst && firstParaSpacing ? firstParaSpacing : { after: 80 }
    out.push(new Paragraph({ children, spacing, ...paragraphOpts }))
    lastParagraphIndex = out.length - 1
    lastChildren = children
    lastSpacing = spacing
    isFirst = false
  }

  // The suffix (the marks tag) belongs inline at the end of the last paragraph,
  // not on a line of its own.
  if (suffixRuns.length) {
    if (lastParagraphIndex >= 0) {
      out[lastParagraphIndex] = new Paragraph({
        children: [...lastChildren, ...suffixRuns],
        spacing: lastSpacing,
        ...paragraphOpts,
      })
    } else {
      out.push(new Paragraph({
        children: [...pendingPrefix, ...suffixRuns],
        spacing: firstParaSpacing || { after: 80 },
        ...paragraphOpts,
      }))
      pendingPrefix = []
    }
  }

  if (!out.length) {
    // An empty question still needs its number and marks tag on the page, or the
    // paper would silently skip a numbered item.
    return [para([...pendingPrefix, runText('', baseOpts)], firstParaSpacing || {})]
  }
  return out
}

/**
 * A content-model table as a real Word table.
 *
 * Word needs `w:tbl`; before this the model had no table node at all, so every
 * cell was concatenated into one paragraph and a results table printed as
 * "TimeTemp020 °C535 °C". The preview and the print window render `textHtml`
 * directly and so looked correct throughout, which is exactly why this was not
 * noticed.
 *
 * Cells are rendered with `optionRuns` — the same inline mapper the answer
 * options use — so a fraction, a subscript or a superscript inside a cell keeps
 * the Phase 1 contract instead of degrading to text at the cell boundary.
 *
 * Borders are explicit. `docx` defaults a table to no visible borders, and an
 * exam results table without ruled cells is not a table a learner can fill in.
 */
function contentTableToDocx(block, baseOpts = { size: 22 }) {
  const columns = Math.max(1, Number(block.columns) || 1)
  const cellOpts = { ...baseOpts, size: Math.min(Number(baseOpts.size) || 22, 20) }

  const buildRow = (row, header) => {
    const cells = []
    for (let i = 0; i < columns; i += 1) {
      const cell = row[i]
      // Wrapped in a paragraph because optionRuns walks BLOCKS and reads their
      // children; a cell holds inline nodes directly, and handing those over
      // raw returned no runs at all — every cell came out empty.
      const runs = cell
        ? optionRuns([{type: 'paragraph', children: cell.children || []}], {
          ...cellOpts, ...(header || cell.header ? {bold: true} : {}),
        })
        : [runText('', cellOpts)]
      cells.push(new TableCell({
        width: {size: Math.floor(100 / columns), type: WidthType.PERCENTAGE},
        children: [para(runs)],
      }))
    }
    // A header row repeats on every page a long table spans, which is what a
    // printed results table does rather than leaving page two unlabelled.
    return new TableRow({children: cells, tableHeader: header})
  }

  return new Table({
    width: {size: 100, type: WidthType.PERCENTAGE},
    rows: [
      ...(block.head || []).map((row) => buildRow(row, true)),
      ...(block.rows || []).map((row) => buildRow(row, false)),
    ],
  })
}

/**
 * An option's content as a flat run list (no paragraph wrappers) — each MCQ
 * option is one row, so its runs sit inside an existing single-paragraph layout.
 *
 * A vertical sum cannot be stacked inside an option row, so it collapses to its
 * one-line equation form; that is what `contentToPlainText` already produces for
 * it, and reusing that keeps the wording identical to every other consumer.
 */
function optionRuns(source, baseOpts = { size: 20 }, fallback = '') {
  // The layout hands over pre-parsed nodes (§4.1); a raw HTML string is still
  // accepted for hand-assembled blocks and older callers.
  const nodes = Array.isArray(source) ? source : parsePaperContent(source)
  const runs = []
  for (const block of nodes) {
    if (block.type === 'verticalArithmetic') {
      runs.push(runText(contentToPlainText([block]), { ...baseOpts, font: 'Consolas' }))
      continue
    }
    runs.push(...paragraphRuns(block, baseOpts))
  }
  if (!runs.length) {
    return [runText(fallback ? String(fallback) : '', baseOpts)]
  }
  return runs
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

/**
 * A library diagram embedded as VECTOR, with a raster fallback (§4.2: "SVG as
 * the source of truth").
 *
 * The catalog diagrams are drawn as SVG and the preview and the print window
 * both use them as SVG. Word was the only renderer that got a flattened
 * bitmap — so the one figure on the paper that IS vector all the way down was
 * the one that printed with resampled edges, and enlarging it in Word made it
 * worse rather than better.
 *
 * `docx` supports an SVG image part with a required raster `fallback`, which is
 * exactly the right contract: Word 2016+ and current LibreOffice draw the
 * vector, anything older draws the PNG we were already producing. So this can
 * only improve on the status quo — the worst case IS the status quo.
 *
 * Only the deterministic catalog diagrams qualify. The labelled-photo composite
 * stays raster: its SVG inlines the photo as a base64 data URI, and an SVG
 * carrying an embedded bitmap is exactly where Word's SVG support is least
 * dependable. A sharper outline is not worth risking a blank figure.
 */
export function svgImageRun(svg, pngBytes, transformation, alt = '') {
  const altText = String(alt || '').trim()
  const altOpts = altText
    ? { altText: { name: altText, title: altText, description: altText } }
    : {}
  try {
    return new ImageRun({
      type: 'svg',
      // BYTES, not the string. `docx` treats a string `data` as base64 and
      // throws on markup — which the catch below would have swallowed, leaving
      // a feature that silently embedded the raster and looked like it worked.
      data: new TextEncoder().encode(String(svg)),
      transformation,
      fallback: { type: 'png', data: pngBytes, transformation },
      ...altOpts,
    })
  } catch {
    // Never lose the figure over a sharper one: fall back to the raster that
    // was being embedded before this existed.
    return imageRun(pngBytes, transformation, alt)
  }
}

// Decode image bytes in the browser to read natural dimensions and, for
// formats Word can't embed (WEBP — which the picture bank stores as-is),
// transcode to PNG. An object URL keeps the canvas same-origin so it is
// never CORS-tainted. Returns { bytes, width, height } or null when there is
// no DOM (e.g. the node test harness).
async function decodeImage(bytes, type) {
  // An injected decoder answers first. Without this the harness reached the
  // jsdom path below, `Image.onload` never fired (jsdom does not decode image
  // data), and every labelled diagram lost its label layer while still
  // embedding the plain figure — silently.
  const injected = await decodeImageBytes(bytes, MIME_BY_TYPE[type] || 'application/octet-stream')
  if (injected !== undefined) return injected
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

/**
 * Sample a decoded image's colours so the export can tell a teacher when a
 * figure will not survive a monochrome printer (§4.2).
 *
 * Downsampled to a small canvas first: the verdict is about which REGIONS merge,
 * and 64px on the long side keeps every region a learner is asked to identify
 * while making the pixel walk trivial next to the fetch and the rasterisation
 * already happening per figure.
 *
 * Browser-only. Returns null with no DOM or on any failure — and a null census
 * is reported as `unknown`, never as a clean bill of health.
 */
async function sampleImageCensus(bytes, type) {
  if (typeof document === 'undefined' || typeof Image === 'undefined'
    || !globalThis.URL?.createObjectURL) return null
  const objectUrl = URL.createObjectURL(
    new Blob([bytes], { type: MIME_BY_TYPE[type] || 'image/png' }),
  )
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('decode failed'))
      el.src = objectUrl
    })
    const w = img.naturalWidth || img.width || 0
    const h = img.naturalHeight || img.height || 0
    if (!w || !h) return null
    const scale = Math.min(1, 64 / Math.max(w, h))
    const cw = Math.max(1, Math.round(w * scale))
    const ch = Math.max(1, Math.round(h * scale))
    const canvas = document.createElement('canvas')
    canvas.width = cw
    canvas.height = ch
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, cw, ch)
    return censusFromPixels(ctx.getImageData(0, 0, cw, ch).data)
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

/**
 * Check a figure against the printer and record a warning on `stats`.
 *
 * Advisory only: a figure that will print badly is still embedded. The teacher
 * is told before they run forty copies, and decides.
 */
async function recordFigurePrintability(stats, url, label) {
  if (!stats || !Array.isArray(stats.unprintableFigures) || !url) return
  // fetchImageBytes caches per URL for the session, so this is the same bytes
  // the embed already pulled rather than a second download.
  const bytes = await fetchImageBytes(url)
  if (!bytes) return
  const census = await sampleImageCensus(bytes, detectImageType(bytes))
  if (!census) return
  const assessment = assessFigurePrintability(summariseColours(census))
  const warning = figurePrintWarning(assessment, label)
  if (warning) stats.unprintableFigures.push({ label, verdict: assessment.verdict, warning })
}

// Fetch, transcode (WEBP→PNG), and aspect-fit an image, returning a ready
// ImageRun or null. Centralising this guarantees WEBP is always transcoded
// before it reaches imageRun — docx would otherwise reject the format.
async function loadImageRun(url, { width = 360, height = 220, widthPercent = 100, alt = '' } = {}) {
  const bytes = await fetchImageBytes(url)
  if (!bytes) return null
  const type = detectImageType(bytes)
  const decoded = await decodeImage(bytes, type)
  if (!decoded) {
    // No DOM (tests): embed jpg/png/gif/bmp as-is; WEBP can't be transcoded
    // without a canvas, so skip it rather than write a broken media part.
    // The band's floor is applied here too. What is missing without a decode is
    // the image's real aspect ratio, so the box falls back to the default
    // 360×220 shape — the floor itself is never conditional.
    if (type === 'webp') return null
    const box = figureBox({ maxWidth: width, maxHeight: height, widthPercent, band: currentBand })
    return imageRun(bytes, { width: box.width, height: box.height }, alt)
  }
  // The box has to be computed from the image's REAL aspect ratio, not an
  // assumed one. Sizing against 360×220 and then re-fitting to the true shape
  // silently undid the band's floor for every figure that wasn't that shape —
  // a 4:1 strip fitted into a floor-raised box came out well under it again.
  const box = figureBox({
    maxWidth: width,
    maxHeight: height,
    aspect: decoded.width / decoded.height,
    widthPercent,
    band: currentBand,
  })
  return imageRun(decoded.bytes, embedBox(box, decoded.width, decoded.height), alt)
}

// Read the intrinsic aspect ratio from an SVG's viewBox so the rasterized PNG
// isn't squashed. Falls back to 4:3.
/**
 * The band governing the paper currently being built (§4.2).
 *
 * Read by every figure below, which needs the level's minimum size. Published
 * defaults only — a figure is sized synchronously and an export must not block
 * on a Firestore read; a stale-by-one-edit minimum beats none, which is what
 * every figure had until Phase 4.
 *
 * It is module state because the figure sizing sits a dozen frames below the
 * entry point and threading a band through every renderer would be a wide
 * change for one value. `withBand` is therefore the ONLY way it is written:
 * it restores the previous value on the way out, so one document can never
 * inherit another's floor — the bug the SBA export had, calling
 * `renderPaperBlocksToDocx` directly and picking up whatever an earlier
 * assessment download left behind.
 *
 * Save-and-restore makes sequential exports safe. It does NOT make overlapping
 * ones safe: two `await`ed builds running at once would still interleave. Every
 * caller today awaits a single user-initiated download, and there is no batch
 * path — if one is ever added, the band has to be threaded properly.
 */
let currentBand = null

/** Run `fn` with `band` in force, restoring whatever was there before. */
async function withBand(band, fn) {
  const previous = currentBand
  currentBand = band || null
  try {
    return await fn()
  } finally {
    // Restoring across an await is the point: it scopes the band to one
    // document. The rule below is flagging the concurrency limitation
    // documented above — real, and accepted: no caller runs two exports at once.
    // eslint-disable-next-line require-atomic-updates
    currentBand = previous
  }
}

function svgAspect(svg) {
  const m = /viewBox="[\d.]+ [\d.]+ ([\d.]+) ([\d.]+)"/.exec(svg || '')
  const w = m ? parseFloat(m[1]) : 0
  const h = m ? parseFloat(m[2]) : 0
  return w > 0 && h > 0 ? w / h : 4 / 3
}

/**
 * Render a library diagram ({libraryKey, params}) to an embedded ImageRun.
 *
 * Returns `{run, unresolved}`, and the second half is the point. This used to
 * return the run or a bare `null`, and a `null` was indistinguishable from "this
 * block had no diagram" — so a figure that failed to rasterise was simply left
 * off the page. The teacher downloaded a paper with a question referring to a
 * figure that is not there, and nothing anywhere said so: not the download, not
 * the studio, not a log line. The fetched-image path already had a dashed-red
 * placeholder for exactly this; the library-diagram path silently omitted.
 *
 * `unresolved` names the failure — which question, which diagram, which STAGE —
 * so the caller can print the placeholder, the studio can warn before the
 * teacher photocopies forty of them, and the pre-export validation gate can
 * refuse the export outright. A placeholder is never a rendered diagram.
 */
async function diagramImageRun(diagram, { maxWidth = 360, maxHeight = 220, widthPreset } = {}) {
  if (!diagram || !diagram.libraryKey) return { run: null, unresolved: null }
  const key = diagram.libraryKey
  // Black ink on white: most Zambian schools print monochrome, so a library
  // figure is drawn in a single dark tone rather than relying on colour.
  const svg = renderDiagramSvg(key, diagram.params || {}, '#1c1612')
  if (!svg) {
    return { run: null, unresolved: { diagramKey: key, stage: 'catalog', reason: 'the diagram is not in the catalog, or it rendered nothing' } }
  }
  const box = figureBox({
    maxWidth,
    maxHeight,
    aspect: svgAspect(svg),
    widthPercent: widthPreset ? resolveImageWidthPercent(widthPreset) : 100,
    band: currentBand,
  })
  let bytes
  try {
    // High-DPI raster (§4.2) — the embed box is in 96dpi CSS pixels, so
    // FIGURE_RASTER_SCALE puts real detail behind every printed dot. It is the
    // FALLBACK now: modern Word draws the vector instead and ignores it.
    bytes = await svgToPngBytes(svg, box.rasterWidth, box.rasterHeight)
  } catch (err) {
    return {
      run: null,
      unresolved: { diagramKey: key, stage: 'rasterise', reason: err?.message || 'the diagram could not be rasterised' },
    }
  }
  try {
    return { run: svgImageRun(svg, bytes, { width: box.width, height: box.height }), unresolved: null }
  } catch (err) {
    return {
      run: null,
      unresolved: { diagramKey: key, stage: 'embed', reason: err?.message || 'the diagram could not be embedded' },
    }
  }
}

async function imageParagraph(url, opts = {}) {
  if (!url) return null
  // A width preset scales the fit-box down from the full-width default so a
  // teacher's "Small/Medium/Large" choice carries into the Word download — but
  // the level's minimum figure size is a floor it cannot go under (§4.2). See
  // figureSizing.js: at Early Childhood the size is a pedagogical requirement,
  // not a layout preference.
  const run = await loadImageRun(url, {
    width: opts.width || 360,
    height: opts.height || 220,
    widthPercent: opts.widthPreset ? resolveImageWidthPercent(opts.widthPreset) : 100,
    alt: opts.alt || '',
  })
  // A figure belongs to the question above it and to the options below it — it
  // must never float onto a page of its own (§4.5).
  return run ? centeredPara([run], KEEP_WITH_NEXT) : null
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
export function buildDiagramIdentifySvg({ href, width, height, labels = [], mode = 'identify', answerKey = false }) {
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
  // Positions and leader endpoints come from the shared resolver — the same
  // call the preview and the print window make — so a label separated on screen
  // is separated in Word, and the line leaves the pill's edge rather than
  // running out from under it.
  const placed = resolveFigureLabels(labels, { mode }).labels
  placed.forEach((l) => {
    const i = l.index
    const cx = clamp01(l.x) * W
    const cy = clamp01(l.y) * H
    // Leader line + tip dot on the part the label points at (both modes).
    if (l.leader) {
      parts.push(`<line x1="${(l.leader.x1 * W).toFixed(1)}" y1="${(l.leader.y1 * H).toFixed(1)}" x2="${(l.leader.x2 * W).toFixed(1)}" y2="${(l.leader.y2 * H).toFixed(1)}" stroke="#000" stroke-width="${sw}"/>`)
      parts.push(`<circle cx="${(l.leader.x2 * W).toFixed(1)}" cy="${(l.leader.y2 * H).toFixed(1)}" r="${dot}" fill="#000"/>`)
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
  // The marking key names the parts ON the figure (§4.3), in green so a marker
  // can see at a glance what the learner's copy withheld. The numbered markers
  // above are untouched — that is what makes the two copies correspond.
  if (answerKey && mode === 'identify') {
    for (const l of resolveAnswerKeyLabels(labels).names) {
      const cx = clamp01(l.x) * W
      const cy = clamp01(l.y) * H
      if (l.leader) {
        parts.push(`<line x1="${(l.leader.x1 * W).toFixed(1)}" y1="${(l.leader.y1 * H).toFixed(1)}" x2="${(l.leader.x2 * W).toFixed(1)}" y2="${(l.leader.y2 * H).toFixed(1)}" stroke="#047857" stroke-width="${sw}"/>`)
      }
      const padX = Math.max(4, Math.round(fs * 0.5))
      const boxW = Math.round(l.text.length * fs * 0.6 + padX * 2)
      const boxH = Math.round(fs * 1.7)
      const rad = Math.max(2, Math.round(boxH * 0.18))
      parts.push(`<rect x="${(cx - boxW / 2).toFixed(1)}" y="${(cy - boxH / 2).toFixed(1)}" width="${boxW}" height="${boxH}" rx="${rad}" ry="${rad}" fill="#fff" stroke="#047857" stroke-width="${sw}"/>`)
      parts.push(`<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" fill="#047857" font-size="${fs}" font-weight="600" font-family="Arial, Helvetica, sans-serif" text-anchor="middle" dominant-baseline="central">${escapeSvgText(l.text)}</text>`)
    }
  }
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
    // The level's minimum figure size applies here too. Slice 4 wired it into
    // the plain-image path only, which left the labelled diagrams — exactly the
    // figures an Early Childhood paper is made of — printing at whatever the
    // width preset produced.
    const fit = figureBox({
      maxWidth: opts.width || 360,
      maxHeight: opts.height || 220,
      aspect: decoded.width / decoded.height,
      widthPercent: opts.widthPreset ? resolveImageWidthPercent(opts.widthPreset) : 100,
      band: currentBand,
    })
    // Drawn at the size it will PRINT at, not at the source image's size.
    //
    // The marker radius and font size are proportions of the canvas with an
    // absolute floor (`max(9, …)`, `max(10, …)`) so they stay legible on a small
    // figure. Built against a 96px source those floors ARE the size — a
    // radius-9 disc is a fifth of a 96px canvas — and rasterising to the print
    // box then magnified them: four numbers that buried the diagram they point
    // at, and a marking key whose "Right atrium" pill was wider than the figure.
    // Building at the print size lets the proportions govern and leaves the
    // floors doing what they were written for, protecting a genuinely tiny one.
    const svg = buildDiagramIdentifySvg({
      href, width: fit.rasterWidth, height: fit.rasterHeight, labels,
      mode: opts.mode || 'identify',
      answerKey: Boolean(opts.answerKey),
    })
    const pngBytes = await svgToPngBytes(svg, fit.rasterWidth, fit.rasterHeight)
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
export async function renderPaperBlocksToDocx(blocks = [], stats = null, { band = null } = {}) {
  return withBand(band, async () => {
    const children = []
    for (const block of blocks) {
      const rendered = await renderBlock(block, stats)
      if (Array.isArray(rendered)) children.push(...rendered)
      else if (rendered) children.push(rendered)
    }
    return children
  })
}

function recordImageFailure(stats, label) {
  if (stats && Array.isArray(stats.failedImages)) {
    stats.failedImages.push(String(label || '').trim() || 'figure')
  }
}

/**
 * Record a figure the paper asked for and did not get.
 *
 * Deliberately separate from `failedImages`, which is a count for a toast. This
 * is the structured record the pre-export validation gate reads: an unresolved
 * REQUIRED figure is a blocking correctness error, not a quality warning, and a
 * gate cannot make that call from a number. Always accumulated onto `stats` when
 * one is supplied, so no caller has to opt in to being told.
 *
 * The record's SHAPE lives in `unresolvedFigures.js`, with the sentence, because
 * the gate has to produce the same record from a static check before any of this
 * runs. Two shapes would mean the gate and the exporter describing the same
 * missing diagram differently.
 */
export function recordUnresolvedFigure(stats, detail) {
  if (!stats) return
  if (!Array.isArray(stats.unresolvedFigures)) stats.unresolvedFigures = []
  stats.unresolvedFigures.push(unresolvedFigure(detail))
}

export { unresolvedFigureMessage, UnresolvedFigureError }

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
export function paperSectionShell(blocks = [], { attribution = false, logoRun = null, layout = null } = {}) {
  const headerBlock = blocks.find((b) => b.kind === 'header')
  const banner = headerParagraphs(headerBlock, logoRun)
  const shell = {}
  const headers = {}
  // The sheet itself (§2), from the SAME resolved tokens the print stylesheet's
  // `@page` rule uses. Word takes twentieths of a point; the tokens convert.
  // Without this, a paper set to A5 landscape printed as A5 landscape in the
  // browser and as A4 portrait in the download — the shape of drift this whole
  // change exists to end. `layout` is optional so a caller that has not been
  // migrated keeps Word's own defaults, which are A4 portrait already.
  // `docx` swaps width and height itself for a landscape section, so it must be
  // handed the PORTRAIT dimensions plus the flag and it emits the laid-out ones.
  // The layout tokens already report the sheet as laid out (a landscape A5 is
  // 210 across, 148 down), so they are swapped back here. Passing them straight
  // through applies the swap twice: the emitted `w:pgSz` came out 148 across on
  // a page still marked landscape, which Word draws as a portrait A5.
  const landscape = layout && layout.orientation === 'landscape'
  const pageProperties = layout ? {
    page: {
      size: {
        width: mmToTwip(landscape ? layout.page.heightMm : layout.page.widthMm),
        height: mmToTwip(landscape ? layout.page.widthMm : layout.page.heightMm),
        orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
      },
      margin: {
        top: mmToTwip(layout.margins.top),
        right: mmToTwip(layout.margins.right),
        // Word has no running `<tfoot>` reservation, so the footer's in-flow
        // reserve is folded into the bottom margin here — the same total zone
        // the browser reserves in two halves. See paperPageGeometry.js.
        bottom: mmToTwip(layout.margins.bottom + layout.content.footerReserveMm),
        left: mmToTwip(layout.margins.left),
      },
    },
  } : {}

  if (banner.length) {
    headers.first = new Header({
      children: [...(attribution ? [attributionWatermarkParagraph()] : []), ...banner],
    })
    // titlePage routes the FIRST page to `headers.first` (the banner) and every
    // later page to `headers.default`, so the banner is printed exactly once.
    shell.properties = { ...pageProperties, titlePage: true }
  } else if (layout) {
    shell.properties = pageProperties
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
    // The labels come off the block (§9), so Word prints the same words as the
    // preview and the PDF. The fallbacks are what was hard-coded here, which is
    // why a paper that has never set a label is byte-identical.
    const labels = b.labels || {}
    if (b.name) {
      children.push(runText(`${labels.name || "Pupil's Name"}: `, { size: 22, bold: true }))
      children.push(runText('______________________________________', { size: 22 }))
    }
    if (b.date) {
      // Right tab stop at the page margin pushes the date field to the
      // far right, the way the preview's flex row does.
      if (b.name) children.push(new Tab())
      children.push(runText(`${labels.date || 'Date'}: `, { size: 22, bold: true }))
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
        runText(`${(b.labels || {}).classField || 'Class'}: `, { size: 22, bold: true }),
        runText('____________________________________', { size: 22 }),
      ],
      spacing: { after: 160 },
    }))
  }
  if (b.marks) {
    out.push(new Paragraph({
      children: [runText(
        `${String((b.labels || {}).marks || 'Total marks').toUpperCase()}: _________ / ${b.totalMarks || '____'}`,
        { bold: true, size: 22 },
      )],
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
        // A paper that hides marks from learners must not print the section's
        // total in its heading either (§4).
        ...(b.showMarks === false ? [] : [
          runText(`  (${b.marks} mark${b.marks === 1 ? '' : 's'})`, { size: 22, color: '6b7280', italics: true }),
        ]),
      ],
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 280, after: 100 },
      border: {
        bottom: { color: '000000', size: 6, style: BorderStyle.SINGLE, space: 1 },
      },
      // A section heading alone at the bottom of a page is one of the layout
      // failures §4.5 names explicitly.
      ...KEEP_WITH_NEXT,
    }),
  ]
  if (b.instructions) {
    out.push(para(
      runText(b.instructions, { italics: true, size: 22, color: '4b5563' }),
      KEEP_WITH_NEXT,
    ))
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
    const { run, unresolved } = await diagramImageRun(b.imageDiagram, { maxWidth: 360, maxHeight: 240 })
    if (run) out.push(new Paragraph({ children: [run], alignment: AlignmentType.CENTER, spacing: { after: 80 } }))
    else {
      // The placeholder, not silence. A passage whose figure vanished reads as a
      // passage that never had one.
      const label = b.imageAlt || b.title || ''
      recordImageFailure(stats, label || 'passage diagram')
      recordUnresolvedFigure(stats, { ...unresolved, kind: 'library_diagram', label })
      out.push(imageFallbackBlock(label))
    }
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
  // `showMarks` is the paper's or the section's decision (§4). Absent on a block
  // built by a caller that predates it, which keeps the old always-print
  // behaviour.
  const marksTag = marks >= 1 && b.showMarks !== false
    ? `  (${marks} mark${marks === 1 ? '' : 's'})` : ''

  // When the question carries pre-hydrated rich HTML, walk it so the
  // Grade-7 math blocks (vertical sums, fractions, number bases) come
  // out with the right Word formatting instead of being flattened to
  // plain text. Otherwise fall back to the simple single-line render.
  // Prefer the content model the layout already parsed (§4.1) — no parsing in a
  // renderer. `textHtml` remains the fallback for a caller that built blocks
  // before textNodes existed, or hand-assembled them in a test.
  const stemNodes = Array.isArray(b.textNodes) && b.textNodes.length
    ? b.textNodes
    : parsePaperContent(b.textHtml)
  if (stemNodes.length) {
    const richParas = contentToDocxParagraphs(stemNodes, { size: 22 }, {
      prefixRuns: [runText(`${b.number}. `, { bold: true, size: 22 })],
      suffixRuns: marksTag
        ? [runText(marksTag, { size: 20, color: '6b7280', italics: true })]
        : [],
      firstParaSpacing: { before: 160, after: 80 },
      // The stem stays with its figure and its options (§4.5).
      paragraphOpts: KEEP_WITH_NEXT,
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
      ...KEEP_WITH_NEXT,
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
        // The marking key gets the named twin of the learner's figure (§4.3).
        answerKey: Boolean(b.showAnswer),
      })
      composited = Boolean(img)
      // A figure that lost its LABEL layer is not a healthy figure, and until
      // this line it was reported as one: the plain image still embedded, so
      // `failedImages` stayed empty and `unresolvedFigures` stayed at zero
      // while a §4.3 marking key came out byte-identical to the learner's copy.
      // A paper that asks a learner to name parts nothing points at is a worse
      // failure than a missing picture, because it looks fine.
      if (!composited) {
        recordUnresolvedFigure(stats, {
          kind: 'diagram_labels',
          questionNumber: b.number ?? null,
          stage: 'composite',
          reason: 'the label layer could not be composited onto the figure, so the '
            + 'figure was embedded without its markers',
          label: b.imageAlt || '',
        })
      }
    }
    if (!img) img = await imageParagraph(b.imageUrl, { alt: b.imageAlt || '', widthPreset: b.imageWidth })
    if (!img) recordImageFailure(stats, b.imageAlt || (b.number != null ? `question ${b.number}` : ''))
    // Advisory: will this figure still say anything once the paper is
    // photocopied in black and white? (§4.2) The figure is embedded either way.
    await recordFigurePrintability(
      stats, b.imageUrl,
      b.number != null ? `The picture in question ${b.number}` : 'A picture on this paper',
    )
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
    const { run, unresolved } = await diagramImageRun(b.imageDiagram, { maxWidth: 360, maxHeight: 240 })
    if (run) out.push(centeredPara([run]))
    else {
      const label = b.imageAlt || (b.number != null ? `question ${b.number}` : '')
      recordImageFailure(stats, label || 'diagram')
      recordUnresolvedFigure(stats, {
        ...unresolved,
        kind: 'library_diagram',
        questionNumber: b.number ?? null,
        questionId: b.id ?? null,
        label,
      })
      out.push(imageFallbackBlock(label))
    }
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
    // Pre-parsed option content from the layout (§4.1). Empty for a block built
    // before it existed, in which case the HTML fallback above still applies.
    const optNodes = b.optionsNodes || []
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
            const { run, unresolved } = await diagramImageRun(media.diagram, { maxWidth: 150, maxHeight: 150 })
            if (run) cellChildren.push(centeredPara([run]))
            else {
              // An option's figure IS the option. Losing it leaves a lettered
              // choice with nothing to choose between.
              const label = `option ${SECTION_LETTERS[i]}${b.number != null ? ` of question ${b.number}` : ''}`
              recordImageFailure(stats, label)
              recordUnresolvedFigure(stats, {
                ...unresolved,
                kind: 'option_diagram',
                questionNumber: b.number ?? null,
                questionId: b.id ?? null,
                label,
              })
              cellChildren.push(imageFallbackBlock(label))
            }
          } else if (media?.imageUrl) {
            const run = await loadImageRun(media.imageUrl, { width: 140, height: 140, alt: media.alt || '' })
            if (run) cellChildren.push(centeredPara([run]))
          }
          const isCorrect = b.showAnswer && Number(b.correctAnswer) === i
          const labelOpts = { bold: true, size: 20, color: isCorrect ? '047857' : undefined }
          const runOpts = { size: 20, color: isCorrect ? '047857' : undefined, bold: isCorrect }
          const optRunsList = optionRuns(optNodes[i] || optsHtml[i], runOpts, optsPlain[i] || opts[i] || '')
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
          const { run, unresolved } = await diagramImageRun(media.diagram, { maxWidth: 60, maxHeight: 60 })
          if (run) {
            runs.push(run)
            runs.push(runText('  ', { size: 20 }))
          } else {
            // Inline with the option text, so the marker is a run rather than a
            // table: the same fact, said where it fits.
            const label = `option ${SECTION_LETTERS[i]}${b.number != null ? ` of question ${b.number}` : ''}`
            recordImageFailure(stats, label)
            recordUnresolvedFigure(stats, {
              ...unresolved,
              kind: 'option_diagram',
              questionNumber: b.number ?? null,
              questionId: b.id ?? null,
              label,
            })
            runs.push(runText('⚠ figure missing ', { bold: true, size: 18, color: 'B91C1C' }))
          }
        } else if (media?.imageUrl) {
          const run = await loadImageRun(media.imageUrl, { width: 50, height: 50, alt: media.alt || '' })
          if (run) {
            runs.push(run)
            runs.push(runText('  ', { size: 20 }))
          }
        }
        runs.push(...optionRuns(optNodes[i] || optsHtml[i], runOpts, optsPlain[i] ?? b.options[i] ?? ''))
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
        runs.push(...optionRuns(optNodes[i] || optsHtml[i], runOpts, optsPlain[i] ?? opt ?? ''))
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
            ...optionRuns(optNodes[i] || optsHtml[i], runOpts, optsPlain[i] ?? opt ?? ''),
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
    } else if (Array.isArray(b.answerNodes) && b.answerNodes.length) {
      // A structured expected answer reaches Word as real Word formatting —
      // an OMML fraction, genuine sub/superscript — through the same run
      // builder the options use. `String(b.correctAnswer)` printed
      // "[object Object]" into the marking key.
      out.push(para([
        runText('Expected answer: ', { bold: true, size: 20, color: '047857' }),
        ...optionRuns(b.answerNodes, { size: 20, color: '047857' }, b.answerPlain),
      ]))
    } else {
      out.push(para([
        runText('Expected answer: ', { bold: true, size: 20, color: '047857' }),
        runText(b.answerPlain ?? String(b.correctAnswer ?? ''), { size: 20, color: '047857' }),
      ]))
    }
    out.push(...schemeNotesParagraphs(b))
  }
  return out
}

/**
 * The marking note under an answer. Rich when the teacher wrote mathematics
 * into it; the plain single run otherwise, which is the path every note
 * written before this existed keeps taking.
 */
function schemeNotesParagraphs(b) {
  const noteOpts = { size: 18, color: '6b7280', italics: true }
  if (Array.isArray(b.explanationNodes) && b.explanationNodes.length) {
    return [para([
      runText('Notes: ', { bold: true, size: 18, color: '6b7280' }),
      ...optionRuns(b.explanationNodes, noteOpts, b.explanation),
    ])]
  }
  if (!b.explanation) return []
  return [para([
    runText('Notes: ', { bold: true, size: 18, color: '6b7280' }),
    runText(b.explanation, noteOpts),
  ])]
}

/**
 * Build the `docx` library Document for a paper.
 *
 * Named `buildDocxDocument` rather than `buildAssessmentDocument` because that
 * name now belongs to the canonical, rendering-agnostic document model in
 * `assessmentDocument.js` — the thing all four renderers consume. This function
 * is one of those renderers, and it returns a Word file, not a model.
 */
export async function buildDocxDocument(assessment, questions, { mode = 'paper', attribution = false, stats = null } = {}) {
  // The level's band governs the figures in the PAPER (§4.2). Scoping it to the
  // block render rather than the whole function also keeps it off the school
  // logo below — a logo is a mark on the letterhead, not a figure a learner has
  // to read, and floor-raising it to 45mm on a Nursery paper would swamp the
  // header. Published defaults only; see `currentBand`.
  // The canonical document (§2) — the same object the studio preview and the
  // print window render, so Word cannot drift from them on the page, the
  // metadata, the marks or the answer-choice count.
  const paperDocument = buildAssessmentDocument(assessment, questions, { mode })
  const blocks = paperDocument.blocks
  const children = await renderPaperBlocksToDocx(blocks, stats, {
    band: seedBandForLevel(assessment && assessment.grade) || null,
  })

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
    description: 'Generated by ZedExams Assessment Paper Studio',
    styles: {
      default: {
        document: { run: { font: 'Times New Roman', size: 22 } },
      },
    },
    sections: [{
      ...paperSectionShell(blocks, { attribution, logoRun, layout: paperDocument.layout }),
      children,
    }],
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
    children.push(para(runText('No questions to answer yet.', { italics: true, size: 20, color: '6b7280' })))
  }

  return new Document({
    creator: 'zedexams.com',
    title: sanitizeXmlText(`${sheet.title} — Answer Sheet`),
    description: 'Answer sheet generated by ZedExams Assessment Paper Studio',
    styles: { default: { document: { run: { font: 'Times New Roman', size: 22 } } } },
    sections: [{ ...attributionSection({ attribution }), children }],
  })
}

export async function downloadAnswerSheetDocx(assessment, questions, filename = 'answer-sheet.docx', opts = {}) {
  const doc = await buildAnswerSheetDocument(assessment, questions, opts)
  const blob = await Packer.toBlob(doc)
  await saveBlob(blob, filename)
}

/**
 * Build the paper and hand it to the teacher — unless a required figure is
 * missing from it.
 *
 * The build has to finish before the missing figure is known: `rasterise` and
 * `embed` are properties of a render in progress, not of the paper. So the
 * refusal happens between the build and the save, which is the last moment it
 * still means anything. It used to sit AFTER the save: the caller learned that
 * question 5's diagram was missing from a file the teacher already had, which
 * makes the report a receipt rather than a gate.
 *
 * `allowUnresolvedFigures` exists for the callers that are not exporting a paper
 * a learner will sit — the visual harness renders deliberately broken fixtures
 * and needs the document to inspect. It is never set by the studio.
 */
export async function downloadAssessmentDocx(assessment, questions, filename = 'assessment.docx', opts = {}) {
  // Collect figure-embed failures during the build. Fetched-image failures still
  // download with a placeholder — a photo that would not load is a quality
  // problem. A missing REQUIRED diagram is not: the learner is asked to label
  // something that is not on the page.
  const stats = { failedImages: [], unresolvedFigures: [], unprintableFigures: [] }
  const doc = await buildDocxDocument(assessment, questions, { ...opts, stats })
  const result = {
    failedImages: stats.failedImages.length,
    // Returned in full, not as a count: the pre-export validation gate has to
    // name the question a teacher must fix, and a number cannot.
    unresolvedFigures: stats.unresolvedFigures,
    unprintableFigures: stats.unprintableFigures,
    delivered: true,
  }
  // THROWN, not returned. A returned `delivered: false` put the burden on every
  // caller to look, and the two library export routes did not — they awaited
  // this and toasted "Paper download started" over a file that was never
  // written, which is worse than the placeholder they used to get. Both already
  // wrap the export in a try/catch that surfaces the message, so a caller that
  // does nothing now fails loudly instead of quietly succeeding.
  if (stats.unresolvedFigures.length > 0 && !opts.allowUnresolvedFigures) {
    throw new UnresolvedFigureError(stats.unresolvedFigures)
  }
  const blob = await Packer.toBlob(doc)
  await saveBlob(blob, filename)
  return result
}
