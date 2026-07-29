/**
 * paperContentModel — the one structured form of a question's rich content (§4.1).
 *
 * "Define a single question content model and make all four renderers read from
 * it. No renderer may hold its own parsing logic."
 *
 * `buildPaperLayout` already gives every renderer the same typed BLOCKS — that
 * part was right. What it handed them for the content INSIDE a block was an HTML
 * string, so each renderer had to parse it back: the Word export carried a full
 * DOM walker of its own (marks, sup/sub, fractions, number bases, vertical
 * arithmetic, line breaks), and the print window leaned on the browser's parser.
 * Two parsers over the same string is exactly the drift the shared block model
 * was built to prevent — a fix to one silently left the other behind.
 *
 * So the HTML is parsed ONCE, here, into typed nodes, and HTML becomes an OUTPUT
 * of the model rather than the thing passed between renderers:
 *
 *        rich text ──parse──▶ content nodes ──▶ Word runs      (assessmentToDocx)
 *                                          └──▶ HTML          (contentToHtml → print window)
 *                                          └──▶ plain text    (search, alt text, AI checks)
 *
 * The node vocabulary is deliberately small — it is what the editor can actually
 * produce, no more:
 *
 *   Blocks:  {type:'paragraph', children:[…]}
 *            {type:'verticalArithmetic', operator, lines:[…], answer}
 *
 *   Inline:  {type:'text', value, marks:{bold,italic,underline,strike,sup,sub}}
 *            {type:'fraction', whole, numerator, denominator}
 *            {type:'numberBase', number, base}
 *            {type:'break'}
 *
 * Parsing needs a DOM, which every caller has (browser, print window, jsdom in
 * tests) — but it is injectable so the model can be exercised without globals.
 * Everything downstream of the parse is pure.
 */

/** The marks a run can carry. Kept as a list so callers can iterate them. */
export const MARK_NAMES = ['bold', 'italic', 'underline', 'strike', 'sup', 'sub']

import { FRACTION_SELECTOR, readFractionAttrs } from '../editor/extensions/MathFraction.js'
import { NUMBER_BASE_SELECTOR, readNumberBaseAttrs } from '../editor/extensions/NumberBase.js'
import {
  VERTICAL_ARITHMETIC_SELECTOR, readVerticalArithmeticAttrs,
} from '../editor/extensions/VerticalArithmetic.js'

/** HTML tag → the mark it applies. */
const TAG_MARKS = {
  STRONG: 'bold', B: 'bold',
  EM: 'italic', I: 'italic',
  U: 'underline',
  S: 'strike', STRIKE: 'strike',
  SUP: 'sup', SUB: 'sub',
}

/** Tags that start a new paragraph rather than continuing the current one. */
const BLOCK_TAGS = new Set([
  'P', 'DIV', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI',
])

function emptyMarks() {
  return {}
}

/** True when two inline text nodes can be merged into one run. */
function sameMarks(a, b) {
  return MARK_NAMES.every((m) => Boolean(a[m]) === Boolean(b[m]))
}

/**
 * Parse paper HTML into content nodes.
 *
 * @param {string} html   the hydrated paper HTML (safeRender.richTextToPaperHtml)
 * @param {object} [opts]
 * @param {Function} [opts.DOMParserImpl] defaults to the global DOMParser
 * @returns {object[]} block nodes; always an array, never null
 */
