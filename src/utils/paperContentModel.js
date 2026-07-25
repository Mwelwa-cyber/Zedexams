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
    const classes = el.classList

    // ── The editor's structured maths nodes ──────────────────────────────
    // These are elements carrying their meaning in data-* attributes, which is
    // why they can be read structurally rather than scraped from their text.
    if (classes && classes.contains('vert-arith')) {
      flush()
      blocks.push({
        type: 'verticalArithmetic',
        operator: el.getAttribute('data-operator') || '+',
        lines: String(el.getAttribute('data-lines') || '').split('|').filter((l) => l !== ''),
        answer: el.getAttribute('data-answer') || '',
      })
      return
    }
    if (classes && classes.contains('math-frac')) {
      inline.push({
        type: 'fraction',
        whole: el.getAttribute('data-whole') || '',
        numerator: el.getAttribute('data-num') || '',
        denominator: el.getAttribute('data-den') || '',
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
    if (classes && classes.contains('num-base')) {
      inline.push({
        type: 'numberBase',
        number: el.getAttribute('data-number') || '',
        base: el.getAttribute('data-base') || '',
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
  return (
    `<pre class="vert-arith vert-arith-print" data-operator="${escapeHtml(block.operator)}" ` +
    `data-lines="${escapeHtml((block.lines || []).join('|'))}" ` +
    `data-answer="${escapeHtml(block.answer)}">${rows.join('\n')}</pre>`
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
