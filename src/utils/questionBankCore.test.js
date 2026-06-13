/**
 * Tests for the firebase-free Question Bank core: preview snippets, runtime/
 * paper-link stripping on save, search matching, and newest-first ordering.
 *
 * Run: node src/utils/questionBankCore.test.js
 */

import {
  bankPreview, sanitizeQuestionForBank, bankRowMatches, byNewest,
} from './questionBankCore.js'

let failures = 0
function assert(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`)
  else { failures += 1; console.error(`  ✗ ${msg}`) }
}

console.log('bankPreview')
{
  assert(bankPreview({ text: '  What is   photosynthesis? ' }) === 'What is photosynthesis?', 'collapses whitespace + trims')
  assert(bankPreview({ text: 'x'.repeat(300) }).length === 160, 'caps the snippet length')
  assert(bankPreview({}) === '', 'no text → empty preview')
}

console.log('\nsanitizeQuestionForBank — drops paper links + runtime state')
{
  const q = {
    type: 'mcq', text: 'Q', options: ['a', 'b'], correctAnswer: 0, marks: 2,
    localId: 'q_123', _id: 'abc', partId: 'part_1', passageId: 'p1', order: 5,
    imageUploading: true, imageAssetId: 'asset', imageUrl: 'blob:xyz',
    requiresReview: true, reviewNotes: ['x'], sourcePage: 3,
    optionMedia: [{ imageUrl: 'blob:opt', imageAssetId: 'a', alt: 'A' }],
  }
  const clean = sanitizeQuestionForBank(q)
  assert(clean.text === 'Q' && clean.marks === 2, 'keeps real content')
  for (const f of ['localId', '_id', 'partId', 'passageId', 'order', 'imageUploading', 'imageAssetId', 'requiresReview', 'sourcePage']) {
    assert(!(f in clean), `drops paper/runtime field "${f}"`)
  }
  assert(clean.imageUrl === '', 'clears blob: stem URL')
  assert(!('imageUrl' in clean.optionMedia[0]), 'clears blob: option image URL')
  assert(clean.optionMedia[0].alt === 'A', 'keeps option alt text')
  // Must not mutate the original (the live question stays intact in the editor).
  assert(q.localId === 'q_123' && q.partId === 'part_1', 'does not mutate the source question')
}

console.log('\nbankRowMatches')
{
  const row = { preview: 'What is the capital of Zambia', topic: 'Geography', subject: 'social studies', type: 'mcq' }
  assert(bankRowMatches(row, '') === true, 'empty term matches everything')
  assert(bankRowMatches(row, 'capital zambia') === true, 'all tokens present matches')
  assert(bankRowMatches(row, 'geography') === true, 'matches on topic')
  assert(bankRowMatches(row, 'mcq') === true, 'matches on type')
  assert(bankRowMatches(row, 'capital france') === false, 'a missing token fails the match')
}

console.log('\nbyNewest')
{
  const rows = [
    { id: 'a', createdAt: { seconds: 100 } },
    { id: 'b', createdAt: { seconds: 300 } },
    { id: 'c', createdAt: { seconds: 200 } },
  ].sort(byNewest)
  assert(rows.map(r => r.id).join('') === 'bca', 'sorts newest first')
  assert([{ id: 'x' }, { id: 'y', createdAt: { seconds: 5 } }].sort(byNewest)[0].id === 'y', 'missing createdAt sorts last')
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`)
  process.exit(1)
}
console.log('\nAll questionBankCore tests passed.')
