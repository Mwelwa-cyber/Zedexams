#!/usr/bin/env node
/**
 * Tests for the open-studio assignment-change notice core (pure).
 * Run: npm run test:assignment-change-notice
 */
import {
  parseStoredSeed,
  seedsDiffer,
  seedLabel,
  compatibilityNotice,
} from '../src/shared/utils/teachingAssignmentChangeNoticeCore.js'

let pass = 0
let fail = 0
const failures = []
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`) }
  catch (err) { fail++; failures.push({ name, message: err.message }); console.log(`  FAIL ${name}\n       ${err.message}`) }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed') }
function eq(a, b, m) { assert(a === b, `${m || 'not equal'} — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`) }

console.log('\nparseStoredSeed')
test('parses a valid seed', () => {
  const s = parseStoredSeed(JSON.stringify({ grade: 'G5', subject: 'mathematics', curriculum: 'cbc' }))
  eq(s.grade, 'G5'); eq(s.subject, 'mathematics'); eq(s.curriculum, 'cbc')
})
test('defaults curriculum to cbc; previous preserved', () => {
  eq(parseStoredSeed(JSON.stringify({ grade: 'G5', curriculum: 'previous' })).curriculum, 'previous')
  eq(parseStoredSeed(JSON.stringify({ grade: 'G5' })).curriculum, 'cbc')
})
test('rejects empty / malformed', () => {
  eq(parseStoredSeed(''), null)
  eq(parseStoredSeed('not json'), null)
  eq(parseStoredSeed(JSON.stringify({ curriculum: 'cbc' })), null) // no grade/subject
  eq(parseStoredSeed(null), null)
})

console.log('\nseedsDiffer')
test('same assignment → no diff', () => {
  eq(seedsDiffer({ grade: 'G5', subject: 'mathematics', curriculum: 'cbc' }, { grade: 'G5', subject: 'mathematics', curriculum: 'cbc' }), false)
})
test('different grade / subject / curriculum → diff', () => {
  eq(seedsDiffer({ grade: 'G4', subject: 'mathematics' }, { grade: 'G5', subject: 'mathematics' }), true)
  eq(seedsDiffer({ grade: 'G5', subject: 'english' }, { grade: 'G5', subject: 'mathematics' }), true)
  eq(seedsDiffer({ grade: 'G5', subject: 'maths', curriculum: 'cbc' }, { grade: 'G5', subject: 'maths', curriculum: 'previous' }), true)
})
test('null-safe', () => {
  eq(seedsDiffer(null, { grade: 'G5' }), true)
  eq(seedsDiffer(null, null), false)
})

console.log('\nseedLabel')
test('builds a human label', () => {
  eq(seedLabel({ grade: 'G5', subject: 'mathematics' }), 'Grade 5 · Mathematics')
})
test('skips unresolvable parts; empty → empty string', () => {
  eq(seedLabel({ grade: 'G4' }), 'Grade 4')
  eq(seedLabel({}), '')
  eq(seedLabel(null), '')
})

console.log('\ncompatibilityNotice')
test('compatible seed → no warning', () => {
  eq(compatibilityNotice({ seed: { grade: 'G5', subject: 'mathematics' }, gradeMapped: true, subjectsLoaded: true, subjectMatched: true }), '')
})
test('unmapped grade → class warning naming the grade', () => {
  const msg = compatibilityNotice({ seed: { grade: 'G5', subject: 'mathematics' }, gradeMapped: false, subjectsLoaded: false, subjectMatched: false })
  assert(msg.includes('Grade 5'), 'names the grade')
  assert(msg.includes('pick the class manually'), 'tells the teacher what to do')
})
test('unmatched subject (after load) → subject warning', () => {
  const msg = compatibilityNotice({ seed: { grade: 'G5', subject: 'mathematics' }, gradeMapped: true, subjectsLoaded: true, subjectMatched: false })
  assert(msg.includes('Mathematics'), 'names the subject')
  assert(msg.includes('pick the subject manually'), 'tells the teacher what to do')
})
test('subjects still loading → no premature warning', () => {
  eq(compatibilityNotice({ seed: { grade: 'G5', subject: 'mathematics' }, gradeMapped: true, subjectsLoaded: false, subjectMatched: false }), '')
})
test('warns, never blocks: message is a sentence, not a flag to disable Switch', () => {
  const msg = compatibilityNotice({ seed: { grade: 'G5', subject: 'x' }, gradeMapped: false })
  assert(typeof msg === 'string' && msg.length > 0, 'string message')
})
test('null-safe on empty seed', () => {
  eq(compatibilityNotice({}), '')
  eq(compatibilityNotice(), '')
})

console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) { console.log('\nfailures:'); failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`)); process.exit(1) }
