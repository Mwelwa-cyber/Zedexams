/**
 * Removing an option run that the stem duplicates — and, more importantly,
 * refusing to remove one it does not.
 *
 * Every "should not touch" case here is a real shape from the question bank: a
 * sequencing question whose stem legitimately lists labelled items, a stem
 * mentioning "Grade A", and a question whose inline run is the ONLY copy of its
 * choices (removing that one deletes the question).
 */

import assert from 'node:assert/strict'
import {
  STEM_SANITIZE,
  findInlineOptionRun,
  runDuplicatesOptions,
  sanitizePaperStems,
  sanitizeQuestionStem,
} from './inlineOptionStem.js'

/* ── Detection ───────────────────────────────────────────────────────────── */

const run = findInlineOptionRun('Which organ pumps blood? A. Lung B. Heart C. Liver D. Kidney')
assert.ok(run, 'a four-item run at the end of a stem is found')
assert.equal(run.items.length, 4)
assert.deepEqual(run.items.map((i) => i.text), ['Lung', 'Heart', 'Liver', 'Kidney'])
assert.equal(run.stem, 'Which organ pumps blood?')

// Other delimiters teachers and generators actually use.
assert.equal(findInlineOptionRun('Pick one: A) red B) blue C) green')?.items.length, 3)
assert.equal(findInlineOptionRun('Pick one: (A) red (B) blue (C) green')?.items.length, 3)
assert.equal(findInlineOptionRun('Pick one: A - red B - blue C - green')?.items.length, 3)

// Not runs.
assert.equal(findInlineOptionRun('A car is faster than a bicycle.'), null, 'one label is not a run')
assert.equal(findInlineOptionRun('She scored Grade A. The class average was lower.'), null)
assert.equal(findInlineOptionRun('Name the parts of a flower.'), null)
assert.equal(
  findInlineOptionRun('Which is heavier? B. iron C. wood D. paper'),
  null,
  'a run that does not start at A is not the option list',
)
assert.equal(findInlineOptionRun(''), null)

// A run whose items are prose-length is prose.
assert.equal(
  findInlineOptionRun(`Explain. A. ${'x'.repeat(210)} B. ${'y'.repeat(210)}`),
  null,
)

/* ── Duplication ─────────────────────────────────────────────────────────── */

const duped = findInlineOptionRun('Which organ pumps blood? A. Lung B. Heart C. Liver D. Kidney')
assert.equal(runDuplicatesOptions(duped, ['Lung', 'Heart', 'Liver', 'Kidney']), true)
assert.equal(runDuplicatesOptions(duped, ['Heart', 'Lung', 'Kidney', 'Liver']), true, 'order does not matter')
assert.equal(
  runDuplicatesOptions(duped, ['Lung', 'Heart', 'Liver']),
  false,
  'a run with an item the options do not have is not a duplicate of them',
)
assert.equal(runDuplicatesOptions(duped, []), false)

/* ── Sanitising a question ───────────────────────────────────────────────── */

const dirty = {
  text: 'Which organ pumps blood? A. Lung B. Heart C. Liver D. Kidney',
  options: ['Lung', 'Heart', 'Liver', 'Kidney'],
  correctAnswer: 1,
}
const cleaned = sanitizeQuestionStem(dirty)
assert.equal(cleaned.status, STEM_SANITIZE.REMOVED)
assert.equal(cleaned.text, 'Which organ pumps blood?')
assert.equal(cleaned.question.options.length, 4, 'the options are untouched')
assert.notEqual(cleaned.question, dirty, 'a change produces a new object')

// The run is the only copy of the choices. Removing it would delete the
// question's content, so nothing is removed and the caller is told why.
const onlyCopy = sanitizeQuestionStem({
  text: 'Which organ pumps blood? A. Lung B. Heart C. Liver D. Kidney',
  options: [],
})
assert.equal(onlyCopy.status, STEM_SANITIZE.NOT_DUPLICATE)
assert.equal(onlyCopy.text, 'Which organ pumps blood? A. Lung B. Heart C. Liver D. Kidney')

// A sequencing question whose stem IS the list.
const sequencing = sanitizeQuestionStem({
  text: 'Arrange in order: A. seed B. seedling C. tree',
  options: ['A, B, C', 'C, B, A', 'B, A, C'],
})
assert.equal(sequencing.status, STEM_SANITIZE.NOT_DUPLICATE)

// A clean question is returned by reference, so a migration can tell nothing
// happened without diffing.
const clean = { text: 'Which organ pumps blood?', options: ['Lung', 'Heart'] }
const untouched = sanitizeQuestionStem(clean)
assert.equal(untouched.status, STEM_SANITIZE.CLEAN)
assert.equal(untouched.question, clean)

/* ── HTML stems ──────────────────────────────────────────────────────────── */

const html = sanitizeQuestionStem({
  text: '<p>Which organ pumps blood?</p><p>A. Lung B. Heart C. Liver D. Kidney</p>',
  options: ['Lung', 'Heart', 'Liver', 'Kidney'],
})
assert.equal(html.status, STEM_SANITIZE.REMOVED)
assert.equal(html.text, '<p>Which organ pumps blood?</p>', 'the surviving markup is intact')

// The run shares a block with real content and the removal cannot be proven on
// the markup — reported for review rather than flattened to plain text.
const mixedBlock = sanitizeQuestionStem({
  text: '<p>Which organ pumps blood? <strong>A. Lung</strong> B. Heart C. Liver D. Kidney</p>',
  options: ['Lung', 'Heart', 'Liver', 'Kidney'],
})
assert.ok(
  mixedBlock.status === STEM_SANITIZE.NEEDS_REVIEW || mixedBlock.status === STEM_SANITIZE.REMOVED,
  'a straddling run is either removed provably or flagged — never silently mangled',
)
if (mixedBlock.status === STEM_SANITIZE.NEEDS_REVIEW) {
  assert.equal(mixedBlock.text, '<p>Which organ pumps blood? <strong>A. Lung</strong> B. Heart C. Liver D. Kidney</p>')
}

/* ── Whole-paper migration ───────────────────────────────────────────────── */

const paper = sanitizePaperStems([
  clean,
  dirty,
  { text: 'Arrange in order: A. seed B. seedling C. tree', options: ['A, B, C', 'C, B, A'] },
])
assert.equal(paper.changed, true)
assert.equal(paper.report.removed.length, 1)
assert.equal(paper.report.removed[0].index, 1)
assert.equal(paper.report.notDuplicate.length, 1)
assert.equal(paper.questions[0], clean, 'unchanged questions keep their identity')
assert.equal(paper.questions[1].text, 'Which organ pumps blood?')

// An empty paper migrates to an empty paper rather than throwing.
assert.deepEqual(sanitizePaperStems([]).questions, [])
assert.equal(sanitizePaperStems(null).changed, false)

console.log('inlineOptionStem: all assertions passed')
