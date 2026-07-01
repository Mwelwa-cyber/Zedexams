#!/usr/bin/env node
/* global console, process */
/**
 * Document Understanding Engine parity net.
 *
 * The validation engine exists twice — once CJS for the Cloud Functions
 * (`functions/documentEngine/`) and once ESM for the browser
 * (`src/documentEngine/`) — because `src/` and `functions/` cannot share a
 * module. This suite runs BOTH on the same fixtures and asserts byte-identical
 * results, so the two can never silently drift (the same mechanism as
 * `scripts/test-question-consistency.mjs`).
 *
 * Plain `node` so it runs inside `npm run test:all`.
 * Run: npm run test:document-engine-parity
 */
import { createRequire } from 'node:module'
import assert from 'node:assert'
import * as esm from '../src/documentEngine/validationEngine.js'
import * as esmDoc from '../src/documentEngine/structuredDocument.js'

const require = createRequire(import.meta.url)
const cjs = require('../functions/documentEngine/validationEngineCore.js')
const cjsDoc = require('../functions/documentEngine/structuredDocumentCore.js')

let pass = 0
const failures = []
function test(name, fn) {
  try {
    fn()
    pass++
    console.log(`  ok  ${name}`)
  } catch (err) {
    failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}`)
    console.log(`       ${err.message}`)
  }
}

// Fixtures exercising every classification path.
const FIXTURES = {
  clean: [1, 2, 3, 4, 5].map((n, i) => ({ order: i, type: 'mcq', options: ['a', 'b', 'c', 'd'], answerKnown: true, sourceNumber: n, prompt: `Q${n}` })),
  missing: [1, 2, 3, 5, 6].map((n, i) => ({ order: i, type: 'mcq', options: ['a', 'b', 'c', 'd'], answerKnown: true, sourceNumber: n, prompt: `Q${n}` })),
  restart: [1, 2, 3, 1, 2].map((n, i) => ({ order: i, type: 'mcq', options: ['a', 'b', 'c', 'd'], answerKnown: true, sourceNumber: n, prompt: `Q${n}` })),
  dupOoO: [1, 2, 2, 4, 3, 5].map((n, i) => ({ order: i, type: 'mcq', options: ['a', 'b', 'c', 'd'], answerKnown: true, sourceNumber: n, prompt: `Q${n}` })),
  mcqGap: [
    { order: 0, type: 'mcq', sourceNumber: 1, options: ['A. x', 'B. y', 'D. z'], answerKnown: true, prompt: `The ${esm.UNCLEAR_TOKEN} thing` },
    { order: 1, type: 'mcq', sourceNumber: 2, options: ['p', 'q', 'r'], answerKnown: false, prompt: 'Q2' },
    { order: 2, type: 'short_answer', sourceNumber: 3, options: [], answerKnown: false, prompt: 'MARKING SCHEME 1. A 2. B 3. C 4. D 5. A' },
  ],
  unnumbered: [
    { order: 0, type: 'essay', options: [], answerKnown: false, prompt: 'Discuss trade' },
    { order: 1, type: 'essay', options: [], answerKnown: false, prompt: 'Explain rainfall' },
  ],
}

// ── constant parity ───────────────────────────────────────────────
console.log('\nconstants')

test('UNCLEAR_TOKEN matches', () => {
  assert.strictEqual(esm.UNCLEAR_TOKEN, cjs.UNCLEAR_TOKEN)
})

test('StructuredDocument field lists match', () => {
  assert.deepStrictEqual(esmDoc.STRUCTURED_DOCUMENT_FIELDS, cjsDoc.STRUCTURED_DOCUMENT_FIELDS)
  assert.deepStrictEqual(esmDoc.CANONICAL_QUESTION_FIELDS, cjsDoc.CANONICAL_QUESTION_FIELDS)
})

// ── behavioural parity ────────────────────────────────────────────
console.log('\nbehavioural parity across fixtures')

for (const [name, list] of Object.entries(FIXTURES)) {
  test(`analyzeNumbering — ${name}`, () => {
    assert.deepStrictEqual(esm.analyzeNumbering(list), cjs.analyzeNumbering(list))
  })
  test(`gateImport — ${name}`, () => {
    assert.deepStrictEqual(esm.gateImport({ questions: list }), cjs.gateImport({ questions: list }))
  })
  test(`per-question status + unclear + mcq — ${name}`, () => {
    for (const q of list) {
      assert.strictEqual(esm.computeValidationStatus(q), cjs.computeValidationStatus(q), 'validationStatus')
      assert.deepStrictEqual(esm.detectUnclear(q), cjs.detectUnclear(q), 'detectUnclear')
      assert.deepStrictEqual(esm.analyzeMcqCompleteness(q, 'Q'), cjs.analyzeMcqCompleteness(q, 'Q'), 'analyzeMcqCompleteness')
      assert.strictEqual(esm.detectAnswerKeyBlock(q), cjs.detectAnswerKeyBlock(q), 'detectAnswerKeyBlock')
    }
  })
  test(`mergeContinuations — ${name}`, () => {
    // Clone so neither engine mutates the shared fixture before the other runs.
    const a = esm.mergeContinuations(list.map((q) => ({ ...q })))
    const b = cjs.mergeContinuations(list.map((q) => ({ ...q })))
    assert.deepStrictEqual(a, b)
  })
}

// A continuation-specific fixture (the others have no mergeable tails).
test('mergeContinuations — tail fixture', () => {
  const tail = [
    { order: 0, sourceNumber: 5, prompt: 'Explain why the river floods', options: [] },
    { order: 1, sourceNumber: null, prompt: 'during the rainy season.', options: [] },
  ]
  assert.deepStrictEqual(
    esm.mergeContinuations(tail.map((q) => ({ ...q }))),
    cjs.mergeContinuations(tail.map((q) => ({ ...q }))),
  )
})

test('stampQuestion parity', () => {
  const samples = [
    { type: 'mcq', prompt: 'x', options: ['a', 'b', 'c', 'd'], answerKnown: true, confidence: 0.9 },
    { type: 'mcq', prompt: 'y', options: ['A. a', 'B. b', 'D. d'], answerKnown: true },
    { type: 'essay', prompt: `z ${esm.UNCLEAR_TOKEN}`, options: [], answerKnown: false, aiConfidence: 5 },
  ]
  for (const s of samples) {
    assert.deepStrictEqual(esmDoc.stampQuestion(s), cjsDoc.stampQuestion(s))
  }
})

console.log('')
console.log(`─── ${pass + failures.length} tests · ${pass} passed · ${failures.length} failed ───`)
if (failures.length) {
  console.log('\nfailures:')
  failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
