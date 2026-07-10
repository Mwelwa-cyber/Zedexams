// readAloudText — plain `node` assertion tests (no React, no DOM).
// Run: node src/utils/readAloudText.test.js
// Wired into test:all via the `test:read-aloud-text` npm script.

import assert from 'node:assert/strict'
import { toSpokenText, optionsToReadAloudText, questionToReadAloudText } from './readAloudText.js'

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
  } catch (err) {
    console.error(`✗ ${name}`)
    throw err
  }
}

// ── toSpokenText ─────────────────────────────────────────────────────────
test('plain string passes through, whitespace normalised', () => {
  assert.equal(toSpokenText('  The  boy   ran  '), 'The boy ran')
})

test('legacy HTML tags are stripped (never spoken aloud)', () => {
  assert.equal(toSpokenText('<p>The <strong>capital</strong> of <u>Zambia</u></p>'), 'The capital of Zambia')
})

test('HTML entities are decoded', () => {
  assert.equal(toSpokenText('<p>Tom &amp; Jerry &lt;3</p>'), 'Tom & Jerry <3')
})

test('a Tiptap doc extracts readable text', () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] }] }
  assert.equal(toSpokenText(doc), 'Hello world')
})

test('empty / nullish values return empty string', () => {
  assert.equal(toSpokenText(''), '')
  assert.equal(toSpokenText(null), '')
  assert.equal(toSpokenText(undefined), '')
})

// ── optionsToReadAloudText ───────────────────────────────────────────────
test('labels options in order', () => {
  assert.equal(
    optionsToReadAloudText(['soil erosion', 'noise pollution', 'floods', 'diseases']),
    'Option A: soil erosion. Option B: noise pollution. Option C: floods. Option D: diseases'
  )
})

test('blank options are skipped, not labelled', () => {
  assert.equal(optionsToReadAloudText(['red', '', 'blue']), 'Option A: red. Option C: blue')
})

test('non-array input returns empty string', () => {
  assert.equal(optionsToReadAloudText(null), '')
  assert.equal(optionsToReadAloudText(undefined), '')
})

// ── questionToReadAloudText ──────────────────────────────────────────────
test('joins shared instruction + stem', () => {
  const q = { sharedInstruction: '<p>Read the passage.</p>', text: 'What is the theme?' }
  assert.equal(questionToReadAloudText(q), 'Read the passage. What is the theme?')
})

test('stem only when no shared instruction', () => {
  assert.equal(questionToReadAloudText({ text: 'Name the capital.' }), 'Name the capital.')
})

console.log(`✓ readAloudText — ${passed} tests passed`)
