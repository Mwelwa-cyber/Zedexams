'use strict';

// Unit test for the past-paper AI import duplicate collapse. The LLM that
// extracts MCQs from a paper sometimes returns the same question twice; the
// editor then shows it twice. dedupeExtractedQuestions removes the repeats and
// re-sequences the survivors' order.

const assert = require('node:assert/strict');
const {dedupeExtractedQuestions, canWriteQuiz} = require('./pastPaperImportHelpers');

function q(prompt, options, order) {
  return {prompt, options, correctAnswer: 0, explanation: '', order, requiresReview: true};
}

// 1. An identical question repeated collapses to one, order re-sequenced.
{
  const input = [
    q('What is the capital of Zambia?', ['Lusaka', 'Ndola', 'Kitwe', 'Livingstone'], 0),
    q('Which gas do plants absorb?', ['Oxygen', 'Carbon dioxide', 'Nitrogen', 'Helium'], 1),
    q('What is the capital of Zambia?', ['Lusaka', 'Ndola', 'Kitwe', 'Livingstone'], 2),
  ];
  const out = dedupeExtractedQuestions(input);
  assert.equal(out.length, 2, 'repeated question must collapse to one');
  assert.deepEqual(out.map((x) => x.prompt), [
    'What is the capital of Zambia?',
    'Which gas do plants absorb?',
  ]);
  assert.deepEqual(out.map((x) => x.order), [0, 1], 'order must be re-sequenced 0..N');
}

// 2. Whitespace/case-only differences are still the same question.
{
  const input = [
    q('What is  2 + 2?', ['3', '4', '5', '6'], 0),
    q('what is 2 + 2?', ['3', '4', '5', '6'], 1),
  ];
  const out = dedupeExtractedQuestions(input);
  assert.equal(out.length, 1, 'case/whitespace variants of one question collapse');
}

// 3. Distinct questions are all kept.
{
  const input = [
    q('Q1?', ['a', 'b', 'c', 'd'], 0),
    q('Q2?', ['a', 'b', 'c', 'd'], 1),
    q('Q3?', ['a', 'b', 'c', 'd'], 2),
  ];
  const out = dedupeExtractedQuestions(input);
  assert.equal(out.length, 3, 'distinct questions are untouched');
}

// 4. Same stem but different options are kept (a genuinely different question).
{
  const input = [
    q('Pick the odd one out.', ['cat', 'dog', 'cow', 'car'], 0),
    q('Pick the odd one out.', ['red', 'blue', 'green', 'seven'], 1),
  ];
  const out = dedupeExtractedQuestions(input);
  assert.equal(out.length, 2, 'same stem with different options stays distinct');
}

// 5. Quiz-write authorisation (IDOR guard for the clear+overwrite path).
{
  const mine = {createdBy: 'teacher-1'};
  const other = {createdBy: 'teacher-2'};
  // Owner can write their own quiz.
  assert.equal(canWriteQuiz(mine, 'teacher-1', false), true);
  // Non-owner, non-admin cannot — this is the IDOR that wiped other quizzes.
  assert.equal(canWriteQuiz(other, 'teacher-1', false), false);
  // Admin can write any quiz (past papers are admin-curated).
  assert.equal(canWriteQuiz(other, 'teacher-1', true), true);
  // Missing quiz doc is not writable for a non-admin.
  assert.equal(canWriteQuiz(null, 'teacher-1', false), false);
  // A quiz with no createdBy is not writable for a non-admin.
  assert.equal(canWriteQuiz({}, 'teacher-1', false), false);
}

console.log('pastPaperImport dedupe + auth test passed');
