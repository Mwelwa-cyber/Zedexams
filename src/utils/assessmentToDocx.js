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

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  HeightRule,
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
import { buildPaperLayout } from './assessmentPaperLayout.js'

const SECTION_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

function runText(str, opts = {}) {
  return new TextRun({ text: str == null ? '' : String(str), ...opts })
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
  let currentRuns = [...prefixRuns]
  let isFirstParagraph = true

  const flush = () => {
    if (currentRuns.length) {
      const spacing = isFirstParagraph && firstParaSpacing
        ? firstParaSpacing
        : { after: 80 }
      out.push(new Paragraph({ children: currentRuns, spacing }))
      currentRuns = []
      isFirstParagraph = false
    }
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
  // Append suffix runs to the last paragraph (or current pending one).
  if (suffixRuns.length) {
    currentRuns.push(...suffixRuns)
  }
  flush()
  return out.length ? out : [para([...prefixRuns, runText('', baseOpts), ...suffixRuns], firstParaSpacing || {})]
}

async function fetchImageBytes(url) {
  try {
    const response = await fetch(url, { mode: 'cors' })
    if (!response.ok) return null
    const buffer = await response.arrayBuffer()
    return new Uint8Array(buffer)
  } catch {
    return null
  }
}

async function logoParagraph(url, transform = null) {
  if (!url) return null
  const bytes = await fetchImageBytes(url)
  if (!bytes) return null
  // Width applies; offset doesn't translate cleanly to inline Word images,
  // so we clamp to width-only. The studio surfaces this limitation in the
  // LogoAdjuster's hint text.
  const width = Math.max(40, Math.min(160, Math.round(Number(transform?.width) || 80)))
  return centeredPara([
    new ImageRun({ data: bytes, transformation: { width, height: width } }),
  ])
}

async function imageParagraph(url, opts = {}) {
  if (!url) return null
  const bytes = await fetchImageBytes(url)
  if (!bytes) return null
  return centeredPara([
    new ImageRun({
      data: bytes,
      transformation: { width: opts.width || 360, height: opts.height || 220 },
    }),
  ])
}

async function renderBlock(block) {
  switch (block.kind) {
    case 'header': return renderHeader(block)
    case 'learnerFields': return renderLearnerFields(block)
    case 'instructions': return renderInstructions(block)
    case 'sectionHeader': return renderSectionHeader(block)
    case 'passage': return renderPassage(block)
    case 'question': return renderQuestion(block)
    case 'pagebreak': return [new Paragraph({ children: [new PageBreak()] })]
    case 'endOfPaper': return [centeredPara(runText(block.text, { italics: true, size: 20, color: '555555' }))]
    case 'footerCode': return [new Paragraph({
      children: [runText(block.code, { size: 18, color: '555555' })],
      alignment: AlignmentType.RIGHT,
      spacing: { before: 200 },
    })]
    default: return []
  }
}

async function renderHeader(b) {
  const out = []
  const logo = await logoParagraph(b.logoUrl, b.logoTransform)
  if (logo) out.push(logo)
  out.push(centeredPara(runText((b.schoolName || 'YOUR SCHOOL NAME').toUpperCase(), { bold: true, size: 32 })))
  out.push(centeredPara(runText(b.title, { bold: true, size: 22 })))
  if (b.subject) out.push(centeredPara(runText(b.subject, { bold: true, size: 24 })))
  if (b.paperName) out.push(centeredPara(runText(b.paperName, { bold: true, size: 22 })))
  out.push(new Paragraph({ children: [runText('')], spacing: { after: 100 } }))
  return out
}

function renderLearnerFields(b) {
  if (!b.name && !b.date && !b.classField && !b.marks) return []
  const row1Children = []
  if (b.name) {
    row1Children.push(new TableCell({
      children: [para(runText("Pupil's Name: __________________________________________", { size: 22 }))],
      borders: BORDER,
    }))
  }
  if (b.date) {
    row1Children.push(new TableCell({
      children: [para(runText('Date: ______________', { size: 22 }))],
      borders: BORDER,
      width: { size: 30, type: WidthType.PERCENTAGE },
    }))
  }
  const rows = []
  if (row1Children.length) rows.push(new TableRow({ children: row1Children }))
  if (b.classField) {
    rows.push(new TableRow({
      children: [new TableCell({
        children: [para(runText('Class: ____________________', { size: 22 }))],
        borders: BORDER,
      })],
    }))
  }
  const out = []
  if (rows.length) {
    out.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }))
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
  if (!b.text) return []
  return [
    para(runText('Instructions', { bold: true, size: 22 })),
    ...instructionParagraphs(b.text),
    new Paragraph({ children: [runText('')], spacing: { after: 100 } }),
  ]
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

async function renderPassage(b) {
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
    const img = await imageParagraph(b.imageUrl, { width: 380, height: 220 })
    if (img) out.push(img)
  }
  out.push(new Paragraph({ children: [runText('')], spacing: { after: 100 } }))
  return out
}

