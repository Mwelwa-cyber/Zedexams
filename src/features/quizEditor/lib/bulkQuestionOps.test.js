/**
 * Tests for bulkQuestionOps — the pure logic behind the bulk-selection
 * toolbar's Apply-to-all patch and Merge actions.
 *
 * Plain `node` (auto-discovered via the test:bulk-question-ops key).
 * ensureRichTextHtml runs DOM-less here (its node fallback), so fixtures use
 * plain/HTML strings and Tiptap docs — all shapes the editor actually stores.
 *
 * Run: npm run test:bulk-question-ops
 */
import assert from 'node:assert/strict'
import {
  BULK_PATCH_FIELDS,
  sanitizeBulkPatch,
  mergeRichText,
  mergeStandaloneSections,
} from './bulkQuestionOps.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

function section(id, question) {
  return { id, kind: 'standalone', question: { localId: `lq-${id}`, ...question } }
}

console.log('bulkQuestionOps')

// ── sanitizeBulkPatch ─────────────────────────────────────────────
test('allowlist covers the toolbar fields', () => {
  for (const field of ['marks', 'topic', 'subtopic', 'competency', 'specificOutcome', 'curriculum', 'difficulty', 'bloom']) {
    assert.ok(BULK_PATCH_FIELDS.includes(field), field)
  }
})

test('keeps valid values, drops empties and junk', () => {
  const out = sanitizeBulkPatch({
    marks: '5',
    topic: '  Fractions  ',
    subtopic: '',
    competency: 'Number operations',
    difficulty: 'medium',
    bloom: 'wormhole',
    hacker: 'evil',
  })
  assert.deepEqual(out, {
    marks: 5,
    topic: 'Fractions',
    competency: 'Number operations',
    difficulty: 'medium',
  })
})

test('marks clamp to the schema bounds (1..20)', () => {
  assert.equal(sanitizeBulkPatch({ marks: 99 }).marks, 20)
  assert.equal(sanitizeBulkPatch({ marks: 0 }).marks, 1)
  assert.deepEqual(sanitizeBulkPatch({ marks: 'abc' }), {})
})

test('string caps enforced (specificOutcome 500)', () => {
  const out = sanitizeBulkPatch({ specificOutcome: 'x'.repeat(600) })
  assert.equal(out.specificOutcome.length, 500)
})

// ── mergeRichText ─────────────────────────────────────────────────
test('concatenates HTML sides; empty sides drop out', () => {
  const merged = mergeRichText('<p>Explain why the river floods</p>', '<p>during the rainy season.</p>')
  assert.ok(merged.includes('river floods'))
  assert.ok(merged.includes('rainy season'))
  assert.equal(mergeRichText('', '<p>b</p>'), mergeRichText('<p>b</p>', ''))
})

test('handles a Tiptap doc object side', () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'tail text' }] }] }
  const merged = mergeRichText('<p>head</p>', doc)
  assert.ok(merged.includes('head'))
  assert.ok(merged.includes('tail text'))
})

// ── mergeStandaloneSections ───────────────────────────────────────
test('merging fewer than 2 picks is a no-op', () => {
  const sections = [section('a', { text: '<p>x</p>', marks: 1 })]
  const result = mergeStandaloneSections(sections, ['a'])
  assert.equal(result.mergedCount, 0)
  assert.equal(result.sections, sections)
})

test('merges two fragments: text joins, marks sum, absorbed section removed', () => {
  const sections = [
    section('a', { _id: 'db-a', text: '<p>Explain why the river floods</p>', marks: 2, options: [], type: 'short_answer' }),
    section('b', { _id: 'db-b', text: '<p>during the rainy season.</p>', marks: 3, options: [], type: 'short_answer' }),
    section('c', { _id: 'db-c', text: '<p>Unrelated</p>', marks: 1 }),
  ]
  const result = mergeStandaloneSections(sections, ['a', 'b'])
  assert.equal(result.mergedCount, 1)
  assert.equal(result.sections.length, 2)
  const merged = result.sections[0].question
  assert.ok(merged.text.includes('river floods') && merged.text.includes('rainy season'))
  assert.equal(merged.marks, 5)
  assert.deepEqual(result.removedQuestionIds, ['db-b'])
  assert.equal(merged.requiresReview, true)
  // Untouched section survives verbatim.
  assert.equal(result.sections[1].question.text, '<p>Unrelated</p>')
})

