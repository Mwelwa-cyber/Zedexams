#!/usr/bin/env node
/** Tests for noteMeta helpers. Run: npm run test:note-meta */
const { isStudyTipsNote } = await import('./noteMeta.js')
let pass = 0, fail = 0; const failures = []
function test(n, fn) { try { fn(); pass++; console.log(`  ok  ${n}`) } catch (e) { fail++; failures.push({ n, e }); console.log(`  XX  ${n} — ${e.message}`) } }
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed') }

console.log('\nnotes noteMeta — isStudyTipsNote')

test('matches by seed key suffix', () => {
  assert(isStudyTipsNote({ seedKey: 'g7sci_n_tips', title: 'How to Study & Exam Tips' }) === true, 'seed key *_tips should match')
  assert(isStudyTipsNote({ seedKey: 'G7SCI_N_TIPS' }) === true, 'seed key match is case-insensitive')
})

test('matches by title fallback when seed key is missing', () => {
  assert(isStudyTipsNote({ title: 'How to Study & Exam Tips' }) === true, 'title should match')
  assert(isStudyTipsNote({ title: 'how to study smarter' }) === true, 'title match is case-insensitive')
})

test('does not match ordinary topic notes', () => {
  assert(isStudyTipsNote({ seedKey: 'g7sci_n_1_1', title: '1.1 The Digestive System' }) === false, 'topic note should not match')
  assert(isStudyTipsNote(null) === false, 'null is safe')
  assert(isStudyTipsNote({}) === false, 'empty object is safe')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) { for (const f of failures) console.error(f.e); process.exit(1) }
