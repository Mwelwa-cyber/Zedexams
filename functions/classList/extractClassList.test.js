#!/usr/bin/env node
/**
 * Tests for functions/classList/extractClassListCore.js — the prompt and the
 * parsing of a photographed class list. Pure logic; no Anthropic, no Firebase.
 * Run: npm run test:class-list-extract  (also via npm run test:all)
 */

const assert = require('assert')
const {
  SYSTEM_PROMPT,
  EXTRACTION_TOOL,
  MAX_PAGES_PER_CALL,
  buildImageContent,
  parseExtraction,
} = require('./extractClassListCore')

let pass = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    pass += 1
    console.log(`  ok  ${name}`)
  } catch (err) {
    failures.push({name, message: err.message})
    console.log(`  FAIL ${name}`)
    console.log(`       ${err.message}`)
  }
}

const png = (data = 'aGVsbG8=') => `data:image/png;base64,${data}`

// ── the prompt ───────────────────────────────────────────────────

console.log('\nthe prompt')

test('forbids inventing a value the page does not carry', () => {
  assert.ok(/never invent/i.test(SYSTEM_PROMPT))
  assert.ok(/leave it null/i.test(SYSTEM_PROMPT))
})

test('pins the day-first date reading Zambian paperwork uses', () => {
  assert.ok(/day-first/i.test(SYSTEM_PROMPT))
})

test('forbids tidying names, which is how a child gets renamed for a year', () => {
  assert.ok(/do not reorder/i.test(SYSTEM_PROMPT))
  assert.ok(/do not expand initials/i.test(SYSTEM_PROMPT))
  assert.ok(/do not fix spellings/i.test(SYSTEM_PROMPT))
})

test('a struck-out row is transcribed and flagged, never dropped', () => {
  assert.ok(/crossed out/i.test(SYSTEM_PROMPT))
  assert.ok(EXTRACTION_TOOL.input_schema.properties.pages.items
    .properties.learners.items.properties.struckThrough)
})

test('the tool schema asks for exactly the fields the class list stores', () => {
  const props = EXTRACTION_TOOL.input_schema.properties.pages.items
    .properties.learners.items.properties
  const expected = [
    'learnerNumber', 'admissionNumber', 'fullName', 'gender',
    'parentPhone', 'admissionDate', 'struckThrough', 'confidence',
  ]
  assert.deepStrictEqual(Object.keys(props).sort(), expected.slice().sort())
})

test('only the name and a confidence are required of the model', () => {
  const required = EXTRACTION_TOOL.input_schema.properties.pages.items
    .properties.learners.items.required
  assert.deepStrictEqual(required, ['fullName', 'confidence'])
})

// ── image handling ───────────────────────────────────────────────

console.log('\nimage handling')

test('accepts supported images and pairs each with its page number', () => {
  const {content, accepted, rejected} = buildImageContent([
    {pageNumber: 1, dataUrl: png()},
    {pageNumber: 2, dataUrl: `data:image/jpeg;base64,${'A'.repeat(40)}`},
  ])
  assert.deepStrictEqual(accepted, [1, 2])
  assert.strictEqual(rejected.length, 0)
  assert.strictEqual(content.length, 4, 'a text label and an image per page')
  assert.strictEqual(content[0].text, 'Page 1')
  assert.strictEqual(content[1].type, 'image')
})

test('a rejected page is REPORTED, never silently dropped', () => {
  const {content, accepted, rejected} = buildImageContent([
    {pageNumber: 1, dataUrl: png()},
    {pageNumber: 2, dataUrl: 'data:application/pdf;base64,AAAA'},
    {pageNumber: 3, dataUrl: 'not a data url'},
    {pageNumber: 4, dataUrl: `data:image/tiff;base64,${'A'.repeat(20)}`},
  ])
  assert.deepStrictEqual(accepted, [1])
  assert.strictEqual(content.length, 2)
  assert.deepStrictEqual(rejected.map((r) => r.pageNumber), [2, 3, 4])
  assert.strictEqual(rejected[0].reason, 'not_an_image')
  assert.strictEqual(rejected[2].reason, 'unsupported_image_type')
})

test('an oversized image is rejected with its own reason', () => {
  const huge = 'A'.repeat(8 * 1024 * 1024)
  const {accepted, rejected} = buildImageContent([{pageNumber: 1, dataUrl: png(huge)}])
  assert.strictEqual(accepted.length, 0)
  assert.strictEqual(rejected[0].reason, 'image_too_large')
})

test('the per-call page cap is enforced here, not left to the model', () => {
  const pages = Array.from({length: 20}, (_, i) => ({pageNumber: i + 1, dataUrl: png()}))
  const {accepted} = buildImageContent(pages)
  assert.strictEqual(accepted.length, MAX_PAGES_PER_CALL)
})

