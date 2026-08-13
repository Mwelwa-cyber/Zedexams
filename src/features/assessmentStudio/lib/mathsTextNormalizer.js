// Turning computer-style mathematics in plain text into the structured nodes
// the editor produces (§8, the stretch goal).
//
// "Create paper with AI" and the scan/import flows hand back question text as
// plain strings, so a generated Grade 7 paper says "3/5" and "x^2" where a
// printed Zambian paper says three-fifths over a bar and x with a raised 2.
// After the editor work, a teacher CAN fix each one by hand. This converts the
// ones that can be converted without guessing.
//
// ── What it will not do, and why ──────────────────────────────────────────
//
// A bare `a/b` is NOT converted. "3/5" is how a fraction is written and also
// how a ratio, a date and a range are written, and nothing in the string
// distinguishes them — the generator emits all of them. Converting on sight
// would silently turn "the ratio 3/5" into a fraction, which is a wrong
// question rather than an ugly one, and it would do so invisibly. §8 is
// explicit that an ambiguous pattern is left alone, and this is the ambiguous
// pattern.
//
// So bare fractions are offered to the teacher rather than applied: this module
// reports them as `candidates` and the studio's "Convert maths notation" action
// shows the count before changing anything. Everything in `changes` below is a
// pattern that has no second reading.
//
// Pure — no React, no DOM. The output is Tiptap JSON built from the same node
// types the modals insert, so a converted question is indistinguishable from
// one the teacher typed by hand.

/* ------------------------------------------------------------------ *
 * The patterns
 * ------------------------------------------------------------------ */

// `2 3/7` — a whole number, a space, then a fraction. A date, a ratio and a
// range never carry a leading whole number in this shape, so this one reads
// only as a mixed number.
// The trailing guard rejects a following digit-after-dot (a decimal such as
// `1/2.5`) but NOT a sentence-ending full stop, which an earlier `[\w.\/]`
// class swallowed — so "Convert 2 3/7." went unconverted purely for ending a
// sentence, which is where a mixed number most often sits.
const MIXED_NUMBER = /(?<![\w.])(\d{1,4})\s+(\d{1,4})\/(\d{1,4})(?![\w/]|\.\d)/g

// `x^2`, `10^-3` — `^` has no other meaning in a school paper.
const POWER = /(?<![\w^])([A-Za-z0-9)\]]+)\^(-?\d+|\{[^{}]{1,12}\})/g

// `sqrt(49)`, `sqrt 49` — a function name that means exactly one thing.
const SQRT = /\bsqrt\s*(?:\(([^()]{1,24})\)|(\d+(?:\.\d+)?))/gi

// A bare `a/b`. Reported, never applied — see the note above.
const BARE_FRACTION = /(?<![\w./])(\d{1,4})\/(\d{1,4})(?![\w/]|\.\d)/g

/* ------------------------------------------------------------------ *
 * Node builders — the same shapes the modals insert
 * ------------------------------------------------------------------ */

const textNode = (value, marks) => (marks ? { type: 'text', text: value, marks } : { type: 'text', text: value })
const fractionNode = (num, den, whole = '') => ({
  type: 'mathFraction', attrs: { whole, num, den },
})
const mathNode = (latex) => ({ type: 'mathInline', attrs: { latex } })

/**
 * A denominator of zero is not a fraction, so a "3/0" in generated text is
 * left as the text it is rather than converted into an impossible node the
 * fraction modal itself would refuse.
 */
function usableFraction(num, den) {
  return Number(den) !== 0
}

/* ------------------------------------------------------------------ *
 * Converting one run of text
 * ------------------------------------------------------------------ */

/**
 * Split a plain string into the inline nodes it should become.
 *
 * Returns `{ nodes, converted, candidates }`:
 *   nodes      — inline Tiptap nodes (text runs plus any maths nodes)
 *   converted  — how many unambiguous patterns became nodes
 *   candidates — how many bare `a/b` were seen and deliberately left alone
 *
 * A string with nothing to convert comes back as a single text node and
 * `converted: 0`, so a caller can tell "nothing to do" from "done".
 */
export function normalizeMathsInText(value, marks) {
  const source = String(value ?? '')
  if (!source) return { nodes: [], converted: 0, candidates: 0 }

  // Collect every match first, then build left to right. Matching in one pass
  // per pattern and sorting afterwards keeps the patterns independent — a
  // combined regex would make each one's behaviour depend on the others' order.
  const hits = []
  let m

  MIXED_NUMBER.lastIndex = 0
  while ((m = MIXED_NUMBER.exec(source)) !== null) {
    if (!usableFraction(m[2], m[3])) continue
    hits.push({ start: m.index, end: m.index + m[0].length, node: fractionNode(m[2], m[3], m[1]) })
  }

  POWER.lastIndex = 0
  while ((m = POWER.exec(source)) !== null) {
    const exponent = m[2].startsWith('{') ? m[2].slice(1, -1) : m[2]
    hits.push({ start: m.index, end: m.index + m[0].length, node: mathNode(`${m[1]}^{${exponent}}`) })
  }

  SQRT.lastIndex = 0
  while ((m = SQRT.exec(source)) !== null) {
    const operand = m[1] ?? m[2] ?? ''
    if (!operand) continue
    hits.push({ start: m.index, end: m.index + m[0].length, node: mathNode(`\\sqrt{${operand}}`) })
  }

  // Earliest first; on a tie the longer match wins, so `2 3/7` is a mixed
  // number rather than a whole number followed by something else.
  hits.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start))

  const chosen = []
  let cursor = -1
  for (const hit of hits) {
    if (hit.start < cursor) continue // overlaps something already taken
    chosen.push(hit)
    cursor = hit.end
  }

  // Bare fractions are counted only OUTSIDE the spans already converted, so a
  // mixed number's own "3/7" is not also reported as an unconverted candidate.
  let candidates = 0
  BARE_FRACTION.lastIndex = 0
  while ((m = BARE_FRACTION.exec(source)) !== null) {
    const inChosen = chosen.some((h) => m.index >= h.start && m.index < h.end)
    if (!inChosen && usableFraction(m[1], m[2])) candidates += 1
  }

  if (!chosen.length) {
    return { nodes: [textNode(source, marks)], converted: 0, candidates }
  }

  const nodes = []
  let at = 0
  for (const hit of chosen) {
    if (hit.start > at) nodes.push(textNode(source.slice(at, hit.start), marks))
    nodes.push(hit.node)
    at = hit.end
  }
  if (at < source.length) nodes.push(textNode(source.slice(at), marks))

  return { nodes, converted: chosen.length, candidates }
}

