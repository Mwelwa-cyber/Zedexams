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
  blockPlacement,
  planNoteView,
  buildNoteSearchText,
  matchesNoteSearch,
  PLACEMENT,
  normalizeKeyword,
  buildGlossary,
  tokenizeInline,
  plainInline,
  assignRevealSteps,
  visibleAtStep,
  readerMeta,
  reviseMinutes,
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

// ── Modes: one content source, two views ─────────────────────────────
test('Learn hides keypoints; Revise hoists them', () => {
  assert.equal(blockPlacement('keypoints', 'learn'), PLACEMENT.HIDDEN)
  assert.equal(blockPlacement('keypoints', 'revise'), PLACEMENT.TOP)
  assert.equal(blockVisibleInMode('keypoints', 'learn'), false)
  assert.equal(blockVisibleInMode('keypoints', 'revise'), true)
})

test('Revise collapses the exercises rather than deleting them', () => {
  for (const t of ['practice', 'sectioncheck']) {
    assert.equal(blockPlacement(t, 'learn'), PLACEMENT.MAIN, t)
    assert.equal(blockPlacement(t, 'revise'), PLACEMENT.PRACTICE, t)
    // Collapsed is not "on the page": the revise-time estimate must not
    // charge the learner for an accordion they never opened.
    assert.equal(blockVisibleInMode(t, 'revise'), false, t)
  }
})

test('Revise hides the assessment surfaces outright', () => {
  for (const t of ['quiz', 'labeldiagram']) {
    assert.equal(blockPlacement(t, 'learn'), PLACEMENT.MAIN, t)
    assert.equal(blockPlacement(t, 'revise'), PLACEMENT.HIDDEN, t)
  }
})

test('tap-to-reveal cards read in both modes', () => {
  // `quickcheck` is a reveal card, not an exercise — Revise keeps it and
  // shows it open (the engine passes `revealed`), because revision must
  // not make a learner re-earn an answer they already worked through.
  assert.equal(blockPlacement('quickcheck', 'learn'), PLACEMENT.MAIN)
  assert.equal(blockPlacement('quickcheck', 'revise'), PLACEMENT.MAIN)
})

test('content blocks read in both modes', () => {
  for (const t of ['paragraph', 'heading', 'tip', 'keyterms', 'tapexplore', 'flow']) {
    assert.equal(blockVisibleInMode(t, 'learn'), true, t)
    assert.equal(blockVisibleInMode(t, 'revise'), true, t)
  }
})

// ── planNoteView ─────────────────────────────────────────────────────
const TWO_VIEW_BLOCKS = [
  { type: 'paragraph', text: 'Intro' },
  { type: 'heading', level: 2, text: 'One' },
  { type: 'paragraph', text: 'Body one' },
  { type: 'practice', q: 'p', options: [] },
  { type: 'heading', level: 2, text: 'Two' },
  { type: 'sectioncheck', q: 'c', options: [] },
  { type: 'keypoints', items: ['Photosynthesis needs sunlight'] },
  { type: 'quiz', quizId: 'q1' },
]

test('planNoteView: Learn places everything but the key points in the body', () => {
  const plan = planNoteView(TWO_VIEW_BLOCKS, 'learn')
  assert.equal(plan.top.length, 0)
  assert.equal(plan.practice.length, 0)
  assert.equal(plan.main.length, TWO_VIEW_BLOCKS.length - 1) // keypoints hidden
  assert.equal(plan.maxStep, 2)
  assert.ok(!plan.main.some((e) => e.block.type === 'keypoints'))
})

test('planNoteView: Revise hoists, collapses and hides — same blocks', () => {
  const plan = planNoteView(TWO_VIEW_BLOCKS, 'revise')
  assert.deepEqual(plan.top.map((e) => e.block.type), ['keypoints'])
  assert.deepEqual(plan.practice.map((e) => e.block.type), ['practice', 'sectioncheck'])
  assert.deepEqual(plan.main.map((e) => e.block.type), ['paragraph', 'heading', 'paragraph', 'heading'])
  // Every authored block is accounted for: placed somewhere, or the one
  // type Revise deliberately drops. Nothing is invented, nothing is lost.
  const placed = [...plan.top, ...plan.main, ...plan.practice].length
  assert.equal(placed, TWO_VIEW_BLOCKS.length - 1) // the quiz is hidden
})

test('planNoteView: section numbers are the same in both doorways', () => {
  const nums = (mode) =>
    planNoteView(TWO_VIEW_BLOCKS, mode).main
      .filter((e) => e.sectionNumber != null)
      .map((e) => e.sectionNumber)
  assert.deepEqual(nums('learn'), [1, 2])
  assert.deepEqual(nums('revise'), [1, 2])
})

test('planNoteView: steps let Learn pace the body one section at a time', () => {
  const plan = planNoteView(TWO_VIEW_BLOCKS, 'learn')
  const atStep = (n) => plan.main.filter((e) => e.step <= n).map((e) => e.block.type)
  assert.deepEqual(atStep(0), ['paragraph'])
  assert.deepEqual(atStep(1), ['paragraph', 'heading', 'paragraph', 'practice'])
  assert.equal(atStep(2).length, plan.main.length)
})

test('planNoteView survives a malformed note', () => {
  const plan = planNoteView([null, undefined, { type: 'paragraph', text: 'x' }], 'revise')
  assert.equal(plan.main.length, 1)
  assert.deepEqual(planNoteView(null, 'learn'), { top: [], main: [], practice: [], maxStep: 0 })
})

// ── Hub search ───────────────────────────────────────────────────────
test('buildNoteSearchText indexes title, subject, headings and key points', () => {
  const text = buildNoteSearchText(
    { title: 'The Digestive System', subject: 'Science' },
    TWO_VIEW_BLOCKS,
  )
  assert.ok(text.includes('digestive system'))
  assert.ok(text.includes('science'))
  assert.ok(text.includes('one'))          // heading
  assert.ok(text.includes('photosynthesis')) // key point — the acceptance check
  assert.ok(!text.includes('Body one'))    // body prose is deliberately out
  assert.equal(text, text.toLowerCase())
})

test('buildNoteSearchText strips inline marks so a keyword still matches', () => {
  const text = buildNoteSearchText({ title: 'T' }, [
    { type: 'keypoints', items: ['A **[[conjunction]]** joins two ideas'] },
  ])
  assert.ok(text.includes('conjunction joins two ideas'))
  assert.ok(!text.includes('[['))
})

test('matchesNoteSearch requires every term (AND), in any order', () => {
  const hay = buildNoteSearchText({ title: 'Digestive System', subject: 'Science' }, [])
  assert.equal(matchesNoteSearch(hay, ''), true)
  assert.equal(matchesNoteSearch(hay, 'digestive'), true)
  assert.equal(matchesNoteSearch(hay, 'science digestive'), true)
  assert.equal(matchesNoteSearch(hay, 'digestive science'), true)
  assert.equal(matchesNoteSearch(hay, 'digestive maths'), false)
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

test('reviseMinutes counts only revise-visible blocks and never reports zero', () => {
  const longText = Array.from({ length: 360 }, () => 'word').join(' ') // ≈2 min at 180wpm
  // Practice is revision-hidden — a note that is mostly exercises still
  // revises quickly; keypoints are what the pass actually reads.
  const minutes = reviseMinutes([
    { type: 'keypoints', items: [longText] },
    { type: 'practice', q: longText, options: [] },
  ])
  assert.equal(minutes, 2)
  assert.equal(reviseMinutes([]), 1)
  assert.ok(reviseMinutes([{ type: 'practice', q: longText, options: [] }]) === 1)
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
