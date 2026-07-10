// Quiz display prefs — plain `node` assertion tests (no Firebase, no React).
// Run: node src/utils/quizDisplayPrefs.test.js
// Wired into test:all via the `test:quiz-display-prefs` npm script.

import assert from 'node:assert/strict'
import {
  DEFAULT_QUIZ_DISPLAY,
  normalizeQuizDisplayPrefs,
  resolveQuizDisplayVars,
  HIGHLIGHT_COLOURS,
  TEXT_SIZES,
  QUIZ_THEMES,
} from './quizDisplayPrefs.js'

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

// ── normalizeQuizDisplayPrefs ────────────────────────────────────────────
test('empty input returns the full default set', () => {
  assert.deepEqual(normalizeQuizDisplayPrefs(undefined), DEFAULT_QUIZ_DISPLAY)
  assert.deepEqual(normalizeQuizDisplayPrefs(null), DEFAULT_QUIZ_DISPLAY)
  assert.deepEqual(normalizeQuizDisplayPrefs({}), DEFAULT_QUIZ_DISPLAY)
})

test('garbage / out-of-range values fall back to defaults', () => {
  const out = normalizeQuizDisplayPrefs({
    textSize: 'gigantic',
    lineSpacing: 42,
    theme: 'neon',
    highlightColour: 'chartreuse',
    underlineStyle: 'wavy',
    dyslexiaFont: 'yes',
  })
  assert.equal(out.textSize, DEFAULT_QUIZ_DISPLAY.textSize)
  assert.equal(out.lineSpacing, DEFAULT_QUIZ_DISPLAY.lineSpacing)
  assert.equal(out.theme, DEFAULT_QUIZ_DISPLAY.theme)
  assert.equal(out.highlightColour, DEFAULT_QUIZ_DISPLAY.highlightColour)
  assert.equal(out.underlineStyle, DEFAULT_QUIZ_DISPLAY.underlineStyle)
  assert.equal(out.dyslexiaFont, false) // non-boolean rejected
})

test('valid values are preserved (round-trip)', () => {
  const input = {
    textSize: 'xlarge',
    lineSpacing: 'wide',
    theme: 'dark',
    highlightColour: 'blue',
    underlineStyle: 'double',
    dyslexiaFont: true,
    widerAnswerSpacing: true,
    largerAnswerLetters: true,
    reduceAnimations: true,
    readAloud: true,
    keepPassageOpen: true,
    showPassageLineNumbers: true,
  }
  assert.deepEqual(normalizeQuizDisplayPrefs(input), input)
})

test('every catalogue value normalises to itself', () => {
  for (const { value } of TEXT_SIZES) assert.equal(normalizeQuizDisplayPrefs({ textSize: value }).textSize, value)
  for (const { value } of QUIZ_THEMES) assert.equal(normalizeQuizDisplayPrefs({ theme: value }).theme, value)
  for (const { value } of HIGHLIGHT_COLOURS) assert.equal(normalizeQuizDisplayPrefs({ highlightColour: value }).highlightColour, value)
})

// ── resolveQuizDisplayVars ───────────────────────────────────────────────
test('resolves data attributes + highlight var from defaults', () => {
  const vars = resolveQuizDisplayVars({})
  assert.equal(vars.className, 'quiz-shell')
  assert.equal(vars['data-quiz-theme'], 'light')
  assert.equal(vars['data-quiz-size'], 'medium')
  assert.equal(vars['data-quiz-spacing'], 'comfortable')
  assert.equal(vars['data-quiz-underline'], 'solid')
  assert.equal(vars.style['--quiz-highlight'], '#ffe58a')
})

test('highlight colour maps to its hex swatch', () => {
  assert.equal(resolveQuizDisplayVars({ highlightColour: 'blue' }).style['--quiz-highlight'], '#bfe0ff')
  assert.equal(resolveQuizDisplayVars({ highlightColour: 'pink' }).style['--quiz-highlight'], '#ffd0e0')
})

test('ACCESSIBILITY: "none" underline never disables underlining', () => {
  // Must map to a visible style (solid), NOT text-decoration:none.
  assert.equal(resolveQuizDisplayVars({ underlineStyle: 'none' })['data-quiz-underline'], 'solid')
})

test('ACCESSIBILITY: "none" highlight falls back to system highlight (never hidden)', () => {
  const vars = resolveQuizDisplayVars({ highlightColour: 'none' })
  assert.equal(vars.style['--quiz-highlight'], '#ffe58a')
})

test('boolean prefs map to string data attributes', () => {
  const vars = resolveQuizDisplayVars({
    dyslexiaFont: true,
    widerAnswerSpacing: true,
    largerAnswerLetters: true,
    reduceAnimations: true,
  })
  assert.equal(vars['data-quiz-dyslexia'], 'true')
  assert.equal(vars['data-quiz-answer-space'], 'wide')
  assert.equal(vars['data-quiz-letters'], 'large')
  assert.equal(vars['data-quiz-reduce-motion'], 'true')
})

console.log(`✓ quizDisplayPrefs — ${passed} tests passed`)
