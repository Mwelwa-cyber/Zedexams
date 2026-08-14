/**
 * Grouping-integrity test for the scanned-paper importer.
 *
 * Guards the spec's rule: "Everything belonging to a question must stay
 * together — images, diagrams, tables, passages, answer spaces and
 * subquestions must never become separated or assigned to the wrong question,"
 * including when a paper spans several pages. Runs a mixed multi-page paper
 * (a comprehension passage + questions on page 1, a diagram question + a
 * table question under a new section on page 2) through the pure pipeline and
 * asserts nothing drifts.
 *
 * Run: node scripts/test-grouping-integrity.mjs
 */

import assert from 'node:assert'
import {
  visionSectionsToLocal,
  groupSectionsIntoParts,
} from '../src/services/quizImport/scannedQuizImporter.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

console.log('grouping-integrity')

// A raw vision result: page 1 has a comprehension passage with 2 questions under
// "Section A"; page 2 has a diagram question and a table question under
// "Section B". Diagrams are described (not cropped — that's the DOM pass).
// Shape mirrors the server-normalised sections the client consumes: questions
// carry `text`, `type`, 1-based `sourcePage`, and `diagrams`.
const rawSections = [
  {
    kind: 'passage',
    passageKind: 'comprehension',
    title: 'The Market',
    passageText: 'Chanda went to the market...',
    sourcePage: 1,
    questions: [
      { text: 'Where did Chanda go?', options: [], type: 'short_answer', sourceQuestionNumber: 1, sectionTitle: 'Section A', sourcePage: 1 },
      { text: 'What did she buy?', options: [], type: 'short_answer', sourceQuestionNumber: 2, sectionTitle: 'Section A', sourcePage: 1 },
    ],
  },
  {
    kind: 'standalone',
    question: {
      text: 'Label the parts of the plant.',
      options: [],
      type: 'diagram_label',
      sourceQuestionNumber: 3,
      sectionTitle: 'Section B',
      sourcePage: 2,
      hasDiagram: true,
      diagrams: [{ box: { x: 0.1, y: 0.2, w: 0.4, h: 0.4 }, kind: 'plant', confidence: 0.9 }],
      diagramLabels: ['roots', 'stem', 'leaf'],
    },
  },
  {
    kind: 'standalone',
    question: {
      text: 'Study the table and answer.',
      options: [],
      type: 'short_answer',
      sourceQuestionNumber: 4,
      sectionTitle: 'Section B',
      sourcePage: 2,
      hasDiagram: true,
      diagrams: [{ box: { x: 0.1, y: 0.5, w: 0.6, h: 0.3 }, kind: 'table', confidence: 0.92 }],
    },
  },
]

const { sections } = visionSectionsToLocal(rawSections, {}, {})

test('the passage keeps BOTH its questions, in order, on its page', () => {
  const passage = sections.find((s) => s.kind === 'passage')
  assert.ok(passage, 'passage section present')
  const qs = passage.passage.questions
  assert.equal(qs.length, 2)
  assert.equal(qs[0].sourceQuestionNumber, 1)
  assert.equal(qs[1].sourceQuestionNumber, 2)
  assert.equal(qs[0].sourcePage, 1) // 0-based index → 1-based page
})

test("the plant question keeps its own diagram + labels (not moved elsewhere)", () => {
  const q3 = sections.map((s) => s.question).find((q) => q && q.sourceQuestionNumber === 3)
  assert.ok(q3, 'diagram question present as standalone')
  assert.equal(q3.type, 'diagram')
  assert.equal(q3.diagramMode, 'identify')
  assert.ok(Array.isArray(q3.detectedDiagrams) && q3.detectedDiagrams.length === 1)
  assert.equal(q3.detectedDiagrams[0].kind, 'plant')
  assert.ok(Array.isArray(q3.diagramLabels) && q3.diagramLabels.length === 3)
})

test('the table question keeps its own table figure (attached to Q4, not Q3)', () => {
  const q4 = sections.map((s) => s.question).find((q) => q && q.sourceQuestionNumber === 4)
  assert.ok(q4)
  assert.equal(q4.detectedDiagrams[0].kind, 'table')
  // And Q3's figure is NOT the table.
  const q3 = sections.map((s) => s.question).find((q) => q && q.sourceQuestionNumber === 3)
  assert.notEqual(q3.detectedDiagrams[0].kind, 'table')
})

test('section headings group questions into parts across the page break', () => {
  const { parts } = groupSectionsIntoParts(sections)
  const titles = parts.map((p) => p.title)
  assert.deepEqual(titles, ['Section A', 'Section B'])
  // Q1/Q2 (passage) → Section A; Q3/Q4 (page 2) → Section B.
  const partA = parts.find((p) => p.title === 'Section A')
  const partB = parts.find((p) => p.title === 'Section B')
  const passage = sections.find((s) => s.kind === 'passage')
  assert.equal(passage.partId, partA.id)
  const q3Section = sections.find((s) => s.question && s.question.sourceQuestionNumber === 3)
  const q4Section = sections.find((s) => s.question && s.question.sourceQuestionNumber === 4)
  assert.equal(q3Section.question.partId, partB.id)
  assert.equal(q4Section.question.partId, partB.id)
})

console.log(`\ngrouping-integrity: ${passed} passed`)
