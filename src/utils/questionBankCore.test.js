/**
 * Tests for the firebase-free Question Bank core: preview snippets, runtime/
 * paper-link stripping on save, search matching, and newest-first ordering.
 *
 * Run: node src/utils/questionBankCore.test.js
 */

import {
  bankPreview, sanitizeQuestionForBank, bankRowMatches, byNewest,
  questionFingerprint, questionTokens, extractKeywords, jaccardSimilarity,
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

console.log('\nquestionFingerprint — exact-duplicate identity')
{
  const a = { text: 'What is <b>photosynthesis</b>?', options: ['Light', 'Water'], correctAnswer: 0 }
  const b = { text: 'What is photosynthesis?', options: ['Water', 'Light'], correctAnswer: 1 }
  const c = { text: 'What is respiration?', options: ['Light', 'Water'], correctAnswer: 0 }
  assert(questionFingerprint(a) === questionFingerprint(b), 'same stem + same option set (any order, HTML stripped) → same fingerprint')
  assert(questionFingerprint(a) !== questionFingerprint(c), 'different stem → different fingerprint')
  assert(/^[0-9a-f]{8}$/.test(questionFingerprint(a)), 'fingerprint is 8-char hex')
}

console.log('\nquestionTokens + jaccardSimilarity — near-duplicate detection')
{
  const a = { text: 'Explain how photosynthesis produces glucose in green plants', options: [] }
  const b = { text: 'Explain how photosynthesis produces glucose in green plants today', options: [] }
  const c = { text: 'Describe the water cycle and evaporation', options: [] }
  const simAB = jaccardSimilarity(questionTokens(a), questionTokens(b))
  const simAC = jaccardSimilarity(questionTokens(a), questionTokens(c))
  assert(simAB > 0.82, 'tiny wording change stays a near-duplicate (>0.82)')
  assert(simAC < 0.3, 'different concept is not a near-duplicate')
  assert(jaccardSimilarity([], ['x']) === 0, 'empty token set → 0 similarity')
  assert(jaccardSimilarity(['x', 'y'], ['x', 'y']) === 1, 'identical token sets → 1')
  assert(!questionTokens(a).includes('the'), 'stopwords are stripped from tokens')
}

console.log('\nextractKeywords')
{
  const kw = extractKeywords({ text: 'Name the largest planet in the solar system' }, { subject: 'Science', topic: 'Astronomy' })
  assert(kw.includes('planet') && kw.includes('astronomy') && kw.includes('science'), 'keywords include question + topic + subject tokens')
  assert(kw.length === new Set(kw).size, 'keywords are de-duplicated')
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`)
  process.exit(1)
}
console.log('\nAll questionBankCore tests passed.')
