#!/usr/bin/env node
/** Tests for the note-highlight prompt + parser. Run: npm run test:note-smart */
const { buildHighlightMessages, parseHighlights, buildSummaryMessages, parseSummaries } = require('./noteSmartPrompt')
let pass = 0, fail = 0; const failures = []
function test(n, fn){ try{ fn(); pass++; console.log(`  ok  ${n}`) } catch(e){ fail++; failures.push({n,e}); console.log(`  XX  ${n} — ${e.message}`) } }
function assert(c,m){ if(!c) throw new Error(m||'assertion failed') }

console.log('\nnote smart — highlight prompt + parser')

test('buildHighlightMessages includes only highlightable blocks with ids + text', () => {
  const msgs = buildHighlightMessages({ blocks: [
    { id:'b1', type:'paragraph', text:'A cell is the basic unit of life.' },
    { id:'b2', type:'image', url:'x' },              // not highlightable
    { type:'paragraph', text:'no id' },               // no id → skipped
  ]})
  assert(msgs.length === 2 && msgs[0].role === 'system' && msgs[1].role === 'user', 'message shape')
  assert(msgs[1].content.includes('b1') && msgs[1].content.includes('basic unit of life'), 'must include b1 text')
  assert(!msgs[1].content.includes('"id":"b2"'), 'image block must be excluded')
  assert(!msgs[1].content.includes('no id'), 'block without id must be excluded')
})

test('parseHighlights parses a {highlights} map, drops short/non-string, caps per block', () => {
  const raw = '```json\n{"highlights":{"b1":["A cell is the basic unit of life.","x","also important enough"],"b9":[123]},"warnings":["w"]}\n```'
  const out = parseHighlights(raw)
  assert(out.highlights.b1.length === 2, `b1 should keep 2 (drop the too-short "x"), got ${out.highlights.b1?.length}`)
  assert(!('b9' in out.highlights), 'b9 had no valid strings → dropped')
  assert(out.warnings[0] === 'w', 'warnings parsed')
})

test('parseHighlights tolerates a bare object and throws on garbage', () => {
  const out = parseHighlights('{"highlights":{"b1":["long enough excerpt here"]}}')
  assert(out.highlights.b1.length === 1, 'bare object ok')
  let threw = false; try { parseHighlights('not json {{{') } catch { threw = true }
  assert(threw, 'garbage should throw')
})

test('buildSummaryMessages includes headings + content and asks for per-section summaries', () => {
  const msgs = buildSummaryMessages({ blocks: [
    { id:'h1', type:'heading', level:2, text:'Cells' },
    { id:'p1', type:'paragraph', text:'A cell is the basic unit of life.' },
    { id:'h2', type:'heading', level:3, text:'Sub' },
  ]})
  assert(msgs.length === 2 && msgs[0].role === 'system' && msgs[1].role === 'user', 'shape')
  assert(msgs[1].content.includes('h1') && msgs[1].content.includes('basic unit of life'), 'includes heading id + content')
})

test('parseSummaries keeps {headingId: summary} strings, drops short/non-string', () => {
  const out = parseSummaries('```json\n{"summaries":{"h1":"This section explains what a cell is and why it matters.","h9":"x","h8":5},"warnings":["w"]}\n```')
  assert(out.summaries.h1 && !('h9' in out.summaries) && !('h8' in out.summaries), 'filtering wrong')
  assert(out.warnings[0] === 'w', 'warnings')
})

test('parseSummaries throws on garbage', () => {
  let threw = false; try { parseSummaries('nope {{{') } catch { threw = true }
  assert(threw, 'should throw')
})

console.log(`\n─── ${pass+fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail>0){ for(const f of failures) console.error(`\n✖ ${f.n}\n  ${f.e.stack||f.e.message}`); process.exit(1) }
