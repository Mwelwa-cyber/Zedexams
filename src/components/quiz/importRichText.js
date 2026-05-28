/**
 * src/components/quiz/importRichText.js
 *
 * Turns the lightweight, LLM-friendly "import markup" that the smart-import
 * pipeline emits into the exact node-HTML shapes the ZedExams editor already
 * understands — the same HTML the Tiptap extensions parse back into real
 * nodes and the safeRender hydrators rebuild for the learner view, PDF, and
 * DOCX exports.
 *
 * Why a converter instead of asking the model for that HTML directly?
 *   - Models reliably produce LaTeX fractions (`\frac{a}{b}`), inline math
 *     (`$…$`), and Markdown tables. They do NOT reliably produce our bespoke
 *     `<span class="math-frac" data-num="…">` markup.
 *   - Keeping the mapping deterministic means it is unit-testable end to end
 *     and never drifts from the editor's parseHTML / sanitiser allow-lists.
 *
 * Supported markup (see functions/aiService.js buildImportStructureMessages
 * + functions/index.js Gemini prompt for the model-facing description):
 *
 *   Stacked fraction        \frac{3}{4}            (mixed: 1\frac{1}{3})
 *   Inline / KaTeX math      $\sqrt{49}$  $x^2$  $\Sigma$
 *   Vertical arithmetic      [[vmath op=- lines=954751,362948 answer=591803]]
 *   Table                    | Animal | Legs |
 *                            | --- | --- |
 *                            | Dog | 4 |
 *
 * Target node-HTML (must stay in sync with the extensions + sanitiser):
 *   MathFraction       <span class="math-frac" data-math-fraction="1"
 *                            data-whole data-num data-den></span>
 *   MathInline         <span class="mnode" data-latex="…"></span>
 *   VerticalArithmetic <div class="vert-arith" data-vertical-arithmetic="1"
 *                            data-operator data-lines data-answer
 *                            data-working></div>
 *   Table              <table><tbody><tr><td>…</td></tr></tbody></table>
 *
 * Pure string in / string out — no DOM, so it runs in the browser importer
 * and under the plain `node` test runner alike.
 */

// Operators the VerticalArithmetic node accepts (see VerticalArithmetic.js).
// We normalise the ASCII forms a model is likely to emit (`-`, `*`, `x`, `/`)
// into the exact Unicode glyphs the node stores.
const VERT_OPERATOR_MAP = {
  '+': '+',
  '-': '−',
  '−': '−',
  '*': '×',
  x: '×',
  X: '×',
  '×': '×',
  '/': '÷',
  '÷': '÷',
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Attribute values additionally escape the double-quote we wrap them in.
function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;')
}

/**
 * Quick guard: is there any import markup worth converting? Lets callers
 * leave plain prose completely untouched (no `<p>` wrapping, no behaviour
 * change) so only questions that actually contain maths/tables are rewritten.
 */