export function parsePaperContent(html, { DOMParserImpl } = {}) {
  const source = typeof html === 'string' ? html : ''
  if (!source.trim()) return []

  const Impl = DOMParserImpl ||
    (typeof DOMParser !== 'undefined' ? DOMParser : null)
  if (!Impl) {
    // No DOM anywhere (a plain `node` caller that did not inject one). Degrade to
    // a single paragraph of tag-stripped text rather than throwing — losing the
    // formatting is bad, losing the question is worse.
    const text = source.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    return text ? [{ type: 'paragraph', children: [{ type: 'text', value: text, marks: {} }] }] : []
  }

  const doc = new Impl().parseFromString(`<body>${source}</body>`, 'text/html')
  const blocks = []
  let inline = []

  const flush = () => {
    // Drop a paragraph that holds nothing but whitespace — the editor emits
    // those between blocks and they would print as blank lines.
    const meaningful = inline.some((n) => n.type !== 'text' || n.value.trim())
    if (meaningful) blocks.push({ type: 'paragraph', children: mergeRuns(inline) })
    inline = []
  }

  const walk = (node, marks) => {
    // Text.
    if (node.nodeType === 3) {
      const value = node.textContent || ''
      if (value) inline.push({ type: 'text', value, marks: { ...marks } })
      return
    }
    if (node.nodeType !== 1) return

    const el = node
    const tag = String(el.tagName || '').toUpperCase()

    // ── The editor's structured maths nodes ──────────────────────────────
    // These are elements carrying their meaning in data-* attributes, which is
    // why they can be read structurally rather than scraped from their text.
    // Recognised with the SAME selectors and attribute readers the editor and
    // the print hydrator use (see MathFraction.js's FRACTION_SELECTOR). Matching
    // on the class alone was a silent divergence: the hydrator has always
    // accepted the `data-math-fraction` spelling too, so a fraction stored that
    // way was hydrated correctly for print and read here as the bare characters
    // "12" — a half printing as twelve, in Word, with nothing to indicate it.
    // ── Tables ───────────────────────────────────────────────────────────
    // A table is a BLOCK with structure, not a run of text, and it has to be
    // read here or it is not read at all. The preview and the print window
    // render `textHtml` directly, so a table looked perfect in both; Word walks
    // this model, and with no table node every cell was concatenated into one
    // paragraph — a results table printed as "TimeTemp020 °C535 °C". Invisible
    // from three of the four renderers, which is why it survived this long.
    if (tag === 'TABLE') {
      flush()
      const block = parseTable(el, marks, walk, () => {
        const taken = inline
        inline = []
        return mergeRuns(taken)
      })
      if (block) blocks.push(block)
      return
    }

    if (el.matches && el.matches(VERTICAL_ARITHMETIC_SELECTOR)) {
      flush()
      const attrs = readVerticalArithmeticAttrs(el)
      blocks.push({
        type: 'verticalArithmetic',
        operator: attrs.operator,
        lines: attrs.lines,
        answer: attrs.answer,
        // Ruled space for a learner to show their method. Dropping it silently
        // removed the room the question gave them.
        working: attrs.working,
      })
      return
    }
    if (el.matches && el.matches(FRACTION_SELECTOR)) {
      const attrs = readFractionAttrs(el)
      inline.push({
        type: 'fraction',
        whole: attrs.whole,
        numerator: attrs.num,
        denominator: attrs.den,
        marks: { ...marks },
      })
      return
    }
    // A formula, carrying BOTH the source LaTeX (so Word can set it as a real
    // equation) and the already-flattened inline fallback (so every other
    // renderer, and Word itself for constructs OMML cannot express, still has
    // something correct to print). See safeRender.flattenMathNodes.
    if (el.hasAttribute && el.hasAttribute('data-tex')) {
      const fallback = []
      const collect = (n, m) => {
        if (n.nodeType === 3) {
          if (n.textContent) fallback.push({ type: 'text', value: n.textContent, marks: { ...m } })
          return
        }
        if (n.nodeType !== 1) return
        const childMark = TAG_MARKS[String(n.tagName || '').toUpperCase()]
        const nextMarks = childMark ? { ...m, [childMark]: true } : m
        for (const c of Array.from(n.childNodes)) collect(c, nextMarks)
      }
      for (const child of Array.from(el.childNodes)) collect(child, marks)
      inline.push({
        type: 'math',
        tex: el.getAttribute('data-tex') || '',
        fallback: mergeRuns(fallback),
        marks: { ...marks },
      })
      return
    }
    if (el.matches && el.matches(NUMBER_BASE_SELECTOR)) {
      const attrs = readNumberBaseAttrs(el)
      inline.push({
        type: 'numberBase',
        number: attrs.number,
        base: attrs.base,
        marks: { ...marks },
      })
      return
    }

    if (tag === 'BR') {
      inline.push({ type: 'break' })
      return
    }

    if (BLOCK_TAGS.has(tag)) {
      flush()
      for (const child of Array.from(el.childNodes)) walk(child, marks)
      flush()
      return
    }

    const mark = TAG_MARKS[tag]
    const next = mark ? { ...marks, [mark]: true } : marks
    for (const child of Array.from(el.childNodes)) walk(child, next)
  }

  for (const node of Array.from(doc.body.childNodes)) walk(node, emptyMarks())
  flush()
  return blocks
}

/**
 * One `<table>` as a structured block: `{ type:'table', head:[row], rows:[row] }`
 * where a row is an array of cells and a cell is an array of INLINE nodes.
 *
 * Cells hold inline content only. A cell containing a paragraph, a fraction or
 * a sub/superscript is exactly what §4 means by "cells honour the rich-text
 * contract"; a cell containing another table is not something a school paper
 * does, and flattening it to its text is better than modelling it.
 *
 * `takeInline` hands back whatever the shared walker accumulated for one cell,
 * so cell content is parsed by the SAME code as everything else rather than by
 * a second, quietly different walker.
 */
