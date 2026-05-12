#!/usr/bin/env node
/**
 * Tests for the question Zod schema and the backfill migration logic.
 * Run: npm run test:schema
 */

import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>')
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.DOMParser = dom.window.DOMParser
globalThis.Node = dom.window.Node
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.Element = dom.window.Element

const { questionWriteSchema, tiptapDoc } = await import('../src/editor/schema/question.js')
const { migrateQuestionRecord } = await import('./migrate-questions-to-v3.mjs')

let pass = 0
let fail = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    pass++
    console.log(`  ok  ${name}`)
  } catch (err) {
    fail++
    failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}`)
    console.log(`       ${err.message}`)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function validDoc() {
  return {
    type: 'mcq',
    detectedType: 'mcq',
    topic: 'Fractions',
    marks: 2,
    order: 1,
    sharedInstruction: '',
    text: '<p>What is 1/2?</p>',
    explanation: '<p>Half.</p>',
    sharedInstructionJSON: null,
    textJSON: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'What is 1/2?' }] }] },
    passageJSON: null,
    explanationJSON: null,
    options: ['0.5', '0.25', '0.75', '1'],
    correctAnswer: 0,
    passageId: null,
    imageUrl: null,
    diagramText: null,
    requiresReview: false,
    reviewNotes: [],
    importWarnings: [],
    sourcePage: null,
    contentVersion: 3,
  }
}

// ── Schema: accept valid records ──────────────────────────────────
console.log('\nschema (valid records)')

test('canonical mcq record passes', () => {
  const result = questionWriteSchema.safeParse(validDoc())
  assert(result.success, JSON.stringify(result.error?.issues))
})

test('short_answer with string correctAnswer', () => {
  const d = validDoc()
  d.type = 'short_answer'
  d.options = []
  d.correctAnswer = 'photosynthesis'
  const result = questionWriteSchema.safeParse(d)
  assert(result.success, JSON.stringify(result.error?.issues))
})

test('tiptapDoc accepts null (empty field)', () => {
  const result = tiptapDoc.safeParse(null)
  assert(result.success, 'null should be accepted')
})

test('tiptapDoc accepts deeply nested content', () => {
  const doc = {
    type: 'doc',
    content: [{
      type: 'bulletList',
      content: [{
        type: 'listItem',
        content: [{
          type: 'paragraph',
          content: [
            { type: 'text', text: 'item ' },
            { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
          ],
        }],
      }],
    }],
  }
  const result = tiptapDoc.safeParse(doc)
  assert(result.success, JSON.stringify(result.error?.issues))
})

// ── Schema: reject invalid records ────────────────────────────────
console.log('\nschema (rejection cases)')

test('rejects unknown top-level field', () => {
  const d = validDoc()
  d.hacker = 'evil'
  const result = questionWriteSchema.safeParse(d)
  assert(!result.success, 'strict() should reject stray fields')
})

test('rejects marks=0', () => {
  const d = validDoc()
  d.marks = 0
  const result = questionWriteSchema.safeParse(d)
  assert(!result.success, 'marks must be >= 1')
})

test('rejects marks=11 (above cap)', () => {
  const d = validDoc()
  d.marks = 11
  const result = questionWriteSchema.safeParse(d)
  assert(!result.success, 'marks must be <= 10')
})

test('rejects unknown question type', () => {
  const d = validDoc()
  d.type = 'multiple_choice'
  const result = questionWriteSchema.safeParse(d)
  assert(!result.success, 'unknown type should fail')
})

test('rejects contentVersion=2 (must be exactly 3)', () => {
  const d = validDoc()
  d.contentVersion = 2
  const result = questionWriteSchema.safeParse(d)
  assert(!result.success, 'write schema is v3-only')
})

test('rejects tiptapDoc without "type: doc"', () => {
  const d = validDoc()
  d.textJSON = { type: 'paragraph', content: [] }
  const result = questionWriteSchema.safeParse(d)
  assert(!result.success, 'root must be doc')
})

test('rejects text longer than 100 KB', () => {
  const d = validDoc()
  d.text = 'x'.repeat(100_001)
  const result = questionWriteSchema.safeParse(d)
  assert(!result.success, 'oversized text should fail')
})

test('numeric type with finite correctAnswer + tolerance passes', () => {
  const d = validDoc()
  d.type = 'numeric'
  d.detectedType = 'numeric'
  d.options = []
  d.correctAnswer = 3.14
  d.tolerance = 0.01
  const result = questionWriteSchema.safeParse(d)
  assert(result.success, JSON.stringify(result.error?.issues))
})

test('numeric type rejects string correctAnswer', () => {
  const d = validDoc()
  d.type = 'numeric'
  d.detectedType = 'numeric'
  d.options = []
  d.correctAnswer = 'pi'
  const result = questionWriteSchema.safeParse(d)
  assert(!result.success, 'numeric with string correctAnswer should reject')
})

test('numeric type rejects options array', () => {
  const d = validDoc()
  d.type = 'numeric'
  d.detectedType = 'numeric'
  d.correctAnswer = 3.14
  // options retained from MCQ default — should be flagged
  const result = questionWriteSchema.safeParse(d)
  assert(!result.success, 'numeric must have no options')
})

test('rejects options list larger than 20', () => {
  const d = validDoc()
  d.options = Array.from({ length: 21 }, (_, i) => `opt${i}`)
  const result = questionWriteSchema.safeParse(d)
  assert(!result.success, 'options cap is 20')
})

// ── Migration logic ───────────────────────────────────────────────
console.log('\nmigration (legacy → v3)')

test('migrates HTML-only mcq to dual format', () => {
  const legacy = {
    type: 'mcq', marks: 2, order: 1, topic: 'Fractions',
    text: '<p>What is <strong>1/2</strong>?</p>',
    explanation: '<p>Half.</p>',
    options: ['0.5', '0.25', '0.75', '1'],
    correctAnswer: 0,
  }
  const result = migrateQuestionRecord(legacy, 1)
  assert(result !== null, 'should migrate, not skip')
  assert(result.contentVersion === 3, 'should be v3')
  assert(result.text === '<p>What is <strong>1/2</strong>?</p>', 'HTML preserved')
  assert(result.textJSON?.type === 'doc', 'textJSON is a doc')
  assert(Array.isArray(result.textJSON.content), 'textJSON has content array')
  assert(result.explanationJSON?.type === 'doc', 'explanationJSON generated')
})

test('plain text field migrates to a paragraph node', () => {
  const legacy = {
    type: 'short_answer', marks: 3, order: 0, topic: 'Essay',
    text: 'Describe photosynthesis.',
    explanation: 'Light → chemical energy.',
    correctAnswer: 'photosynthesis',
  }
  const result = migrateQuestionRecord(legacy, 0)
  assert(result?.textJSON?.content?.length >= 1, 'plain text wrapped in paragraph')
})

test('already-v3 record is skipped (returns null)', () => {
  const current = {
    type: 'mcq', marks: 1, order: 0, topic: 't',
    text: '<p>x</p>', explanation: '', sharedInstruction: '',
    textJSON: { type: 'doc', content: [] },
    sharedInstructionJSON: null, explanationJSON: null, passageJSON: null,
    options: ['a','b'], correctAnswer: 0, contentVersion: 3,
  }
  const result = migrateQuestionRecord(current, 0)
  assert(result === null, 'v3 records must be skipped')
})

test('missing text becomes empty JSON (null), not an error', () => {
  const legacy = {
    type: 'mcq', marks: 2, order: 1, topic: 'x',
    text: '', explanation: '',
    options: ['a', 'b'], correctAnswer: 0,
  }
  const result = migrateQuestionRecord(legacy, 1)
  assert(result.textJSON === null, 'empty text → null JSON')
  assert(result.explanationJSON === null, 'empty explanation → null JSON')
})

test('existing JSON fields are preferred over HTML when both present', () => {
  const jsonDoc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'already json' }] }] }
  const legacy = {
    type: 'mcq', marks: 2, order: 1, topic: 'x',
    text: '<p>stale html</p>', explanation: '',
    textJSON: jsonDoc,
    options: ['a','b'], correctAnswer: 0,
  }
  const result = migrateQuestionRecord(legacy, 1)
  assert(result.textJSON.content[0].content[0].text === 'already json', 'should prefer existing JSON')
})

test('math node round-trips through migration', () => {
  const legacy = {
    type: 'mcq', marks: 2, order: 1, topic: 'Algebra',
    text: '<p>Solve <span class="mnode" data-latex="x^2=4">x^2=4</span></p>',
    explanation: '', options: ['a','b'], correctAnswer: 0,
  }
  const result = migrateQuestionRecord(legacy, 1)
  // Find the math node in the JSON
  const para = result.textJSON.content[0]
  const mathNode = para.content?.find(n => n.type === 'mathInline')
  assert(mathNode, 'math node should be present in JSON output')
  assert(mathNode.attrs?.latex === 'x^2=4', `latex attr preserved, got: ${JSON.stringify(mathNode.attrs)}`)
})

// ── Report ────────────────────────────────────────────────────────
console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  console.log('\nfailures:')
  failures.forEach(f => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
