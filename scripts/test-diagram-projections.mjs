/**
 * Tests for Diagram Library render-time projections (Visual Studio v2 1A/1B):
 * reading-order lettering, version projections, alphabetical word bank,
 * answer-key legend and the learner drag-the-label contract.
 */
import assert from 'node:assert'
import {
  readingOrder, letteredLabels, displayTextForVersion, wordBank,
  answerKeyLines, projectDiagram, dragTheLabelZones, READING_ROW_TOLERANCE,
} from '../src/features/visualStudio/lib/diagramProjections.js'

const L = (id, word, x, y) => ({ id, word, anchor: { x, y }, box: { x, y } })

// Reading order: top→bottom, left→right within a row.
{
  const labels = [
    L('c', 'Lungs', 0.2, 0.8),
    L('a', 'Nose', 0.6, 0.1),
    L('b', 'Trachea', 0.1, 0.1 + READING_ROW_TOLERANCE / 2), // same visual row as Nose, further left
  ]
  const ordered = readingOrder(labels)
  assert.deepEqual(ordered.map((l) => l.id), ['b', 'a', 'c'], 'row tolerance letters left→right')
  // Input untouched.
  assert.deepEqual(labels.map((l) => l.id), ['c', 'a', 'b'])
}

// Letters derive from reading order but come back in INPUT order.
{
  const labels = [L('low', 'Roots', 0.5, 0.9), L('high', 'Leaf', 0.5, 0.1)]
  const lettered = letteredLabels(labels)
  assert.deepEqual(lettered.map((l) => l.id), ['low', 'high'], 'input order preserved')
  assert.equal(lettered.find((l) => l.id === 'high').letter, 'P', 'topmost label is P')
  assert.equal(lettered.find((l) => l.id === 'low').letter, 'Q')
  assert.equal(labels[0].letter, undefined, 'input not mutated')
}

// Deleting a label re-letters with no gap or duplicate (letters never stored).
{
  const labels = [L('a', 'Nose', 0.5, 0.1), L('b', 'Trachea', 0.5, 0.4), L('c', 'Lungs', 0.5, 0.7)]
  const before = letteredLabels(labels).map((l) => l.letter)
  assert.deepEqual(before, ['P', 'Q', 'R'])
  const after = letteredLabels(labels.filter((l) => l.id !== 'b')).map((l) => l.letter)
  assert.deepEqual(after, ['P', 'Q'], 'no skipped letter after delete')
}

// Version display text.
{
  const [l] = letteredLabels([L('a', 'Stomach', 0.5, 0.5)])
  assert.equal(displayTextForVersion(l, 'teacher'), 'Stomach')
  assert.equal(displayTextForVersion(l, 'learner'), 'P')
  assert.equal(displayTextForVersion(l, 'answerKey'), 'P')
  assert.equal(displayTextForVersion(l, 'picture'), '')
}

// Word bank: lowercase, alphabetical, de-duplicated — never anchor order.
{
  const labels = [
    L('a', 'Stomach', 0.5, 0.9),
    L('b', 'Liver', 0.5, 0.1),
    L('c', 'stomach', 0.5, 0.5),
    L('d', '  ', 0.5, 0.6),
  ]
  assert.deepEqual(wordBank(labels), ['liver', 'stomach'])
}

// Answer key follows reading (letter) order and skips blank words.
{
  const labels = [L('a', 'Roots', 0.5, 0.9), L('b', 'Leaf', 0.5, 0.1), L('c', '', 0.5, 0.5)]
  assert.deepEqual(answerKeyLines(labels), ['P = Leaf', 'R = Roots'])
}

// projectDiagram: one object per version.
{
  const labels = [L('a', 'Leaf', 0.5, 0.1), L('b', 'Roots', 0.5, 0.9)]
  const learner = projectDiagram(labels, 'learner')
  assert.equal(learner.labels[0].display, 'P')
  assert.deepEqual(learner.wordBank, ['leaf', 'roots'])
  assert.deepEqual(learner.answerKey, [])
  assert.deepEqual(learner.blankLetters, ['P', 'Q'])

  const key = projectDiagram(labels, 'answerKey')
  assert.deepEqual(key.answerKey, ['P = Leaf', 'Q = Roots'])
  assert.deepEqual(key.wordBank, [], 'word bank is learner-only')

  const teacher = projectDiagram(labels, 'teacher')
  assert.equal(teacher.labels[0].display, 'Leaf')
  assert.deepEqual(teacher.blankLetters, [])

  const picture = projectDiagram(labels, 'picture')
  assert.ok(picture.labels.every((l) => l.display === ''), 'picture version shows nothing')

  // Unknown version falls back to teacher rather than throwing.
  assert.equal(projectDiagram(labels, 'nope').version, 'teacher')
}

// Learner drag-the-label contract: zones carry anchors + words; tokens are
// alphabetical so the token strip doesn't leak the answer order.
{
  const labels = [L('a', 'Stomach', 0.4, 0.6), L('b', 'Liver', 0.3, 0.2), L('c', '', 0.9, 0.9)]
  const { zones, tokens } = dragTheLabelZones(labels)
  assert.equal(zones.length, 2, 'blank-word labels are not drop zones')
  assert.deepEqual(zones.map((z) => z.word), ['Liver', 'Stomach'], 'zones in reading order')
  assert.deepEqual(zones[0].anchor, { x: 0.3, y: 0.2 })
  assert.deepEqual(tokens, ['liver', 'stomach'])
}

console.log('test-diagram-projections: all assertions passed')
