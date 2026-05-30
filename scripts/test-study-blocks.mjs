#!/usr/bin/env node
/**
 * Tests for the study-note block model + schema.
 * Run: npm run test:study-blocks  (also via npm run test:all)
 *
 * Guards two things in particular:
 *   1. Every block the editor can produce validates against the write schema.
 *   2. No block field is an array-of-arrays — Firestore rejects nested arrays,
 *      so keyterms/table rows must be maps, not tuples.
 */

const {
  blankStudyBlocks, newStudyBlock, STUDY_BLOCK_TYPES,
  buildStudyExcerpt, studyReadingTime, studySpeechText,
} = await import('../src/features/notes/lib/studyBlocks.js')
const { studyBlocksWriteSchema, coerceStudyBlocks } = await import('../src/features/notes/lib/studySchema.js')

let pass = 0, fail = 0
const failures = []
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`) }
  catch (err) { fail++; failures.push({ name, err }); console.log(`  XX  ${name} — ${err.message}`) }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed') }

// Recursively confirm no array directly contains another array (Firestore rule).
function hasNestedArray(value) {
  if (Array.isArray(value)) {
    if (value.some(Array.isArray)) return true
    return value.some(hasNestedArray)
  }
  if (value && typeof value === 'object') return Object.values(value).some(hasNestedArray)
  return false
}

console.log('\nstudy blocks — schema + Firestore safety')

test('blankStudyBlocks() validates against the write schema', () => {
  studyBlocksWriteSchema.parse(blankStudyBlocks())
})

test('every block type validates and is Firestore-safe (no nested arrays)', () => {
  for (const type of STUDY_BLOCK_TYPES) {
    const block = newStudyBlock(type)
    studyBlocksWriteSchema.parse([block])
    assert(!hasNestedArray(block), `block "${type}" contains a nested array — Firestore will reject it`)
  }
})

test('keyterms rows are {term, def} maps (not tuples)', () => {
  const kt = newStudyBlock('keyterms')
  assert(kt.rows.every(r => r && typeof r === 'object' && !Array.isArray(r) && 'term' in r), 'keyterms rows must be maps')
})

test('table rows are {cells:[]} maps (not tuples)', () => {
  const tb = newStudyBlock('table')
  assert(tb.rows.every(r => r && typeof r === 'object' && Array.isArray(r.cells)), 'table rows must be {cells:[]} maps')
})

test('coerceStudyBlocks drops malformed blocks but keeps valid ones', () => {
  const out = coerceStudyBlocks([
    { type: 'paragraph', text: 'Keep me' },
    { type: 'bogus', whatever: 1 },
    null,
    { type: 'objectives' },                  // missing items → dropped
    { type: 'quiz', quizId: 'abc123' },
  ])
  assert(out.length === 2, `expected 2 valid blocks, got ${out.length}`)
  assert(out[0].type === 'paragraph' && out[1].type === 'quiz', 'wrong blocks survived')
})

test('coerceStudyBlocks returns [] for non-array input', () => {
  assert(coerceStudyBlocks(null).length === 0)
  assert(coerceStudyBlocks(undefined).length === 0)
  assert(coerceStudyBlocks('nope').length === 0)
})

test('helpers: excerpt is a string, reading time >= 1, speech includes the title', () => {
  const blocks = blankStudyBlocks()
  assert(typeof buildStudyExcerpt(blocks) === 'string', 'excerpt must be a string')
  assert(studyReadingTime(blocks) >= 1, 'reading time must be >= 1')
  assert(studySpeechText(blocks, 'My Topic').includes('My Topic'), 'speech text must include the title')
})

console.log(`\n─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  for (const f of failures) console.error(`\n✖ ${f.name}\n  ${f.err.stack || f.err.message}`)
  process.exit(1)
}
