/**
 * lessonPlanBlocks — structured, non-prose content inside a lesson plan's
 * progression cells (§4.7).
 *
 * A lesson plan is not always sentences. A Grade 3 Numeracy plan carries worked
 * column sums with the digits aligned under their place values; a Reception
 * plan is a matching exercise with pictures, not a paragraph describing one.
 * Both used to reach the page as prose, because a cell was a string and a
 * string is prose.
 *
 * The notation is deliberately line-oriented and semicolon-free, because a cell
 * travels as a JSON string and `planShape.toLines` splits cells on newlines and
 * semicolons. One block is one line:
 *
 *   #sum: 38677 + 11314              → aligned place-value column addition
 *   #sum: 38677 + 11314 = 49991      → …with the total stated rather than computed
 *   #expand: 38677                   → 30 000 + 8 000 + 600 + 70 + 7
 *   #match: ball|star, cup|spoon     → two picture columns to join with a line
 *
 * Everything here is pure: parsing and HTML generation only. The Word exporter
 * maps the same parsed nodes to docx elements, so preview, print and Word draw
 * one description of the block rather than three.
 */

// ── Place value ───────────────────────────────────────────────────────────────

// Column headings, ones first. Zambian primary materials use these exact
// abbreviations (TTh = ten thousands), so a teacher reads the printed heading
// row as the one they already write on the board.
const PLACE_HEADINGS = ['O', 'T', 'H', 'Th', 'TTh', 'HTh', 'M', 'TM']

// The value of each place, ones first — used by expanded notation.
const PLACE_VALUES = [1, 10, 100, 1000, 10000, 100000, 1000000, 10000000]

