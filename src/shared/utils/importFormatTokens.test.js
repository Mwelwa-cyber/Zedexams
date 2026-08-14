// Import format tokens — plain `node` assertion tests (no DOM).
// Run: node src/shared/utils/importFormatTokens.test.js
// Wired into test:all via the `test:import-format-tokens` npm script.

import assert from 'node:assert/strict'
import {
  hasFormatTokens,
  stripFormatTokens,
  wrapFormattedPieces,
  fixLeadingStructuralTokens,
  formatTokensToHtml,
  formatTokensToInlineHtml,
} from './importFormatTokens.js'

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

/* ── detection / stripping ─────────────────────────────────────────────── */

test('hasFormatTokens detects each token type', () => {
  for (const t of ['b', 'u', 'i', 'hl', 'sup', 'sub']) {
    assert.equal(hasFormatTokens(`x [[${t}]]y[[/${t}]]`), true, t)
  }
  assert.equal(hasFormatTokens('plain text with [brackets] and [[vmath op=+]]'), false)
})

test('stripFormatTokens removes tokens, keeps content', () => {
  assert.equal(
    stripFormatTokens('What does the [[u]]underlined[[/u]] word mean?'),
    'What does the underlined word mean?'
  )
})

/* ── wrapFormattedPieces ───────────────────────────────────────────────── */

test('wraps a partially-formatted run in tokens', () => {
  const out = wrapFormattedPieces([
    { text: 'The boy was ', formats: null },
    { text: 'exhausted', formats: { b: true } },
    { text: ' after the race.', formats: null },
  ])
  assert.equal(out, 'The boy was [[b]]exhausted[[/b]] after the race.')
})

test('paragraph-coverage rule: fully-bold paragraph drops the bold', () => {
  const out = wrapFormattedPieces([
    { text: 'SECTION A: ', formats: { b: true } },
    { text: 'ENGLISH', formats: { b: true } },
  ])
  assert.equal(out, 'SECTION A: ENGLISH')
})

test('coverage rule drops only the covering format, keeps partial ones', () => {
  const out = wrapFormattedPieces([
    { text: 'All bold ', formats: { b: true } },
    { text: 'and underlined', formats: { b: true, u: true } },
  ])
  assert.equal(out, 'All bold [[u]]and underlined[[/u]]')
})

test('adjacent identically-formatted runs merge into one token pair', () => {
  const out = wrapFormattedPieces([
    { text: 'under', formats: { u: true } },
    { text: 'lined', formats: { u: true } },
    { text: ' word', formats: null },
  ])
  assert.equal(out, '[[u]]underlined[[/u]] word')
})

test('multiple formats nest in a stable order', () => {
  const out = wrapFormattedPieces([
    { text: 'word', formats: { u: true, b: true } },
    { text: ' plain', formats: null },
  ])
  assert.equal(out, '[[b]][[u]]word[[/u]][[/b]] plain')
})

test('whitespace-only pieces are never wrapped', () => {
  const out = wrapFormattedPieces([
    { text: 'a', formats: { b: true } },
    { text: ' ', formats: { u: true } },
    { text: 'b', formats: null },
  ])
  assert.equal(out, '[[b]]a[[/b]] b')
})

test('superscript/subscript survive (never coverage-dropped in mixed text)', () => {
  const out = wrapFormattedPieces([
    { text: 'H', formats: null },
    { text: '2', formats: { sub: true } },
    { text: 'O and x', formats: null },
    { text: '2', formats: { sup: true } },
  ])
  assert.equal(out, 'H[[sub]]2[[/sub]]O and x[[sup]]2[[/sup]]')
})

/* ── fixLeadingStructuralTokens ────────────────────────────────────────── */

test('drops formatting that wraps only a question-number prefix', () => {
  assert.equal(
    fixLeadingStructuralTokens('[[b]]1.[[/b]] What is soil erosion?'),
    '1. What is soil erosion?'
  )
})

test('drops formatting that wraps only an option-letter prefix', () => {
  assert.equal(fixLeadingStructuralTokens('[[b]]A.[[/b]] dog'), 'A. dog')
})

test('moves formatting past the prefix when it spans into the text', () => {
  assert.equal(
    fixLeadingStructuralTokens('[[b]]2. Choose[[/b]] the answer'),
    '2. [[b]]Choose[[/b]] the answer'
  )
})

test('handles the PRISCA tab form', () => {
  assert.equal(fixLeadingStructuralTokens('[[b]]1[[/b]]\tWhich planet…'), '1\tWhich planet…')
})

test('lines without structural prefixes are untouched', () => {
  const s = '[[u]]Read[[/u]] the passage below.'
  assert.equal(fixLeadingStructuralTokens(s), s)
})

