#!/usr/bin/env node
/**
 * Round-trip test for the import-markup converter.
 *
 * The colocated importRichText.test.js pins the HTML *shape* the converter
 * emits. This test proves that HTML actually round-trips through the two
 * pipelines that matter:
 *
 *   1. sanitiser  — sanitizeHTML / sanitizeQuizRichHTML must KEEP the
 *                   data-* attributes the hydrators read (a stripped
 *                   attribute = a blank fraction / column sum on the learner
 *                   view).
 *   2. Tiptap     — generateJSON(html, renderExtensions) must parse the HTML
 *                   back into real mathFraction / verticalArithmetic / table /
 *                   mathInline nodes (this is the HTML→JSON path the editor
 *                   runs when an imported question is opened).
 *
 * Run:   npm run test:import-rich-text-roundtrip
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

const { importMarkupToRichHtml, importMarkupToOptionHtml } = await import(
  '../src/components/quiz/importRichText.js'
)
const { sanitizeHTML, sanitizeQuizRichHTML } = await import(
  '../src/editor/utils/sanitize.js'
)
const { generateJSON } = await import('@tiptap/core')
const { renderExtensions } = await import(
  '../src/editor/extensions/buildExtensions.js'
)

let passed = 0
const failures = []
function assert(label, cond) {
  if (cond) passed += 1
  else failures.push(label)
}

// Collect every node "type" present anywhere in a Tiptap JSON doc.
function collectTypes(node, set = new Set()) {
  if (!node || typeof node !== 'object') return set
  if (node.type) set.add(node.type)
  if (Array.isArray(node.content)) node.content.forEach((c) => collectTypes(c, set))
  return set
}

const sample = [
  'What is \\frac{3}{4} of 200?',
  '',
  'Work out the difference:',
  '[[vmath op=- lines=954751,362948 answer=591803]]',
  '',
  'Study the table:',
  '| Animal | Legs |',
  '| --- | --- |',
  '| Dog | 4 |',
  '| Spider | 8 |',
  '',
  'Find $\\sqrt{49}$.',
].join('\n')

const html = importMarkupToRichHtml(sample)

/* ── 1. Sanitiser keeps the data-* attributes ──────────────────────────── */

for (const sanitize of [sanitizeHTML, sanitizeQuizRichHTML]) {
  const clean = sanitize(html)
  const name = sanitize === sanitizeHTML ? 'sanitizeHTML' : 'sanitizeQuizRichHTML'
  assert(`${name} keeps fraction marker`, clean.includes('data-math-fraction'))
  assert(`${name} keeps fraction num`, clean.includes('data-num="3"'))
  assert(`${name} keeps fraction den`, clean.includes('data-den="4"'))
  assert(`${name} keeps vert-arith marker`, clean.includes('data-vertical-arithmetic'))
  assert(`${name} keeps vert operator`, clean.includes('data-operator="−"'))
  assert(`${name} keeps vert lines`, clean.includes('data-lines="954751|362948"'))
  assert(`${name} keeps vert answer`, clean.includes('data-answer="591803"'))
  assert(`${name} keeps inline math latex`, clean.includes('data-latex'))
  assert(`${name} keeps the table element`, clean.includes('<table'))
  assert(`${name} keeps a table cell`, clean.toLowerCase().includes('<td'))
}

/* ── 2. Tiptap parses the HTML back into real nodes ────────────────────── */

const json = generateJSON(html, renderExtensions)
const types = collectTypes(json)

assert('parses a mathFraction node', types.has('mathFraction'))
assert('parses a verticalArithmetic node', types.has('verticalArithmetic'))
assert('parses a table node', types.has('table'))
assert('parses a mathInline node', types.has('mathInline'))

// The fraction node must carry the numerator/denominator through the parse.
function findNode(node, typeName) {
  if (!node || typeof node !== 'object') return null
  if (node.type === typeName) return node
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      const found = findNode(child, typeName)
      if (found) return found
    }
  }
  return null
}

const frac = findNode(json, 'mathFraction')
assert('parsed fraction keeps num attr', frac?.attrs?.num === '3')
assert('parsed fraction keeps den attr', frac?.attrs?.den === '4')

const vert = findNode(json, 'verticalArithmetic')
assert('parsed vert keeps operator', vert?.attrs?.operator === '−')
assert(
  'parsed vert keeps lines',
  Array.isArray(vert?.attrs?.lines) && vert.attrs.lines.join('|') === '954751|362948',
)

const math = findNode(json, 'mathInline')
assert('parsed inline math keeps latex', math?.attrs?.latex === '\\sqrt{49}')

/* ── 3. Option round-trip ──────────────────────────────────────────────── */

const optionHtml = importMarkupToOptionHtml('\\frac{11}{100}')
const optionJson = generateJSON(optionHtml, renderExtensions)
assert('option parses a mathFraction node', collectTypes(optionJson).has('mathFraction'))

/* ── Summary ───────────────────────────────────────────────────────────── */

if (failures.length) {
  console.error(`\n❌ import-rich-text round-trip: ${failures.length} failed:`)
  failures.forEach((f) => console.error(`   • ${f}`))
  process.exit(1)
}
console.log(`✅ import-rich-text round-trip: ${passed} assertions passed`)