function parseTable(el, marks, walk, takeInline) {
  const readRow = (tr) => {
    const cells = []
    for (const cell of Array.from(tr.children || [])) {
      const cellTag = String(cell.tagName || '').toUpperCase()
      if (cellTag !== 'TD' && cellTag !== 'TH') continue
      takeInline() // discard anything left over from a previous cell
      for (const child of Array.from(cell.childNodes)) walk(child, marks)
      cells.push({ header: cellTag === 'TH', children: takeInline() })
    }
    return cells
  }

  const head = []
  const rows = []
  for (const part of Array.from(el.querySelectorAll('tr'))) {
    const inHead = Boolean(part.closest && part.closest('thead'))
    const cells = readRow(part)
    if (!cells.length) continue
    // A row of TH cells is a header row wherever it sits — a table written
    // without <thead> is common in pasted content and still has a header.
    if (inHead || (!rows.length && !head.length && cells.every((c) => c.header))) {
      head.push(cells)
    } else {
      rows.push(cells)
    }
  }
  if (!head.length && !rows.length) return null
  const columns = Math.max(
    ...[...head, ...rows].map((r) => r.length),
    1,
  )
  return { type: 'table', head, rows, columns }
}

/**
 * Merge adjacent text nodes that carry identical marks.
 *
 * Nested inline tags (`<strong><em>x</em>y</strong>`) and the sub/sup elements
 * the maths flattener emits produce a node per fragment. One Word run per
 * fragment bloats the file and interferes with Word's own line breaking, and one
 * `<span>` per fragment does the same to the print window.
 */
function mergeRuns(nodes) {
  const out = []
  for (const node of nodes) {
    const last = out[out.length - 1]
    if (node.type === 'text' && last && last.type === 'text' && sameMarks(last.marks, node.marks)) {
      last.value += node.value
      continue
    }
    out.push(node)
  }
  return out
}

/* ── Serialisers: the model is the source, these are its outputs ─────────── */

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (c) => HTML_ESCAPES[c])
}

/** The tags that carry each mark, innermost last. */
const MARK_TAGS = {
  bold: 'strong', italic: 'em', underline: 'u', strike: 's', sup: 'sup', sub: 'sub',
}

function wrapMarks(html, marks) {
  let out = html
  for (const name of MARK_NAMES) {
    if (marks && marks[name]) out = `<${MARK_TAGS[name]}>${out}</${MARK_TAGS[name]}>`
  }
  return out
}

/** A table block as HTML, for the print window. */
function tableToHtml(block) {
  const cellHtml = (cell) => (cell.children || []).map(inlineToHtml).join('')
  const rowHtml = (row) => '<tr>' + row
      .map((cell) => (cell.header
        ? `<th>${cellHtml(cell)}</th>`
        : `<td>${cellHtml(cell)}</td>`))
      .join('') + '</tr>'
  const head = (block.head || []).map(rowHtml).join('')
  const body = (block.rows || []).map(rowHtml).join('')
  return '<table>' +
    (head ? `<thead>${head}</thead>` : '') +
    (body ? `<tbody>${body}</tbody>` : '') +
    '</table>'
}

/**
 * Render content nodes back to HTML, for the print window.
 *
 * The print window is an HTML renderer, so HTML is the right OUTPUT for it — the
 * point of §4.1 is that it is no longer the interchange format the other
 * renderers have to parse.
 */
export function contentToHtml(nodes) {
  const blocks = Array.isArray(nodes) ? nodes : []
  const out = []
  for (const block of blocks) {
    if (block.type === 'table') {
      out.push(tableToHtml(block))
      continue
    }
    if (block.type === 'verticalArithmetic') {
      out.push(verticalArithmeticHtml(block))
      continue
    }
    const inner = (block.children || []).map(inlineToHtml).join('')
    out.push(`<p>${inner}</p>`)
  }
  return out.join('')
}

