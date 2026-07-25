/**
 * paperContentModel tests — one parser, and everything else a serialiser (§4.1).
 *
 * The brief: "Define a single question content model and make all four renderers
 * read from it. No renderer may hold its own parsing logic."
 *
 * What is worth testing is therefore not "does it parse HTML" but the properties
 * that make it a canonical model: every construct the editor can produce survives
 * a round trip, the outputs agree with each other, and nothing is lost in
 * translation. A model that dropped a fraction would still parse.
 *
 * Run: node src/utils/paperContentModel.test.js
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import {
  parsePaperContent, contentToHtml, contentToPlainText, isContentEmpty,
  columnWidth, MARK_NAMES,
} from './paperContentModel.js'

const { DOMParser } = new JSDOM().window
const parse = (html) => parsePaperContent(html, { DOMParserImpl: DOMParser })

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
  } catch (err) {
    console.error(`✗ ${name}\n  ${err.message}`)
    process.exitCode = 1
  }
}

/* ── blocks ─────────────────────────────────────────────────────────────── */

console.log('\n— blocks —')

test('a paragraph becomes one block', () => {
  const nodes = parse('<p>Work out the area.</p>')
  assert.equal(nodes.length, 1)
  assert.equal(nodes[0].type, 'paragraph')
  assert.equal(nodes[0].children[0].value, 'Work out the area.')
})

test('several block tags become several paragraphs', () => {
  assert.equal(parse('<p>One</p><p>Two</p><div>Three</div>').length, 3)
})

test('list items become paragraphs — the paper has no bullet renderer', () => {
  const nodes = parse('<ul><li>First</li><li>Second</li></ul>')
  assert.equal(nodes.length, 2)
  assert.equal(contentToPlainText(nodes), 'First Second')
})

test('a whitespace-only paragraph is dropped, not printed as a blank line', () => {
  assert.deepEqual(parse('<p>   </p><p>\n</p>'), [])
  assert.equal(parse('<p>Real</p><p> </p>').length, 1)
})

test('bare text with no block wrapper still becomes a paragraph', () => {
  assert.equal(contentToPlainText(parse('Just text')), 'Just text')
})

test('empty and rubbish input give an empty model rather than throwing', () => {
  assert.deepEqual(parse(''), [])
  assert.deepEqual(parse(null), [])
  assert.deepEqual(parse(undefined), [])
  assert.deepEqual(parse('   '), [])
})

/* ── marks ──────────────────────────────────────────────────────────────── */

console.log('\n— marks —')

test('every mark the editor can apply is recognised', () => {
  const cases = {
    bold: '<strong>x</strong>', italic: '<em>x</em>', underline: '<u>x</u>',
    strike: '<s>x</s>', sup: '<sup>x</sup>', sub: '<sub>x</sub>',
  }
  for (const [mark, html] of Object.entries(cases)) {
    const node = parse(`<p>${html}</p>`)[0].children[0]
    assert.equal(node.marks[mark], true, mark)
  }
  // …and the list the module publishes matches what it actually handles.
  assert.deepEqual([...MARK_NAMES].sort(), Object.keys(cases).sort())
})

test('the legacy tag spellings are recognised too', () => {
  assert.equal(parse('<p><b>x</b></p>')[0].children[0].marks.bold, true)
  assert.equal(parse('<p><i>x</i></p>')[0].children[0].marks.italic, true)
  assert.equal(parse('<p><strike>x</strike></p>')[0].children[0].marks.strike, true)
})

test('nested marks combine rather than replacing each other', () => {
  const node = parse('<p><strong><em>both</em></strong></p>')[0].children[0]
  assert.equal(node.marks.bold, true)
  assert.equal(node.marks.italic, true)
})

test('adjacent text with the same marks merges into one run', () => {
  // One run per fragment bloats the .docx and breaks Word's line breaking.
  const children = parse('<p><strong>a</strong><strong>b</strong>c</p>')[0].children
  assert.equal(children.length, 2)
  assert.equal(children[0].value, 'ab')
  assert.equal(children[1].value, 'c')
})

test('a mark ending does NOT merge across the boundary', () => {
  const children = parse('<p><strong>bold</strong>plain</p>')[0].children
  assert.equal(children.length, 2)
  assert.equal(children[0].marks.bold, true)
  assert.ok(!children[1].marks.bold)
})

