#!/usr/bin/env node
/**
 * Tests for the notes document-import structuring prompt + parser.
 * Run: npm run test:note-import  (also via npm run test:all)
 */
const {
  buildNoteStructureMessages, parseStructuredNote,
} = require('./noteStructurePrompt')

let pass = 0, fail = 0
const failures = []
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`) }
  catch (err) { fail++; failures.push({ name, err }); console.log(`  XX  ${name} — ${err.message}`) }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed') }

console.log('\nnote import — prompt + parser')

test('buildNoteStructureMessages returns a system+user message pair containing the doc text', () => {
  const msgs = buildNoteStructureMessages({ fileName: 'x.docx', documentText: 'Photosynthesis is...' })
  assert(Array.isArray(msgs) && msgs.length === 2, 'expected 2 messages')
  assert(msgs[0].role === 'system' && msgs[1].role === 'user', 'roles wrong')
  assert(msgs[1].content.includes('Photosynthesis is'), 'user message must include the document text')
})

test('parseStructuredNote parses a fenced JSON object into { blocks, warnings }', () => {
  const raw = '```json\n{"blocks":[{"type":"heading","level":2,"text":"Cells"},{"type":"paragraph","text":"A cell is..."}],"warnings":["short"]}\n```'
  const out = parseStructuredNote(raw)
  assert(Array.isArray(out.blocks) && out.blocks.length === 2, 'expected 2 blocks')
  assert(out.blocks[0].type === 'heading' && out.blocks[1].type === 'paragraph', 'block types wrong')
  assert(Array.isArray(out.warnings) && out.warnings[0] === 'short', 'warnings not parsed')
})

test('parseStructuredNote accepts a bare blocks array too', () => {
  const out = parseStructuredNote('[{"type":"paragraph","text":"hi"}]')
  assert(out.blocks.length === 1 && out.warnings.length === 0, 'bare array should yield blocks + empty warnings')
})

test('parseStructuredNote drops non-object blocks and keeps a string type', () => {
  const out = parseStructuredNote('{"blocks":[null,3,{"type":"paragraph","text":"keep"},{"noType":1}]}')
  assert(out.blocks.length === 1 && out.blocks[0].text === 'keep', 'should keep only well-formed typed blocks')
})

test('parseStructuredNote throws on unparseable input', () => {
  let threw = false
  try { parseStructuredNote('not json at all {{{') } catch { threw = true }
  assert(threw, 'expected a throw on garbage input')
})

console.log(`\n─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) { for (const f of failures) console.error(`\n✖ ${f.name}\n  ${f.err.stack || f.err.message}`); process.exit(1) }
