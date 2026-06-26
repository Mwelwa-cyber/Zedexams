#!/usr/bin/env node
/**
 * Tests for the "Label the Diagram" question type (`type: 'diagram_label'`):
 *   - the pure helpers in src/utils/diagramLabelGrading.js
 *   - deterministic grading + scoring via src/utils/quizScoring.js
 *   - per-type pre-publish validation via src/utils/quizValidation.js
 *   - that the question schema accepts a diagram_label question
 *
 * The learner sees an image with numbered markers and types the name of each
 * numbered part; every named marker must match for the question to score.
 *
 * Run: npm run test:diagram-label
 */

import {
  diagramLabelLayout,
  diagramLabelAnswerKey,
  hasDiagramLabelContent,
  gradeDiagramLabels,
} from '../src/utils/diagramLabelGrading.js'
import {
  isQuestionCorrect,
  computeQuizScore,
  isDiagramLabelType,
} from '../src/utils/quizScoring.js'
import { validateStandaloneQuestion, collectQuizIssues } from '../src/utils/quizValidation.js'
import { questionWriteSchema } from '../src/editor/schema/question.js'

let pass = 0
let fail = 0
function check(name, cond) {
  if (cond) { pass += 1 } else { fail += 1; console.error(`  ✗ ${name}`) }
}
function eq(name, a, b) {
  check(`${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`,
    JSON.stringify(a) === JSON.stringify(b))
}

// A "MyPlate"-style question: name the five food groups around the plate.
const q = {
  type: 'diagram_label',
  imageUrl: 'https://example.com/my-plate.png',
  diagramMode: 'identify',
  diagramLabels: [
    { x: 0.20, y: 0.30, text: 'Protein' },
    { x: 0.55, y: 0.18, text: 'Grains' },
    { x: 0.80, y: 0.45, text: 'Dairy' },
    { x: 0.30, y: 0.72, text: 'Fruits' },
    { x: 0.62, y: 0.70, text: 'Vegetable/Vegetables' },
  ],
}

// ── Layout: numbers + index alignment, only named markers count ───
const layout = diagramLabelLayout(q)
eq('layout counts five markers', layout.length, 5)
eq('layout numbers 1-based', layout.map(l => l.number), [1, 2, 3, 4, 5])
eq('layout indexes 0-based', layout.map(l => l.index), [0, 1, 2, 3, 4])
eq('layout keeps positions', [layout[0].x, layout[0].y], [0.20, 0.30])

// Empty / whitespace markers are skipped so the question stays completable,
// and the remaining markers renumber to stay contiguous.
const withGaps = {
  type: 'diagram_label',
  imageUrl: 'x',
  diagramLabels: [
    { x: 0.1, y: 0.1, text: 'Heart' },
    { x: 0.2, y: 0.2, text: '   ' },     // unnamed → skipped
    { x: 0.3, y: 0.3, text: 'Lungs' },
  ],
}
eq('layout skips blank markers', diagramLabelLayout(withGaps).map(l => l.text), ['Heart', 'Lungs'])
eq('answer key skips blanks', diagramLabelAnswerKey(withGaps), ['Heart', 'Lungs'])

// ── Answer key ordering ───────────────────────────────────────────
eq('answer key order', diagramLabelAnswerKey(q),
  ['Protein', 'Grains', 'Dairy', 'Fruits', 'Vegetable/Vegetables'])
eq('hasContent true', hasDiagramLabelContent(q), true)
eq('hasContent false (no named markers)', hasDiagramLabelContent({ diagramLabels: [{ x: 0, y: 0, text: '' }] }), false)
eq('hasContent false (no markers)', hasDiagramLabelContent({ diagramLabels: [] }), false)

// ── Grading (case / whitespace / variants, all-or-nothing) ────────
const allRight = gradeDiagramLabels(q, ['Protein', 'Grains', 'Dairy', 'Fruits', 'Vegetables'])
eq('grade all correct', allRight.allCorrect, true)
eq('grade correctLabels', allRight.correctLabels, 5)