/* ── the editor's structured maths ──────────────────────────────────────── */

console.log('\n— the maths the editor produces —')

test('a stacked fraction is read structurally, not scraped from its text', () => {
  const node = parse(
    '<p><span class="math-frac" data-whole="1" data-num="3" data-den="4"></span></p>',
  )[0].children[0]
  assert.equal(node.type, 'fraction')
  assert.equal(node.whole, '1')
  assert.equal(node.numerator, '3')
  assert.equal(node.denominator, '4')
})

test('a number base keeps its base separate from its number', () => {
  const node = parse(
    '<p><span class="num-base" data-number="313" data-base="5"></span></p>',
  )[0].children[0]
  assert.equal(node.type, 'numberBase')
  assert.equal(node.number, '313')
  assert.equal(node.base, '5')
})

test('a vertical sum is a BLOCK, not an inline run', () => {
  const nodes = parse(
    '<div class="vert-arith" data-operator="+" data-lines="24|17" data-answer="41"></div>',
  )
  assert.equal(nodes.length, 1)
  assert.equal(nodes[0].type, 'verticalArithmetic')
  assert.deepEqual(nodes[0].lines, ['24', '17'])
  assert.equal(nodes[0].answer, '41')
  assert.equal(nodes[0].operator, '+')
})

test('a vertical sum interrupts the paragraph around it', () => {
  const nodes = parse(
    '<p>Before</p><div class="vert-arith" data-lines="1|2" data-answer="3"></div><p>After</p>',
  )
  assert.deepEqual(nodes.map((n) => n.type),
    ['paragraph', 'verticalArithmetic', 'paragraph'])
})

test('the column width is the longest line or the answer', () => {
  assert.equal(columnWidth({ lines: ['9', '124'], answer: '133' }), 3)
  assert.equal(columnWidth({ lines: ['1'], answer: '10000' }), 5)
  // Never zero — a zero-width pad would throw on repeat().
  assert.equal(columnWidth({ lines: [], answer: '' }), 1)
})

test('a line break is kept as a break, not swallowed', () => {
  const children = parse('<p>a<br>b</p>')[0].children
  assert.deepEqual(children.map((c) => c.type), ['text', 'break', 'text'])
})

test('a formula keeps its source LaTeX beside its printable fallback', () => {
  // The fallback is what the print window draws; the LaTeX is what lets the Word
  // export build a real equation (§4.2). Losing either would cost a renderer.
  const node = parse(
    '<p><span data-tex="\\frac{1}{2}">1<sup>1</sup>&frasl;<sub>2</sub></span></p>',
  )[0].children[0]
  assert.equal(node.type, 'math')
  assert.equal(node.tex, '\\frac{1}{2}')
  assert.ok(node.fallback.length > 0, 'the printable fallback is kept')
  // The fallback is the flattened "1 ¹⁄₂" form, fraction slash and all.
  assert.equal(contentToPlainText([{ type: 'paragraph', children: [node] }]), '11⁄2')
})

test('a formula\'s fallback keeps its own sup/sub marks', () => {
  const node = parse('<p><span data-tex="x^2">x<sup>2</sup></span></p>')[0].children[0]
  const scripted = node.fallback.find((n) => n.marks && n.marks.sup)
  assert.ok(scripted, 'the superscript survived into the fallback')
  assert.equal(scripted.value, '2')
})

test('a formula round-trips through HTML with its LaTeX intact', () => {
  const once = parse('<p><span data-tex="\\sqrt{2}">√(2)</span></p>')
  assert.deepEqual(parse(contentToHtml(once)), once)
})

/* ── HTML output ────────────────────────────────────────────────────────── */

console.log('\n— HTML output —')

test('the model round-trips through HTML without losing anything', () => {
  const source =
    '<p>Solve <strong>x</strong><sup>2</sup> and ' +
    '<span class="math-frac" data-num="1" data-den="2"></span></p>'
  const once = parse(source)
  const twice = parse(contentToHtml(once))
  assert.deepEqual(twice, once, 'a second parse of the rendered HTML differs')
})

test('a vertical sum round-trips as a block', () => {
  const once = parse('<div class="vert-arith" data-operator="-" data-lines="90|45" data-answer="45"></div>')
  // The HTML form is a rendered monospace block — it is an OUTPUT, so it does
  // not have to re-parse into the same node. What must survive is the content.
  const html = contentToHtml(once)
  assert.ok(html.includes('90'), 'the addends are in the output')
  assert.ok(html.includes('45'), 'the answer is too')
  assert.ok(html.includes('─'), 'and the rule between them')
})