/** Group a number with spaces the way Zambian classrooms write it: 38 677. */
export function groupDigits(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

/** Digits of a number, most significant first. */
function digitsOf(n) {
  return String(Math.trunc(Math.abs(n))).split('').map(Number)
}

/**
 * Expanded notation: 38677 → ['30 000', '8 000', '600', '70', '7'].
 * Zero places are dropped — "30 000 + 0 + 600" is not how it is taught.
 */
export function expandedParts(n) {
  const digits = digitsOf(n)
  const out = []
  digits.forEach((d, i) => {
    if (d === 0) return
    const place = PLACE_VALUES[digits.length - 1 - i]
    out.push(groupDigits(d * place))
  })
  return out
}

// ── Parsing ───────────────────────────────────────────────────────────────────

const SUM_RE = /^#sum:\s*(.+)$/i
const EXPAND_RE = /^#expand:\s*(.+)$/i
const MATCH_RE = /^#match:\s*(.+)$/i

function parseNumber(token) {
  const cleaned = String(token || '').replace(/[\s,]/g, '')
  if (!/^\d+$/.test(cleaned)) return null
  return Number(cleaned)
}

/**
 * Parse `#sum: 38677 + 11314 [= 49991]`.
 * Returns null when the line is not a well-formed sum — an unparseable block
 * falls back to being printed as ordinary text rather than vanishing.
 */
function parseSum(body) {
  const [left, right] = String(body).split('=')
  const addends = left.split('+').map(parseNumber)
  if (addends.length < 2 || addends.some((n) => n == null)) return null
  const stated = right != null ? parseNumber(right) : null
  const total = stated == null ? addends.reduce((a, b) => a + b, 0) : stated
  const width = Math.max(String(total).length, ...addends.map((a) => String(a).length))
  return {
    type: 'sum',
    addends,
    total,
    width,
    headings: PLACE_HEADINGS.slice(0, width).reverse(),
  }
}

function parseExpand(body) {
  const n = parseNumber(body)
  if (n == null) return null
  return { type: 'expand', number: n, parts: expandedParts(n) }
}

/**
 * Parse `#match: ball|star, cup|spoon`. Each pair is one printed ROW: the left
 * item and the right item a learner draws a line between. The right column is
 * deliberately printed in the order given — shuffling is the generator's job,
 * because a renderer that shuffles would print a different sheet every time it
 * re-rendered and the marking key would stop matching the learner's copy.
 */
function parseMatch(body) {
  const pairs = String(body)
    .split(',')
    .map((chunk) => chunk.split('|').map((s) => s.trim().toLowerCase()))
    .filter((p) => p.length === 2 && p[0] && p[1])
  if (pairs.length === 0) return null
  return { type: 'match', pairs: pairs.map(([left, right]) => ({ left, right })) }
}

/**
 * Split one cell's text into typed nodes. Consecutive prose lines stay together
 * in a single `text` node so an ordinary cell parses to exactly one node and
 * every existing plan renders byte-for-byte as before.
 *
 * @param {unknown} value
 * @returns {Array<object>}
 */
export function parseCellBlocks(value) {
  const text = Array.isArray(value) ? value.join('\n') : String(value == null ? '' : value)
  if (!text.trim()) return []
  const nodes = []
  let prose = []

  const flush = () => {
    if (prose.length) {
      nodes.push({ type: 'text', text: prose.join('\n') })
      prose = []
    }
  }

  for (const rawLine of text.split(/\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    let node = null
    let m
    if ((m = SUM_RE.exec(line))) node = parseSum(m[1])
    else if ((m = EXPAND_RE.exec(line))) node = parseExpand(m[1])
    else if ((m = MATCH_RE.exec(line))) node = parseMatch(m[1])

    if (node) {
      flush()
      nodes.push(node)
    } else {
      prose.push(line)
    }
  }
  flush()
  return nodes
}

/** True when a cell carries at least one structured block. */
export function hasBlocks(value) {
  return parseCellBlocks(value).some((n) => n.type !== 'text')
}

// ── Line-art object library ───────────────────────────────────────────────────

/**
 * A small library of printable line-art objects for early-childhood matching,
 * sorting and odd-one-out blocks. Stroke-only on a 40×40 canvas so it prints
 * legibly in black and white and photocopies without filling in — the same
 * constraint every other printed surface in this repo is held to.
 *
 * Keys are the words a Reception teacher uses; the generator picks from
 * `OBJECT_ART_NAMES` so it can never name a picture that does not exist.
 */
const OBJECT_ART_PATHS = {
  ball: '<circle cx="20" cy="20" r="14"/><path d="M8 14 Q20 24 32 14"/><path d="M8 26 Q20 16 32 26"/>',
  star: '<polygon points="20,4 24.7,14.6 36,15.4 27.4,23 30.2,34 20,28 9.8,34 12.6,23 4,15.4 15.3,14.6"/>',
  cup: '<rect x="8" y="12" width="18" height="16" rx="2"/><path d="M26 16 q8 3 0 9"/>',
  spoon: '<ellipse cx="20" cy="11" rx="6" ry="8"/><line x1="20" y1="19" x2="20" y2="36"/>',
  sock: '<path d="M14 5 h10 v16 q0 5 5 7 l4 2 q3 2 1 5 h-12 q-8 -2 -8 -10 z"/>',
  leaf: '<path d="M8 32 Q10 10 32 8 Q30 30 8 32 z"/><line x1="8" y1="32" x2="24" y2="16"/>',
  chair: '<rect x="12" y="6" width="16" height="16" rx="1"/><line x1="12" y1="22" x2="12" y2="34"/><line x1="28" y1="22" x2="28" y2="34"/><line x1="12" y1="22" x2="28" y2="22"/>',
  book: '<path d="M6 8 h13 q1 4 1 24 h-14 z"/><path d="M34 8 h-13 q-1 4 -1 24 h14 z"/>',
  pencil: '<path d="M10 32 l3 -8 l16 -16 l5 5 l-16 16 z"/><line x1="27" y1="10" x2="32" y2="15"/>',
  tree: '<path d="M20 4 L30 20 H10 z"/><path d="M20 14 L32 30 H8 z"/><rect x="18" y="30" width="4" height="6"/>',
  house: '<path d="M6 20 L20 8 L34 20"/><rect x="10" y="20" width="20" height="14"/><rect x="17" y="26" width="6" height="8"/>',
  fish: '<path d="M6 20 Q16 10 26 20 Q16 30 6 20 z"/><path d="M26 20 L34 13 L34 27 z"/><circle cx="12" cy="18" r="1.2"/>',
  bird: '<path d="M8 24 Q16 12 28 16 L34 12 L32 20 Q30 30 18 30 Q8 30 8 24 z"/><circle cx="28" cy="19" r="1"/>',
  apple: '<circle cx="20" cy="23" r="12"/><path d="M20 11 q0 -6 6 -7"/>',
  drum: '<ellipse cx="20" cy="13" rx="12" ry="5"/><path d="M8 13 v12 q0 5 12 5 q12 0 12 -5 v-12"/><line x1="10" y1="17" x2="30" y2="26"/><line x1="30" y1="17" x2="10" y2="26"/>',
}

export const OBJECT_ART_NAMES = Object.freeze(Object.keys(OBJECT_ART_PATHS))

/**
 * The SVG markup for one object, sized in millimetres so the preview and the
 * print window draw the same physical picture.
 *
 * Returns '' for an unknown name — the caller prints the WORD instead, so a
 * generator that invents "wheelbarrow" produces a usable (if plainer) matching
 * sheet rather than an empty box.
 *
 * @param {string} name
 * @param {{ sizeMm?: number, stroke?: string }} [opts]
 * @returns {string}
 */
export function objectArtSvg(name, { sizeMm = 11, stroke = '#333' } = {}) {
  const key = String(name || '').trim().toLowerCase()
  const paths = OBJECT_ART_PATHS[key]
  if (!paths) return ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" ` +
    `width="${sizeMm}mm" height="${sizeMm}mm" fill="none" stroke="${stroke}" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`
  )
}

/** True when the library can draw this object. */
export function hasObjectArt(name) {
  return Object.prototype.hasOwnProperty.call(OBJECT_ART_PATHS, String(name || '').trim().toLowerCase())
}

// ── HTML rendering ────────────────────────────────────────────────────────────

function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * The aligned column-addition block. A real <table> rather than a <pre>: a
 * monospace block is only aligned while the font is monospace, and Word's
 * default is not — the same digits that line up in the preview would stagger in
 * the export. One cell per place value lines up in every renderer.
 */
function sumHtml(node) {
  const cell = (content, extra = '') =>
    `<td style="padding:0 .6mm;text-align:center;font-variant-numeric:tabular-nums${extra}">${content}</td>`
  const digitRow = (n, { sign = '', rule = false } = {}) => {
    const digits = String(n).padStart(node.width, ' ').split('')
    const border = rule ? ';border-bottom:1px solid currentColor' : ''
    return (
      `<tr>${cell(esc(sign), border)}` +
      digits.map((d) => cell(d === ' ' ? '&nbsp;' : esc(d), border)).join('') +
      '</tr>'
    )
  }
  const headRow =
    `<tr>${cell('')}` +
    node.headings.map((h) => cell(`<span style="font-size:.85em">${esc(h)}</span>`)).join('') +
    '</tr>'
  const bodyRows = node.addends
    .map((a, i) => digitRow(a, {
      sign: i === 0 ? '' : '+',
      rule: i === node.addends.length - 1,
    }))
    .join('')
  return (
    `<table class="lp-sum" style="border-collapse:collapse;margin:1mm 0 1.5mm;font-size:.95em">` +
    `<tbody>${headRow}${bodyRows}${digitRow(node.total)}</tbody></table>`
  )
}

function expandHtml(node) {
  return `<div class="lp-expand" style="margin:.6mm 0">${esc(node.parts.join(' + '))}</div>`
}

function matchHtml(node) {
  const box = (name) => {
    const art = objectArtSvg(name)
    return (
      `<td class="lp-obj" style="border:1px solid #999;border-radius:2mm;padding:1.5mm 1mm;text-align:center;font-size:.85em">` +
      (art ? `<span style="display:block;margin:0 auto .8mm">${art}</span>` : '') +
      esc(name) +
      '</td>'
    )
  }
  const rows = node.pairs
    .map(
      (p) =>
        `<tr>${box(p.left)}` +
        `<td class="lp-dots" style="border:0;text-align:center;color:#888;font-size:.8em;padding:0 1mm">·&nbsp;·&nbsp;·</td>` +
        `${box(p.right)}</tr>`,
    )
    .join('')
  return (
    `<div class="lp-match-title" style="font-style:italic;margin:.5mm 0 1.5mm">` +
    'Draw a line to match the objects that are the same:</div>' +
    `<table class="lp-match" style="border-collapse:separate;border-spacing:0 1.5mm;width:100%">` +
    `<tbody>${rows}</tbody></table>`
  )
}

/**
 * Render one parsed node to HTML. `textToHtml` is supplied by the caller so the
 * prose keeps whatever line formatting that renderer already uses (dash lines
 * in the progression table, plain paragraphs elsewhere).
 *
 * @param {object} node
 * @param {(text: string) => string} textToHtml
 * @returns {string}
 */
export function blockToHtml(node, textToHtml) {
  if (!node) return ''
  switch (node.type) {
    case 'sum': return sumHtml(node)
    case 'expand': return expandHtml(node)
    case 'match': return matchHtml(node)
    case 'text': return typeof textToHtml === 'function' ? textToHtml(node.text) : esc(node.text)
    default: return ''
  }
}

/**
 * Render a whole cell — prose and blocks, in the order they were written.
 * @param {unknown} value
 * @param {(text: string) => string} textToHtml
 * @returns {string}
 */
export function cellToHtml(value, textToHtml) {
  return parseCellBlocks(value).map((n) => blockToHtml(n, textToHtml)).join('')
}

/**
 * The prompt fragment that teaches the generator this notation. Kept beside the
 * parser so a change to one is a change to the other in the same diff — a
 * notation the prompt describes and the parser does not accept prints as
 * literal "#sum:" text on a teacher's plan.
 */
export function blockNotationDirective() {
  return [
    'STRUCTURED CELL CONTENT — a lesson plan is not always sentences. Inside a stage cell you may put any of these on a line of their own (never inside a sentence):',
    '- "#sum: 38677 + 11314" — a worked column addition. It prints with the digits aligned under TTh Th H T O place-value headings and the answer ruled underneath. Add "= 49991" to state the answer yourself.',
    '- "#expand: 38677" — expanded notation. It prints as 30 000 + 8 000 + 600 + 70 + 7.',
    `- "#match: ball|star, cup|spoon" — a picture matching exercise for early-childhood classes. It prints two columns of line-art objects with space to draw joining lines. Use ONLY these object words: ${OBJECT_ART_NAMES.join(', ')}.`,
    'Use these for Mathematics and Numeracy worked examples at any grade, and for Baby Class / Nursery / Reception activities. Never describe such an exercise in a paragraph when a block can show it.',
  ].join('\n')
}
