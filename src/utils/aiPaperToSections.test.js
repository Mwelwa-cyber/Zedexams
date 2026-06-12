// Node test for the AI-paper → studio-blocks mapper.
// Run: node src/utils/aiPaperToSections.test.js

import assert from 'node:assert'
import {
  aiAssessmentToStudioBlocks,
  mapAiQuestion,
  matchAnswerIndex,
} from './aiPaperToSections.js'

let passed = 0
function ok(name, cond) {
  assert.ok(cond, name)
  passed += 1
  console.log(`  ok  ${name}`)
}

console.log('aiPaperToSections')

// ── matchAnswerIndex ──────────────────────────────────────────────────────
{
  const opts = ['kwacha', 'ngwee', 'dollar', 'rand']
  assert.strictEqual(matchAnswerIndex('ngwee', opts), 1)
  assert.strictEqual(matchAnswerIndex('  NGWEE  ', opts), 1)
  assert.strictEqual(matchAnswerIndex('B', opts), 1)
  assert.strictEqual(matchAnswerIndex('B.', opts), 1)
  assert.strictEqual(matchAnswerIndex('(c)', opts), 2)
  assert.strictEqual(matchAnswerIndex('D. rand', opts), 3)
  assert.strictEqual(matchAnswerIndex('euro', opts), -1)
  assert.strictEqual(matchAnswerIndex('', opts), -1)
  ok('matchAnswerIndex handles full text, letters, and prefixed answers', true)
}

// ── mapAiQuestion ─────────────────────────────────────────────────────────
{
  const mcq = mapAiQuestion({
    type: 'multiple_choice',
    prompt: 'The capital of Zambia is …',
    options: ['Kitwe', 'Livingstone', 'Lusaka', 'Ndola'],
    marks: 1,
    answer: 'Lusaka',
    markingGuide: '1 mark for Lusaka.',
  })
  assert.strictEqual(mcq.overrides.type, 'mcq')
  assert.strictEqual(mcq.overrides.correctAnswer, 2)
  assert.strictEqual(mcq.overrides.explanation, '1 mark for Lusaka.')
  assert.ok(!mcq.overrides.requiresReview)
  ok('clean MCQ maps with the right correct index', true)

  const tf = mapAiQuestion({
    type: 'true_false',
    prompt: 'Zambia has ten provinces.',
    marks: 1,
    answer: 'True',
  })
  assert.deepStrictEqual(tf.overrides.options, ['True', 'False'])
  assert.strictEqual(tf.overrides.correctAnswer, 0)
  ok('true/false becomes a 2-option MCQ', true)

  const calc = mapAiQuestion({
    type: 'calculation',
    prompt: 'Work out 456 + 287.',
    marks: 2,
    answer: '743',
    markingGuide: '1 method + 1 answer.',
  })
  assert.strictEqual(calc.overrides.type, 'short_answer')
  assert.strictEqual(calc.overrides.correctAnswer, '743')
  ok('calculation maps to short_answer with the model answer', true)

  const bad = mapAiQuestion({
    type: 'multiple_choice',
    prompt: 'Pick one.',
    options: ['a', 'b', 'c', 'd'],
    marks: 1,
    answer: 'something else entirely',
  })
  assert.strictEqual(bad.overrides.requiresReview, true)
  assert.ok(bad.overrides.reviewNotes.length > 0)
  ok('unmatchable MCQ answer flags the question for review', true)

  const withDiagram = mapAiQuestion({
    type: 'short_answer',
    prompt: 'Name the part labelled X.',
    marks: 2,
    answer: 'stem',
    diagram: 'A bean plant with the stem labelled X.',
  })
  assert.strictEqual(withDiagram.overrides.requiresReview, true)
  assert.ok(withDiagram.overrides.reviewNotes.some((n) => n.includes('Diagram needed')))
  assert.strictEqual(withDiagram.overrides.diagramBrief, 'A bean plant with the stem labelled X.')
  ok('diagram briefs surface as review notes AND a diagramBrief field', true)
}

// ── aiAssessmentToStudioBlocks ────────────────────────────────────────────
{
  const blocks = aiAssessmentToStudioBlocks({
    header: { title: 'G4 Science — End of Term', totalMarks: 5 },
    sections: [
      {
        title: 'SECTION A: Circle the correct answer.',
        instructions: 'Circle the correct answer.',
        questions: [
          { type: 'multiple_choice', prompt: 'Q1?', options: ['x', 'y'], marks: 1, answer: 'y' },
          { type: 'multiple_choice', prompt: 'Q2?', options: ['p', 'q'], marks: 1, answer: 'p' },
          null,
          { type: 'multiple_choice', prompt: '', options: ['a'], marks: 1, answer: 'a' },
        ],
      },
      {
        title: 'SECTION B',
        instructions: 'Answer in the spaces provided.',
        questions: [
          { type: 'structured', prompt: 'Explain photosynthesis.', marks: 3, answer: 'Plants make food…' },
        ],
      },
      { title: 'EMPTY SECTION', questions: [] },
    ],
  })
  assert.strictEqual(blocks.parts.length, 2, 'empty AI section produces no part')
  assert.strictEqual(blocks.questionCount, 3)
  assert.strictEqual(blocks.totalMarks, 5)
  assert.strictEqual(blocks.sections.length, 3)
  ok('sections become parts; junk questions are skipped with warnings', true)

  const first = blocks.sections[0]
  assert.strictEqual(first.kind, 'standalone')
  assert.strictEqual(first.question.partId, blocks.parts[0].id)
  assert.strictEqual(blocks.sections[2].question.partId, blocks.parts[1].id)
  ok('questions carry their AI section’s partId', true)
  assert.ok(blocks.warnings.length >= 1)
  ok('skips are reported as warnings', true)
}

// ── Comprehension passages become passage blocks ─────────────────────────
{
  const blocks = aiAssessmentToStudioBlocks({
    sections: [
      {
        title: 'SECTION B: COMPREHENSION',
        instructions: 'Read the story and answer the questions.',
        passage: {
          title: 'Warthog and Lion',
          text: 'A warthog went into a cave to keep warm. Soon a hungry lion came in…',
        },
        questions: [
          { type: 'short_answer', prompt: 'Why did Warthog hold his tusks against the roof?', marks: 2, answer: 'To pretend the cave was falling.' },
          { type: 'multiple_choice', prompt: 'Where did Warthog go?', options: ['a cave', 'a river', 'a tree'], marks: 1, answer: 'a cave' },
        ],
      },
    ],
  })
  assert.strictEqual(blocks.sections.length, 1)
  const sec = blocks.sections[0]
  assert.strictEqual(sec.kind, 'passage')
  assert.strictEqual(sec.passage.passageKind, 'comprehension')
  assert.strictEqual(sec.passage.title, 'Warthog and Lion')
  assert.strictEqual(sec.passage.questions.length, 2)
  assert.strictEqual(sec.passage.questions[1].correctAnswer, 0)
  assert.strictEqual(blocks.parts.length, 0, 'passage blocks need no Part wrapper')
  assert.strictEqual(blocks.questionCount, 2)
  assert.strictEqual(blocks.totalMarks, 3)
  ok('AI comprehension sections map to native passage blocks', true)
}

// ── Garbage input never throws ────────────────────────────────────────────
{
  for (const junk of [null, undefined, {}, { sections: 'nope' }, []]) {
    const blocks = aiAssessmentToStudioBlocks(junk)
    assert.strictEqual(blocks.questionCount, 0)
  }
  ok('malformed input degrades to zero blocks', true)
}

console.log(`aiPaperToSections: ${passed} checks passed`)
