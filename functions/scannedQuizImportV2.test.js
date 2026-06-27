/**
 * Unit tests for the V2 scanned-paper OCR import engine. Plain `node` script
 * (no test runner) — throws on the first failed assertion, matching the
 * repo's other functions/*.test.js files. Model calls are not exercised here;
 * only the pure normaliser is tested.
 *
 * Run: node functions/scannedQuizImportV2.test.js
 */

const assert = require("node:assert");
const { normaliseScannedQuestionV2 } = require('./scannedQuizImportV2.js');

// ─── Test 1: fill_blanks question maps statements and wordBank ────────────────

{
  const raw = {
    questionType: 'fill_blanks',
    prompt: 'Complete the sentences.',
    statements: [{ text: 'The sun is a _____.', blanks: 1 }],
    wordBank: ['star', 'planet'],
    marks: 2,
    confidence: 0.85,
    options: [],
    hasDiagram: false,
    diagrams: [],
  };
  const result = normaliseScannedQuestionV2(raw, { sourcePageIndex: 0 });
  assert.strictEqual(result.type, 'fill_blanks', 'type should be fill_blanks');
  assert.deepStrictEqual(result.statements, [{ text: 'The sun is a _____.', blanks: 1 }], 'statements should match');
  assert.deepStrictEqual(result.wordBank, ['star', 'planet'], 'wordBank should match');
  assert.strictEqual(result.marks, 2, 'marks should be 2');
  assert.strictEqual(result.requiresReview, false, 'requiresReview should be false for high confidence');
  console.log('✓ fill_blanks question maps statements and wordBank');
}

// ─── Test 2: low confidence question sets requiresReview ──────────────────────

{
  const raw = {
    questionType: 'mcq',
    prompt: 'Which?',
    options: ['A', 'B'],
    confidence: 0.4,
    marks: 1,
    hasDiagram: false,
    diagrams: [],
  };
  const result = normaliseScannedQuestionV2(raw, { sourcePageIndex: 0 });
  assert.strictEqual(result.requiresReview, true, 'requiresReview should be true for low confidence');
  assert.ok(result.importWarnings.length > 0, 'importWarnings should be non-empty');
  console.log('✓ low confidence question sets requiresReview');
}

// ─── Test 3: matching question maps matchingLeft and matchingRight ─────────────

{
  const raw = {
    questionType: 'matching',
    prompt: 'Match Column A to Column B.',
    matchingLeft: ['Dog', 'Cat'],
    matchingRight: ['Barks', 'Meows', 'Chirps'],
    marks: 2,
    confidence: 0.9,
    options: [],
    hasDiagram: false,
    diagrams: [],
  };
  const result = normaliseScannedQuestionV2(raw, { sourcePageIndex: 0 });
  assert.strictEqual(result.type, 'matching', 'type should be matching');
  assert.deepStrictEqual(result.matchingLeft, ['Dog', 'Cat'], 'matchingLeft should match');
  assert.deepStrictEqual(result.matchingRight, ['Barks', 'Meows', 'Chirps'], 'matchingRight should match');
  console.log('✓ matching question maps matchingLeft and matchingRight');
}

// ─── Test 4: true_false uses tfStatement as text and sets ['True', 'False'] options

{
  const raw = {
    questionType: 'true_false',
    prompt: 'Indicate if the statement is true or false.',
    tfStatement: 'The capital of Zambia is Lusaka.',
    confidence: 0.95,
    marks: 1,
    options: [],
    hasDiagram: false,
    diagrams: [],
  }
  const result = normaliseScannedQuestionV2(raw, { sourcePageIndex: 0 })
  assert.strictEqual(result.type, 'tf')
  assert.deepStrictEqual(result.options, ['True', 'False'])
  assert.strictEqual(result.text, 'The capital of Zambia is Lusaka.')
  console.log('✓ true_false maps tfStatement and options')
}

// ─── Test 5: table_fill maps tableHeaders and tableRows into tableData

{
  const raw = {
    questionType: 'table_fill',
    prompt: 'Complete the table.',
    tableHeaders: ['Animal', 'Sound'],
    tableRows: [['Dog', '▭'], ['Cat', '▭']],
    confidence: 0.88,
    marks: 2,
    options: [],
    hasDiagram: false,
    diagrams: [],
  }
  const result = normaliseScannedQuestionV2(raw, { sourcePageIndex: 1 })
  assert.strictEqual(result.type, 'short_answer')
  assert.deepStrictEqual(result.tableData, {
    headers: ['Animal', 'Sound'],
    rows: [['Dog', '▭'], ['Cat', '▭']],
  })
  console.log('✓ table_fill maps tableData')
}

// ─── Test 6: structured subParts include label field

{
  const raw = {
    questionType: 'structured',
    prompt: 'Answer the following.',
    subParts: [
      { label: 'a', text: 'Define photosynthesis.', marks: 2, answerLines: 3 },
      { label: 'b', text: 'Name two products.', marks: 1, answerLines: 2 },
    ],
    confidence: 0.9,
    marks: 3,
    options: [],
    hasDiagram: false,
    diagrams: [],
  }
  const result = normaliseScannedQuestionV2(raw, { sourcePageIndex: 0 })
  assert.strictEqual(result.type, 'short_answer')
  assert.strictEqual(result.subParts.length, 2)
  assert.strictEqual(result.subParts[0].label, 'a')
  assert.strictEqual(result.subParts[1].label, 'b')
  assert.strictEqual(result.subParts[0].text, 'Define photosynthesis.')
  console.log('✓ structured subParts include label')
}

// Test 7: runScannedQuizImportV2 is exported
{
  const mod = require('./scannedQuizImportV2.js')
  const assert = require('node:assert')
  assert.strictEqual(typeof mod.runScannedQuizImportV2, 'function', 'runScannedQuizImportV2 should be exported')
  console.log('✓ runScannedQuizImportV2 is exported')
}

console.log('\nAll tests passed.');
