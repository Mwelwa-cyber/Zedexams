/**
 * Does this rich-text value carry anything a learner would see?
 *
 * Part of the shared assessment package (see ../README.md). Environment-neutral.
 *
 * ## Why this had to move
 *
 * "The question text is empty" is the most-hit blocking rule on the paper, and
 * it was the last one the server could not run: the browser implementation
 * reaches for `DOMParser`. So the studio refused a blank question and the export
 * callable did not, and a replayed request exported a paper that prints
 *
 *     1. (no question text)                                        (1 mark)
 *
 * ## Why it is DOM-free rather than DOM-when-available
 *
 * The old implementation had both paths already — `DOMParser` in a browser, a
 * regex strip in Node — and they are not the same function. Two answers to
 * "is this question finished", chosen by which runtime asked, is the fork this
 * package exists to end. One implementation, and it has to be the one that runs
 * everywhere.
 *
 * That makes the semantics load-bearing rather than incidental, so they are
 * written out here instead of falling out of whatever `innerText` happens to do:
 *
 *   EMPTY      `<p></p>`, `<p><br></p>`, `<p>&nbsp;</p>`, a whitespace-only
 *              string, a TipTap doc of empty paragraphs, editor placeholder
 *              markup, and text made only of zero-width characters.
 *
 *   NOT EMPTY  any visible text; a maths node (`data-latex`, fraction, number
 *              base, vertical arithmetic); a table with a non-empty cell; an
 *              image or a catalogue diagram; and a fill-in-the-blank run, whose
 *              blanks ARE the content.
 *
 * The last group is the reason a tag strip is not the rule. A question that is a
 * labelled diagram, or `\ce{H2O}`, or a table of values to complete, has no text
 * at all and is perfectly finished; stripping tags and asking whether anything
 * is left would block every one of them.
 */

/** Characters that occupy no visual space and must never count as content. */
const INVISIBLE = /[​-‍⁠﻿]/g

/** The handful of entities that actually turn up in stored paper HTML. */
const ENTITIES = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  ensp: ' ', emsp: ' ', thinsp: ' ', shy: '',
}

/**
 * Decode the entities a stored paper can contain, so `&nbsp;` is measured as the
 * whitespace it is rather than as the seven visible characters it is written as.
 */
export function decodeEntities(input) {
  return String(input ?? '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10)
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match
      try {
        return String.fromCodePoint(code)
      } catch {
        return match
      }
    }
    const named = ENTITIES[body.toLowerCase()]
    return named === undefined ? match : named
  })
}

/**
 * Text with everything that occupies no space removed.
 *
 * Non-breaking and zero-width characters are the two that make a value LOOK
 * non-empty to a naive check while showing a learner nothing — `<p>&nbsp;</p>`
 * is what an editor leaves behind when a teacher selects a line and deletes it.
 */
export function visibleText(input) {
  return decodeEntities(input)
    .replace(INVISIBLE, '')
    .replace(/ /g, ' ')
    .replace(/\s+/g, '')
}

/**
 * HTML that carries content without carrying text.
 *
 * Attribute-based rather than tag-based wherever the editor's own markup is
 * attribute-based, because that is the spelling `paperContentModel` and the
 * exporters read — a check keyed on something else would drift from what
 * actually prints.
 */
const CONTENT_BEARING_HTML = [
  /\bdata-latex\s*=/i,           // KaTeX / mhchem maths
  /\bdata-math-fraction\b/i,     // MathFraction.js
  /\bdata-fraction\b/i,          // its older spelling, still in stored papers
  /\bdata-number-base\b/i,       // NumberBase.js
  /\bdata-vertical-arithmetic\b/i, // VerticalArithmetic.js
  /\bdata-diagram\b/i,
  /\bdata-blank\b/i,             // a fill-in-the-blank slot
  /<img\b/i,
  /<svg\b/i,
]

/** TipTap node types that are content in themselves, with or without text. */
const ATOMIC_NODES = new Set([
  'image', 'diagram', 'figure',
  'math', 'mathNode', 'mathInline', 'mathBlock', 'inlineMath', 'blockMath',
  'fraction', 'mathFraction', 'numberBase', 'verticalArithmetic',
  'blank', 'fillBlank',
  'horizontalRule', 'table',
])

/** TipTap node types that hold nothing on their own. */
const STRUCTURAL_NODES = new Set([
  'doc', 'paragraph', 'text', 'hardBreak', 'hard_break',
  'bulletList', 'orderedList', 'listItem', 'blockquote', 'heading',
  'tableRow', 'tableCell', 'tableHeader',
])

/** A TipTap doc, given the object, its JSON string, or something else entirely. */
export function asTiptapDoc(value) {
  if (value && typeof value === 'object' && value.type === 'doc' && Array.isArray(value.content)) {
    return value
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (parsed && parsed.type === 'doc' && Array.isArray(parsed.content)) return parsed
      } catch { /* not a doc, fall through to the string paths */ }
    }
  }
  return null
}

/** Walk a TipTap node tree looking for anything a learner would see. */
function tiptapHasContent(node) {
  if (!node) return false
  if (Array.isArray(node)) return node.some(tiptapHasContent)
  if (typeof node !== 'object') return false

  const type = String(node.type || '')
  if (type === 'text') return visibleText(node.text).length > 0
  // An atomic node is content even with no children — that is what makes it
  // atomic. A table is atomic only if a cell holds something; an empty grid is
  // scaffolding a teacher has not filled in.
  if (type === 'table') return Array.isArray(node.content) && node.content.some(tiptapHasContent)
  if (ATOMIC_NODES.has(type)) return true
  if (Array.isArray(node.content)) return node.content.some(tiptapHasContent)
  // An unrecognised node with no children is treated as CONTENT rather than as
  // nothing. A new editor node type should make a question look finished by
  // mistake, never make a finished question look blank and block its export.
  return !STRUCTURAL_NODES.has(type) && type.length > 0
}

/** Strip tags, leaving the text between them. */
function textFromHtml(html) {
  let out = String(html ?? '')
    // A block boundary is a space, or "one</p><p>two" measures as "onetwo" —
    // which does not change emptiness, but does change every caller that reads
    // this for a preview or an alt text.
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/td|\/th)\b[^>]*>/gi, ' ')
  // Strip remaining tags to a fixpoint so removals can't reassemble a tag
  // (e.g. "<scr<x>ipt>").
  let prev
  do {
    prev = out
    out = out.replace(/<[^>]*>/g, '')
  } while (out !== prev)
  return out
}

/**
 * True when this value carries something a learner would see.
 *
 * @param {string|object} value HTML, plain text, or a TipTap doc
 */
export function richTextHasContent(value) {
  if (value === null || value === undefined) return false

  const doc = asTiptapDoc(value)
  if (doc) return tiptapHasContent(doc)

  if (typeof value === 'object') {
    // A ProseMirror fragment or a node handed over without its doc wrapper.
    return tiptapHasContent(value)
  }

  const input = String(value)
  if (!input.trim()) return false
  if (CONTENT_BEARING_HTML.some((re) => re.test(input))) return true
  if (/<table\b/i.test(input)) {
    // A table counts only when a cell holds something. An empty grid is
    // scaffolding, and a question that is only scaffolding prints blank.
    return visibleText(textFromHtml(input)).length > 0
  }
  return visibleText(textFromHtml(input)).length > 0
}

/** The complement, for callers that read better that way. */
export function richTextIsEmpty(value) {
  return !richTextHasContent(value)
}
