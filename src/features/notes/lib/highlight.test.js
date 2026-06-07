#!/usr/bin/env node
/** Tests for the highlight matcher. Run: npm run test:notes-highlight */
const { splitSentences, isHighlighted, mdInlineHighlighted } = await import('./highlight.js')
let pass=0, fail=0; const failures=[]
function test(n,fn){ try{ fn(); pass++; console.log(`  ok  ${n}`) } catch(e){ fail++; failures.push({n,e}); console.log(`  XX  ${n} — ${e.message}`) } }
function assert(c,m){ if(!c) throw new Error(m||'assertion failed') }

console.log('\nnotes highlight — matcher')

test('splitSentences splits on sentence boundaries', () => {
  const s = splitSentences('A cell is the unit of life. It is small. Why?')
  assert(s.length === 3, `expected 3 sentences, got ${s.length}`)
})

test('isHighlighted matches a contained excerpt (normalized), ignores short', () => {
  assert(isHighlighted('A cell is the basic unit of life.', ['the basic unit of life']) === true, 'should match substring')
  assert(isHighlighted('A cell is small.', ['the basic unit of life']) === false, 'no match')
  assert(isHighlighted('A cell is small.', ['cell']) === false, 'excerpt under min length should not match')
})

test('mdInlineHighlighted wraps matched sentence and preserves bold + escaping', () => {
  const html = mdInlineHighlighted('A **cell** is the basic unit of life. It is tiny.', ['the basic unit of life'])
  assert(html.includes('<mark class="note-hl">'), 'should wrap the matched sentence')
  assert(html.includes('<strong>cell</strong>'), 'should keep bold inside the mark')
  assert(!html.includes('<mark') || html.indexOf('It is tiny') > html.indexOf('</mark>'), 'second sentence not wrapped')
})

test('mdInlineHighlighted with no excerpts equals plain mdInline (no marks)', () => {
  const html = mdInlineHighlighted('Plain text with *italic*.', [])
  assert(!html.includes('<mark'), 'no marks when no excerpts')
  assert(html.includes('<em>italic</em>'), 'italic preserved')
})

console.log(`\n─── ${pass+fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail>0){ for(const f of failures) console.error(`\n✖ ${f.n}\n  ${f.e.stack||f.e.message}`); process.exit(1) }
