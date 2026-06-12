#!/usr/bin/env node
/**
 * Tests for the pure helpers in the notes document-import orchestrator.
 * Run: npm run test:note-import-client  (also via npm run test:all)
 */
const {
  buildDocumentTextWithMarkers, resolveImageBlocks, IMAGE_MARKER_RE,
} = await import('./noteImportCore.js')

let pass = 0, fail = 0
const failures = []
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`) }
  catch (err) { fail++; failures.push({ name, err }); console.log(`  XX  ${name} — ${err.message}`) }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed') }

console.log('\nnote import (client) — pure helpers')

test('buildDocumentTextWithMarkers interleaves [[IMAGE:id]] markers in block order', () => {
  const blocks = [
    { text: 'Intro paragraph.', assets: [{ id: 'a1' }] },
    { text: 'Second paragraph.', assets: [] },
  ]
  const text = buildDocumentTextWithMarkers(blocks)
  assert(text.includes('Intro paragraph.'), 'keeps text')
  assert(text.includes('[[IMAGE:a1]]'), 'adds marker for asset a1')
  assert(text.indexOf('Intro') < text.indexOf('[[IMAGE:a1]]'), 'marker comes after its block text')
  assert(text.indexOf('[[IMAGE:a1]]') < text.indexOf('Second paragraph'), 'marker stays in document order')
})

test('resolveImageBlocks replaces assetRef with an uploaded url and drops unresolved', () => {
  const blocks = [
    { type: 'paragraph', text: 'hi' },
    { type: 'image', assetRef: 'a1', caption: 'Cell diagram' },
    { type: 'image', assetRef: 'missing', caption: 'gone' },
  ]
  const urls = new Map([['a1', 'https://store/a1.jpg']])
  const out = resolveImageBlocks(blocks, urls)
  assert(out.length === 2, `expected 2 blocks (unresolved image dropped), got ${out.length}`)
  const img = out.find(b => b.type === 'image')
  assert(img && img.url === 'https://store/a1.jpg' && !('assetRef' in img), 'image block must carry url and drop assetRef')
  assert(img.caption === 'Cell diagram', 'caption preserved')
})

test('IMAGE_MARKER_RE matches the marker and captures the id', () => {
  const m = '[[IMAGE:xY_9]]'.match(IMAGE_MARKER_RE)
  assert(m && m[1] === 'xY_9', 'should capture the asset id')
})

console.log(`\n─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) { for (const f of failures) console.error(`\n✖ ${f.name}\n  ${f.err.stack || f.err.message}`); process.exit(1) }
