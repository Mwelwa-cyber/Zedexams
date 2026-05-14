#!/usr/bin/env node
/**
 * Regression tests for the rich-text sanitise / serialise pipeline.
 *
 * These are the bugs that caused "Σ symbols appearing in text", "formatting
 * breaks after save", and "past papers flatten on edit". Run before merging
 * any change to:
 *   - src/utils/quizRichText.js
 *   - src/editor/utils/sanitize.js
 *   - src/editor/extensions/MathInline.js
 *   - src/editor/utils/safeRender.js
 *   - src/components/quiz/QuizRichText.jsx (runCommand / styleWithCSS)
 *
 * Run:   npm run test:sanitize
 */

import { JSDOM } from 'jsdom'

// Stand up a DOM global BEFORE importing modules that touch document/DOMParser.
const dom = new JSDOM('<!doctype html><html><body></body></html>')
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.DOMParser = dom.window.DOMParser
globalThis.Node = dom.window.Node
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.Element = dom.window.Element

const {
  ensureRichTextHtml,
  serializeEditorElement,
  createMathNodeHtml,
} = await import('../src/utils/quizRichText.js')

const { sanitizeHTML, sanitizeQuizRichHTML } = await import('../src/editor/utils/sanitize.js')

let pass = 0
let fail = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    pass++
    console.log(`  ok  ${name}`)
  } catch (err) {
    fail++
    failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}`)
    console.log(`       ${err.message}`)
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

function assertIncludes(haystack, needle, label = '') {
  if (!haystack.includes(needle)) {
    throw new Error(
      `${label || 'expected'}\n   expected to contain: ${JSON.stringify(needle)}\n   actual:              ${JSON.stringify(haystack)}`
    )
  }
}

function assertNotIncludes(haystack, needle, label = '') {
  if (haystack.includes(needle)) {
    throw new Error(
      `${label || 'expected NOT to contain'}\n   forbidden: ${JSON.stringify(needle)}\n   actual:    ${JSON.stringify(haystack)}`
    )
  }
}

// ── Group 1: semantic formatting survives save ───────────────────────
console.log('\nsemantic formatting')

test('<strong> tag survives', () => {
  const out = ensureRichTextHtml('<p><strong>bold</strong> text</p>')
  assertIncludes(out, '<strong>bold</strong>', 'strong')
})

test('<em> tag survives', () => {
  const out = ensureRichTextHtml('<p><em>italic</em> text</p>')
  assertIncludes(out, '<em>italic</em>', 'em')
})

test('<u> tag survives', () => {
  const out = ensureRichTextHtml('<p><u>underline</u> text</p>')
  assertIncludes(out, '<u>underline</u>', 'u')
})

test('<b> is aliased to <strong>', () => {
  const out = ensureRichTextHtml('<p><b>bold</b></p>')
  assertIncludes(out, '<strong>bold</strong>', 'b→strong')
})

test('<i> is aliased to <em>', () => {
  const out = ensureRichTextHtml('<p><i>italic</i></p>')
  assertIncludes(out, '<em>italic</em>', 'i→em')
})

// ── Group 2: headings survive (was the "past papers flatten" bug) ────
console.log('\nheadings & blockquote')

test('<h1> survives the pipeline', () => {
  const out = ensureRichTextHtml('<h1>Past Paper — Grade 7 Mathematics</h1>')
  assertIncludes(out, '<h1>', 'h1 tag')
  assertIncludes(out, 'Past Paper', 'h1 text')
})

test('<h2> survives the pipeline', () => {
  const out = ensureRichTextHtml('<h2>Section A</h2>')
  assertIncludes(out, '<h2>', 'h2 tag')
})

test('<h3> survives the pipeline', () => {
  const out = ensureRichTextHtml('<h3>Question 1</h3>')
  assertIncludes(out, '<h3>', 'h3 tag')
})

test('<blockquote> survives the pipeline', () => {
  const out = ensureRichTextHtml('<blockquote>A quoted passage.</blockquote>')
  assertIncludes(out, '<blockquote>', 'blockquote tag')
})

// ── Group 3: math nodes — THE Σ-in-text bug ──────────────────────────
console.log('\nmath nodes')

test('math node with data-latex round-trips', () => {
  const html = createMathNodeHtml('\\Sigma', false)
  const out = ensureRichTextHtml(html)
  assertIncludes(out, 'data-latex="\\Sigma"', 'latex attribute preserved')
  assertIncludes(out, 'class="mnode"', 'mnode class preserved')
})

test('math node with data-math-latex (Tiptap output) normalised to data-latex', () => {
  const html = '<p><span class="mnode" data-math-latex="\\frac{a}{b}">\\frac{a}{b}</span></p>'
  const out = ensureRichTextHtml(html)
  assertIncludes(out, 'data-latex="\\frac{a}{b}"', 'normalised to data-latex')
  assertNotIncludes(out, 'data-math-latex', 'old attribute name dropped')
})

test('serializeEditorElement DELETES math node when data-latex is missing', () => {
  // Simulates a .mnode whose attribute was lost but whose KaTeX glyph ("Σ")
  // is still in the DOM. Old behaviour: textContent "Σ" got captured and
  // re-saved as the new "LaTeX", leaking glyphs into question text forever.
  const editor = document.createElement('div')
  editor.innerHTML = '<p>Answer: <span class="mnode"><span class="katex">Σ</span></span> is the sum.</p>'
  const out = serializeEditorElement(editor)
  assertNotIncludes(out, 'Σ', 'rendered glyph must not leak into content')
  assertNotIncludes(out, 'mnode', 'empty math node removed entirely')
  assertIncludes(out, 'Answer:', 'surrounding text preserved')
  assertIncludes(out, 'is the sum', 'surrounding text preserved')
})

test('serializeEditorElement KEEPS math node when data-latex is present', () => {
  const editor = document.createElement('div')
  editor.innerHTML = '<p>Sum: <span class="mnode" data-latex="\\Sigma">\\Sigma</span></p>'
  const out = serializeEditorElement(editor)
  assertIncludes(out, 'data-latex="\\Sigma"', 'valid math node survives')
  assertIncludes(out, 'class="mnode"', 'mnode class preserved')
})

test('serializeEditorElement normalises data-math-latex → data-latex', () => {
  const editor = document.createElement('div')
  editor.innerHTML = '<p><span class="mnode" data-math-latex="\\pi">\\pi</span></p>'
  const out = serializeEditorElement(editor)
  assertIncludes(out, 'data-latex="\\pi"', 'normalised attribute')
  assertNotIncludes(out, 'data-math-latex', 'old attribute removed')
})

// ── Group 4: unsafe content is stripped, safe content preserved ──────
console.log('\nsecurity & sanitation')

test('<script> tag is stripped', () => {
  const out = ensureRichTextHtml('<p>hi</p><script>alert(1)</script>')
  assertNotIncludes(out, '<script', 'no script tag')
  assertNotIncludes(out, 'alert', 'no script content')
  assertIncludes(out, 'hi', 'safe content retained')
})

test('on* event attributes are stripped', () => {
  const out = ensureRichTextHtml('<p onclick="alert(1)">click</p>')
  assertNotIncludes(out, 'onclick', 'event handler removed')
  assertIncludes(out, 'click', 'text retained')
})

test('style attribute narrows to whitelisted properties', () => {
  // cleanColorValue only accepts hex / rgb / hsl / transparent / currentcolor /
  // inherit — matches the app's TEXT_COLORS palette which is all hex. Bare
  // keyword colors like "red" are intentionally dropped.
  const out = ensureRichTextHtml('<p style="text-align:center; font-weight:bold; color:#ff0000">x</p>')
  assertIncludes(out, 'text-align:center', 'text-align kept')
  assertIncludes(out, 'color:#ff0000', 'hex color kept')
  assertNotIncludes(out, 'font-weight', 'font-weight stripped — use <strong> instead')
})

test('bare keyword colors (e.g. "red") are intentionally dropped', () => {
  // Documenting existing behaviour: the sanitiser refuses named colors.
  // Users who need color must pick from the hex-only ColorPalette.
  const out = ensureRichTextHtml('<p style="color:red">x</p>')
  assertNotIncludes(out, 'color:red', 'keyword color dropped')
})

test('colspan/rowspan numeric clamping', () => {
  const out = ensureRichTextHtml('<table><tr><td colspan="3" rowspan="2">x</td></tr></table>')
  assertIncludes(out, 'colspan="3"', 'colspan preserved')
  assertIncludes(out, 'rowspan="2"', 'rowspan preserved')
})

// ── Group 5: editor sanitizer (Tiptap path) agrees on allow-lists ────
console.log('\neditor sanitizer alignment')

test('sanitizeHTML permits headings', () => {
  const out = sanitizeHTML('<h1>Title</h1><h2>Sub</h2><h3>Third</h3>')
  assertIncludes(out, '<h1>', 'h1')
  assertIncludes(out, '<h2>', 'h2')
  assertIncludes(out, '<h3>', 'h3')
})

test('sanitizeHTML permits data-latex AND data-math-latex', () => {
  const a = sanitizeHTML('<span class="mnode" data-latex="\\x">x</span>')
  const b = sanitizeHTML('<span class="mnode" data-math-latex="\\x">x</span>')
  assertIncludes(a, 'data-latex', 'data-latex kept')
  assertIncludes(b, 'data-math-latex', 'data-math-latex kept (for round-trip)')
})

test('sanitizeQuizRichHTML permits headings', () => {
  const out = sanitizeQuizRichHTML('<h1>Title</h1>')
  assertIncludes(out, '<h1>', 'h1 allowed in final defensive pass')
})

// ── Group 6: Grade-7 math blocks ─────────────────────────────────────
console.log('\nGrade-7 math blocks')

test('vertical-arithmetic data attributes survive editor sanitiser', () => {
  const input = '<div class="vert-arith" data-vertical-arithmetic="1" data-operator="−" data-lines="2376|1154" data-answer="" data-working="false"></div>'
  const out = sanitizeHTML(input)
  assertIncludes(out, 'data-vertical-arithmetic', 'wrapper marker')
  assertIncludes(out, 'data-operator="−"', 'operator')
  assertIncludes(out, 'data-lines="2376|1154"', 'lines')
})

test('vertical-arithmetic survives quiz-rich pipeline', () => {
  const input = '<div class="vert-arith" data-vertical-arithmetic="1" data-operator="+" data-lines="100|200" data-answer="300" data-working="false"></div>'
  const out = ensureRichTextHtml(input)
  assertIncludes(out, 'data-vertical-arithmetic', 'wrapper marker')
  assertIncludes(out, 'data-operator="+"', 'operator')
  assertIncludes(out, 'data-answer="300"', 'answer')
})

test('fraction data attributes survive quiz-rich pipeline', () => {
  const input = '<p>Add <span class="math-frac" data-math-fraction="1" data-whole="1" data-num="1" data-den="3"></span> and <span class="math-frac" data-math-fraction="1" data-whole="1" data-num="1" data-den="6"></span></p>'
  const out = ensureRichTextHtml(input)
  assertIncludes(out, 'data-math-fraction', 'wrapper marker')
  assertIncludes(out, 'data-whole="1"', 'whole number')
  assertIncludes(out, 'data-num="1"', 'numerator')
  assertIncludes(out, 'data-den="3"', 'denominator')
})

test('number-base data attributes survive quiz-rich pipeline', () => {
  const input = '<p>Convert <span class="num-base" data-number-base="1" data-number="313" data-base="5"></span> to base 10.</p>'
  const out = ensureRichTextHtml(input)
  assertIncludes(out, 'data-number-base', 'wrapper marker')
  assertIncludes(out, 'data-number="313"', 'number')
  assertIncludes(out, 'data-base="5"', 'base')
})

test('vert-arith / math-frac / num-base classes preserved', () => {
  const input = '<div class="vert-arith" data-vertical-arithmetic="1" data-operator="+" data-lines="1|2" data-answer="" data-working="false"></div><p><span class="math-frac" data-math-fraction="1" data-whole="" data-num="3" data-den="4"></span><span class="num-base" data-number-base="1" data-number="11" data-base="2"></span></p>'
  const out = ensureRichTextHtml(input)
  assertIncludes(out, 'class="vert-arith"', 'vert-arith class')
  assertIncludes(out, 'class="math-frac"', 'math-frac class')
  assertIncludes(out, 'class="num-base"', 'num-base class')
})

// ── Report ───────────────────────────────────────────────────────────
console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  console.log('\nfailures:')
  failures.forEach(f => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
