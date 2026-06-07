#!/usr/bin/env node
/**
 * Tests for the study-note table-of-contents derivation.
 * Run: npm run test:notes-toc  (also via npm run test:all)
 */

const { buildToc, sectionAnchorId } = await import('../src/features/notes/lib/toc.js')

let pass = 0, fail = 0
const failures = []
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`) }
  catch (err) { fail++; failures.push({ name, err }); console.log(`  XX  ${name} — ${err.message}`) }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed') }

console.log('\nnotes TOC — buildToc + sectionAnchorId')

test('buildToc returns [] for non-array / empty / heading-less input', () => {
  assert(buildToc(null).length === 0, 'null → []')
  assert(buildToc(undefined).length === 0, 'undefined → []')
  assert(buildToc([]).length === 0, 'empty → []')
  assert(buildToc([{ type: 'paragraph', text: 'x' }]).length === 0, 'no headings → []')
})

test('buildToc extracts headings in order with key/id/text/level/index', () => {
  const blocks = [
    { id: 'a1', type: 'heading', level: 2, text: 'Cells' },
    { type: 'paragraph', text: 'body' },
    { id: 'b2', type: 'heading', level: 3, text: 'Sub' },
  ]
  const toc = buildToc(blocks)
  assert(toc.length === 2, `expected 2 entries, got ${toc.length}`)
  assert(toc[0].key === 'a1' && toc[0].level === 2 && toc[0].text === 'Cells' && toc[0].index === 0, 'entry 0 wrong')
  assert(toc[0].id === sectionAnchorId('a1'), 'entry 0 id must come from sectionAnchorId')
  assert(toc[1].key === 'b2' && toc[1].level === 3 && toc[1].index === 2, 'entry 1 wrong')
})

test('buildToc strips inline markdown from heading text', () => {
  const toc = buildToc([{ id: 'h', type: 'heading', level: 2, text: '**Photosynthesis**' }])
  assert(toc[0].text === 'Photosynthesis', `expected stripped text, got "${toc[0].text}"`)
})

test('buildToc skips empty / whitespace headings', () => {
  const toc = buildToc([
    { id: 'h1', type: 'heading', level: 2, text: '   ' },
    { id: 'h2', type: 'heading', level: 2, text: 'Real' },
  ])
  assert(toc.length === 1 && toc[0].text === 'Real', 'empty heading should be skipped')
})

test('buildToc produces unique keys when ids are missing or duplicated', () => {
  const toc = buildToc([
    { type: 'heading', level: 2, text: 'One' },        // no id → idx-0
    { type: 'heading', level: 2, text: 'Two' },        // no id → idx-1
    { id: 'dup', type: 'heading', level: 3, text: 'A' },
    { id: 'dup', type: 'heading', level: 3, text: 'B' },// duplicate id → de-duped
  ])
  const keys = toc.map(e => e.key)
  assert(new Set(keys).size === keys.length, `keys must be unique: ${keys.join(', ')}`)
  assert(keys[0] === 'idx-0' && keys[1] === 'idx-1', 'missing-id headings should key by index')
})

test('sectionAnchorId is deterministic and prefixed', () => {
  assert(sectionAnchorId('idx-0') === 'note-sec-idx-0', 'unexpected anchor id')
})

console.log(`\n─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  for (const f of failures) console.error(`\n✖ ${f.name}\n  ${f.err.stack || f.err.message}`)
  process.exit(1)
}