test('no pages produces nothing rather than throwing', () => {
  assert.strictEqual(buildImageContent([]).content.length, 0)
  assert.strictEqual(buildImageContent(null).content.length, 0)
})

// ── parsing ──────────────────────────────────────────────────────

console.log('\nparsing the answer')

const GOOD = {
  pages: [{
    pageNumber: 1,
    readable: true,
    learners: [
      {learnerNumber: '1', admissionNumber: 'ADM-001', fullName: 'Alex Lobela', gender: 'M', parentPhone: '0977123456', admissionDate: '2026-01-12', confidence: 0.98},
      {fullName: 'Naomi Chipeta', gender: 'F', confidence: 0.62},
    ],
  }],
}

test('normalises a good answer into class-list rows', () => {
  const result = parseExtraction(GOOD, {requestedPages: [1]})
  assert.strictEqual(result.totalRows, 2)
  const [first, second] = result.pages[0].rows
  assert.strictEqual(first.admissionNumber, 'ADM-001')
  assert.strictEqual(first.admissionDate, '2026-01-12')
  assert.strictEqual(first.source, 'capture')
  assert.strictEqual(second.admissionNumber, null, 'an absent field stays absent')
  assert.strictEqual(second.learnerNumber, '')
  assert.strictEqual(result.pages[0].status, 'extracted')
})

test('a page the model could not read comes back FAILED, not empty', () => {
  const result = parseExtraction({
    pages: [{pageNumber: 1, readable: false, note: 'Too dark to read.', learners: []}],
  }, {requestedPages: [1]})
  assert.strictEqual(result.pages[0].status, 'failed')
  assert.strictEqual(result.pages[0].note, 'Too dark to read.')
})

test('a page the model simply omitted is a failure, not an empty page', () => {
  const result = parseExtraction(GOOD, {requestedPages: [1, 2, 3]})
  assert.strictEqual(result.pages.length, 3)
  assert.strictEqual(result.pages[1].status, 'failed')
  assert.strictEqual(result.pages[2].rows.length, 0)
})

test('a row with no name is dropped; it is not a learner', () => {
  const result = parseExtraction({
    pages: [{pageNumber: 1, readable: true, learners: [
      {fullName: '   ', confidence: 0.9},
      {fullName: 'Ruth Mwila', confidence: 0.9},
    ]}],
  }, {requestedPages: [1]})
  assert.strictEqual(result.totalRows, 1)
})

test('confidence is clamped and a missing one is not read as certainty', () => {
  const result = parseExtraction({
    pages: [{pageNumber: 1, readable: true, learners: [
      {fullName: 'A', confidence: 5},
      {fullName: 'B', confidence: -1},
      {fullName: 'C'},
      {fullName: 'D', confidence: 'very sure'},
    ]}],
  }, {requestedPages: [1]})
  const [a, b, c, d] = result.pages[0].rows
  assert.strictEqual(a.confidence, 1)
  assert.strictEqual(b.confidence, 0)
  assert.strictEqual(c.confidence, 0.5, 'no confidence must not become 1')
  assert.strictEqual(d.confidence, 0.5)
})

test('an unreadable date is left null rather than guessed at', () => {
  const result = parseExtraction({
    pages: [{pageNumber: 1, readable: true, learners: [
      {fullName: 'A', confidence: 1, admissionDate: '12/01/2026'},
      {fullName: 'B', confidence: 1, admissionDate: 'last term'},
    ]}],
  }, {requestedPages: [1]})
  assert.strictEqual(result.pages[0].rows[0].admissionDate, null)
  assert.strictEqual(result.pages[0].rows[1].admissionDate, null)
})

test('a gender outside M/F is recorded as unknown, not as "other"', () => {
  const result = parseExtraction({
    pages: [{pageNumber: 1, readable: true, learners: [{fullName: 'A', confidence: 1, gender: 'boy'}]}],
  }, {requestedPages: [1]})
  assert.strictEqual(result.pages[0].rows[0].gender, null)
})

test('a struck-out row survives with its flag', () => {
  const result = parseExtraction({
    pages: [{pageNumber: 1, readable: true, learners: [{fullName: 'Left Learner', confidence: 1, struckThrough: true}]}],
  }, {requestedPages: [1]})
  assert.strictEqual(result.pages[0].rows[0].struckThrough, true)
})

test('a malformed or missing answer fails every requested page', () => {
  const result = parseExtraction(null, {requestedPages: [1, 2]})
  assert.strictEqual(result.totalRows, 0)
  assert.ok(result.pages.every((p) => p.status === 'failed'))
})

// ── summary ──────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length > 0) {
  console.log('\nFailures:')
  failures.forEach((f) => console.log(`  - ${f.name}: ${f.message}`))
  process.exit(1)
}
