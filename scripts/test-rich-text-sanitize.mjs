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
 *   - src/features/quizEditor/components/QuizRichText.jsx (runCommand / styleWithCSS)
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

test('<mark> highlight survives (comprehension "highlighted word" questions)', () => {
  const out = ensureRichTextHtml('<p>Choose the <mark>highlighted</mark> word.</p>')
  assertIncludes(out, '<mark>highlighted</mark>', 'mark preserved through quiz-rich pipeline')
})

test('<mark> keeps its highlight colour via background-color style', () => {
  const out = ensureRichTextHtml('<p><mark style="background-color:#ffe58a">note</mark></p>')
  assertIncludes(out, '<mark', 'mark tag kept')
  assertIncludes(out, 'background-color:#ffe58a', 'highlight colour kept')
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

test('sanitizeHTML + sanitizeQuizRichHTML permit <mark>', () => {
  const editor = sanitizeHTML('<p><mark>x</mark></p>')
  const quiz = sanitizeQuizRichHTML('<p><mark>x</mark></p>')
  assertIncludes(editor, '<mark>', 'mark allowed in editor sanitiser')
  assertIncludes(quiz, '<mark>', 'mark allowed in quiz-rich sanitiser')
})

test('<mark> cannot smuggle a script or event handler', () => {
  const out = sanitizeQuizRichHTML('<mark onclick="alert(1)">x</mark><script>alert(2)</script>')
  assertNotIncludes(out, 'onclick', 'event handler stripped off mark')
  assertNotIncludes(out, '<script', 'script tag stripped')
  assertNotIncludes(out, 'alert', 'no script payload')
  assertIncludes(out, '<mark>x</mark>', 'clean mark retained')
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

// ── Group 7: garbage-char stripping (render-time, fixes already-stored data) ──
// Grade 7 Expressive Arts (and any past-paper imported before this fix) may
// have stray DOCX-artifact characters stored in Firestore. richTextToPlainText
// strips them at render time so no data migration is required.
console.log('\ngarbage-char stripping (render-time fix)')

const { richTextToPlainText } = await import('../src/utils/quizRichText.js')

test('U+FFFD replacement char stripped from plain text', () => {
  const out = richTextToPlainText('Hello�World')
  assertNotIncludes(out, '�', 'replacement char must be gone')
  assertIncludes(out, 'HelloWorld', 'surrounding text preserved')
})

test('U+FEFF BOM stripped from plain text', () => {
  const out = richTextToPlainText('﻿Title')
  assertNotIncludes(out, '﻿', 'BOM must be gone')
  assertIncludes(out, 'Title', 'text preserved')
})

test('U+200B zero-width space stripped from plain text', () => {
  const out = richTextToPlainText('A​Content')
  assertNotIncludes(out, '​', 'zero-width space must be gone')
  assertIncludes(out, 'AContent', 'words merged cleanly')
})

test('U+200C zero-width non-joiner stripped', () => {
  const out = richTextToPlainText('A‌Content')
  assertNotIncludes(out, '‌', 'zero-width non-joiner stripped')
})

test('U+200D zero-width joiner stripped', () => {
  const out = richTextToPlainText('A‍Content')
  assertNotIncludes(out, '‍', 'zero-width joiner stripped')
})

test('U+2060 word joiner stripped', () => {
  const out = richTextToPlainText('A⁠Content')
  assertNotIncludes(out, '⁠', 'word joiner stripped')
})

test('U+00AD soft hyphen stripped from plain text', () => {
  const out = richTextToPlainText('Ex­pressive')
  assertNotIncludes(out, '­', 'soft hyphen must be gone')
  assertIncludes(out, 'Expressive', 'word must be intact')
})

test('C0 control char (U+0007 BEL) stripped from plain text', () => {
  const out = richTextToPlainText('Test\u0007After')
  assertNotIncludes(out, '\u0007', 'BEL stripped')
  assertIncludes(out, 'TestAfter', 'text preserved')
})

test('C1 control char (U+0085 NEL) stripped from plain text', () => {
  const out = richTextToPlainText('TestAfter')
  assertNotIncludes(out, '', 'C1 NEL stripped')
  assertIncludes(out, 'TestAfter', 'text preserved')
})

test('garbage chars stripped from HTML rich-text (already-stored path)', () => {
  const out = richTextToPlainText('<p>Hello�World​</p>')
  assertNotIncludes(out, '�', 'replacement char stripped from HTML')
  assertNotIncludes(out, '​', 'zero-width space stripped from HTML')
  assertIncludes(out, 'HelloWorld', 'plain text preserved')
})

test('legitimate non-ASCII chars preserved (accented, Cinyanja, em-dash, musical)', () => {
  // These MUST NOT be touched by the garbage-char stripping pass.
  const phrase = 'café — Nsonga ya uluzi ♥ ♪'
  const out = richTextToPlainText(phrase)
  assertIncludes(out, 'café', 'accented char preserved')
  assertIncludes(out, '—', 'em-dash preserved')
  assertIncludes(out, 'Nsonga', 'Cinyanja word preserved')
  assertIncludes(out, '♥', 'heart symbol preserved')
  assertIncludes(out, '♪', 'musical note preserved')
})

// ── Group 8: garbage chars stripped on the HTML render path ──────────────────
// The Past Paper Studio renders question content through RichContent ->
// safeRender.toHTML -> sanitizeHTML (Tiptap/HTML path), and quiz rich text
// through sanitizeQuizRichHTML. Both must drop DOCX-to-text garbage so
// already-stored content (e.g. Grade 7 Expressive Arts Q17) renders clean
// without a data migration. Junk chars are built with String.fromCharCode so
// this test file stays pure ASCII.
console.log('\ngarbage-char stripping (HTML render path)')

const FFFD = String.fromCharCode(0xfffd)   // replacement char
const ZWSP = String.fromCharCode(0x200b)   // zero-width space
const SHY = String.fromCharCode(0x00ad)    // soft hyphen
const BEL = String.fromCharCode(0x0007)    // C0 control
const NEL = String.fromCharCode(0x0085)    // C1 control
const BOM = String.fromCharCode(0xfeff)    // BOM

test('sanitizeHTML strips replacement char + zero-width + soft hyphen', () => {
  const out = sanitizeHTML(`<p>Name the${FFFD} in${ZWSP}stru${SHY}ment</p>`)
  assertNotIncludes(out, FFFD, 'replacement char gone')
  assertNotIncludes(out, ZWSP, 'zero-width space gone')
  assertNotIncludes(out, SHY, 'soft hyphen gone')
  assertIncludes(out, 'Name the instrument', 'visible text reads cleanly')
})

test('sanitizeHTML strips C0/C1 control chars + BOM', () => {
  const out = sanitizeHTML(`${BOM}<p>Test${BEL}${NEL}After</p>`)
  assertNotIncludes(out, BEL, 'BEL gone')
  assertNotIncludes(out, NEL, 'NEL gone')
  assertNotIncludes(out, BOM, 'BOM gone')
  assertIncludes(out, 'TestAfter', 'text preserved')
})

test('sanitizeQuizRichHTML strips garbage chars too', () => {
  const out = sanitizeQuizRichHTML(`<p>A${FFFD}B${ZWSP}C</p>`)
  assertNotIncludes(out, FFFD, 'replacement char gone')
  assertNotIncludes(out, ZWSP, 'zero-width space gone')
  assertIncludes(out, 'ABC', 'text preserved')
})

test('HTML sanitizers preserve legitimate non-ASCII', () => {
  const phrase = '<p>café — Nsonga ♪</p>'
  for (const out of [sanitizeHTML(phrase), sanitizeQuizRichHTML(phrase)]) {
    assertIncludes(out, 'café', 'accented char preserved')
    assertIncludes(out, '—', 'em-dash preserved')
    assertIncludes(out, '♪', 'musical note preserved')
  }
})

// ── Report ───────────────────────────────────────────────────────────
console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  console.log('\nfailures:')
  failures.forEach(f => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