function inlineToHtml(node) {
  if (node.type === 'break') return '<br>'
  if (node.type === 'text') return wrapMarks(escapeHtml(node.value), node.marks)
  // A structured node is emitted as its own element carrying BOTH its data (so
  // the model round-trips through its own output — the property that makes it
  // canonical rather than merely first) and a legible inline fallback (so the
  // print window draws something correct even with no stylesheet).
  if (node.type === 'fraction') {
    const whole = node.whole ? `${escapeHtml(node.whole)} ` : ''
    const inner =
      `${whole}<sup>${escapeHtml(node.numerator)}</sup>` +
      `&frasl;<sub>${escapeHtml(node.denominator)}</sub>`
    return wrapMarks(
      `<span class="math-frac" data-whole="${escapeHtml(node.whole)}" ` +
      `data-num="${escapeHtml(node.numerator)}" ` +
      `data-den="${escapeHtml(node.denominator)}">${inner}</span>`,
      node.marks,
    )
  }
  if (node.type === 'numberBase') {
    const base = node.base ? `<sub>${escapeHtml(node.base)}</sub>` : ''
    return wrapMarks(
      `<span class="num-base" data-number="${escapeHtml(node.number)}" ` +
      `data-base="${escapeHtml(node.base)}">${escapeHtml(node.number)}${base}</span>`,
      node.marks,
    )
  }
  if (node.type === 'math') {
    const inner = (node.fallback || []).map(inlineToHtml).join('')
    return wrapMarks(`<span data-tex="${escapeHtml(node.tex)}">${inner}</span>`, node.marks)
  }
  return ''
}

/**
 * A vertical sum, as a monospace block. The columns are aligned by padding
 * rather than by a table so the same alignment survives into Word, where the
 * DOCX serialiser pads identically.
 */
function verticalArithmeticHtml(block) {
  const width = columnWidth(block)
  const pad = (s) => String(s ?? '').padStart(width, ' ')
  const rows = block.lines.map((line, i) => {
    const op = i === block.lines.length - 1 ? block.operator : ' '
    return escapeHtml(`${op}  ${pad(line)}`)
  })
  rows.push(escapeHtml(`   ${'─'.repeat(width)}`))
  rows.push(escapeHtml(`   ${pad(block.answer)}`))
  // Same contract as the inline structured nodes: the data travels with the
  // rendering, so parsing this output returns the block it came from.
  if (block.working) {
    // Ruled working space, kept as underscores so a JavaScript-free renderer
    // still shows the learner where to write. The flag round-trips too, or a
    // second parse would quietly drop the space again.
    rows.push('')
    rows.push(escapeHtml(`   ${'_'.repeat(Math.max(width, 4))}`))
    rows.push(escapeHtml(`   ${'_'.repeat(Math.max(width, 4))}`))
  }
  return (
    `<pre class="vert-arith vert-arith-print" data-operator="${escapeHtml(block.operator)}" ` +
    `data-lines="${escapeHtml((block.lines || []).join('|'))}" ` +
    `data-answer="${escapeHtml(block.answer)}"` +
    `${block.working ? ' data-working="true"' : ''}>${rows.join('\n')}</pre>`
  )
}

/**
 * The column width a vertical sum pads to — the longest of its lines and its
 * answer. Shared so the HTML and the Word output align identically; computing it
 * twice is how the two would drift by a space.
 */
export function columnWidth(block) {
  return Math.max(
    ...(block.lines || []).map((l) => String(l ?? '').length),
    String(block.answer ?? '').length,
    1,
  )
}

/**
 * Content nodes as plain text — for search, alt text, and anywhere a string is
 * all that fits.
 */
export function contentToPlainText(nodes) {
  const blocks = Array.isArray(nodes) ? nodes : []
  const parts = []
  for (const block of blocks) {
    if (block.type === 'verticalArithmetic') {
      parts.push(`${block.lines.join(` ${block.operator} `)} = ${block.answer || '___'}`)
      continue
    }
    if (block.type === 'table') {
      // Cells separated by a tab, rows by a newline — the shape every plain-text
      // consumer already expects of tabular data (it matches what the DOCX
      // walker's own note describes), so search and alt text read a table as a
      // table rather than as one run-together string.
      for (const row of [...(block.head || []), ...(block.rows || [])]) {
        const line = row
            .map((cell) => contentToPlainText([{ type: 'paragraph', children: cell.children || [] }]))
            .join('\t')
        if (line.trim()) parts.push(line)
      }
      continue
    }
    let line = ''
    for (const node of block.children || []) {
      if (node.type === 'text') line += node.value
      else if (node.type === 'break') line += ' '
      else if (node.type === 'fraction') {
        line += `${node.whole ? `${node.whole} ` : ''}${node.numerator}/${node.denominator}`
      } else if (node.type === 'numberBase') line += `${node.number}${node.base}`
      else if (node.type === 'math') line += contentToPlainText([{ type: 'paragraph', children: node.fallback || [] }])
    }
    if (line.trim()) parts.push(line.trim())
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

/** True when the model carries nothing a reader would see. */
export function isContentEmpty(nodes) {
  return contentToPlainText(nodes) === ''
}