const caseInsensitive = gradeDiagramLabels(q, ['protein', '  grains ', 'DAIRY', 'fruits', 'vegetable'])
eq('grade ignores case + spacing + accepts variant', caseInsensitive.allCorrect, true)

const partial = gradeDiagramLabels(q, ['Protein', 'WRONG', 'Dairy', 'Fruits', 'Vegetables'])
eq('grade partial not all', partial.allCorrect, false)
eq('grade partial count', partial.correctLabels, 4)
eq('grade perLabel', partial.perLabel, [true, false, true, true, true])

const empty = gradeDiagramLabels(q, [])
eq('grade empty not correct', empty.allCorrect, false)
eq('grade empty count', empty.correctLabels, 0)

// ── Scoring integration ───────────────────────────────────────────
check('isDiagramLabelType', isDiagramLabelType('diagram_label'))
check('isDiagramLabelType false for diagram', !isDiagramLabelType('diagram'))
const scoreQ = { ...q, id: 'q1', marks: 5, topic: 'Nutrition' }
check('isQuestionCorrect all', isQuestionCorrect(scoreQ, ['Protein', 'Grains', 'Dairy', 'Fruits', 'Vegetable']))
check('isQuestionCorrect partial -> false', !isQuestionCorrect(scoreQ, ['Protein', 'Grains', 'Dairy', 'Fruits', 'x']))
const scored = computeQuizScore([scoreQ], { q1: ['Protein', 'Grains', 'Dairy', 'Fruits', 'Vegetables'] })
eq('computeQuizScore full marks', scored.score, 5)
eq('computeQuizScore total', scored.total, 5)
const scoredPartial = computeQuizScore([scoreQ], { q1: ['Protein', 'Grains', 'Dairy', 'Fruits', 'x'] })
eq('computeQuizScore partial = 0 (all-or-nothing)', scoredPartial.score, 0)

// ── Pre-publish validation ────────────────────────────────────────
let lastError = null
const notify = msg => { lastError = msg }
check('validates a complete diagram_label', validateStandaloneQuestion(
  { ...q, text: 'Name each part of the plate.' }, 'Question 1', { onError: notify }))

lastError = null
check('blocks when image missing', !validateStandaloneQuestion(
  { type: 'diagram_label', text: 'Name the parts.', diagramLabels: [{ x: 0.1, y: 0.1, text: 'A' }] },
  'Question 1', { onError: notify }))
check('image error message mentions an image', /image/i.test(lastError || ''))

lastError = null
check('blocks when no named markers', !validateStandaloneQuestion(
  { type: 'diagram_label', text: 'Name the parts.', imageUrl: 'x', diagramLabels: [] },
  'Question 1', { onError: notify }))
check('marker error message mentions a part', /part/i.test(lastError || ''))

// collectQuizIssues surfaces the same blocker for the checklist modal.
const { issues } = collectQuizIssues({
  form: { title: 'T', subject: 'Home Economics', grade: 3 },
  sections: [{ kind: 'standalone', question: {
    localId: 'L1', type: 'diagram_label', text: 'Name the parts.', imageUrl: 'x', diagramLabels: [],
  } }],
  questionNumbers: { L1: 1 },
})
check('collectQuizIssues flags missing markers', issues.some(i => i.id.startsWith('diagram-label-')))

// ── Schema accepts a diagram_label question ───────────────────────
const baseDoc = {
  type: 'diagram_label',
  topic: 'Nutrition',
  marks: 5,
  order: 0,
  text: 'Name each numbered part of the plate.',
  options: [],
  correctAnswer: '',
  imageUrl: 'https://example.com/my-plate.png',
  diagramMode: 'identify',
  diagramLabels: [
    { x: 0.20, y: 0.30, text: 'Protein' },
    { x: 0.55, y: 0.18, text: 'Grains' },
  ],
  contentVersion: 3,
}
const okParse = questionWriteSchema.safeParse(baseDoc)
check('schema accepts diagram_label', okParse.success)
if (!okParse.success) console.error('   schema error:', okParse.error.issues?.[0])

console.log(`\ndiagram-label: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
