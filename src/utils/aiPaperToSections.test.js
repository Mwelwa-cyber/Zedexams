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

// ── Visual questions (v5): stem / labelled / option_images ────────────────
{
  // stem_figure
  const stem = mapAiQuestion({
    type: 'multiple_choice',
    prompt: 'The instrument shown below is mostly used for … music.',
    options: ['reggae', 'traditional', 'pop', 'jazz'],
    marks: 1,
    answer: 'traditional',
    visual: { kind: 'stem_figure', prompt: 'a traditional African djembe goblet drum, side view' },
  })
  assert.strictEqual(stem.overrides.diagramBrief, 'a traditional African djembe goblet drum, side view')
  assert.strictEqual(stem.overrides.correctAnswer, 1)
  ok('stem_figure sets a diagramBrief without disturbing MCQ options', true)

  // labelled_figure / identify
  const labelled = mapAiQuestion({
    type: 'short_answer',
    prompt: 'Study the diagram below. Name the parts.',
    marks: 5,
    answer: 'See marking guide.',
    visual: {
      kind: 'labelled_figure',
      mode: 'identify',
      prompt: 'a plastic-bottle water filter with layers of stones, sand and cloth',
      labels: ['Dirty water', 'Small stones', 'Fine sand', 'Cloth', 'Clean water'],
    },
  })
  assert.strictEqual(labelled.overrides.diagramMode, 'identify')
  assert.strictEqual(labelled.overrides.diagramLabels.length, 5)
  assert.strictEqual(labelled.overrides.diagramLabels[0].text, 'Dirty water')
  assert.ok(labelled.overrides.diagramLabels.every((l) => l.x >= 0 && l.x <= 1 && l.y >= 0 && l.y <= 1))
  ok('labelled_figure builds diagramLabels + identify mode with in-range positions', true)

  // option_images — picture-based MCQ
  const picOpts = mapAiQuestion({
    type: 'multiple_choice',
    prompt: 'Which equipment measures the correct weight of food?',
    options: [],
    marks: 1,
    answer: 'B',
    visual: {
      kind: 'option_images',
      options: [
        { prompt: 'a plastic wash basin' },
        { prompt: 'a dial kitchen weighing scale' },
        { prompt: 'a serving spoon' },
        { prompt: 'a cooking saucepan' },
      ],
    },
  })
  assert.strictEqual(picOpts.overrides.options.length, 4)
  assert.ok(picOpts.overrides.options.every((o) => o === ''))
  assert.strictEqual(picOpts.overrides.optionMedia.length, 4)
  assert.strictEqual(picOpts.overrides.optionMedia[1].diagramBrief, 'a dial kitchen weighing scale')
  assert.ok(picOpts.overrides.optionMedia[0].alt.length > 0, 'alt seeded from brief')
  assert.strictEqual(picOpts.overrides.correctAnswer, 1, 'letter answer B → index 1')
  ok('option_images becomes empty text options + per-option media briefs', true)

  // option_images where the answer is the winning brief text, not a letter
  const picByText = mapAiQuestion({
    type: 'multiple_choice',
    prompt: 'Which item is NOT made by carving?',
    options: [],
    marks: 1,
    answer: 'a metal cooking saucepan',
    visual: {
      kind: 'option_images',
      options: [
        { prompt: 'a wooden goblet cup' },
        { prompt: 'a carved wooden walking stick' },
        { prompt: 'a wooden serving spoon' },
        { prompt: 'a metal cooking saucepan' },
      ],
    },
  })
  assert.strictEqual(picByText.overrides.correctAnswer, 3, 'brief-text answer resolves to its option')
  ok('option_images tolerates a brief-text answer as a fallback', true)
}

// ── Exact library shapes: kind "shape" / "shape_options" ──────────────────
{
  // stem shape → question.imageDiagram, no diagramBrief (no generation)
  const shape = mapAiQuestion({
    type: 'calculation',
    prompt: 'Calculate the area of the parallelogram below.',
    marks: 2,
    answer: '48 cm²',
    visual: { kind: 'shape', libraryKey: 'parallelogramh', params: { base: '12 cm', height: '4 cm' } },
  })
  assert.strictEqual(shape.overrides.imageDiagram.libraryKey, 'parallelogramh')
  assert.strictEqual(shape.overrides.imageDiagram.params.base, '12 cm')
  assert.ok(!shape.overrides.diagramBrief, 'a library shape needs no generation brief')
  ok('shape maps to an exact stem imageDiagram', true)

  // shape_options → empty text options + per-option diagrams, letter answer
  const shapeOpts = mapAiQuestion({
    type: 'multiple_choice',
    prompt: 'Which of the following shapes is a regular hexagon?',
    options: [],
    marks: 1,
    answer: 'C',
    visual: {
      kind: 'shape_options',
      options: [
        { libraryKey: 'square' },
        { libraryKey: 'rhombus' },
        { libraryKey: 'hexagon' },
        { libraryKey: 'pentagon' },
      ],
    },
  })
  assert.strictEqual(shapeOpts.overrides.options.length, 4)
  assert.ok(shapeOpts.overrides.options.every((o) => o === ''))
  assert.strictEqual(shapeOpts.overrides.optionMedia[2].diagram.libraryKey, 'hexagon')
  assert.ok(shapeOpts.overrides.optionMedia[0].alt.length > 0, 'option alt seeded for the alt-text check')
  assert.strictEqual(shapeOpts.overrides.correctAnswer, 2, 'letter answer C → index 2')
  ok('shape_options maps to per-option exact diagrams', true)
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

// ── Matching questions ────────────────────────────────────────────────────
{
  const good = mapAiQuestion({
    type: 'matching',
    prompt: 'Match the animals in Column A with their young ones in Column B.',
    matching: { left: ['cow', 'dog', 'hen'], right: ['calf', 'puppy', 'chick', 'kid'], pairs: [0, 1, 2] },
    marks: 3,
    answer: 'cow-calf, dog-puppy, hen-chick',
    markingGuide: '1 mark per correct pair.',
  })
  assert.strictEqual(good.overrides.type, 'matching')
  assert.deepStrictEqual(good.overrides.matchingLeft, ['cow', 'dog', 'hen'])
  assert.deepStrictEqual(good.overrides.matchingRight, ['calf', 'puppy', 'chick', 'kid'])
  assert.deepStrictEqual(good.overrides.matchingAnswer, [0, 1, 2])
  assert.ok(!good.overrides.requiresReview)
  ok('valid matching maps to the studio matching shape', true)

  const broken = mapAiQuestion({
    type: 'matching',
    prompt: 'Match these.',
    matching: null,
    marks: 2,
    answer: 'a-b',
  })
  assert.strictEqual(broken.overrides.type, 'short_answer')
  assert.strictEqual(broken.overrides.requiresReview, true)
  ok('matching without columns degrades to a flagged short answer', true)
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
