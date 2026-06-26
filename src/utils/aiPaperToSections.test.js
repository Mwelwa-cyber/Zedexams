// Node test for the AI-paper → studio-blocks mapper.
// Run: node src/utils/aiPaperToSections.test.js

import assert from 'node:assert'
import {
  aiAssessmentToStudioBlocks,
  aiPaperToStudioDoc,
  examPaperToAssessmentShape,
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

// ── Maths markup → stacked fractions / columns (v6) ───────────────────────
{
  // An MCQ whose stem AND options are \frac fractions, like the real Grade-7
  // papers. The converter turns them into the editor's stacked math-frac spans
  // while the answer still resolves against the plain option text.
  const frac = mapAiQuestion({
    type: 'multiple_choice',
    prompt: 'Work out \\frac{1}{3} + \\frac{2}{5}.',
    options: ['\\frac{3}{15}', '\\frac{8}{15}', '\\frac{11}{15}', '\\frac{3}{8}'],
    marks: 1,
    answer: '\\frac{11}{15}',
    markingGuide: 'Common denominator 15 gives \\frac{11}{15}.',
  })
  assert.ok(frac.overrides.text.includes('math-frac'), 'stem fractions become stacked spans')
  assert.ok(frac.overrides.text.includes('data-num="1"') && frac.overrides.text.includes('data-den="3"'))
  assert.ok(frac.overrides.options.every((o) => o.includes('math-frac')), 'each fraction option is stacked')
  assert.strictEqual(frac.overrides.correctAnswer, 2, '\\frac{11}{15} answer still resolves to its option')
  assert.ok(frac.overrides.explanation.includes('math-frac'), 'marking guide fractions stack too')
  assert.ok(!frac.overrides.requiresReview)
  ok('fraction MCQ stems + options convert to stacked math-frac markup', true)

  // A mixed number and a plain (no-maths) option are untouched / handled.
  const mixed = mapAiQuestion({
    type: 'short_answer',
    prompt: 'A jug holds 2\\frac{1}{4} litres. Write this as an improper fraction.',
    marks: 1,
    answer: '\\frac{9}{4}',
  })
  assert.ok(mixed.overrides.text.includes('data-whole="2"'), 'mixed number keeps its whole part')
  ok('mixed numbers convert to a whole + stacked fraction', true)

  // Plain prose with no maths passes straight through unchanged (no <p> wrap).
  const plain = mapAiQuestion({
    type: 'short_answer',
    prompt: 'Name the capital city of Zambia.',
    marks: 1,
    answer: 'Lusaka',
  })
  assert.strictEqual(plain.overrides.text, 'Name the capital city of Zambia.')
  ok('non-maths prose is left exactly as-is', true)

  // Matching columns are deliberately left PLAIN (the paper layout + answer key
  // run them through richTextToPlainText, so HTML there would only risk a
  // literal span; this matches the document importer).
  const match = mapAiQuestion({
    type: 'matching',
    prompt: 'Match each fraction to its simplest form.',
    matching: { left: ['\\frac{2}{4}', '\\frac{3}{9}'], right: ['\\frac{1}{2}', '\\frac{1}{3}'], pairs: [0, 1] },
    marks: 2,
    answer: 'see guide',
  })
  assert.ok(match.overrides.matchingLeft.every((s) => !s.includes('math-frac')), 'matching columns stay plain')
  assert.strictEqual(match.overrides.matchingLeft[0], '\\frac{2}{4}')
  ok('matching columns are left plain (no HTML conversion)', true)
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
  // Every default label carries a leader-line target (tx/ty) so it points AT a
  // part instead of sitting on top of it, and the targets are in range.
  assert.ok(labelled.overrides.diagramLabels.every((l) =>
    Number.isFinite(l.tx) && Number.isFinite(l.ty) && l.tx >= 0 && l.tx <= 1 && l.ty >= 0 && l.ty <= 1))
  // Labels alternate into the left/right margins (not stacked on one edge) so
  // the leader lines fan out the way a real exam diagram is labelled.
  assert.ok(labelled.overrides.diagramLabels.some((l) => l.x < 0.5) &&
    labelled.overrides.diagramLabels.some((l) => l.x > 0.5))
  ok('labelled_figure builds diagramLabels + identify mode with leader-line targets', true)

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
  // The comprehension section is a lettered Part now — so it prints UNDER its
  // own "Section A" heading instead of floating above the first section as an
  // unlabelled story. The Part carries the section heading + instruction; the
  // passage block carries the story title + text.
  assert.strictEqual(blocks.parts.length, 1, 'comprehension section becomes a Part')
  assert.strictEqual(blocks.parts[0].title, 'SECTION B: COMPREHENSION', 'Part keeps the AI section heading')
  assert.strictEqual(sec.partId, blocks.parts[0].id, 'passage section is attached to its Part')
  assert.strictEqual(sec.passage.questions[0].partId, blocks.parts[0].id, 'passage sub-questions inherit the Part')
  assert.strictEqual(blocks.questionCount, 2)
  assert.strictEqual(blocks.totalMarks, 3)
  ok('AI comprehension sections become a lettered Part with the passage attached', true)
}

// ── A comprehension-first paper does not float the story above Section A ───
{
  // Mirrors the reported bug: the generator put the comprehension FIRST and a
  // multiple-choice section SECOND. The passage must land in Part A (so it
  // prints under "Section A"), and the MCQ section in Part B — not the other
  // way round with the story floating, unlabelled, at the very top.
  const blocks = aiAssessmentToStudioBlocks({
    sections: [
      {
        title: 'SECTION A: COMPREHENSION',
        instructions: 'Read the story carefully and answer the questions which follow.',
        passage: { title: 'Chanda’s Garden', text: 'Chanda lives in a village near Kabwe. She grows vegetables…' },
        questions: [
          { type: 'short_answer', prompt: 'Where does Chanda live?', marks: 1, answer: 'In a village near Kabwe.' },
          { type: 'short_answer', prompt: 'Name TWO plants Chanda grows.', marks: 2, answer: 'Any two vegetables.' },
        ],
      },
      {
        title: 'SECTION B: MULTIPLE CHOICE',
        instructions: 'Circle the correct answer for each question.',
        questions: [
          { type: 'multiple_choice', prompt: 'Which group has only fruits?', options: ['Mango, orange', 'Mango, onion'], marks: 1, answer: 'Mango, orange' },
        ],
      },
    ],
  })
  assert.strictEqual(blocks.parts.length, 2, 'two sections → two lettered Parts')
  // Part A is the comprehension; its passage section points at Part A.
  const passageSec = blocks.sections.find((s) => s.kind === 'passage')
  assert.ok(passageSec, 'a passage section exists')
  assert.strictEqual(passageSec.partId, blocks.parts[0].id, 'comprehension is Part A, not floating')
  // Part B holds the multiple-choice question.
  const mcqSec = blocks.sections.find((s) => s.kind === 'standalone')
  assert.strictEqual(mcqSec.question.partId, blocks.parts[1].id, 'MCQ section is Part B')
  ok('a comprehension-first paper keeps the story inside Section A', true)
}

// ── Short-answer sub-parts: explicit `parts` map to subParts ──────────────
{
  const { overrides } = mapAiQuestion({
    type: 'short_answer',
    prompt: 'Fill in the blanks to complete the sentences below.',
    marks: 1, // wrong on purpose — must be recomputed from the parts
    parts: [
      { text: 'Foods such as meat belong to the group called ____', answer: 'protein', marks: 1 },
      { text: 'Fats and oils give our bodies ____', answer: 'energy', marks: 1 },
      { text: 'Too little food leads to ____', answer: 'malnutrition', marks: 1 },
    ],
  })
  assert.strictEqual(overrides.type, 'short_answer')
  assert.ok(Array.isArray(overrides.subParts) && overrides.subParts.length === 3, 'three sub-parts mapped')
  assert.strictEqual(overrides.subParts[0].answer, 'protein', 'part answer carried')
  assert.strictEqual(overrides.marks, 3, 'question marks auto-sum from the parts')
  assert.strictEqual(overrides.correctAnswer, '', 'stem carries no single answer when parts exist')
  ok('explicit AI parts map to studio subParts with summed marks', true)
}

// ── Short-answer sub-parts: a crammed "(a)(b)(c)" prompt auto-splits ───────
{
  const { overrides } = mapAiQuestion({
    type: 'short_answer',
    prompt: 'Complete the sentences below. (a) Water boils at ____ degrees. (1) (b) Ice melts at ____ degrees. (1)',
    marks: 2,
  })
  assert.ok(Array.isArray(overrides.subParts) && overrides.subParts.length === 2, 'crammed prompt auto-splits into 2 parts')
  assert.strictEqual(overrides.subParts[0].answerFormat, 'inline', 'auto-split parts default to inline blanks')
  assert.strictEqual(overrides.marks, 2, 'auto-split marks sum from the (1)(1) hints')
  ok('a crammed (a)(b)(c) short-answer prompt auto-splits into subParts', true)
}

// ── A plain single short-answer is NOT turned into sub-parts ───────────────
{
  const { overrides } = mapAiQuestion({
    type: 'short_answer',
    prompt: 'Name the capital city of Zambia.',
    answer: 'Lusaka',
    marks: 1,
  })
  assert.ok(!overrides.subParts, 'plain short-answer has no subParts')
  assert.strictEqual(overrides.correctAnswer, 'Lusaka', 'plain short-answer keeps its single answer')
  ok('a plain single short-answer question is left untouched', true)
}

// ── Garbage input never throws ────────────────────────────────────────────
{
  for (const junk of [null, undefined, {}, { sections: 'nope' }, []]) {
    const blocks = aiAssessmentToStudioBlocks(junk)
    assert.strictEqual(blocks.questionCount, 0)
  }
  ok('malformed input degrades to zero blocks', true)
}

// ── aiPaperToStudioDoc: an AI ASSESSMENT generation becomes a printable paper ─
// Regression for the "library not auto saving" bug: a generateAssessment doc
// (tool 'assessment') landed in the library but the detail view had no renderer,
// so it opened BLANK. aiPaperToStudioDoc must turn the saved `output` into a
// non-empty { doc, questions } the paper layout can render.
{
  const out = {
    header: {
      title: 'Grade 4 Mathematics — End of Term 2 Test',
      grade: 'G4', subject: 'Mathematics', term: 2,
      durationMinutes: 60, totalMarks: 4,
      instructions: 'Answer ALL questions.',
    },
    sections: [
      {
        title: 'SECTION A: Multiple choice',
        instructions: 'Circle the correct answer.',
        questions: [
          { type: 'multiple_choice', prompt: 'What is 2 + 2?', options: ['3', '4', '5'], marks: 1, answer: '4' },
          { type: 'multiple_choice', prompt: 'What is 5 - 1?', options: ['3', '4', '5'], marks: 1, answer: '4' },
        ],
      },
      {
        title: 'SECTION B: Short answer',
        questions: [
          { type: 'structured', prompt: 'Explain how to add two fractions.', marks: 2, answer: 'Find a common denominator…' },
        ],
      },
    ],
  }
  const { doc, questions, questionCount } = aiPaperToStudioDoc(out, 'assessment')
  assert.strictEqual(questionCount, 3, 'all questions survive the conversion')
  assert.strictEqual(questions.length, 3)
  assert.strictEqual(doc.subject, 'Mathematics', 'header subject carried onto the paper doc')
  assert.strictEqual(doc.grade, 'G4')
  assert.strictEqual(doc.coverInstructions, 'Answer ALL questions.')
  assert.strictEqual(doc.parts.length, 2, 'two AI sections become two paper parts')
  ok('aiPaperToStudioDoc turns an AI assessment into a non-empty paper doc', true)
}

// ── examPaperToAssessmentShape: flat exam_paper normalises to sections ────────
{
  const flat = {
    header: { title: 'G7 Science Mock', grade: 'G7', subject: 'Science', instructions: 'Choose ONE best answer.' },
    questions: [
      { number: 1, question: 'Which organ pumps blood?', options: ['Heart', 'Lung', 'Liver', 'Kidney'], correctAnswer: 'Heart', explanation: 'The heart is a pump.' },
      { number: 2, question: 'Water freezes at?', options: ['0°C', '50°C', '100°C', '-10°C'], correctAnswer: '0°C', explanation: '' },
    ],
  }
  const shaped = examPaperToAssessmentShape(flat)
  assert.strictEqual(shaped.sections.length, 1, 'flat exam paper → one section')
  assert.strictEqual(shaped.sections[0].questions.length, 2)
  assert.strictEqual(shaped.sections[0].questions[0].prompt, 'Which organ pumps blood?', 'question text mapped to prompt')
  assert.strictEqual(shaped.sections[0].questions[0].answer, 'Heart', 'correctAnswer mapped to answer')

  const { questionCount, questions } = aiPaperToStudioDoc(flat, 'exam_paper')
  assert.strictEqual(questionCount, 2, 'exam paper converts to a non-empty paper')
  assert.strictEqual(questions[0].type, 'mcq', 'multiple_choice maps to the studio mcq type')
  ok('a flat exam_paper generation also renders as a non-empty paper', true)

  // An already-sectioned payload passed through examPaperToAssessmentShape is
  // returned unchanged (defensive — both generators share this path).
  const sectioned = { header: {}, sections: [{ questions: [] }] }
  assert.strictEqual(examPaperToAssessmentShape(sectioned), sectioned, 'sectioned payload passes through')
  ok('examPaperToAssessmentShape leaves an assessment-shaped payload alone', true)
}

// ── A failed/empty generation degrades to an empty (not crashing) paper ──────
{
  for (const junk of [null, undefined, {}, { header: {} }, { sections: [] }]) {
    const { questionCount, questions, doc } = aiPaperToStudioDoc(junk, 'assessment')
    assert.strictEqual(questionCount, 0, 'no questions from empty output')
    assert.ok(Array.isArray(questions) && Array.isArray(doc.parts), 'shape stays consistent')
  }
  ok('aiPaperToStudioDoc never throws on an empty/failed generation', true)
}

console.log(`aiPaperToSections: ${passed} checks passed`)
