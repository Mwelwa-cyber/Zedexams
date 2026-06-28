/**
 * Tests for the firebase-free Question Bank core: preview snippets, runtime/
 * paper-link stripping on save, search matching, and newest-first ordering.
 *
 * Run: node src/utils/questionBankCore.test.js
 */

import {
  bankPreview, sanitizeQuestionForBank, bankRowMatches, byNewest,
  questionFingerprint, questionTokens, extractKeywords, jaccardSimilarity,
  examPaperQuestionToBank, homeworkQuestionToBank,
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

console.log('\nexamPaperQuestionToBank — server quiz-shape → editor-shape')
{
  const q = examPaperQuestionToBank({
    type: 'multiple_choice', question: 'Capital of Zambia?',
    options: ['Ndola', 'Lusaka', 'Kitwe', 'Livingstone'], correctAnswer: 'Lusaka',
    explanation: 'It is Lusaka', topic: 'Geography', difficulty: 'easy', marks: 1,
  })
  assert(q.type === 'mcq', 'multiple_choice → mcq')
  assert(q.text === 'Capital of Zambia?', 'question → text')
  assert(q.correctAnswer === 1, "correctAnswer option TEXT 'Lusaka' → index 1")
  assert(q.marks === 1 && q.topic === 'Geography' && q.difficulty === 'easy', 'carries marks/topic/difficulty')
  assert(q.options.length === 4, 'options carried over')

  // Case-insensitive key match.
  const ci = examPaperQuestionToBank({ type: 'multiple_choice', question: 'Q', options: ['Yes', 'No'], correctAnswer: 'yes' })
  assert(ci.correctAnswer === 0, 'key matches an option case-insensitively')
  assert(ci.marks === 1, 'marks defaults to 1 when absent')

  // True/false + short answer.
  const tf = examPaperQuestionToBank({ type: 'true_false', question: 'Sky is blue?', correctAnswer: 'True' })
  assert(tf.type === 'tf' && tf.correctAnswer === 0 && tf.options.length === 2, "tf 'True' → index 0 with True/False options")
  const sa = examPaperQuestionToBank({ type: 'short_answer', question: '2+2?', correctAnswer: '4' })
  assert(sa.type === 'short_answer' && sa.correctAnswer === '4' && sa.options.length === 0, 'short_answer keeps text answer, no options')

  // Unmappable → null (dropped, not banked).
  assert(examPaperQuestionToBank({ type: 'multiple_choice', question: '', options: ['a', 'b'], correctAnswer: 'a' }) === null, 'blank stem → null')
  assert(examPaperQuestionToBank({ type: 'multiple_choice', question: 'Q', options: ['a', 'b'], correctAnswer: 'zzz' }) === null, 'MCQ key not among options → null')
  assert(examPaperQuestionToBank({ type: 'multiple_choice', question: 'Q', options: ['only'], correctAnswer: 'only' }) === null, 'MCQ with <2 options → null')
  assert(examPaperQuestionToBank(null) === null, 'null input → null')
}

console.log('\nhomeworkQuestionToBank — homework shape → editor short-answer')
{
  const q = homeworkQuestionToBank({
    prompt: 'What is 12 × 8?', answer: '96', workingNotes: '12 × 8 = 96 (multiply)',
  }, { topic: 'Multiplication' })
  assert(q.type === 'short_answer', 'always short_answer')
  assert(q.text === 'What is 12 × 8?', 'prompt → text')
  assert(q.correctAnswer === '96', 'answer → correctAnswer')
  assert(q.explanation === '12 × 8 = 96 (multiply)', 'workingNotes → explanation (marking guide)')
  assert(q.topic === 'Multiplication', 'topic taken from meta when absent on the question')
  assert(q.options.length === 0 && q.marks === 1, 'no options, marks default 1')

  assert(homeworkQuestionToBank({ prompt: 'Q', answer: '' }) === null, 'no answer → null (unkeyed, dropped)')
  assert(homeworkQuestionToBank({ prompt: '', answer: 'A' }) === null, 'no prompt → null')
  assert(homeworkQuestionToBank(null) === null, 'null input → null')
  assert(homeworkQuestionToBank({ prompt: 'Q', answer: 'A', topic: 'Fractions' }).topic === 'Fractions', 'question topic wins over meta')
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`)
  process.exit(1)
}
console.log('\nAll questionBankCore tests passed.')