test('selection order does not matter — document order wins', () => {
  const sections = [
    section('a', { text: '<p>first</p>', marks: 1, options: [] }),
    section('b', { text: '<p>second</p>', marks: 1, options: [] }),
  ]
  const result = mergeStandaloneSections(sections, ['b', 'a'])
  const merged = result.sections[0].question
  // 'a' is first in document order, so it survives and 'b' is absorbed.
  assert.ok(merged.text.indexOf('first') < merged.text.indexOf('second'))
})

test('passage and pagebreak sections are never merged', () => {
  const sections = [
    { id: 'p', kind: 'passage', passage: { questions: [] } },
    section('a', { text: '<p>x</p>', marks: 1 }),
    section('b', { text: '<p>y</p>', marks: 1 }),
  ]
  const result = mergeStandaloneSections(sections, ['p', 'a', 'b'])
  assert.equal(result.mergedCount, 1)
  assert.equal(result.sections[0].kind, 'passage')
})

test('marks clamp at 20 with a note', () => {
  const sections = [
    section('a', { text: '<p>x</p>', marks: 15, options: [] }),
    section('b', { text: '<p>y</p>', marks: 15, options: [] }),
  ]
  const result = mergeStandaloneSections(sections, ['a', 'b'])
  assert.equal(result.sections[0].question.marks, 20)
  assert.ok(result.notes.some(note => /clamped/.test(note)))
})

test('absorbed figures move into the survivor images[] (nothing lost)', () => {
  const sections = [
    section('a', { text: '<p>x</p>', marks: 1, imageUrl: 'https://x/1.png', images: [] }),
    section('b', {
      text: '<p>y</p>', marks: 1,
      imageUrl: 'https://x/2.png', imageAlt: 'Figure 2', imageWidth: 'medium',
      images: [{ url: 'https://x/3.png', alt: '', width: 'full' }],
    }),
  ]
  const result = mergeStandaloneSections(sections, ['a', 'b'])
  const merged = result.sections[0].question
  // Survivor keeps its own primary imageUrl; absorbed figures stack below.
  assert.equal(merged.imageUrl, 'https://x/1.png')
  assert.deepEqual(merged.images.map(image => image.url), ['https://x/2.png', 'https://x/3.png'])
  assert.equal(merged.images[0].alt, 'Figure 2')
})

test('absorbed question with its own options adds a review note', () => {
  const sections = [
    section('a', { text: '<p>x</p>', marks: 1, options: [], type: 'short_answer' }),
    section('b', { text: '<p>y</p>', marks: 1, options: ['p', 'q'], type: 'mcq', correctAnswer: 0 }),
  ]
  const result = mergeStandaloneSections(sections, ['a', 'b'])
  const merged = result.sections[0].question
  assert.ok(merged.reviewNotes.some(note => /own answer options/.test(note)))
  // Survivor's answer model is untouched.
  assert.equal(merged.type, 'short_answer')
  assert.deepEqual(merged.options, [])
})

test('image overflow past the 6-image cap becomes a note, not a silent drop', () => {
  const many = Array.from({ length: 7 }, (_, i) => ({ url: `https://x/${i}.png`, alt: '', width: 'full' }))
  const sections = [
    section('a', { text: '<p>x</p>', marks: 1, images: many.slice(0, 4) }),
    section('b', { text: '<p>y</p>', marks: 1, images: many.slice(4) }),
  ]
  const result = mergeStandaloneSections(sections, ['a', 'b'])
  assert.equal(result.sections[0].question.images.length, 6)
  assert.ok(result.notes.some(note => /image cap/.test(note)))
})

console.log(`\n${passed} tests passed`)