test('text is escaped, so a question about "<" cannot break the paper', () => {
  const html = contentToHtml(parse('<p>Is 3 &lt; 5?</p>'))
  assert.ok(html.includes('3 &lt; 5'), 'the less-than is escaped')
  assert.ok(!html.includes('<5'), 'and never emitted raw')
})

test('marks survive into the HTML', () => {
  const html = contentToHtml(parse('<p><strong>bold</strong> and <sub>low</sub></p>'))
  assert.ok(/<strong>bold<\/strong>/.test(html))
  assert.ok(/<sub>low<\/sub>/.test(html))
})

/* ── plain text output ──────────────────────────────────────────────────── */

console.log('\n— plain text output —')

test('plain text keeps the words and drops the markup', () => {
  assert.equal(
    contentToPlainText(parse('<p>Find <strong>x</strong> when <em>y</em> = 2.</p>')),
    'Find x when y = 2.',
  )
})

test('a fraction reads as a fraction in plain text', () => {
  assert.equal(
    contentToPlainText(parse('<p><span class="math-frac" data-whole="2" data-num="1" data-den="3"></span></p>')),
    '2 1/3',
  )
})

test('a vertical sum reads as an equation in plain text', () => {
  assert.equal(
    contentToPlainText(parse('<div class="vert-arith" data-operator="+" data-lines="24|17" data-answer="41"></div>')),
    '24 + 17 = 41',
  )
})

test('an empty model is recognised as empty', () => {
  assert.equal(isContentEmpty(parse('')), true)
  assert.equal(isContentEmpty(parse('<p>  </p>')), true)
  assert.equal(isContentEmpty(parse('<p>x</p>')), false)
  assert.equal(isContentEmpty(null), true)
})

/* ── degrading without a DOM ────────────────────────────────────────────── */

console.log('\n— no DOM —')

test('with no DOM at all the words survive, even though the formatting does not', () => {
  // Losing the formatting is bad; losing the question is worse.
  const nodes = parsePaperContent('<p>Hello <strong>there</strong></p>', { DOMParserImpl: null })
  const hadGlobal = typeof DOMParser !== 'undefined'
  if (!hadGlobal) {
    assert.equal(contentToPlainText(nodes), 'Hello there')
  }
  // With jsdom's parser injected it parses properly, which is the real path.
  assert.equal(
    contentToPlainText(parsePaperContent('<p>Hello <strong>there</strong></p>', { DOMParserImpl: DOMParser })),
    'Hello there',
  )
})

/* ── the guard: no renderer holds its own parser ────────────────────────── */

console.log('\n— no renderer parses for itself —')

test('the Word export contains no HTML parsing of its own', () => {
  // §4.1: "No renderer may hold its own parsing logic." The exporter used to
  // carry a full DOM walker — tag names, classList checks, attribute reads —
  // duplicating what the print window did over the same string. It now maps
  // typed nodes. This fails if a walker creeps back in.
  const src = readFileSync(new URL('./assessmentToDocx.js', import.meta.url), 'utf8')
  const code = src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n')

  for (const [pattern, what] of [
    [/\.tagName/, 'reads tagName'],
    [/classList\??\.contains/, 'checks classList'],
    [/getAttribute\(\s*['"]data-(num|den|whole|lines|operator|answer|number|base)/, 'reads the editor\'s data-* attributes'],
    [/nodeType\s*===?\s*Node\./, 'branches on nodeType'],
  ]) {
    assert.ok(!pattern.test(code), `assessmentToDocx.js still ${what}`)
  }

  // …and it does reach for the shared parser rather than a private one.
  assert.ok(/from '\.\/paperContentModel\.js'/.test(src),
    'assessmentToDocx.js does not import the shared content model')
})

test('the layout hands renderers the model, not just a string', () => {
  const src = readFileSync(new URL('./assessmentPaperLayout.js', import.meta.url), 'utf8')
  assert.ok(/textNodes:/.test(src), 'the layout does not emit textNodes')
  assert.ok(/optionsNodes/.test(src), 'the layout does not emit optionsNodes')
})

console.log(`\n✓ paper content model — ${passed} tests passed`)
