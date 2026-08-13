import assert from 'node:assert/strict'
import { parsePastedQuestions } from '../src/features/assessmentStudio/lib/pasteQuestionParser.js'

let passed = 0
let failed = 0

function test(name, fn) {
  try { fn(); console.log(`ok  ${name}`); passed++ }
  catch (e) { console.error(`FAIL ${name}\n     ${e.message}`); failed++ }
}

// ── MCQ ──────────────────────────────────────────────────────────────────────

test('parses a basic MCQ with answer', () => {
  const qs = parsePastedQuestions(`
1. What is the capital of Zambia? [2]
A) Lusaka
B) Ndola
C) Kitwe
D) Livingstone
Answer: A
`)
  assert.equal(qs.length, 1)
  assert.equal(qs[0].type, 'mcq')
  assert.equal(qs[0].text, 'What is the capital of Zambia?')
  assert.equal(qs[0].marks, 2)
  assert.deepEqual(qs[0].options, ['Lusaka', 'Ndola', 'Kitwe', 'Livingstone'])
  assert.equal(qs[0].correctAnswer, 0)
})

test('parses MCQ with dot-style options and lowercase letter answer', () => {
  const qs = parsePastedQuestions(`
1. Which gas do plants absorb? (1 mark)
A. Carbon dioxide
B. Oxygen
C. Nitrogen
D. Hydrogen
Ans: a
`)
  assert.equal(qs[0].type, 'mcq')
  assert.equal(qs[0].marks, 1)
  assert.equal(qs[0].correctAnswer, 0)
})

test('pads MCQ to 4 options when only 2 given', () => {
  const qs = parsePastedQuestions(`
1. True or false format MCQ
A) Yes
B) No
Answer: B
`)
  assert.equal(qs[0].options.length, 4)
  assert.equal(qs[0].options[2], '')
  assert.equal(qs[0].correctAnswer, 1)
})

test('parses MCQ with bracket-style options (A)', () => {
  const qs = parsePastedQuestions(`
1. Select the correct one. [1]
(A) Option one
(B) Option two
(C) Option three
(D) Option four
Answer: C
`)
  assert.equal(qs[0].type, 'mcq')
  assert.equal(qs[0].correctAnswer, 2)
})

// ── SHORT ANSWER / ESSAY ──────────────────────────────────────────────────────

test('parses short-answer when no options given', () => {
  const qs = parsePastedQuestions(`
2. Name the three branches of government. (3)
Answer: Executive, Legislature, Judiciary
`)
  assert.equal(qs[0].type, 'short_answer')
  assert.equal(qs[0].marks, 3)
  assert.equal(qs[0].correctAnswer, 'Executive, Legislature, Judiciary')
})

test('parses essay when marks >= 5', () => {
  const qs = parsePastedQuestions(`
3. Explain the causes and effects of deforestation in Zambia. [8]
`)
  assert.equal(qs[0].type, 'essay')
  assert.equal(qs[0].marks, 8)
})

test('parses essay when question text is long and no options', () => {
  const qs = parsePastedQuestions(`
4. Describe in detail how the Zambian constitution protects the rights of citizens and discuss three specific examples from your own experience or reading. [4]
`)
  assert.equal(qs[0].type, 'essay')
})

// ── TRUE / FALSE ─────────────────────────────────────────────────────────────

test('parses true/false with Answer: True', () => {
  const qs = parsePastedQuestions(`
5. The sun rises in the east. (1)
Answer: True
`)
  assert.equal(qs[0].type, 'true_false')
  assert.equal(qs[0].correctAnswer, 0)
})

test('parses true/false with Answer: False', () => {
  const qs = parsePastedQuestions(`
6. The moon produces its own light. (1)
Answer: FALSE
`)
  assert.equal(qs[0].type, 'true_false')
  assert.equal(qs[0].correctAnswer, 1)
})

// ── MARKS EXTRACTION ─────────────────────────────────────────────────────────

test('extracts marks from square bracket suffix', () => {
  assert.equal(parsePastedQuestions('1. Question text [3]')[0].marks, 3)
})

test('extracts marks from parenthesis suffix', () => {
  assert.equal(parsePastedQuestions('1. Question text (4)')[0].marks, 4)
})

test('extracts marks from "marks" word suffix', () => {
  assert.equal(parsePastedQuestions('1. Question text (2 marks)')[0].marks, 2)
})

test('defaults to 1 mark when no suffix', () => {
  assert.equal(parsePastedQuestions('1. No marks here')[0].marks, 1)
})

// ── MULTIPLE QUESTIONS ────────────────────────────────────────────────────────

test('parses multiple questions in one paste', () => {
  const qs = parsePastedQuestions(`
1. First question [1]
A) Alpha
B) Beta
C) Gamma
D) Delta
Answer: B

2. Second question (2)
Answer: Model answer here

3. Third question [5]
`)
  assert.equal(qs.length, 3)
  assert.equal(qs[0].type, 'mcq')
  assert.equal(qs[1].type, 'short_answer')
  assert.equal(qs[2].type, 'essay')
})

test('handles Q-prefixed numbers (Q1. Q2.)', () => {
  const qs = parsePastedQuestions(`
Q1. First [1]
A) A
B) B
C) C
D) D
Answer: C

Q2. Second (3)
`)
  assert.equal(qs.length, 2)
  assert.equal(qs[0].correctAnswer, 2)
})

test('handles closing-paren question numbers (1) 2))', () => {
  const qs = parsePastedQuestions(`
1) First question [2]
A) Yes
B) No
C) Maybe
D) Never
Answer: D

2) Second question (1)
`)
  assert.equal(qs.length, 2)
  assert.equal(qs[0].correctAnswer, 3)
})

test('ignores blank lines between questions', () => {
  const qs = parsePastedQuestions('\n\n1. Q one [1]\nA) X\nB) Y\nC) Z\nD) W\n\n\n2. Q two [2]\n\n')
  assert.equal(qs.length, 2)
})

test('returns empty array for empty input', () => {
  assert.deepEqual(parsePastedQuestions(''), [])
  assert.deepEqual(parsePastedQuestions('   \n\n  '), [])
})

test('skips entries with no question text', () => {
  const qs = parsePastedQuestions('1.   \n2. Real question [1]')
  assert.equal(qs.length, 1)
  assert.equal(qs[0].text, 'Real question')
})

// ── SUMMARY ───────────────────────────────────────────────────────────────────

console.log(`\n─── ${passed + failed} tests · ${passed} passed · ${failed} failed ───\n`)
if (failed) process.exit(1)