/**
 * Convert every bare `a/b` as well — the teacher's explicit choice.
 *
 * Separate from `normalizeMathsInText` on purpose. That function is safe to run
 * on anything; this one changes the meaning of text it cannot fully read, so it
 * only ever runs when a teacher has asked for it, having been shown the count.
 */
export function normalizeMathsInTextIncludingBareFractions(value, marks) {
  const source = String(value ?? '')
  if (!source) return { nodes: [], converted: 0, candidates: 0 }

  const first = normalizeMathsInText(source, marks)
  if (!first.candidates) return first

  const out = []
  let converted = first.converted
  for (const node of first.nodes) {
    if (node.type !== 'text') { out.push(node); continue }
    const text = node.text
    let at = 0
    BARE_FRACTION.lastIndex = 0
    let m
    while ((m = BARE_FRACTION.exec(text)) !== null) {
      if (!usableFraction(m[1], m[2])) continue
      if (m.index > at) out.push(textNode(text.slice(at, m.index), marks))
      out.push(fractionNode(m[1], m[2]))
      converted += 1
      at = m.index + m[0].length
    }
    if (at === 0) { out.push(node); continue }
    if (at < text.length) out.push(textNode(text.slice(at), marks))
  }
  return { nodes: out, converted, candidates: 0 }
}

/* ------------------------------------------------------------------ *
 * Converting a whole field
 * ------------------------------------------------------------------ */

/**
 * Walk a field's value and convert the mathematics inside its text runs.
 *
 * Accepts what a field actually holds: a plain string (what AI and import
 * produce) or a Tiptap doc (what the editor holds). A doc is walked so a
 * partially-formatted question converts too — the maths inside a bolded run
 * stays bolded, because the run's marks travel onto the text nodes around the
 * new maths node.
 *
 * Returns `{ value, converted, candidates }`. `value` is the SAME reference
 * when nothing changed, so a caller can skip a write rather than dirtying a
 * paper that gained nothing.
 */
export function normalizeMathsInField(value, { includeBareFractions = false } = {}) {
  const convert = includeBareFractions
    ? normalizeMathsInTextIncludingBareFractions
    : normalizeMathsInText

  if (value == null || value === '') return { value, converted: 0, candidates: 0 }

  if (typeof value === 'string') {
    // An HTML or JSON string is not plain text — parsing it here would be a
    // second rich-text parser, and there is deliberately only one. Those
    // arrive as docs by the time a field holds them.
    const trimmed = value.trim()
    if (trimmed.startsWith('<') || trimmed.startsWith('{')) {
      return { value, converted: 0, candidates: 0 }
    }
    const { nodes, converted, candidates } = convert(value)
    if (!converted) return { value, converted: 0, candidates }
    return {
      value: { type: 'doc', content: [{ type: 'paragraph', content: nodes }] },
      converted,
      candidates,
    }
  }

  if (typeof value !== 'object' || value.type !== 'doc') {
    return { value, converted: 0, candidates: 0 }
  }

  let converted = 0
  let candidates = 0

  const walk = (node) => {
    if (!node || typeof node !== 'object') return node
    if (!Array.isArray(node.content)) return node
    const content = []
    for (const child of node.content) {
      if (child?.type === 'text' && typeof child.text === 'string') {
        const result = convert(child.text, child.marks)
        converted += result.converted
        candidates += result.candidates
        content.push(...(result.converted ? result.nodes : [child]))
        continue
      }
      content.push(walk(child))
    }
    return { ...node, content }
  }

  const next = walk(value)
  if (!converted) return { value, converted: 0, candidates }
  return { value: next, converted, candidates }
}

/**
 * Every mathematics field of a question, converted in one pass.
 *
 * Returns `{ question, converted, candidates }` — and the SAME question object
 * when nothing changed, so a no-op cannot mark a paper dirty.
 */
export function normalizeMathsInQuestion(question, opts = {}) {
  if (!question || typeof question !== 'object') {
    return { question, converted: 0, candidates: 0 }
  }
  let converted = 0
  let candidates = 0
  const patch = {}

  for (const field of ['text', 'correctAnswer', 'explanation']) {
    // An MCQ's correctAnswer is an index, not text.
    if (field === 'correctAnswer' && typeof question[field] === 'number') continue
    const result = normalizeMathsInField(question[field], opts)
    converted += result.converted
    candidates += result.candidates
    if (result.value !== question[field]) patch[field] = result.value
  }

  if (Array.isArray(question.options) && question.options.length) {
    let optionsChanged = false
    const options = question.options.map((option) => {
      const result = normalizeMathsInField(option, opts)
      converted += result.converted
      candidates += result.candidates
      if (result.value !== option) optionsChanged = true
      return result.value
    })
    if (optionsChanged) patch.options = options
  }

  if (!converted) return { question, converted: 0, candidates }
  return { question: { ...question, ...patch }, converted, candidates }
}