export function hasImportMarkup(text) {
  const s = String(text || '')
  if (!s) return false
  if (
    /\\frac\s*\{/.test(s) ||           // stacked fraction
    /\$[^$\n]+\$/.test(s) ||           // $…$ inline math
    /\\\(|\\\[/.test(s) ||             // \( … \) / \[ … \]
    /\[\[\s*vmath\b/i.test(s)          // vertical arithmetic token
  ) {
    return true
  }
  // Markdown table can appear anywhere in the field, not just the first line.
  const lines = s.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    if (isTableBlockStart(lines, i)) return true
  }
  return false
}

/* ── Fractions ──────────────────────────────────────────────────────────── */

// A "simple" fraction is integer/integer with an optional leading whole
// number — exactly what MathFraction renders as a stacked fraction. Anything
// fancier (\frac{x+1}{2}, nested braces) stays as KaTeX via MathInline.
const SIMPLE_FRACTION_RE = /^\s*(\d+)?\s*\\frac\{(\d+)\}\{(\d+)\}\s*$/

function fractionSpan({ whole = '', num, den }) {
  return (
    '<span class="math-frac" data-math-fraction="1"' +
    ` data-whole="${escapeAttr(whole)}"` +
    ` data-num="${escapeAttr(num)}"` +
    ` data-den="${escapeAttr(den)}"></span>`
  )
}

function mathInlineSpan(latex) {
  return `<span class="mnode" data-latex="${escapeAttr(latex)}"></span>`
}

// Render a single LaTeX expression as the nicest node we can: a stacked
// MathFraction when it is a plain integer fraction, otherwise inline KaTeX.
function latexToNode(latex) {
  const trimmed = String(latex || '').trim()
  if (!trimmed) return ''
  const frac = trimmed.match(SIMPLE_FRACTION_RE)
  if (frac) {
    return fractionSpan({ whole: frac[1] || '', num: frac[2], den: frac[3] })
  }
  return mathInlineSpan(trimmed)
}

/* ── Inline conversion (text + $math$ + bare \frac) ─────────────────────── */

// Walks a single run of text and replaces every maths region with the right
// node, HTML-escaping everything in between. Order matters: we consume
// delimited math ($…$, \(…\), \[…\]) and bare \frac{…}{…} left to right so a
// `\frac` already inside `$…$` is handled by the delimiter branch.
export function convertInline(text) {
  const src = String(text ?? '')
  let out = ''
  let i = 0
  const n = src.length

  while (i < n) {
    const ch = src[i]

    // $ … $  (single-dollar inline math). No newline allowed inside.
    if (ch === '$') {
      const end = src.indexOf('$', i + 1)
      if (end > i) {
        const inner = src.slice(i + 1, end)
        if (inner.trim() && !inner.includes('\n')) {
          out += latexToNode(inner)
          i = end + 1
          continue
        }
      }
    }

    // \( … \)  and  \[ … \]
    if (ch === '\\' && (src[i + 1] === '(' || src[i + 1] === '[')) {
      const close = src[i + 1] === '(' ? '\\)' : '\\]'
      const end = src.indexOf(close, i + 2)
      if (end > i) {
        const inner = src.slice(i + 2, end)
        if (inner.trim()) {
          out += latexToNode(inner)
          i = end + 2
          continue
        }
      }
    }

    // Bare \frac{…}{…} (optionally a leading whole number directly before it,
    // e.g. "1\frac{1}{3}" → mixed number).
    if (ch === '\\' && src.startsWith('\\frac', i)) {
      const parsed = readBareFrac(src, i)
      if (parsed) {
        // Pull a directly-preceding integer off the already-emitted output so
        // "1\frac{1}{3}" becomes a mixed number rather than "1" + "1/3".
        const wholeMatch = out.match(/(\d+)\s*$/)
        let whole = ''
        if (wholeMatch) {
          whole = wholeMatch[1]
          out = out.slice(0, out.length - wholeMatch[0].length)
        }
        out += fractionSpan({ whole, num: parsed.num, den: parsed.den })
        i = parsed.end
        continue
      }
    }

    out += escapeHtml(ch)
    i += 1
  }

  return out
}

// Reads a `\frac{NUM}{DEN}` starting at `start`. Returns { num, den, end }
// for integer numerator/denominator, or null for anything else (so complex
// fractions fall through to plain escaping rather than a broken node).
function readBareFrac(src, start) {
  const re = /\\frac\{(\d+)\}\{(\d+)\}/y
  re.lastIndex = start
  const m = re.exec(src)
  if (!m) return null
  return { num: m[1], den: m[2], end: re.lastIndex }
}

/* ── Vertical arithmetic token ──────────────────────────────────────────── */

// Parse a single [[vmath …]] token body into the node's attributes.
//   [[vmath op=- lines=954751,362948 answer=591803 working=false]]
// Values may be bare or quoted. `lines` is comma-separated; the node stores
// them pipe-joined (encodeLines), which is what we emit here.
export function parseVmathToken(body) {
  const attrs = { operator: '+', lines: ['', ''], answer: '', working: false }
  const partRe = /(\w+)\s*=\s*("[^"]*"|'[^']*'|[^\s\]]+)/g
  let m
  while ((m = partRe.exec(body))) {
    const key = m[1].toLowerCase()
    let val = m[2]
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (key === 'op' || key === 'operator') {
      attrs.operator = VERT_OPERATOR_MAP[val] || '+'
    } else if (key === 'lines') {
      attrs.lines = val.split(',').map((s) => s.trim()).filter((s) => s.length)
    } else if (key === 'answer') {
      attrs.answer = val.trim()
    } else if (key === 'working') {
      attrs.working = val === 'true' || val === '1'
    }
  }
  if (attrs.lines.length < 2) {
    // A single operand is meaningless for a column sum — pad to two blanks so
    // the node still renders something a teacher can edit.
    while (attrs.lines.length < 2) attrs.lines.push('')
  }
  return attrs
}

function verticalArithmeticDiv(attrs) {
  return (
    '<div class="vert-arith" data-vertical-arithmetic="1"' +
    ` data-operator="${escapeAttr(attrs.operator)}"` +
    ` data-lines="${escapeAttr(attrs.lines.join('|'))}"` +
    ` data-answer="${escapeAttr(attrs.answer)}"` +
    ` data-working="${attrs.working ? 'true' : 'false'}"></div>`
  )
}

/* ── Markdown tables ────────────────────────────────────────────────────── */

const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

function looksLikeTableRow(line) {
  return typeof line === 'string' && line.includes('|') && /\S/.test(line)
}

// A markdown table block starts where a row line is immediately followed by a
// separator line (| --- | --- |). Both conditions are required so a stray `|`
// in prose never starts a table.
function isTableBlockStart(lines, idx) {
  return (
    looksLikeTableRow(lines[idx]) &&
    typeof lines[idx + 1] === 'string' &&
    TABLE_SEPARATOR_RE.test(lines[idx + 1]) &&
    lines[idx + 1].includes('|')
  )
}

function splitTableCells(line) {
  let s = String(line).trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  return s.split('|').map((cell) => cell.trim())
}

// Consumes a markdown table beginning at `start`. Returns { html, end } where
// `end` is the index of the first line after the table.
function consumeTable(lines, start) {
  const headerCells = splitTableCells(lines[start])
  let i = start + 2 // skip header + separator
  const bodyRows = []
  while (i < lines.length && looksLikeTableRow(lines[i])) {
    bodyRows.push(splitTableCells(lines[i]))
    i += 1
  }

  const colCount = Math.max(
    headerCells.length,
    ...bodyRows.map((r) => r.length),
    1,
  )
  const padRow = (cells) => {
    const padded = cells.slice(0, colCount)
    while (padded.length < colCount) padded.push('')
    return padded
  }

  const th = padRow(headerCells)
    .map((c) => `<th>${convertInline(c)}</th>`)
    .join('')
  const body = bodyRows
    .map(
      (row) =>
        '<tr>' +
        padRow(row)
          .map((c) => `<td>${convertInline(c)}</td>`)
          .join('') +
        '</tr>',
    )
    .join('')

  const html =
    '<table><thead><tr>' +
    th +
    '</tr></thead><tbody>' +
    body +
    '</tbody></table>'
  return { html, end: i }
}

/* ── Block-level conversion ─────────────────────────────────────────────── */

// Matches a line that is ONLY a [[vmath …]] token (the model is told to put
// it on its own line so it becomes a block, like the editor's node).
const VMATH_LINE_RE = /^\s*\[\[\s*vmath\b([^\]]*)\]\]\s*$/i

/**
 * Convert a full rich-text field (question stem, passage, explanation) from
 * import markup into editor HTML. Block constructs (tables, vertical
 * arithmetic) become their own elements; runs of plain lines become `<p>`
 * paragraphs with inline maths converted.
 *
 * Returns plain text untouched when there is no markup, so non-maths
 * questions import exactly as before.
 */
export function importMarkupToRichHtml(text) {
  const src = String(text ?? '')
  if (!src.trim()) return ''
  if (!hasImportMarkup(src)) return src

  const lines = src.split(/\r?\n/)
  const parts = []
  let paragraph = []

  const flushParagraph = () => {
    if (!paragraph.length) return
    const inner = paragraph.map((l) => convertInline(l)).join('<br>')
    if (inner.trim()) parts.push(`<p>${inner}</p>`)
    paragraph = []
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) {
      flushParagraph()
      i += 1
      continue
    }

    const vmath = line.match(VMATH_LINE_RE)
    if (vmath) {
      flushParagraph()
      parts.push(verticalArithmeticDiv(parseVmathToken(vmath[1])))
      i += 1
      continue
    }

    if (isTableBlockStart(lines, i)) {
      flushParagraph()
      const { html, end } = consumeTable(lines, i)
      parts.push(html)
      i = end
      continue
    }

    paragraph.push(line)
    i += 1
  }
  flushParagraph()

  return parts.join('')
}

/**
 * Convert a single answer option. Options are inline, single-value fields, so
 * we only run inline conversion (fractions + $math$) — no paragraphs, tables,
 * or block vertical-arithmetic. Plain options pass straight through.
 */
export function importMarkupToOptionHtml(text) {
  const src = String(text ?? '')
  if (!src.trim()) return src
  if (!hasImportMarkup(src)) return src
  // Strip a leading vmath line guard: options never carry block tokens, but a
  // stray `$…$` or `\frac` should still convert.
  return convertInline(src.replace(/\n+/g, ' '))
}