async function renderQuestion(b) {
  const out = []
  const marks = b.marks ?? 1
  const marksTag = marks > 1 ? `  (${marks} marks)` : ''

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
    const img = await imageParagraph(b.imageUrl)
    if (img) out.push(img)
    const labels = Array.isArray(b.diagramLabels) ? b.diagramLabels : []
    const isIdentify = b.diagramMode === 'identify'
    if (labels.length) {
      if (isIdentify) {
        // Identify mode: emit numbered blank-answer lines below the image
        // for the student to fill in. The expected answers go into the
        // marking key paragraph (below, in the showAnswer branch).
        for (let i = 0; i < labels.length; i += 1) {
          out.push(para([
            runText(`${i + 1}. `, { bold: true, size: 20 }),
            runText('______________________________________________________', { size: 20 }),
          ]))
        }
      } else {
        // Word can't reliably overlay positioned labels on top of an
        // inline image, so we drop the labels as a numbered text list
        // below — same information, ordered top-to-bottom then
        // left-to-right.
        const sorted = [...labels].sort((a, c) => (a.y - c.y) || (a.x - c.x))
        const text = sorted.map((l, i) => `${i + 1}. ${l.text}`).join('   ')
        out.push(para([
          runText('Labels: ', { bold: true, size: 20 }),
          runText(text, { size: 20 }),
        ]))
      }
    }
  }
  if (b.tableData) {
    const headers = Array.isArray(b.tableData.headers) ? b.tableData.headers : []
    const rows = Array.isArray(b.tableData.rows) ? b.tableData.rows : []
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
  if (b.wordBank && b.wordBank.length) {
    out.push(para([
      runText('Word bank: ', { bold: true, size: 20 }),
      runText(b.wordBank.join(' · '), { size: 20 }),
    ]))
  }

  if (b.type === 'mcq') {
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
          if (media?.imageUrl) {
            const bytes = await fetchImageBytes(media.imageUrl)
            if (bytes) {
              cellChildren.push(centeredPara([
                new ImageRun({ data: bytes, transformation: { width: 140, height: 140 } }),
              ]))
            }
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
        if (media?.imageUrl) {
          const bytes = await fetchImageBytes(media.imageUrl)
          if (bytes) {
            runs.push(new ImageRun({ data: bytes, transformation: { width: 50, height: 50 } }))
            runs.push(runText('  ', { size: 20 }))
          }
        }
        runs.push(...optionRuns(optsHtml[i], runOpts, optsPlain[i] ?? b.options[i] ?? ''))
        if (isCorrect) runs.push(runText(' ✓', { bold: true, color: '047857', size: 20 }))
        out.push(para(runs))
      }
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
  } else if (b.type === 'short_answer' || b.type === 'fill') {
    const lines = b.answerLines || 2
    for (let i = 0; i < lines; i += 1) {
      out.push(para(runText('______________________________________________________', { size: 20 })))
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
  } else if (b.type === 'diagram') {
    const lines = b.answerLines || 4
    for (let i = 0; i < lines; i += 1) {
      out.push(para(runText('______________________________________________________', { size: 20 })))
    }
  } else if (b.type === 'essay') {
    const lines = b.answerLines || 10
    for (let i = 0; i < lines; i += 1) {
      out.push(para(runText('______________________________________________________', { size: 20 })))
    }
  }

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

  if (b.showAnswer) {
    if (b.type === 'diagram' && b.diagramMode === 'identify' && Array.isArray(b.diagramLabels) && b.diagramLabels.length) {
      const pairs = b.diagramLabels.map((l, i) => `${i + 1}. ${l.text || '—'}`).join('   ')
      out.push(para([
        runText('Answers: ', { bold: true, size: 20, color: '047857' }),
        runText(pairs, { size: 20, color: '047857' }),
      ]))
    } else if (b.type === 'mcq') {
      const i = Number(b.correctAnswer)
      const letter = SECTION_LETTERS[i] || '?'
      const opt = b.options?.[i] ?? ''
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

export async function buildAssessmentDocument(assessment, questions, { mode = 'paper' } = {}) {
  const blocks = buildPaperLayout(assessment, questions, { mode })
  const children = []
  for (const block of blocks) {
    const rendered = await renderBlock(block)
    if (Array.isArray(rendered)) children.push(...rendered)
    else if (rendered) children.push(rendered)
  }

  const title = mode === 'scheme'
    ? `${assessment.title || 'Assessment'} — Marking Key`
    : (assessment.title || 'Assessment')

  return new Document({
    creator: 'zedexams.com',
    title,
    description: 'Generated by ZedExams Assessment Studio',
    styles: {
      default: {
        document: { run: { font: 'Times New Roman', size: 22 } },
      },
    },
    sections: [{ children }],
  })
}

export async function downloadAssessmentDocx(assessment, questions, filename = 'assessment.docx', opts = {}) {
  const doc = await buildAssessmentDocument(assessment, questions, opts)
  const blob = await Packer.toBlob(doc)
  try {
    const { saveAs } = await import('file-saver')
    saveAs(blob, filename)
    return
  } catch { /* fall through */ }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
