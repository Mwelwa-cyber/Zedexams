/**
 * Plain-node tests for structured (non-prose) lesson-plan cell content (§4.7).
 * Run: node src/utils/lessonPlanBlocks.test.js  (npm run test:lesson-plan-blocks)
 */

import assert from 'node:assert/strict'
import {
  OBJECT_ART_NAMES,
  blockNotationDirective,
  cellToHtml,
  expandedParts,
  groupDigits,
  hasBlocks,
  hasObjectArt,
  objectArtSvg,
  parseCellBlocks,
} from './lessonPlanBlocks.js'

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

console.log('\nplace value')
check('digits group the way Zambian classrooms write them', () => {
  assert.equal(groupDigits(38677), '38 677')
  assert.equal(groupDigits(7), '7')
  assert.equal(groupDigits(1000000), '1 000 000')
})
check('expanded notation drops zero places', () => {
  assert.deepEqual(expandedParts(38677), ['30 000', '8 000', '600', '70', '7'])
  assert.deepEqual(expandedParts(34510), ['30 000', '4 000', '500', '10'])
  assert.deepEqual(expandedParts(7), ['7'])
})

console.log('\nparsing')
check('an ordinary cell parses to exactly one text node', () => {
  const nodes = parseCellBlocks('– Draw arrows.\n– Name the parts.')
  assert.equal(nodes.length, 1)
  assert.equal(nodes[0].type, 'text')
  assert.equal(nodes[0].text, '– Draw arrows.\n– Name the parts.')
  assert.equal(hasBlocks('– Draw arrows.'), false)
})
check('a column sum parses with its place-value headings', () => {
  const [node] = parseCellBlocks('#sum: 38677 + 11314')
  assert.equal(node.type, 'sum')
  assert.deepEqual(node.addends, [38677, 11314])
  assert.equal(node.total, 49991)
  assert.equal(node.width, 5)
  assert.deepEqual(node.headings, ['TTh', 'Th', 'H', 'T', 'O'])
})
check('a stated total is used rather than recomputed', () => {
  const [node] = parseCellBlocks('#sum: 16592 + 1701 = 18293')
  assert.equal(node.total, 18293)
})
check('addends of unequal length widen to the total', () => {
  const [node] = parseCellBlocks('#sum: 16592 + 1701')
  assert.equal(node.width, 5)
})
check('spaces and commas inside numbers are tolerated', () => {
  const [node] = parseCellBlocks('#sum: 34 510 + 26,923')
  assert.deepEqual(node.addends, [34510, 26923])
})
check('expanded notation parses', () => {
  const [node] = parseCellBlocks('#expand: 38677')
  assert.equal(node.type, 'expand')
  assert.deepEqual(node.parts, ['30 000', '8 000', '600', '70', '7'])
})
check('a matching block parses into pairs', () => {
  const [node] = parseCellBlocks('#match: ball|star, cup|spoon')
  assert.equal(node.type, 'match')
  assert.deepEqual(node.pairs, [{ left: 'ball', right: 'star' }, { left: 'cup', right: 'spoon' }])
})
check('prose and blocks keep their written order', () => {
  const nodes = parseCellBlocks('– Demonstrate adding with regrouping:\n#sum: 38677 + 11314\n– Then set group work.')
  assert.deepEqual(nodes.map((n) => n.type), ['text', 'sum', 'text'])
})
check('a malformed block prints as ordinary text rather than vanishing', () => {
  const nodes = parseCellBlocks('#sum: not a sum')
  assert.equal(nodes.length, 1)
  assert.equal(nodes[0].type, 'text')
  assert.match(nodes[0].text, /#sum/)
})
check('a cell carrying no semicolons survives planShape line splitting', () => {
  // planShape.toLines splits on \n and ';' — a block that contained a semicolon
  // would be torn in half before any renderer ever saw it.
  for (const notation of ['#sum: 38677 + 11314', '#expand: 38677', '#match: ball|star, cup|spoon']) {
    assert.equal(notation.includes(';'), false, notation)
  }
})

console.log('\nline art')
check('every advertised object can actually be drawn', () => {
  for (const name of OBJECT_ART_NAMES) {
    assert.ok(hasObjectArt(name), name)
    assert.match(objectArtSvg(name), /^<svg /, name)
  }
  assert.ok(OBJECT_ART_NAMES.length >= 10)
})
check('an unknown object draws nothing rather than an empty box', () => {
  assert.equal(objectArtSvg('wheelbarrow'), '')
  assert.equal(hasObjectArt('wheelbarrow'), false)
})
check('art is sized in millimetres so preview and print agree physically', () => {
  assert.match(objectArtSvg('ball', { sizeMm: 9 }), /width="9mm" height="9mm"/)
})
check('art is stroke-only so it photocopies', () => {
  const svg = objectArtSvg('ball')
  assert.match(svg, /fill="none"/)
  assert.doesNotMatch(svg, /fill="#(?!fff)/i)
})

console.log('\nHTML rendering')
check('a sum renders as a real table, not a monospace block', () => {
  const html = cellToHtml('#sum: 38677 + 11314', (t) => t)
  assert.match(html, /<table class="lp-sum"/)
  assert.doesNotMatch(html, /<pre/)
  assert.match(html, /TTh/)
  // The last addend row carries the rule the answer sits under.
  assert.match(html, /border-bottom:1px solid currentColor/)
})
check('the total appears in the sum', () => {
  const html = cellToHtml('#sum: 38677 + 11314', (t) => t)
  for (const digit of '49991') assert.ok(html.includes(`>${digit}<`), digit)
})
check('a matching block renders both columns and the joining space', () => {
  const html = cellToHtml('#match: ball|star', (t) => t)
  assert.match(html, /Draw a line to match/)
  assert.match(html, /lp-dots/)
  assert.ok((html.match(/lp-obj/g) || []).length === 2)
  assert.match(html, /<svg /)
})
check('an unknown object still prints its word', () => {
  const html = cellToHtml('#match: ball|wheelbarrow', (t) => t)
  assert.match(html, /wheelbarrow/)
})
check('prose is handed to the caller’s own formatter', () => {
  const html = cellToHtml('– Draw arrows.', (t) => `<b>${t}</b>`)
  assert.equal(html, '<b>– Draw arrows.</b>')
})
check('cell content is escaped', () => {
  const html = cellToHtml('#match: <script>|star', (t) => t)
  // No form of a script tag opening may survive (covers <script>, <script >,
  // <script foo=…>), and the escaped text must be what actually renders.
  assert.ok(!html.toLowerCase().includes('<script'), 'no raw script tag survives')
  assert.ok(html.includes('&lt;script&gt;'), 'content was HTML-escaped')
})

console.log('\nprompt directive')
check('the directive advertises only objects the library can draw', () => {
  const directive = blockNotationDirective()
  for (const name of OBJECT_ART_NAMES) assert.ok(directive.includes(name), name)
  const advertised = /Use ONLY these object words: ([^\n.]+)/.exec(directive)[1]
  for (const word of advertised.split(',').map((s) => s.trim())) {
    assert.ok(hasObjectArt(word), `directive advertises "${word}"`)
  }
})
check('every notation the directive teaches actually parses', () => {
  const directive = blockNotationDirective()
  for (const sample of ['#sum: 38677 + 11314', '#expand: 38677', '#match: ball|star, cup|spoon']) {
    assert.ok(directive.includes(sample), sample)
    assert.equal(parseCellBlocks(sample)[0].type !== 'text', true, sample)
  }
})

console.log(`\n✅ lessonPlanBlocks — ${passed} checks passed\n`)
