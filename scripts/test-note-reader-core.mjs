/**
 * Tests for src/features/notes/reader/readerCore.js — the pure logic of
 * the prototype-v3 note reader engine (learner redesign step 3): the
 * reader-note gate, mode visibility, keyword tokenizing/glossary,
 * paced-reveal steps, label-diagram scoring, and the meta estimate.
 */
import assert from 'node:assert/strict'
import {
  READER_BLOCK_TYPES,
  isReaderNote,
  blockVisibleInMode,
  normalizeKeyword,
  buildGlossary,
  tokenizeInline,
  plainInline,
  assignRevealSteps,
  visibleAtStep,
  readerMeta,
  scoreLabelPlacement,
  labelSlotKey,
  labelBankOrder,
  scrollProgress,
} from '../src/features/notes/reader/readerCore.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ok  ${name}`)
}

// ── Gate ─────────────────────────────────────────────────────────────
test('isReaderNote: true only when an interactive reader block is present', () => {
  assert.equal(isReaderNote([{ type: 'paragraph', text: 'x' }]), false)
  assert.equal(isReaderNote([{ type: 'paragraph', text: 'x' }, { type: 'practice', q: '', options: [] }]), true)
  assert.equal(isReaderNote([{ type: 'glossary', entries: [] }]), true)
  assert.equal(isReaderNote([]), false)
  assert.equal(isReaderNote(null), false)
})

test('every reader block type gates the note into the engine', () => {
  for (const type of READER_BLOCK_TYPES) {
    assert.equal(isReaderNote([{ type }]), true, type)
  }
})

// ── Modes ────────────────────────────────────────────────────────────
test('Learn hides keypoints; Revise hides the practice surfaces', () => {
  assert.equal(blockVisibleInMode('keypoints', 'learn'), false)
  assert.equal(blockVisibleInMode('keypoints', 'revise'), true)
  for (const t of ['practice', 'sectioncheck', 'quickcheck', 'labeldiagram']) {
    assert.equal(blockVisibleInMode(t, 'learn'), true, t)
    assert.equal(blockVisibleInMode(t, 'revise'), false, t)
  }
  for (const t of ['paragraph', 'heading', 'tip', 'keyterms']) {
    assert.equal(blockVisibleInMode(t, 'learn'), true, t)
    assert.equal(blockVisibleInMode(t, 'revise'), true, t)
  }
})

// ── Keywords ─────────────────────────────────────────────────────────
test('normalizeKeyword folds case and ellipsis spacing', () => {
  assert.equal(normalizeKeyword('Either…or'), 'either … or')
  assert.equal(normalizeKeyword('  SO  '), 'so')
  assert.equal(normalizeKeyword('not  only …  but also'), 'not only … but also')
})

test('buildGlossary indexes entries by normalised word', () => {
  const g = buildGlossary([
    { type: 'paragraph', text: 'x' },
    { type: 'glossary', entries: [{ word: 'Because', meaning: 'gives the reason' }] },
    { type: 'glossary', entries: [{ word: 'either … or', meaning: 'a choice pair' }] },
  ])
  assert.equal(g.get('because').meaning, 'gives the reason')
  assert.equal(g.get(normalizeKeyword('Either…Or')).meaning, 'a choice pair')
  assert.equal(g.size, 2)
})

test('tokenizeInline splits text, bold and keyword marks', () => {
  assert.deepEqual(tokenizeInline('A [[conjunction]] is a **joining word**.'), [
    { t: 'text', v: 'A ' },
    { t: 'kw', v: 'conjunction' },
    { t: 'text', v: ' is a ' },
    { t: 'bold', v: 'joining word' },
    { t: 'text', v: '.' },
  ])
  assert.deepEqual(tokenizeInline('plain'), [{ t: 'text', v: 'plain' }])
  assert.deepEqual(tokenizeInline(''), [])
  assert.equal(plainInline('**b** and [[kw]]'), 'b and kw')
})

// ── Paced reveal ─────────────────────────────────────────────────────
test('assignRevealSteps breaks at level-2 headings; intro is step 0', () => {
  const blocks = [
    { type: 'paragraph', text: 'intro' },
    { type: 'heading', level: 2, text: 'One' },
    { type: 'paragraph', text: 'a' },
    { type: 'heading', level: 3, text: 'sub' }, // level 3 never breaks
    { type: 'heading', level: 2, text: 'Two' },
    { type: 'sectioncheck', q: 'x', options: [], remediation: { explain: '', retryQ: '', retryOptions: [] } },
  ]
  const { steps, maxStep } = assignRevealSteps(blocks)
  assert.deepEqual(steps, [0, 1, 1, 1, 2, 2])
  assert.equal(maxStep, 2)
  assert.equal(visibleAtStep(blocks, steps, 0).length, 1)
  assert.equal(visibleAtStep(blocks, steps, 1).length, 4)
  assert.equal(visibleAtStep(blocks, steps, 2).length, 6)
})

// ── Meta ─────────────────────────────────────────────────────────────
test('readerMeta counts sections and never reports zero minutes', () => {
  const meta = readerMeta([
    { type: 'heading', level: 2, text: 'One' },
    { type: 'paragraph', text: 'short text here' },
    { type: 'practice', q: 'q', options: [] },
  ])
  assert.equal(meta.sections, 1)
  assert.ok(meta.minutes >= 1)
  assert.deepEqual(readerMeta([]), { minutes: 1, sections: 1 })
})

// ── Label diagram ────────────────────────────────────────────────────
const ITEMS = [
  { key: 'mouth', label: 'Mouth', x: 0.2, y: 0.2 },
  { key: 'liver', label: 'Liver', x: 0.1, y: 0.5 },
  { key: 'anus', label: 'Anus', x: 0.8, y: 0.9 },
]

test('scoreLabelPlacement judges only placed slots and detects perfection', () => {
  let r = scoreLabelPlacement(ITEMS, { mouth: 'Mouth' })
  assert.deepEqual({ placed: r.placed, correct: r.correct, total: r.total, perfect: r.perfect }, { placed: 1, correct: 1, total: 3, perfect: false })
  r = scoreLabelPlacement(ITEMS, { mouth: 'Mouth', liver: 'Anus', anus: 'Liver' })
  assert.equal(r.correct, 1)
  assert.equal(r.verdicts.liver, false)
  r = scoreLabelPlacement(ITEMS, { mouth: 'Mouth', liver: 'Liver', anus: 'Anus' })
  assert.equal(r.perfect, true)
})

test('labelSlotKey falls back to the label; bank order is alphabetical (never slot order)', () => {
  assert.equal(labelSlotKey({ key: 'k', label: 'L' }), 'k')
  assert.equal(labelSlotKey({ label: 'L' }), 'L')
  assert.deepEqual(labelBankOrder(ITEMS), ['Anus', 'Liver', 'Mouth'])
})

// ── Progress ─────────────────────────────────────────────────────────
test('scrollProgress clamps to 0–100 and survives a zero-height page', () => {
  assert.equal(scrollProgress(0, 1000), 0)
  assert.equal(scrollProgress(500, 1000), 50)
  assert.equal(scrollProgress(2000, 1000), 100)
  assert.equal(scrollProgress(10, 0), 0)
  assert.equal(scrollProgress(NaN, 100), 0)
})

console.log(`\n✓ note-reader-core — ${passed} tests passed`)