test('applies per line in multi-line text', () => {
  const out = fixLeadingStructuralTokens('[[b]]A.[[/b]] cat\n[[b]]B.[[/b]] dog')
  assert.equal(out, 'A. cat\nB. dog')
})

/* ── formatTokensToHtml ────────────────────────────────────────────────── */

test('converts tokens to the sanctioned editor tags', () => {
  assert.equal(
    formatTokensToHtml('What does the [[u]]underlined[[/u]] word mean?'),
    '<p>What does the <u>underlined</u> word mean?</p>'
  )
  assert.equal(
    formatTokensToHtml('Choose the [[hl]]highlighted[[/hl]] word.'),
    '<p>Choose the <mark>highlighted</mark> word.</p>'
  )
  assert.equal(
    formatTokensToHtml('H[[sub]]2[[/sub]]O and x[[sup]]2[[/sup]]'),
    '<p>H<sub>2</sub>O and x<sup>2</sup></p>'
  )
})

test('nested tokens produce nested tags', () => {
  assert.equal(
    formatTokensToHtml('[[b]][[u]]word[[/u]][[/b]]'),
    '<p><strong><u>word</u></strong></p>'
  )
})

test('plain text without tokens is returned unchanged (no <p> wrap)', () => {
  const s = 'Which city is the capital of Zambia?'
  assert.equal(formatTokensToHtml(s), s)
  assert.equal(formatTokensToHtml(''), '')
})

test('escapes HTML in the surrounding text', () => {
  const out = formatTokensToHtml('Is 5 < 7? The [[b]]answer[[/b]] & more')
  assert.equal(out, '<p>Is 5 &lt; 7? The <strong>answer</strong> &amp; more</p>')
})

test('paragraph breaks and line breaks are preserved', () => {
  const out = formatTokensToHtml('The [[b]]boy[[/b]] ran.\n\nWhat does the bold word mean?')
  assert.equal(out, '<p>The <strong>boy</strong> ran.</p><p>What does the bold word mean?</p>')
  const br = formatTokensToHtml('Line [[i]]one[[/i]]\nLine two')
  assert.equal(br, '<p>Line <em>one</em><br>Line two</p>')
})

test('stray close token is dropped; unclosed open auto-closes at line end', () => {
  assert.equal(formatTokensToHtml('a [[/b]]b [[u]]c'), '<p>a b <u>c</u></p>')
})

test('conversion is idempotent-safe (converted HTML has no tokens left)', () => {
  const once = formatTokensToHtml('The [[b]]word[[/b]]')
  assert.equal(hasFormatTokens(once), false)
  assert.equal(formatTokensToHtml(once), once)
})

/* ── tab-inside-token prefixes (PSLE answer-key DOCX layout) ───────────── */

test('frees "[[b]]1\\t[[/b]]stem" — tab INSIDE the bold run', () => {
  assert.equal(
    fixLeadingStructuralTokens('[[b]]1\t[[/b]]… people have died of COVID 19.'),
    '1\t… people have died of COVID 19.'
  )
})

test('frees "[[b]]A\\t[[/b]]option" — bold option label with inner tab', () => {
  assert.equal(
    fixLeadingStructuralTokens('[[b]]A\t[[/b]]Small'),
    'A\tSmall'
  )
})

test('moves opens past "[[b]]A\\tword[[/b]]" (bold spans past the label)', () => {
  assert.equal(
    fixLeadingStructuralTokens('[[b]]A\tSmall[[/b]]'),
    'A\t[[b]]Small[[/b]]'
  )
})

/* ── answer / explanation marker lines ─────────────────────────────────── */

test('answer-marker line is fully unwrapped so ANSWER_RE can match', () => {
  assert.equal(
    fixLeadingStructuralTokens('[[b]]Answer: C — Many[[/b]][[i]] ‘Many’ goes with plural nouns.[[/i]]'),
    'Answer: C — Many ‘Many’ goes with plural nouns.'
  )
})

test('explanation-marker line is fully unwrapped', () => {
  assert.equal(
    fixLeadingStructuralTokens('[[b]]Explanation:[[/b]] [[i]]shows contrast.[[/i]]'),
    'Explanation: shows contrast.'
  )
})

test('a passage sentence starting with "Because" (no colon) keeps its tokens', () => {
  const line = 'Because the [[u]]chief[[/u]] was furious, he ordered an arrest.'
  assert.equal(fixLeadingStructuralTokens(line), line)
})

/* ── formatTokensToInlineHtml ──────────────────────────────────────────── */

test('inline option conversion (no paragraph wrap)', () => {
  assert.equal(formatTokensToInlineHtml('a [[b]]bold[[/b]] option'), 'a <strong>bold</strong> option')
  assert.equal(formatTokensToInlineHtml('117 kg'), '117 kg')
})

console.log(`✓ importFormatTokens — ${passed} tests passed`)
