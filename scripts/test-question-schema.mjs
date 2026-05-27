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

const { questionWriteSchema, tiptapDoc, coerceQuestion } = await import('../src/editor/schema/question.js')
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

test('accepts marks=15 (within the 1-20 range)', () => {
  // The cap was raised from 10 to 20 so legitimate past-paper questions
  // with `[15 marks]` survive import without auto-save throwing
  // "Invalid input at 'marks'". See useFirestore.normalizeQuestionPayload
  // for the matching client-side clamp.
  const d = validDoc()
  d.marks = 15
  const result = questionWriteSchema.safeParse(d)
  assert(result.success, 'marks=15 should be accepted under the new 1-20 cap')
})

test('rejects marks=21 (above cap)', () => {
  const d = validDoc()
  d.marks = 21
  const result = questionWriteSchema.safeParse(d)
  assert(!result.success, 'marks must be <= 20')
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

test('hotspot type with correctRegion + imageUrl passes', () => {
  const d = validDoc()
  d.type = 'hotspot'
  d.detectedType = 'hotspot'
  d.options = []
  d.correctAnswer = 0
  d.correctRegion = { x: 0.5, y: 0.5, radius: 0.1 }
  d.imageUrl = 'https://example.com/heart.png'
  const result = questionWriteSchema.safeParse(d)
  assert(result.success, JSON.stringify(result.error?.issues))
})

test('hotspot type rejects missing correctRegion', () => {
  const d = validDoc()
  d.type = 'hotspot'
  d.detectedType = 'hotspot'
  d.options = []
  d.imageUrl = 'https://example.com/heart.png'
  const result = questionWriteSchema.safeParse(d)
  assert(!result.success, 'hotspot without correctRegion should reject')
})

test('hotspot type rejects missing image', () => {
  const d = validDoc()
  d.type = 'hotspot'
  d.detectedType = 'hotspot'
  d.options = []
  d.correctRegion = { x: 0.5, y: 0.5, radius: 0.1 }
  // imageUrl deliberately left null
  const result = questionWriteSchema.safeParse(d)
  assert(!result.success, 'hotspot without image should reject')
})

test('hotspot type rejects out-of-range coords', () => {
  const d = validDoc()
  d.type = 'hotspot'
  d.detectedType = 'hotspot'
  d.options = []
  d.correctRegion = { x: 1.5, y: 0.5, radius: 0.1 }
  d.imageUrl = 'https://example.com/heart.png'
  const result = questionWriteSchema.safeParse(d)
  assert(!result.success, 'hotspot x > 1 should reject')
})

test('numeric type rejects Infinity correctAnswer', () => {
  const d = validDoc()
  d.type = 'numeric'
  d.detectedType = 'numeric'
  d.options = []
  d.correctAnswer = Infinity
  d.tolerance = 0
  const result = questionWriteSchema.safeParse(d)
  assert(!result.success, 'numeric requires finite correctAnswer')
})

test('numeric type rejects negative tolerance', () => {
  const d = validDoc()
  d.type = 'numeric'
  d.detectedType = 'numeric'
  d.options = []
  d.correctAnswer = 3.14
  d.tolerance = -0.01
  const result = questionWriteSchema.safeParse(d)
  assert(!result.success, 'tolerance has min(0)')
})

test('numeric type accepts null tolerance (legacy / not yet set)', () => {
  const d = validDoc()
  d.type = 'numeric'
  d.detectedType = 'numeric'
  d.options = []
  d.correctAnswer = 3.14
  d.tolerance = null
  const result = questionWriteSchema.safeParse(d)
  assert(result.success, JSON.stringify(result.error?.issues))
})

test('hotspot type rejects correctRegion missing radius', () => {
  const d = validDoc()
  d.type = 'hotspot'
  d.detectedType = 'hotspot'
  d.options = []
  // Missing `radius` — shape is incomplete
  d.correctRegion = { x: 0.5, y: 0.5 }
  d.imageUrl = 'https://example.com/heart.png'
  const result = questionWriteSchema.safeParse(d)
  assert(!result.success, 'correctRegion needs radius')
})

test('hotspot type rejects correctRegion radius > 0.5 cap', () => {
  const d = validDoc()
  d.type = 'hotspot'
  d.detectedType = 'hotspot'
  d.options = []
  d.correctRegion = { x: 0.5, y: 0.5, radius: 0.9 }
  d.imageUrl = 'https://example.com/heart.png'
  const result = questionWriteSchema.safeParse(d)
  assert(!result.success, 'radius capped at 0.5')
})

test('hotspot accepts imageDiagram in place of imageUrl', () => {
  // Teachers can drop in a library diagram instead of uploading an image.
  const d = validDoc()
  d.type = 'hotspot'
  d.detectedType = 'hotspot'
  d.options = []
  d.correctRegion = { x: 0.5, y: 0.5, radius: 0.1 }
  d.imageUrl = null
  d.imageDiagram = { libraryKey: 'heart_anatomy', params: {} }
  const result = questionWriteSchema.safeParse(d)
  assert(result.success, JSON.stringify(result.error?.issues))
})

test('hotspot type rejects retained options from MCQ', () => {
  const d = validDoc()
  d.type = 'hotspot'
  d.detectedType = 'hotspot'
  d.correctRegion = { x: 0.5, y: 0.5, radius: 0.1 }
  d.imageUrl = 'https://example.com/heart.png'
  // options retained from MCQ default — should be flagged
  const result = questionWriteSchema.safeParse(d)
  assert(!result.success, 'hotspot must have no options')
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

// ── coerceQuestion (read-side normaliser) ─────────────────────────
console.log('\ncoerceQuestion')

test('returns null for non-object input', () => {
  assert(coerceQuestion(null) === null)
  assert(coerceQuestion(undefined) === null)
  assert(coerceQuestion('not an object') === null)
  assert(coerceQuestion([]) === null)
})

test('preserves id (wiring relies on this)', () => {
  const out = coerceQuestion({ id: 'q_abc', type: 'mcq', marks: 1 })
  assert(out.id === 'q_abc')
})

test('unknown type falls back to mcq', () => {
  // A legacy doc with `type: 'multiple_choice'` (the old spelling) used
  // to crash the runner's type-branch switch. Now it grades as mcq.
  const out = coerceQuestion({ type: 'multiple_choice', marks: 1 })
  assert(out.type === 'mcq', `expected mcq fallback, got ${out.type}`)
})

test('known types survive', () => {
  for (const t of ['mcq', 'tf', 'short_answer', 'diagram', 'fill', 'short', 'numeric', 'hotspot']) {
    assert(coerceQuestion({ type: t, marks: 1 }).type === t, `${t} should survive`)
  }
})

test('non-array options coerces to []', () => {
  assert(Array.isArray(coerceQuestion({ options: null, marks: 1 }).options))
  assert(Array.isArray(coerceQuestion({ options: 'A,B,C', marks: 1 }).options))
  assert(coerceQuestion({ options: null, marks: 1 }).options.length === 0)
})

test('option entries stringified defensively', () => {
  // A legacy import that left a number in options[] used to break the
  // editor's text input. coerceQuestion guarantees strings.
  const out = coerceQuestion({ options: ['A', 42, null, 'D'], marks: 1 })
  assert(out.options.every(o => typeof o === 'string'), 'all entries must be strings')
  assert(out.options[1] === '42')
  assert(out.options[2] === '')
})

test('NaN/missing marks falls back to 1 (no score-arithmetic blow-up)', () => {
  // The runner sums `q.marks` for the score total. Legacy `marks: NaN`
  // (from a bad CSV import) would propagate NaN through the total and
  // render "Score: NaN/NaN" on the results page.
  assert(coerceQuestion({ marks: NaN }).marks === 1)
  assert(coerceQuestion({ marks: undefined }).marks === 1)
  assert(coerceQuestion({ marks: 'abc' }).marks === 1)
  assert(coerceQuestion({ marks: 0 }).marks === 1)
})

test('marks above cap is floored to 10', () => {
  assert(coerceQuestion({ marks: 999 }).marks === 10)
})

test('non-integer marks is floored', () => {
  assert(coerceQuestion({ marks: 2.7 }).marks === 2)
})

test('non-array optionMedia coerces to []', () => {
  assert(Array.isArray(coerceQuestion({ optionMedia: null, marks: 1 }).optionMedia))
})

test('non-object optionMedia entries become null (parallel-array safety)', () => {
  const out = coerceQuestion({ optionMedia: [{ alt: 'a' }, 'bad', 42, null], marks: 1 })
  assert(out.optionMedia[0]?.alt === 'a')
  assert(out.optionMedia[1] === null)
  assert(out.optionMedia[2] === null)
  assert(out.optionMedia[3] === null)
})

test('malformed tolerance becomes null (does not crash numericGrading)', () => {
  assert(coerceQuestion({ tolerance: 'oops', marks: 1 }).tolerance === null)
  assert(coerceQuestion({ tolerance: -1, marks: 1 }).tolerance === null)
  assert(coerceQuestion({ tolerance: NaN, marks: 1 }).tolerance === null)
})

test('valid tolerance survives', () => {
  assert(coerceQuestion({ tolerance: 0.01, marks: 1 }).tolerance === 0.01)
  assert(coerceQuestion({ tolerance: 0, marks: 1 }).tolerance === 0)
})

test('malformed correctRegion becomes null', () => {
  assert(coerceQuestion({ correctRegion: 'not-an-object', marks: 1 }).correctRegion === null)
  assert(coerceQuestion({ correctRegion: { x: 1.5, y: 0.5, radius: 0.1 }, marks: 1 }).correctRegion === null)
  assert(coerceQuestion({ correctRegion: { x: 0.5, y: 0.5 }, marks: 1 }).correctRegion === null)
})

test('valid correctRegion survives with numeric coercion', () => {
  // String-typed coords (some legacy CSV imports) should still produce
  // a well-shaped region.
  const out = coerceQuestion({ correctRegion: { x: '0.5', y: '0.5', radius: '0.1' }, marks: 1 })
  assert(out.correctRegion?.x === 0.5)
  assert(out.correctRegion?.y === 0.5)
  assert(out.correctRegion?.radius === 0.1)
})

test('preserves passthrough fields (correctAnswer, text, tiptap JSON, …)', () => {
  const out = coerceQuestion({
    type: 'mcq',
    marks: 1,
    correctAnswer: 0,
    text: '<p>What?</p>',
    textJSON: { type: 'doc', content: [] },
    customField: 'preserve me',
    contentVersion: 3,
  })
  assert(out.correctAnswer === 0)
  assert(out.text === '<p>What?</p>')
  assert(out.textJSON?.type === 'doc')
  assert(out.customField === 'preserve me')
  assert(out.contentVersion === 3)
})

// ── Report ────────────────────────────────────────────────────────
console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  console.log('\nfailures:')
  failures.forEach(f => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
