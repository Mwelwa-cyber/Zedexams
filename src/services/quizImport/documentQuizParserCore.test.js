import assert from 'node:assert/strict'
import {
  expandFlattenedQuestionRuns,
  isRunningHeaderFooterLine,
  metadataFromText,
  processImportedQuestionBlocks,
} from './documentQuizParserCore.js'
import { richTextToPlainText } from '../../utils/quizRichText.js'

const punctuationInstruction = 'For questions 26-30, each sentence has one punctuation error. Choose the sentence with the correct punctuation.'
const completionInstruction = 'For questions 31-38, choose the correct word or phrase to complete each sentence.'
const paragraphInstruction = 'Look at questions 39-45. Each question has four paragraphs. Choose the one which has the sentences in the best order.'
const comprehensionInstruction = 'This part has three stories with questions on each. Read each story and answer the questions which follow.'

function block(text, overrides = {}) {
  return {
    text,
    assets: [],
    source: 'docx',
    numberedList: false,
    ...overrides,
  }
}

function makeOptionOnlyQuestion(number, options) {
  return block(
    `${number}. A. ${options[0]} B. ${options[1]} C. ${options[2]} D. ${options[3]}`,
  )
}

function makeInlineQuestion(number, text, options) {
  return block(
    `${number}. ${text} A. ${options[0]} B. ${options[1]} C. ${options[2]} D. ${options[3]}`,
  )
}

function makeParaOrderingQuestion(number, topic) {
  return [
    block(String(number)),
    block(`AFirst, ${topic} began in the classroom.`),
    block(`Then the class moved outside for practice.`),
    block(`BThe class moved outside for practice before the activity began.`),
    block(`Then the teacher explained the task in the classroom.`),
    block(`CFirst, ${topic} began in the classroom.`),
    block(`Finally, the pupils checked their work together.`),
    block(`DFinally, the pupils checked their work together.`),
    block(`Then ${topic} began in the classroom.`),
  ]
}

function makePassage(storyNumber, heading, firstQuestionNumber) {
  const storyLabel = `Story ${storyNumber}`
  const rangeLabel = storyNumber === 2
    ? `Now do questions ${firstQuestionNumber}-${firstQuestionNumber + 4}`
    : `Questions ${firstQuestionNumber}-${firstQuestionNumber + 4}`

  const questions = Array.from({ length: 5 }, (_, index) => {
    const questionNumber = firstQuestionNumber + index
    return makeInlineQuestion(
      questionNumber,
      `What is the best answer for ${heading.toLowerCase()} question ${index + 1}?`,
      [
        `${heading} option A${index + 1}`,
        `${heading} option B${index + 1}`,
        `${heading} option C${index + 1}`,
        `${heading} option D${index + 1}`,
      ],
    )
  })

  return [
    block(storyLabel),
    block(heading),
    block(`${heading} begins with a short paragraph that sets the scene for the reader.`),
    block(`A second paragraph gives more detail about ${heading.toLowerCase()} and the children in the story.`),
    block(rangeLabel),
    ...questions,
  ]
}

function makeAnswerKeyLine(numbers) {
  return block(numbers.map(number => `${number} A`).join(' '))
}

function makeFixtureBlocks() {
  const punctuationQuestions = Array.from({ length: 5 }, (_, index) =>
    makeOptionOnlyQuestion(26 + index, [
      `The pupil ${index + 1} forgot the full stop`,
      `The pupil ${index + 1} used the comma correctly.`,
      `The pupil ${index + 1} asked the question?`,
      `The pupil ${index + 1} shouted loudly!`,
    ]),
  )

  const completionQuestions = Array.from({ length: 8 }, (_, index) =>
    makeInlineQuestion(31 + index, `Choose the best word to complete sentence ${index + 1}.`, [
      `word A${index + 1}`,
      `word B${index + 1}`,
      `word C${index + 1}`,
      `word D${index + 1}`,
    ]),
  )

  const paragraphQuestions = Array.from({ length: 7 }, (_, index) =>
    makeParaOrderingQuestion(39 + index, `activity ${index + 1}`),
  ).flat()

  const comprehensionStories = [
    ...makePassage(1, 'The Clever Hare', 46),
    ...makePassage(2, 'The Lost Calf', 51),
    ...makePassage(3, 'A Visit to the River', 56),
  ]

  return [
    block('PART 3'),
    block(punctuationInstruction),
    ...punctuationQuestions,
    block('PART 4'),
    block(completionInstruction),
    ...completionQuestions,
    block('PART 5'),
    block(paragraphInstruction),
    block('Example'),
    block('The answer is A.'),
    block('Now do questions 39-45'),
    ...paragraphQuestions,
    block('READING COMPREHENSION'),
    block(comprehensionInstruction),
    ...comprehensionStories,
    block('Answer Key'),
    makeAnswerKeyLine([26, 27, 28, 29, 30, 31, 32, 33, 34, 35]),
    makeAnswerKeyLine([36, 37, 38, 39, 40, 41, 42, 43, 44, 45]),
    makeAnswerKeyLine([46, 47, 48, 49, 50, 51, 52, 53, 54, 55]),
    makeAnswerKeyLine([56, 57, 58, 59, 60]),
  ]
}

function allQuestionsFromSections(sections) {
  return sections.flatMap(section =>
    section.kind === 'passage'
      ? (section.passage?.questions || [])
      : [section.question],
  )
}

function findQuestion(sections, sourceQuestionNumber) {
  return allQuestionsFromSections(sections).find(
    question => String(question?.sourceQuestionNumber) === String(sourceQuestionNumber),
  )
}

function plainRichText(value) {
  return richTextToPlainText(value).replace(/\s+/g, ' ').trim()
}

function runRegressionTest() {
  const warnings = []
  const { sections, summary } = processImportedQuestionBlocks(makeFixtureBlocks(), warnings)

  assert.equal(warnings.length, 0)
  assert.equal(summary.questions, 35)
  assert.equal(summary.passages, 3)
  assert.equal(summary.needsReview, 0)

  const passageSections = sections.filter(section => section.kind === 'passage')
  assert.deepEqual(
    passageSections.map(section => section.passage.title),
    ['Story 1', 'Story 2', 'Story 3'],
  )
  passageSections.forEach(section => {
    assert.equal(section.passage.questions.length, 5)
    assert.match(plainRichText(section.passage.instructions), /three stories with questions on each/i)
  })
  assert.doesNotMatch(passageSections[0].passage.passageText, /Questions 46-50/i)
  assert.doesNotMatch(passageSections[1].passage.passageText, /Story 3/i)

  const q26 = findQuestion(sections, 26)
  const q31 = findQuestion(sections, 31)
  const q39 = findQuestion(sections, 39)
  const q45 = findQuestion(sections, 45)

  assert.ok(q26)
  assert.ok(q31)
  assert.ok(q39)
  assert.ok(q45)

  assert.equal(plainRichText(q26.sharedInstruction), punctuationInstruction)
  assert.equal(q26.options.length, 4)

  assert.equal(plainRichText(q31.sharedInstruction), completionInstruction)
  assert.equal(q31.options.length, 4)

  assert.equal(plainRichText(q39.sharedInstruction), paragraphInstruction)
  assert.equal(q39.options.length, 4)
  assert.match(q39.options[0], /activity 1 began in the classroom/i)
  assert.match(q39.options[0], /moved outside for practice/i)

  assert.equal(plainRichText(q45.sharedInstruction), paragraphInstruction)
  assert.equal(q45.options.length, 4)
  assert.doesNotMatch(q45.options[3], /reading comprehension/i)
}

runRegressionTest()

// ─── Real-world ECZ Word layout ───────────────────────────────────────────
// The fixture above uses idealised one-line / bare-number formats. Real ECZ
// .docx exports (e.g. G7 English) use two layouts the parser used to silently
// drop:
//   1. "Number-only stem" — the question is just `26.` on its own line and the
//      A–D answer choices are full sentences on the following lines, with an
//      inline `Answer: B  —  …` line. The section heading supplies the stem.
//   2. Paragraph-ordering markers written as `39.` (trailing period), not the
//      bare `39` the old code required, also with inline answers.
// This regression locks both in so a clean 60-question paper imports whole.
function numberOnlyStemQuestion(number, options, answerLetter) {
  const answerText = options['ABCD'.indexOf(answerLetter)]
  return [
    block(`${number}.`),
    block(`A   ${options[0]}`),
    block(`B   ${options[1]}`),
    block(`C   ${options[2]}`),
    block(`D   ${options[3]}`),
    block(`Answer: ${answerLetter}  —  ${answerText}`),
  ]
}

function paraOrderQuestionWithPeriod(number, options, answerLetter) {
  const answerText = options['ABCD'.indexOf(answerLetter)]
  return [
    block(`${number}.`),
    block(`A   ${options[0]}`),
    block(`B   ${options[1]}`),
    block(`C   ${options[2]}`),
    block(`D   ${options[3]}`),
    block(`Answer: ${answerLetter}  —  ${answerText}`),
  ]
}

function runRealWorldLayoutTest() {
  const punctuationInstr = 'Choose the sentence which is correctly punctuated.'
  const paragraphInstr = 'Choose the paragraph which has the sentences in the best order.'

  const blocks = [
    block('Part 3: Questions 26 – 30'),
    block(punctuationInstr),
    ...numberOnlyStemQuestion(26, [
      'The Bible was translated into Chitonga Cinyanja Luvale and Icibemba.',
      'The Bible was translated into, Chitonga Cinyanja Luvale and Icibemba.',
      'The Bible, was translated into Chitonga Cinyanja Luvale and Icibemba.',
      'The Bible was translated into Chitonga, Cinyanja, Luvale and Icibemba.',
    ], 'D'),
    ...numberOnlyStemQuestion(27, [
      "The First Lady's Independence Day attire was nice.",
      'The First Ladys Independence Day attire was nice.',
      "The First Lady's, Independence Day attire was nice.",
      "The First Ladys' Independence Day attire was nice.",
    ], 'A'),
    ...numberOnlyStemQuestion(28, [
      'take this map in case you lose your way.',
      'Take this map in case you lose your way?',
      'Take this map in case you lose your way.',
      'take this map in case you lose your way!',
    ], 'C'),
    ...numberOnlyStemQuestion(29, [
      "Your mother is very dear to you, isn't she?",
      "Your mother is very dear, to you isn't she?",
      "Your mother is very dear to you! isn't she?",
      "Your mother is very dear to you, isn't she?",
    ], 'A'),
    ...numberOnlyStemQuestion(30, [
      'Aha! There comes our teacher! said Patra.',
      'Aha! There comes our teacher. said Patra.',
      'Aha! There comes our teacher, said Patra.',
      'Aha! There comes our teacher, said Patra.',
    ], 'A'),
    block('SECTION B — Part 1: Questions 39 – 45'),
    block(paragraphInstr),
    ...paraOrderQuestionWithPeriod(39, [
      'First sentence one. Then sentence two. Finally sentence three.',
      'Then sentence two. Finally sentence three. First sentence one.',
      'Finally sentence three. First sentence one. Then sentence two.',
      'First sentence one. Then sentence two. Finally sentence three again.',
    ], 'A'),
    ...paraOrderQuestionWithPeriod(45, [
      'Football is played all over the world. It is run by FIFA.',
      'It is run by FIFA. Football is played all over the world.',
      'FIFA runs football. Football is played everywhere.',
      'Everywhere football is played. FIFA is the body.',
    ], 'B'),
  ]

  const warnings = []
  const { sections, summary } = processImportedQuestionBlocks(blocks, warnings)

  // All 7 questions present (5 punctuation + 2 paragraph-ordering).
  assert.equal(summary.questions, 7, `expected 7 questions, got ${summary.questions}`)

  const numbers = allQuestionsFromSections(sections)
    .map(q => Number(q.sourceQuestionNumber))
    .sort((a, b) => a - b)
  assert.deepEqual(numbers, [26, 27, 28, 29, 30, 39, 45])

  // Number-only stems: each carries the section instruction as its stem,
  // four options, and the inline answer resolved to the right index.
  const q26 = findQuestion(sections, 26)
  assert.match(plainRichText(q26.text), /correctly punctuated/i)
  assert.equal(q26.options.length, 4)
  assert.equal(q26.type, 'mcq')
  assert.equal(q26.correctAnswer, 3) // D

  const q27 = findQuestion(sections, 27)
  assert.equal(q27.correctAnswer, 0) // A
  const q28 = findQuestion(sections, 28)
  assert.equal(q28.correctAnswer, 2) // C — option ending in "?" must not be misread

  // Paragraph-ordering markers with a trailing period (`39.`) parse, keep four
  // options, and resolve their inline answers.
  const q39 = findQuestion(sections, 39)
  assert.ok(q39, 'Q39 (paragraph-ordering, "39." marker) must not be dropped')
  assert.equal(q39.options.length, 4)
  assert.equal(q39.correctAnswer, 0) // A
  const q45 = findQuestion(sections, 45)
  assert.ok(q45, 'Q45 must not be dropped')
  assert.equal(q45.correctAnswer, 1) // B
}

runRealWorldLayoutTest()

// ─── Bare "Story N" comprehension passages ────────────────────────────────
// Real ECZ G7 English papers head each reading passage with just "Story 1",
// "Story 2", "Story 3" and NO "read the passage and answer the questions that
// follow" instruction — the section is introduced only by a "Reading
// Comprehension — Questions 46 – 60" range heading. The parser used to need a
// comprehension instruction (or a passage-internal "answer the questions that
// follow" line) to enter comprehension mode, so a bare "Story N" label was
// discarded: the passage text vanished and every question under it landed as a
// bare standalone. The visible symptom was "after importing, the stories are
// not there — only the questions." This locks the passages in.
function comprehensionQuestionWithInlineAnswer(number, stem, options, answerLetter) {
  const answerText = options['ABCD'.indexOf(answerLetter)]
  return [
    block(`${number}.  ${stem}`),
    block(`A   ${options[0]}`),
    block(`B   ${options[1]}`),
    block(`C   ${options[2]}`),
    block(`D   ${options[3]}`),
    block(`Answer: ${answerLetter}  —  ${answerText}`),
  ]
}

function runBareStoryLabelTest() {
  const blocks = [
    block('Reading Comprehension — Questions 46 – 60'),
    // Story 1 — introduced by a bare label, no comprehension instruction.
    block('Story 1'),
    block('Once upon a time, the grandson of a headman developed a bad cough. The people called in a witchdoctor to cure him.'),
    block('The witchdoctor chewed some roots and danced around the child, then took a small calabash and made it appear to speak.'),
    ...comprehensionQuestionWithInlineAnswer(46, 'According to the text, why was the ancestor angry with the villagers? They …',
      ['bewitched the boy.', 'did not give him some beer.', 'misunderstood the calabash.', 'offered him some beer.'], 'B'),
    ...comprehensionQuestionWithInlineAnswer(47, 'Which of the following was not done by the witchdoctor?',
      ['Carrying him outside.', 'Dancing around him.', 'Giving him medicine.', 'Spitting on his face.'], 'C'),
    // Story 2 — another bare label; must close Story 1 and open a new passage.
    block('Story 2'),
    block('Crocodiles are large semiaquatic reptiles that live throughout the tropics. The crocodile has the most powerful bite ever measured for living animals.'),
    block("The crocodile's jaw is also incredibly sensitive to touch, even more sensitive than the human fingertip."),
    ...comprehensionQuestionWithInlineAnswer(51, 'According to the passage, the word hatchlings means young animals that have recently emerged from the …',
      ['womb.', 'water.', 'leaves.', 'eggs.'], 'D'),
    ...comprehensionQuestionWithInlineAnswer(52, "The crocodile's jaw has a high sense of …",
      ['touch.', 'taste.', 'smell.', 'sight.'], 'A'),
  ]

  const warnings = []
  const { sections, summary } = processImportedQuestionBlocks(blocks, warnings)

  assert.equal(summary.passages, 2, `expected 2 passages, got ${summary.passages}`)
  assert.equal(summary.questions, 4, `expected 4 questions, got ${summary.questions}`)

  const passageSections = sections.filter(section => section.kind === 'passage')
  assert.deepEqual(
    passageSections.map(section => section.passage.title),
    ['Story 1', 'Story 2'],
  )

  // Each story keeps its own passage text and its own two questions — the
  // story is not swallowed into a previous question and the questions are not
  // emitted as bare standalones.
  assert.match(plainRichText(passageSections[0].passage.passageText), /grandson of a headman/i)
  assert.match(plainRichText(passageSections[0].passage.passageText), /witchdoctor chewed some roots/i)
  assert.equal(passageSections[0].passage.questions.length, 2)

  assert.match(plainRichText(passageSections[1].passage.passageText), /Crocodiles are large semiaquatic reptiles/i)
  // Story 1's text must NOT leak into Story 2's passage.
  assert.doesNotMatch(plainRichText(passageSections[1].passage.passageText), /grandson of a headman/i)
  assert.equal(passageSections[1].passage.questions.length, 2)

  // Inline answers resolve against the right option for grouped questions.
  const q46 = findQuestion(sections, 46)
  assert.ok(q46, 'Q46 must be grouped under Story 1, not dropped')
  assert.equal(q46.correctAnswer, 1) // B
  const q51 = findQuestion(sections, 51)
  assert.ok(q51, 'Q51 must be grouped under Story 2, not dropped')
  assert.equal(q51.correctAnswer, 3) // D
}

runBareStoryLabelTest()

/**
 * Past-paper regression: G7 Mathematics 2023 (and any docx that opens
 * with a "Answer ALL N questions. Choose the BEST answer." intro and
 * later has a per-question prompt that happens to start with an
 * imperative verb like "List …" / "Find …" inside a diagram question).
 *
 * Three distinct bugs were stamping the wrong shared instruction on the
 * wrong questions:
 *
 * 1. The doc's intro instruction was previously stamped onto Q1's
 *    sharedInstruction, making Q1 look like a special question with a
 *    document-level prompt. The intro now lifts to parts[0].instructions
 *    instead, so every numbered question's sharedInstruction stays empty
 *    unless the source genuinely had a per-question prompt.
 *
 * 2. Once the parser captured the doc's intro instruction it was stamped
 *    onto every subsequent question forever, because neither the
 *    preprocessor's `currentInstruction` nor the parser's local
 *    `sharedInstruction` was cleared after being consumed by a
 *    numbered question.
 *
 * 3. When a per-question prompt that looks like a teacher instruction
 *    appeared between the question's diagram and its options (e.g.
 *    "List set A ∪ B." under a Venn diagram), the parser would close
 *    the question with empty options AND promote the line to a stale
 *    sharedInstruction that then leaked onto the next 25+ questions.
 */
function runIntroInstructionLeakTest() {
  const intro = 'Answer ALL 60 questions. Choose the BEST answer for each question.'
  const fixture = [
    block(intro),
    // Q1 — should be the only question carrying the intro instruction.
    block('1.  The perimeter of the following trapezium is …'),
    block('A  32 cm'),
    block('B  42 cm'),
    block('C  52 cm'),
    block('D  62 cm'),
    block('Answer: C — 52 cm'),
    // Q2 — must NOT inherit Q1's intro instruction.
    block('2.  367 452 + 456 577 ='),
    block('A  824 029'),
    block('B  823 929'),
    block('C  813 929'),
    block('D  813 029'),
    block('Answer: D — 813 029'),
    // Q35 — Venn-diagram question whose actual prompt ("List set A ∪ B.")
    // sits between the figure line and the options. Pre-fix this dropped
    // Q35's options entirely and stamped "List set A ∪ B." onto Q36.
    block('35.  Study the Venn diagram below.'),
    block('[Venn diagram: E = universal set; A = {k, l, m, n, o} overlapping with B = {o, p, q, r, s}; t is outside both]'),
    block('List set A ∪ B.'),
    block('A  {l, o, r}'),
    block('B  {l, o, r, s}'),
    block('C  {k, l, m, n, o, p, q, r, s}'),
    block('D  {k, l, m, n, o, p, q, r, s, t}'),
    block('Answer: D — {k, l, m, n, o, p, q, r, s, t}'),
    // Q36 — must NOT inherit Q35's "List set A ∪ B." prompt.
    block('36.  What is the name of the following shape?'),
    block('A  Cuboid'),
    block('B  Cylinder'),
    block('C  Trapezium'),
    block('D  Triangular prism'),
    block('Answer: D — Triangular prism'),
  ]

  const { sections, parts, documentInstruction } = processImportedQuestionBlocks(fixture, [])
  const q1 = findStandaloneQuestion(sections, 1)
  const q2 = findStandaloneQuestion(sections, 2)
  const q35 = findStandaloneQuestion(sections, 35)
  const q36 = findStandaloneQuestion(sections, 36)

  assert.ok(q1, 'Q1 must parse')
  assert.ok(q2, 'Q2 must parse')
  assert.ok(q35, 'Q35 must parse')
  assert.ok(q36, 'Q36 must parse')

  // Bug 1: the doc-level intro lives on parts[0].instructions, not on
  // Q1's per-question prompt — every numbered question's sharedInstruction
  // should remain empty unless the source had a real per-question prompt.
  assert.equal(documentInstruction, intro,
    'documentInstruction should expose the doc-level intro')
  assert.ok(parts.length >= 1, 'a default Part should be created to own the intro')
  assert.equal(plainRichText(parts[0].instructions), intro,
    'parts[0].instructions should carry the doc intro')
  assert.equal(plainRichText(q1.sharedInstruction), '',
    'Q1 must not also carry the doc intro on its per-question prompt')
  assert.equal(plainRichText(q2.sharedInstruction), '',
    'Q2 must not inherit Q1\'s intro instruction')

  // Bug 2a: Q35 must keep its four options instead of being closed early
  // when the parser hits "List set A ∪ B.".
  const q35Options = q35.options.filter(opt => opt && opt.length)
  assert.equal(q35Options.length, 4,
    'Q35 must retain all four options when an instruction-shaped line sits between its figure and options')
  assert.equal(q35.correctAnswer, 3,
    'Q35 correct answer index should still parse as D')

  // Bug 2b: the "List set A ∪ B." prompt must not leak onto Q36.
  assert.equal(plainRichText(q36.sharedInstruction), '',
    'Q36 must not inherit Q35\'s in-question prompt as a shared instruction')
  const q36Options = q36.options.filter(opt => opt && opt.length)
  assert.equal(q36Options.length, 4, 'Q36 should still parse all four options')
}

runIntroInstructionLeakTest()

function findStandaloneQuestion(sections, sourceQuestionNumber) {
  return sections
    .filter(section => section.kind !== 'passage')
    .map(section => section.question)
    .find(question => String(question?.sourceQuestionNumber) === String(sourceQuestionNumber))
}

// Regression test for the "instructions go somewhere else" bug. Before the
// fix, an instruction line that appeared between question N's options and
// question N+1 was dumped into question N's explanation and never appeared
// as the instruction for question N+1. It also had to handle imperative
// instruction verbs that the strict standalone regex didn't match.
function runInstructionRoutingTest() {
  const blocks = [
    block('1. The capital of France is ___.'),
    block('A. Berlin'),
    block('B. Paris'),
    block('C. London'),
    block('D. Madrid'),
    // A new instruction sneaks in right after Q1's options. It uses an
    // imperative verb ("Underline") that the original strict regex missed.
    block('Underline the verb in each of the following sentences.'),
    block('2. The boy ran home after school.'),
    block('A. boy'),
    block('B. ran'),
    block('C. home'),
    block('D. school'),
    // A second imperative-style instruction with a trailing colon.
    block('Match each animal with its young:'),
    block('3. Cow'),
    block('A. kid'),
    block('B. calf'),
    block('C. lamb'),
    block('D. foal'),
  ]

  const warnings = []
  const { sections } = processImportedQuestionBlocks(blocks, warnings)

  const q1 = findStandaloneQuestion(sections, 1)
  const q2 = findStandaloneQuestion(sections, 2)
  const q3 = findStandaloneQuestion(sections, 3)

  assert.ok(q1, 'Q1 should be parsed')
  assert.ok(q2, 'Q2 should be parsed')
  assert.ok(q3, 'Q3 should be parsed')

  // Q1's explanation MUST NOT contain the instruction that follows it.
  assert.doesNotMatch(plainRichText(q1.explanation), /underline the verb/i,
    'Q1 explanation should not contain the next instruction line.')

  // Q2 should pick up the "Underline..." instruction.
  assert.match(plainRichText(q2.sharedInstruction), /underline the verb/i,
    'Q2 should inherit the "Underline" instruction line.')

  // Q2's explanation MUST NOT contain the next "Match..." instruction.
  assert.doesNotMatch(plainRichText(q2.explanation), /match each animal/i,
    'Q2 explanation should not contain the next instruction line.')

  // Q3 should pick up the "Match..." instruction.
  assert.match(plainRichText(q3.sharedInstruction), /match each animal/i,
    'Q3 should inherit the "Match each animal" instruction line.')
}

runInstructionRoutingTest()

// Regression test: an instruction that appears BEFORE the first question of
// a section, with no explicit "Instruction:" prefix and no question yet
// active, must not be silently dropped.
function runPreQuestionInstructionTest() {
  const blocks = [
    block('Section A: Vocabulary'),
    block('Underline the correct word in each sentence.'),
    block('1. He ___ to school every day.'),
    block('A. go'),
    block('B. goes'),
    block('C. going'),
    block('D. gone'),
  ]

  const warnings = []
  const { sections } = processImportedQuestionBlocks(blocks, warnings)
  const q1 = findStandaloneQuestion(sections, 1)
  assert.ok(q1, 'Q1 should be parsed')
  assert.match(plainRichText(q1.sharedInstruction), /underline the correct word/i,
    'Q1 should inherit the pre-question instruction.')
}

runPreQuestionInstructionTest()

// Regression test for the "stem text bleeds into the wrong slot" bug. Past-
// paper imports where the next question's number prefix went missing (Word
// table flattened, PDF column reflow, etc.) used to cascade every subsequent
// trailing line into Q1's explanation/stem, ballooning Q1 with Q2/Q3 content
// and silently dropping Q2 from the editor. This mirrors the screenshot
// failure where Q1 carried two "Extra text after options" warnings.
function runStemBleedGuardTest() {
  const blocks = [
    block('1. What is the capital of France?'),
    block('A. Berlin'),
    block('B. Paris'),
    block('C. London'),
    block('D. Madrid'),
    // A stray line of context that doesn't match any structural pattern —
    // permitted to land as Q1's explanation, but only once.
    block('Paris is in Western Europe.'),
    // Next question lost its "2." prefix during extraction. Before the fix
    // this bled into Q1's stem because it ends with `?` and Q1 already had
    // options.
    block('What is the capital of Germany?'),
    block('A. Paris'),
    block('B. Madrid'),
    block('C. Berlin'),
    block('D. Rome'),
  ]

  const warnings = []
  const { sections, summary } = processImportedQuestionBlocks(blocks, warnings)
  const allQuestions = allQuestionsFromSections(sections)

  assert.equal(allQuestions.length, 2,
    'both questions must survive even when the second loses its number prefix')
  assert.equal(summary.questions, 2)

  const q1 = allQuestions[0]
  assert.match(plainRichText(q1.text), /capital of france/i,
    'Q1 stem must remain "capital of France"')
  assert.doesNotMatch(plainRichText(q1.text), /capital of germany/i,
    'Q1 stem must not absorb the next question stem')
  assert.doesNotMatch(plainRichText(q1.explanation), /capital of germany/i,
    'Q1 explanation must not absorb the next question stem')

  const q2 = allQuestions[1]
  assert.match(plainRichText(q2.text), /capital of germany/i,
    'Q2 must be recognised as its own question')
  assert.equal(q2.options.length, 4, 'Q2 must keep its own options')
  // Q2's options must match the source order — the cascade used to overwrite
  // them with Q3's "A. Rome" / "B. Venice" etc.
  assert.match(q2.options[0], /paris/i)
  assert.match(q2.options[1], /madrid/i)
  assert.match(q2.options[2], /berlin/i)
  assert.match(q2.options[3], /rome/i)
}

runStemBleedGuardTest()

// Regression test for the "vertical arithmetic question is lost / footer
// becomes a phantom question" bugs reproduced on G7_Mathematics_2023:
//
// - The source lays Q6 out as `6.` / `954 751` / `− 362 948` / `─────────`
//   in four separate Word paragraphs. Before the fix, `6.` failed to
//   match QUESTION_RE (which requires `(.+)$` after the punctuation),
//   was absorbed into Q5's explanation, and Q6 either disappeared or
//   showed up as an unnumbered "Q?" with the wrong stem.
// - The doc ends with `STOP! PLEASE CHECK ALL YOUR WORK CAREFULLY` and
//   `©G7/Mathematics/2023`. Before the fix, the stem-bleed guard treated
//   each trailing line as the stem of a new question, inflating the
//   question count by 1-2 and producing footer-as-Q entries.
function runOrphanNumberAndFooterTest() {
  const blocks = [
    // Q5 (already complete) — establishes that the orphan-number
    // preprocessor doesn't interfere with normal questions.
    block('5. Find the Highest Common Factor of 9 and 12.'),
    block('A 12'),
    block('B 9'),
    block('C 3'),
    block('D 1'),
    block('Answer: C — 3'),
    // Q6 — vertical arithmetic, four-paragraph layout.
    block('6.'),
    block('954 751'),
    block('− 362 948'),
    block('─────────'),
    block('A 691 813'),
    block('B 592 803'),
    block('C 591 813'),
    block('D 591 803'),
    block('Answer: C — 591 803'),
    // Q7 — normal numbered question, follows Q6.
    block('7. Find the next number in the sequence below.'),
    block('98, 92, 86, 80, ___'),
    block('A 78'),
    block('B 74'),
    block('C 68'),
    block('D 64'),
    block('Answer: B — 74'),
    // Trailing footer lines — must NOT become phantom questions.
    block('STOP! PLEASE CHECK ALL YOUR WORK CAREFULLY'),
    block('©G7/Mathematics/2023'),
  ]

  const warnings = []
  const { sections, summary } = processImportedQuestionBlocks(blocks, warnings)
  const standalones = sections
    .filter(s => s.kind !== 'passage')
    .map(s => s.question)

  // Exactly three questions — Q5, Q6, Q7. No phantom Q? from the footer.
  assert.equal(standalones.length, 3,
    `exactly three questions expected — saw ${standalones.length}`)
  assert.equal(summary.questions, 3)

  const q5 = findStandaloneQuestion(sections, 5)
  const q6 = findStandaloneQuestion(sections, 6)
  const q7 = findStandaloneQuestion(sections, 7)

  assert.ok(q5, 'Q5 must parse')
  assert.ok(q6, 'Q6 must parse with the correct source question number')
  assert.ok(q7, 'Q7 must parse')

  // Q5 must not have absorbed the orphan `6.` into its explanation.
  assert.doesNotMatch(plainRichText(q5.explanation), /^6\.?\s*$/,
    'Q5 explanation must not contain the orphan question-number marker')
  // No reviewNotes complaining about absorbed extra text.
  assert.deepEqual(q5.reviewNotes, [],
    `Q5 should have no review notes — saw ${JSON.stringify(q5.reviewNotes)}`)

  // Q6 keeps its source number AND captures the multi-paragraph stem
  // (vertical-arithmetic operands and the underline).
  assert.equal(q6.options.length, 4, 'Q6 must have all four options')
  assert.match(plainRichText(q6.text), /954 751/, 'Q6 stem must contain 954 751')
  assert.match(plainRichText(q6.text), /362 948/, 'Q6 stem must contain 362 948')
  assert.equal(q6.correctAnswer, 2, 'Q6 correct answer index is C → 2')

  // Confirm no question survived the footer (no phantom Q with copyright
  // text or "STOP!" as stem).
  const phantom = standalones.find(q => /©|stop!|copyright/i.test(plainRichText(q.text)))
  assert.equal(phantom, undefined,
    `no question should be created from the document footer — saw ${JSON.stringify(phantom)}`)
}

runOrphanNumberAndFooterTest()

// Regression: data context (a real `<w:tbl>` between a question's stem
// and its options, or a `[Bar graph: …]` / `[Pie chart: …]` / `[Map: …]`
// bracketed reference) used to flatten into the question's stem field —
// e.g. Q4's stem becoming "The table shows… Days Monday Tuesday … 42 19
// 0 39 1 40 On which day was the highest…?" which made the editor card
// unreadable. The parser now routes both forms into question.diagramText
// so the stem stays clean and the data context is rendered as
// supplementary content.
function runDataContextSplitTest() {
  const blocks = [
    // Q4 — real DOCX table sits BETWEEN the lead-in and the interrogative.
    // buildDocxTableBlocks (in production) emits one block per row tagged
    // source='docx-table'; we emulate that shape directly here.
    block('4. The table shows the number of oranges collected by a farmer from his orchard.'),
    { text: 'Days\nMonday\nTuesday', source: 'docx-table', assets: [], numberedList: false },
    { text: 'Number of oranges\n42\n19', source: 'docx-table', assets: [], numberedList: false },
    block('On which day was the highest number of oranges collected?'),
    block('A Friday'),
    block('B Monday'),
    block('C Saturday'),
    block('D Wednesday'),
    block('Answer: C — Saturday'),
    // Q11 — bracketed Bar graph placeholder. Before the regex fix this
    // stayed in the stem because `graph` wasn't in the keyword list.
    block('11. The graph shows the number of bags of maize harvested by a farmer in five days.'),
    block('[Bar graph: Mon ≈ 20, Tue ≈ 20, Wed ≈ 25, Thu ≈ 15, Fri ≈ 10 bags]'),
    block('How many bags of maize were harvested on Tuesday?'),
    block('A 25'),
    block('B 20'),
    block('C 10'),
    block('D 5'),
    block('Answer: B — 20'),
    // Q12 — `[Map: …]` placeholder, also previously missed.
    block('12. Use the map below to answer the question.'),
    block('[Map: provinces of Zambia, shaded for population density]'),
    block('Which province has the highest population density?'),
    block('A Lusaka'),
    block('B Copperbelt'),
    block('C Eastern'),
    block('D Western'),
    block('Answer: A — Lusaka'),
  ]

  const warnings = []
  const { sections } = processImportedQuestionBlocks(blocks, warnings)
  const q4 = findStandaloneQuestion(sections, 4)
  const q11 = findStandaloneQuestion(sections, 11)
  const q12 = findStandaloneQuestion(sections, 12)

  assert.ok(q4, 'Q4 must parse')
  assert.ok(q11, 'Q11 must parse')
  assert.ok(q12, 'Q12 must parse')

  // Q4 — table data must be in diagramText, not stem. Stem must NOT
  // include `Days Monday` or the numeric column values.
  assert.doesNotMatch(plainRichText(q4.text), /\bDays\s+Monday\b/,
    'Q4 stem must not absorb table column headers')
  assert.doesNotMatch(plainRichText(q4.text), /\b42 19\b/,
    'Q4 stem must not absorb table numeric cells')
  assert.match(String(q4.diagramText || ''), /Days/,
    'Q4 diagramText should carry the column headers')
  assert.match(String(q4.diagramText || ''), /42/,
    'Q4 diagramText should carry the numeric cells')
  // Stem still has both the lead-in AND the interrogative.
  assert.match(plainRichText(q4.text), /table shows the number of oranges/i)
  assert.match(plainRichText(q4.text), /On which day was the highest/i)
  assert.equal(q4.correctAnswer, 2, 'Q4 correct answer index is C → 2')

  // Q11 — `[Bar graph: …]` must be stripped from stem and land in
  // diagramText. The current bracketed regex used to miss `graph` /
  // `chart` / `map` keywords entirely.
  assert.doesNotMatch(plainRichText(q11.text), /\[Bar graph/i,
    'Q11 stem must not contain the bar-graph placeholder')
  assert.match(String(q11.diagramText || ''), /Bar graph/i,
    'Q11 diagramText must carry the bar-graph placeholder')

  // Q12 — same for `[Map: …]`.
  assert.doesNotMatch(plainRichText(q12.text), /\[Map:/i,
    'Q12 stem must not contain the map placeholder')
  assert.match(String(q12.diagramText || ''), /Map:/i,
    'Q12 diagramText must carry the map placeholder')
}

runDataContextSplitTest()

// Phase 3: a DOCX table row that carries one image per option cell should
// produce a question with optionMedia[] pointing at those images — not a
// question stem image with the option images discarded.
function runOptionImageAttributionTest() {
  const optAAsset = { id: 'asset-A', imageUrl: 'blob:opt-A' }
  const optBAsset = { id: 'asset-B', imageUrl: 'blob:opt-B' }
  const optCAsset = { id: 'asset-C', imageUrl: 'blob:opt-C' }
  const optDAsset = { id: 'asset-D', imageUrl: 'blob:opt-D' }

  // Simulates the block buildDocxTableBlocks emits for a row whose 4 option
  // cells each carry "A. <img>" / "B. <img>" / "C. <img>" / "D. <img>". The
  // "(image)" placeholders are what tryImageOptionsRow synthesises so the
  // parser's OPTION_RE matches; the parser then blanks them out when an
  // attributed asset is found for that option.
  const tableBlock = {
    text: '1. Which animal is the elephant?\nA. (image)\nB. (image)\nC. (image)\nD. (image)',
    assets: [],
    source: 'docx',
    optionAssetsByLetter: {
      A: optAAsset,
      B: optBAsset,
      C: optCAsset,
      D: optDAsset,
    },
  }

  const warnings = []
  const { sections } = processImportedQuestionBlocks([tableBlock], warnings)
  const q1 = findStandaloneQuestion(sections, 1)
  assert.ok(q1, 'image-option question must parse out of the table block')

  assert.ok(Array.isArray(q1.optionMedia) && q1.optionMedia.length >= 4,
    'optionMedia[] should be populated for all four option assets')
  assert.equal(q1.optionMedia[0]?.imageAssetId, 'asset-A',
    'option A media should point at the A asset')
  assert.equal(q1.optionMedia[3]?.imageAssetId, 'asset-D',
    'option D media should point at the D asset')

  // Per-option assets must NOT also surface as the stem image — otherwise
  // the question stem would show option A's image and confuse the learner.
  assert.equal(q1.imageAssetId, '',
    'question stem must not claim any of the option-attributed assets')
  assert.equal(q1.imageUrl, '',
    'question stem image URL must stay empty when all assets are option images')

  // Imported alt text seeded so the pre-publish checklist surfaces a review
  // prompt rather than failing validation silently.
  assert.match(q1.optionMedia[0]?.alt || '', /option a/i,
    'alt text should be seeded with the option letter for accessibility')
}

runOptionImageAttributionTest()

// Regression: G7_Mathematics_2023 past-paper docx triggered five distinct
// import-mapping bugs at once. This test pins the field-routing fixes so
// future parser changes can't silently reintroduce them.
function runG7PastPaperMappingTest() {
  // metadataFromText must NOT pick the institution name as the title, must
  // accept word-spelled grades ("GRADE SEVEN"), and must not surface a
  // topic field — imported papers span many CBC topics and the teacher
  // should pick (or leave blank) rather than have the title stamped in.
  const headerText = [
    'EXAMINATIONS COUNCIL OF ZAMBIA',
    'GRADE SEVEN COMPOSITE EXAMINATION – 2023',
    'Mathematics',
    'SUBJECT 3/1     |     TIME ALLOWED: 90 MINUTES',
    'Answer ALL 60 questions. Choose the BEST answer for each question.',
    '1.  The perimeter of the following trapezium is …',
    'A  Grade 8 learner foil should not move the grade reading away from seven.',
  ].join('\n')
  const metadata = metadataFromText(headerText, 'G7_Mathematics_2023_Past_Paper.docx')
  assert.equal(metadata.title, 'GRADE SEVEN COMPOSITE EXAMINATION – 2023',
    'title should prefer the paper-y header line, not the institution name')
  assert.equal(metadata.grade, '7',
    'grade should be derived from the header "GRADE SEVEN", not "Grade 8" inside a later question')
  assert.equal(metadata.subject, 'mathematics',
    'subject should return the curriculum ID, not the display label')
  assert.equal(metadata.topic, undefined,
    'topic must not be present on imported metadata')

  // Parser: a [Diagram: …] line with nested parens used to leak into the
  // question text AND populate diagramText, putting the caption in two
  // fields. Fix: it now goes only to diagramText.
  const fixture = [
    block('Answer ALL 60 questions. Choose the BEST answer for each question.'),
    block('1.  The perimeter of the following trapezium is …'),
    block('[Diagram: trapezium with sides 18 cm (top), 7 cm (left), 9 cm (right), 26 cm (bottom)]'),
    block('A  32 cm'),
    block('B  42 cm'),
    block('C  52 cm'),
    block('D  62 cm'),
    block('Answer: C — 52 cm'),
    // A second question whose diagram caption keyword is NOT the first
    // token inside the brackets ("Shapes diagram"). The old regex only
    // matched when the keyword led; this asserts the new regex catches
    // the keyword anywhere inside the bracket.
    block('30.  Which of the following shapes is a regular hexagon?'),
    block('[Shapes diagram: I = square, II = rhombus/diamond, III = hexagon, IV = pentagon]'),
    block('A  IV'),
    block('B  III'),
    block('C  II'),
    block('D  I'),
    block('Answer: B — III'),
  ]
  const result = processImportedQuestionBlocks(fixture, [])
  const q1 = findStandaloneQuestion(result.sections, 1)
  const q30 = findStandaloneQuestion(result.sections, 30)
  assert.ok(q1 && q30, 'Q1 and Q30 must parse')

  // The bracketed diagram description must be stripped from the question
  // text, but preserved as diagramText so the editor still shows it.
  assert.doesNotMatch(plainRichText(q1.text), /\[Diagram:/i,
    'Q1 stem must not contain the bracketed diagram caption')
  assert.match(q1.diagramText || '', /trapezium with sides 18 cm/i,
    'Q1 diagramText must keep the caption (so the editor can render it)')
  assert.doesNotMatch(plainRichText(q30.text), /\[Shapes diagram:/i,
    'Q30 stem must not contain the bracketed Shapes-diagram caption')
  assert.match(q30.diagramText || '', /I = square/i,
    'Q30 diagramText must keep the caption even though the keyword is not the first token')

  // The leading "Answer ALL …" intro must lift to parts[0].instructions
  // rather than land on Q1's sharedInstruction.
  assert.equal(plainRichText(q1.sharedInstruction), '',
    'Q1 sharedInstruction must be empty — the doc-level intro lives on the part, not the question')
  assert.ok(result.parts.length >= 1, 'a default Part should be created to own the intro')
  assert.match(plainRichText(result.parts[0].instructions), /Answer ALL 60 questions/i,
    'parts[0].instructions should carry the doc-level intro')

  // No topic on individual questions either — empty string from the parser.
  assert.equal(q1.topic ?? '', '',
    'Q1.topic must be empty — imports do not stamp topic per-question')
}

runG7PastPaperMappingTest()

// ─── Stray-symbol cleaning (Expressive Arts paper regression) ─────────────
// Grade 7 Expressive Arts (and any paper converted from a Word document with
// encoding issues) may contain garbage Unicode characters that render as
// visible "symbols" in the browser:
//
//   U+FFFD  Unicode replacement character — encoding error artifact
//   U+FEFF  BOM / zero-width no-break space
//   U+200B–U+200D, U+2060–U+2064  zero-width / invisible chars
//   U+00AD  soft hyphen (renders as '-' in some browsers)
//   U+0000–U+001F (except tab/LF/CR)  C0 control characters
//   U+0080–U+009F  C1 control characters (Windows-1252 range)
//
// The fix adds a stripping pass at the top of cleanImportedText so newly
// imported papers never store these chars. The render-time path in
// richTextToPlainText also strips them so existing Firestore data is fixed
// without a migration.
function runGarbageSymbolCleanTest() {
  // Helper: feed raw text through the full parser and find the given question.
  function parseAndFind(rawText, questionNumber) {
    const warnings = []
    const { sections } = processImportedQuestionBlocks(
      [block(rawText)],
      warnings,
    )
    return allQuestionsFromSections(sections).find(
      q => String(q?.sourceQuestionNumber) === String(questionNumber),
    )
  }

  // 1. U+FFFD replacement char in a question stem.
  const q1 = parseAndFind(
    '1. Which instrument is used in �Expressive Arts class?',
    1,
  )
  assert.ok(q1, 'Q1 with U+FFFD must parse')
  assert.doesNotMatch(plainRichText(q1.text), /\ufffd/,
    'U+FFFD (replacement char) must be stripped from question text')
  assert.match(plainRichText(q1.text), /Expressive Arts class/,
    'surrounding text must be preserved after U+FFFD removal')

  // 2. U+200B zero-width space inside an option.
  const q2Blocks = [
    block('2. What is the primary colour?'),
    block('A. Red'),
    block('B. Green​'),
    block('C. Blue'),
    block('D. Yellow'),
  ]
  const { sections: s2 } = processImportedQuestionBlocks(q2Blocks, [])
  const q2 = allQuestionsFromSections(s2).find(q => String(q?.sourceQuestionNumber) === '2')
  assert.ok(q2, 'Q2 with U+200B in option must parse')
  assert.ok(q2.options.every(opt => !/[\u200b-\u200d]/.test(opt)),
    'zero-width space must be stripped from all options')

  // 3. U+FEFF BOM at the start of a question.
  const q3 = parseAndFind(
    '﻿3. Name a traditional Zambian musical instrument.',
    3,
  )
  assert.ok(q3, 'Q3 with U+FEFF BOM must parse')
  assert.doesNotMatch(plainRichText(q3.text), /\ufeff/,
    'U+FEFF BOM must be stripped')
  assert.match(plainRichText(q3.text), /Zambian musical instrument/,
    'question text must survive BOM removal')

  // 4. Soft hyphen U+00AD inside "Expressive Arts" (the exact subject name
  //    that appeared in the reported bug — ECZ docs emit soft hyphens after
  //    long compound words when the doc had auto-hyphenation enabled).
  const q4 = parseAndFind(
    '4. Ex­pressive Arts is taught in which term?',
    4,
  )
  assert.ok(q4, 'Q4 with soft hyphen must parse')
  assert.doesNotMatch(plainRichText(q4.text), /\u00ad/,
    'soft hyphen (U+00AD) must be stripped')
  assert.match(plainRichText(q4.text), /Expressive Arts/,
    'word must be joined after soft-hyphen removal')

  // 5. C0 control chars (e.g. U+0007 BEL, U+001F US) in question text.
  const q5 = parseAndFind(
    '5. Identify\u0007 the correct\u001f rhythm.',
    5,
  )
  assert.ok(q5, 'Q5 with C0 control chars must parse')
  // eslint-disable-next-line no-control-regex
  assert.doesNotMatch(plainRichText(q5.text), /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/,
    'C0 control chars must be stripped (except tab/LF/CR)')
  assert.match(plainRichText(q5.text), /Identify the correct rhythm/,
    'surrounding words must survive C0 stripping')

  // 6. C1 control chars (e.g. U+0082 BPH, U+009F APC) in question text.
  const q6 = parseAndFind(
    '6. What is a tempo?',
    6,
  )
  assert.ok(q6, 'Q6 with C1 control chars must parse')
  assert.doesNotMatch(plainRichText(q6.text), /[\u0080-\u009f]/,
    'C1 control chars must be stripped')
  assert.match(plainRichText(q6.text), /What is a tempo/,
    'words must survive C1 stripping')

  // 7. Mixed garbage burst — multiple junk chars in a single question, plus
  //    real non-ASCII chars (Cinyanja phrase) that MUST be preserved.
  const q7Blocks = [
    block('7. �ANsonga​ ya ﻿uluzi­ ndiani?'),
    block('A. Nsonga yoyamba'),
    block('B. Nsonga yachiwiri'),
    block('C. Nsonga yachitatu'),
    block('D. Nsonga yachineyi'),
  ]
  const { sections: s7 } = processImportedQuestionBlocks(q7Blocks, [])
  const q7 = allQuestionsFromSections(s7).find(q => String(q?.sourceQuestionNumber) === '7')
  assert.ok(q7, 'Q7 with mixed garbage in Cinyanja question must parse')
  // Junk stripped:
  assert.doesNotMatch(plainRichText(q7.text), /\ufffd/, 'replacement char stripped')
  assert.doesNotMatch(plainRichText(q7.text), /\u200b/, 'zero-width space stripped')
  assert.doesNotMatch(plainRichText(q7.text), /\ufeff/, 'BOM stripped')
  assert.doesNotMatch(plainRichText(q7.text), /\u00ad/, 'soft hyphen stripped')
  // Legitimate Cinyanja text preserved:
  assert.match(plainRichText(q7.text), /Nsonga/,
    'Cinyanja word "Nsonga" must not be destroyed')
  assert.match(plainRichText(q7.text), /uluzi/,
    'Cinyanja word "uluzi" must not be destroyed')
  assert.equal(q7.options.length, 4, 'all four options must survive')
}

runGarbageSymbolCleanTest()

// ── Worked examples skipped ─────────────────────────────────────────────────
// Grade-seven papers often include an unnumbered "Example" immediately before
// the real numbered run. The example may itself contain "1." plus A-D options,
// which previously inflated the import count and shifted the real paper's
// questions. Examples are teaching scaffolds, not assessable questions.
function runWorkedExampleSkipTest() {
  const blocks = [
    block('PART 1'),
    block('Example'),
    block('1. Which word is an adjective?'),
    block('A. quickly'),
    block('B. blue'),
    block('C. under'),
    block('D. sing'),
    block('Answer: B'),
    block('Now do questions 1-2'),
    block('1. Which word is a noun?'),
    block('A. run'),
    block('B. table'),
    block('C. quickly'),
    block('D. under'),
    block('2. Which sentence is correctly punctuated?'),
    block('A. we went home.'),
    block('B. We went home.'),
    block('C. We went home'),
    block('D. we went home'),
  ]

  const { sections, summary } = processImportedQuestionBlocks(blocks, [])
  const questions = allQuestionsFromSections(sections)
  assert.equal(summary.questions, 2,
    `worked examples must not become questions, got ${summary.questions}`)
  assert.deepEqual(
    questions.map(q => Number(q.sourceQuestionNumber)),
    [1, 2],
    'the real Q1/Q2 remain after the example is skipped',
  )
  assert.ok(questions.every(q => !/adjective|blue/i.test(plainRichText(q.text))),
    'example stem/options must not leak into imported question text')
}

runWorkedExampleSkipTest()

// ── Duplicate-question collapse ──────────────────────────────────────────────
// Reproduces the "a 60-question paper imports as 64, with some questions
// appearing twice" report. Three duplication shapes are exercised; the parser
// must emit only the real questions.
function runDuplicateImportTest() {
  // 1. An answer/solutions list whose heading ("Solutions") ANSWER_KEY_HEADING_RE
  //    doesn't recognise, so each `1. B` row parsed as a brand-new question with
  //    stem "B" and no options. These must be dropped, not counted.
  const answerKeyLeak = [
    block('1. What is 2 + 2?'),
    block('A. 3'),
    block('B. 4'),
    block('C. 5'),
    block('D. 6'),
    block('2. What is 3 + 3?'),
    block('A. 5'),
    block('B. 6'),
    block('C. 7'),
    block('D. 8'),
    block('Solutions'),
    block('1. B'),
    block('2. B'),
  ]
  const leakWarnings = []
  const { sections: leakSections, summary: leakSummary } =
    processImportedQuestionBlocks(answerKeyLeak, leakWarnings)
  assert.equal(leakSummary.questions, 2,
    `answer-key fragments must be dropped, got ${leakSummary.questions}`)
  const leakNumbers = allQuestionsFromSections(leakSections)
    .map(q => Number(q.sourceQuestionNumber))
  assert.deepEqual(leakNumbers, [1, 2], 'only the two real questions survive')
  assert.ok(leakWarnings.some(w => /duplicate/i.test(w)),
    'a warning must tell the teacher duplicates were removed')

  // 2. The same numbered question detected twice (a wrapped stem re-triggered a
  //    new question). The more complete copy — the one that kept its options —
  //    must be the survivor.
  const sameNumberTwice = [
    block('5. What is the capital of Zambia?'),
    block('A. Lusaka'),
    block('B. Ndola'),
    block('C. Kitwe'),
    block('D. Livingstone'),
    block('5. What is the capital of Zambia?'),
  ]
  const { sections: dupSections } = processImportedQuestionBlocks(sameNumberTwice, [])
  const fives = allQuestionsFromSections(dupSections)
    .filter(q => String(q.sourceQuestionNumber) === '5')
  assert.equal(fives.length, 1, 'a repeated Q5 must collapse to one question')
  assert.equal(fives[0].options.length, 4, 'the complete copy (with options) wins')

  // 3. Two questions with byte-identical content emitted at different positions
  //    collapse even when they carry no number.
  const identicalContent = [
    block('Which gas do plants absorb? A. Oxygen B. Carbon dioxide C. Nitrogen D. Helium'),
    block('Which gas do plants absorb? A. Oxygen B. Carbon dioxide C. Nitrogen D. Helium'),
  ]
  const { summary: identicalSummary } = processImportedQuestionBlocks(identicalContent, [])
  assert.equal(identicalSummary.questions, 1,
    `identical questions must collapse, got ${identicalSummary.questions}`)
}

runDuplicateImportTest()

function runHeaderFooterNoiseTest() {
  // Unit: the classifier catches page markers + exam-footer slash chains, and
  // leaves real content (including a bare number-only stem) alone.
  assert.equal(isRunningHeaderFooterLine('Page 6 of 14'), true)
  assert.equal(isRunningHeaderFooterLine('Page 12'), true)
  assert.equal(isRunningHeaderFooterLine('6 of 14'), true)
  assert.equal(isRunningHeaderFooterLine('PSME/English Language/PRISCA/2026'), true)
  assert.equal(isRunningHeaderFooterLine('PSLE/English/2025'), true)
  assert.equal(isRunningHeaderFooterLine('©G7/Mathematics/2023'), true)
  // Negatives — must NOT be treated as noise.
  assert.equal(isRunningHeaderFooterLine('26.'), false, 'a number-only stem is not a page marker')
  assert.equal(isRunningHeaderFooterLine('How many countries are there in Africa?'), false)
  assert.equal(isRunningHeaderFooterLine('Which of these is a fraction: 1/2 or 3/4 in 2020 terms?'), false)

  // Parse-level: page markers + the running footer must NOT spawn questions or
  // attach as an explanation. Two real questions survive; the noise is dropped.
  const blocks = [
    block('Page 6 of 14'),
    block('1. Which gas do plants absorb? A. Oxygen B. Carbon dioxide C. Nitrogen D. Helium'),
    block('PSME/English Language/PRISCA/2026'),
    block('2. What colour is the sky? A. Blue B. Green C. Red D. Yellow'),
    block('Page 7 of 14'),
  ]
  const { sections, summary } = processImportedQuestionBlocks(blocks, [])
  assert.equal(summary.questions, 2, `only the two real questions survive, got ${summary.questions}`)
  const stems = allQuestionsFromSections(sections).map(q => plainRichText(q.text))
  assert.ok(!stems.some(s => /page \d+ of \d+/i.test(s)), 'no "Page X of Y" question was created')
  assert.ok(!stems.some(s => /PRISCA/i.test(s)), 'the running footer did not become a question')
}

runHeaderFooterNoiseTest()

// ── Answer-with-reasons paper (PSLE "Questions and Answers" DOCX layout) ──
// Each question is followed by an inline "Answer: C — Many  <reason>" line.
// The letter must resolve the correct option AND the reason must land in the
// explanation field — it used to leak into passages or get dropped.
function runAnswerWithReasonsTest() {
  const blocks = [
    block('Part 1: Questions 1–2 — Choose the word that makes the sentence correct.'),
    block('1. … people have died of COVID 19 in the world.'),
    block('A. Small'),
    block('B. Plenty'),
    block('C. Many'),
    block('D. Little'),
    block('Answer: C — Many ‘Many’ is used with plural countable nouns such as ‘people’.'),
    block('2. The girl can sing … she cannot dance.'),
    block('A. and'),
    block('B. but'),
    block('C. nor'),
    block('D. or'),
    block('Answer: B — but Shows a contrast between two ideas.'),
  ]
  const { sections, summary } = processImportedQuestionBlocks(blocks, [])
  assert.equal(summary.questions, 2, `expected 2 questions, got ${summary.questions}`)
  const questions = allQuestionsFromSections(sections)
  assert.equal(questions[0].correctAnswer, 2, 'Q1 answer resolves to option C')
  assert.match(plainRichText(questions[0].explanation), /plural countable nouns/,
    'Q1 reason landed in the explanation')
  assert.equal(questions[1].correctAnswer, 1, 'Q2 answer resolves to option B')
  assert.match(plainRichText(questions[1].explanation), /contrast between two ideas/,
    'Q2 reason landed in the explanation')
  assert.equal(summary.needsReview, 0, 'nothing flagged for review')
}

runAnswerWithReasonsTest()

// ── Para-order section with FULLY-FORMED numbered stems ──────────────────
// Typed-up papers repeat the shared instruction as each question's stem
// ("39. Choose the paragraph with the sentences in the best order:") instead
// of the raw ECZ number-only markers. The whole Part used to be silently
// dropped: the Part heading matched PARA_ORDER_INSTRUCTION_RE and each
// numbered stem line restarted collection as a fresh "instruction".
function runParaOrderFullStemTest() {
  const blocks = [
    block('Part 1: Questions 39–40 — Choose the paragraph which has the sentences in the best order.'),
    block('39. Choose the paragraph with the sentences in the best order:'),
    block('A. At the end of the rally, a lot of people joined the party. The audience clapped.'),
    block('B. He then started giving his manifesto. The audience clapped to welcome him.'),
    block('C. The politician arrived at the rally platform. At the end of the rally, people joined.'),
    block('D. The politician arrived at the rally platform. The audience clapped to welcome him.'),
    block('Answer: D — Option D Logical order: arrived, clapped, manifesto, joined.'),
    block('40. Choose the paragraph with the sentences in the best order:'),
    block('A. Kokoliko is a famous primary school in Luapula province. It is well known.'),
    block('B. Kokoliko is a famous primary school in Luapula province. For five years it passed.'),
    block('C. It is well known for producing good results. Kokoliko is a famous primary school.'),
    block('D. For five years it passed. Kokoliko is a famous primary school in Luapula.'),
    block('Answer: A — Option A Introduces the school first.'),
  ]
  const { sections, summary } = processImportedQuestionBlocks(blocks, [])
  assert.equal(summary.questions, 2, `expected 2 para-order questions, got ${summary.questions}`)
  const questions = allQuestionsFromSections(sections)
  assert.equal(String(questions[0].sourceQuestionNumber), '39')
  assert.equal(questions[0].options.length, 4, 'Q39 kept all four paragraph options')
  assert.equal(questions[0].correctAnswer, 3, 'Q39 answer resolves to option D')
  assert.ok(!/^part\s/i.test(plainRichText(questions[0].text)),
    'the Part heading prefix was stripped from the rebuilt stem')
  assert.equal(questions[1].correctAnswer, 0, 'Q40 answer resolves to option A')
  assert.match(plainRichText(questions[1].explanation), /Introduces the school first/,
    'para-order reason landed in the explanation (without the "Option A" echo)')
}

runParaOrderFullStemTest()

// ── "Quick Answer Key" heading opens the answer-key block ────────────────
// The heading variant with a leading word ("Quick Answer Key") used to slip
// past ANSWER_KEY_HEADING_RE, so the key dump ("1: C 2: B …") became a
// phantom question flagged by the structure check.
function runQuickAnswerKeyTest() {
  const blocks = [
    block('1. Which gas do plants absorb?'),
    block('A. Oxygen'),
    block('B. Carbon dioxide'),
    block('C. Nitrogen'),
    block('D. Helium'),
    block('2. What colour is the sky?'),
    block('A. Blue'),
    block('B. Green'),
    block('C. Red'),
    block('D. Yellow'),
    block('Quick Answer Key'),
    block('1: B 2: A'),
  ]
  const { sections, summary } = processImportedQuestionBlocks(blocks, [])
  assert.equal(summary.questions, 2, `the key dump must not become a question, got ${summary.questions}`)
  const questions = allQuestionsFromSections(sections)
  assert.equal(questions[0].correctAnswer, 1, 'the quick answer key resolves Q1’s answer')
  // Regression: the LAST question before the key heading used to be routed
  // into (inactive) comprehension state and silently dropped.
  assert.equal(String(questions[1].sourceQuestionNumber), '2', 'the question just before the key survives')
  assert.equal(questions[1].correctAnswer, 0, 'the quick answer key resolves Q2’s answer')
}

runQuickAnswerKeyTest()

// ── SPACE-separated numbering ("51 Why did…" / "A hated marriage.") ──────
// Some generated/re-exported papers put a plain space after the question
// number and option letter — no tab, no punctuation. QUESTION_RE and
// QUESTION_NO_PUNCT_RE both miss that, so whole sections used to flow into
// the passage text as prose ("the questions are coming in like a story").
// bareNumberStemMatch accepts these only when the number is corroborated by
// sequence or the Part heading's declared range, so prose starting with a
// number can't spawn phantom questions.
function runSpaceSeparatedNumberingTest() {
  const blocks = [
    block('Part 1: Questions 1–2 — Choose the word that makes the sentence correct.'),
    block('1 … people have died of COVID 19 in the world.'),
    block('A Small'),
    block('B Plenty'),
    block('C Many'),
    block('D Little'),
    block('Answer: C — Many ‘Many’ is used with plural countable nouns.'),
    block('2 The girl can sing … she cannot dance.'),
    block('A and'),
    block('B but'),
    block('C nor'),
    block('D or'),
    block('Answer: B — but Shows a contrast between two ideas.'),
    block('Part 2: Questions 46–47 — Comprehension'),
    block(comprehensionInstruction),
    block('Story 1'),
    block('Mary walked to school every day. It took 14 minutes each way. One day she found 20 kwacha on the road and handed it to her teacher.'),
    block('46 How long did Mary take to walk to school?'),
    block('A 20 minutes'),
    block('B 14 minutes'),
    block('C 40 minutes'),
    block('D 4 minutes'),
    block('Answer: B — 14 minutes The text says it took 14 minutes each way.'),
    block('47 What did Mary find on the road?'),
    block('A A book'),
    block('B A pencil'),
    block('C Money'),
    block('D A phone'),
    block('Answer: C — Money She found 20 kwacha.'),
  ]
  const { sections, summary } = processImportedQuestionBlocks(blocks, [])
  assert.equal(summary.questions, 4, `expected 4 questions, got ${summary.questions}`)
  const questions = allQuestionsFromSections(sections)
  assert.equal(String(questions[0].sourceQuestionNumber), '1')
  assert.equal(questions[0].options.length, 4, 'Q1 kept its four space-separated options')
  assert.equal(questions[0].correctAnswer, 2, 'Q1 answer resolves to option C')
  assert.equal(questions[1].correctAnswer, 1, 'Q2 answer resolves to option B')
  const passage = sections.find(s => s.kind === 'passage')
  assert.ok(passage, 'the story became a passage section')
  assert.equal(passage.passage.questions.length, 2, 'both comprehension questions attached to the passage')
  const passageText = plainRichText(passage.passage.passageText)
  assert.ok(!/46 How long/.test(passageText), 'Q46 did not leak into the passage text')
  // Prose starting with a number ("14 minutes each way…" style) must NOT
  // become a phantom question — only 1, 2, 46, 47 exist.
  const nums = questions.map(q => String(q.sourceQuestionNumber))
  assert.deepEqual(nums, ['1', '2', '46', '47'], `unexpected question numbers: ${nums}`)
}

runSpaceSeparatedNumberingTest()

// ── Cover page + worked example + period-terminated range heading ────────
// PRISCA/ECZ text-PDF layout. Three regressions in one fixture:
//  1. The COVER PAGE is a numbered instruction list ("1 Read these
//     instructions carefully.") — space-separated numbering must NOT
//     cold-start questions from it.
//  2. "Now do questions 31 - 38." ends with a period — it must still act as
//     a worked-example boundary + part-range marker (the example skipper
//     used to run straight through the following questions).
//  3. A duplicate range marker after the "Part N:" heading must not split
//     the part or overwrite its descriptive title.
function runCoverPageAndExampleBoundaryTest() {
  const blocks = [
    block('MINISTRY OF EDUCATION'),
    block('PRIMARY SCHOOL MOCK EXAMINATION – 2026'),
    block('1 Read these instructions carefully.'),
    block('2 Do not turn this page before you are told. Your teacher will tell you.'),
    block('3 This paper is divided into 2 sections: A and B. There are 60 questions.'),
    block('4 For each question, four answers are given, but only one is right.'),
    block('SECTION A'),
    block('Part 4: Questions 31 – 32'),
    block('Each question contains an underlined word. Choose the correct meaning.'),
    block('Example:'),
    block('The chief received homage from his subjects. The word homage means …'),
    block('A honor.'),
    block('B explore.'),
    block('C preach.'),
    block('D lodge.'),
    block('The answer A – honor – is the only answer that gives the right meaning.'),
    block('Now do questions 31 - 32.'),
    block('31 The meeting has been postponed to next week. The word postponed means …'),
    block('A committed.'),
    block('B concluded.'),
    block('C moved.'),
    block('D abolished.'),
    block('32 Brandina was embarrassed by her sister. The word embarrassed means …'),
    block('A feel anxious.'),
    block('B waiting for something.'),
    block('C get angry.'),
    block('D feel silly in front of others.'),
  ]
  const { sections, summary, parts } = processImportedQuestionBlocks(blocks, [])
  const questions = allQuestionsFromSections(sections)
  const nums = questions.map(q => String(q.sourceQuestionNumber))
  assert.deepEqual(nums, ['31', '32'], `cover instructions must not become questions: ${nums}`)
  assert.equal(questions[0].options.length, 4, 'Q31 kept its options after the worked example')
  assert.ok(
    !questions.some(q => /read these instructions|do not turn/i.test(plainRichText(q.text))),
    'no cover-page instruction leaked into a question stem',
  )
  const partTitles = (parts || []).map(p => p.title).filter(Boolean)
  assert.ok(
    partTitles.some(t => /part 4: questions 31/i.test(t)),
    `the descriptive Part title survived the duplicate range marker: ${partTitles}`,
  )
  assert.ok(
    !partTitles.some(t => /^now do questions/i.test(t)),
    `"Now do questions" must not become its own part: ${partTitles}`,
  )
  assert.equal(summary.questions, 2)
}

runCoverPageAndExampleBoundaryTest()

// ── Review follow-ups (#1817): cold start, bare Part titles, captions ─────
// 1. An UNHEADED paper that opens directly with space-separated "1 <stem>"
//    (no Part heading, no range) must still import — the cover-page gate
//    only rejects instruction-shaped openers.
function runUnheadedColdStartTest() {
  const blocks = [
    block('1 … people have died of COVID 19 in the world.'),
    block('A Small'),
    block('B Plenty'),
    block('C Many'),
    block('D Little'),
    block('Answer: C — Many'),
    block('2 The girl can sing … she cannot dance.'),
    block('A and'),
    block('B but'),
    block('C nor'),
    block('D or'),
    block('Answer: B — but'),
  ]
  const { sections, summary } = processImportedQuestionBlocks(blocks, [])
  const questions = allQuestionsFromSections(sections)
  assert.equal(summary.questions, 2, `unheaded cold start imports both questions, got ${summary.questions}`)
  assert.equal(questions[0].correctAnswer, 2)
  assert.equal(questions[1].correctAnswer, 1)
}

runUnheadedColdStartTest()

// 2. A bare descriptive heading ("Part 4" — no range in the title) followed
//    by the period-terminated range marker keeps the descriptive title.
function runBarePartTitlePreservedTest() {
  const blocks = [
    block('Part 4'),
    block('Each question contains an underlined word. Choose the correct meaning.'),
    block('Now do questions 31 - 32.'),
    block('31 The meeting has been postponed. The word postponed means …'),
    block('A committed.'),
    block('B concluded.'),
    block('C moved.'),
    block('D abolished.'),
    block('32 Brandina was embarrassed. The word embarrassed means …'),
    block('A feel anxious.'),
    block('B waiting.'),
    block('C get angry.'),
    block('D feel silly.'),
  ]
  const { parts, summary } = processImportedQuestionBlocks(blocks, [])
  assert.equal(summary.questions, 2)
  const titles = (parts || []).map(p => p.title).filter(Boolean)
  assert.ok(titles.some(t => /^part 4$/i.test(t)), `bare "Part 4" title survived: ${titles}`)
  assert.ok(!titles.some(t => /^now do questions/i.test(t)), `marker did not become a part: ${titles}`)
}

runBarePartTitlePreservedTest()

// 3. A bracketed cover diagram caption buffered before a SECTION heading is
//    cleared with the cover assets — it must not land on the first question.
function runCoverCaptionClearedTest() {
  const blocks = [
    block('1 Read these instructions carefully.'),
    block('[Diagram: Example showing how to shade the answer sheet]'),
    block('SECTION A'),
    block('Part 1: Questions 1 – 1'),
    block('1 … people have died of COVID 19 in the world.'),
    block('A Small'),
    block('B Plenty'),
    block('C Many'),
    block('D Little'),
    block('Answer: C — Many'),
  ]
  const { sections } = processImportedQuestionBlocks(blocks, [])
  const [q1] = allQuestionsFromSections(sections)
  assert.ok(!/shade the answer sheet/i.test(String(q1.diagramText || '')),
    'the cover caption did not attach to Q1')
}

runCoverCaptionClearedTest()

// 4. A cover whose FIRST item is worded outside the instruction-verb
//    vocabulary ("1 You have 60 minutes…") must still be rejected — and one
//    slipping through must not drag the sequential items after it in,
//    because the shape guards apply to every accepted line outside a
//    declared range.
function runUnusualCoverWordingTest() {
  const blocks = [
    block('PRIMARY SCHOOL MOCK EXAMINATION – 2026'),
    block('1 You have 60 minutes to complete this paper.'),
    block('2 Do not turn this page before you are told.'),
    block('3 Shade your answers on your Answer Sheet using an HB pencil.'),
    block('SECTION A'),
    block('Part 1: Questions 1 – 1'),
    block('1 … people have died of COVID 19 in the world.'),
    block('A Small'),
    block('B Plenty'),
    block('C Many'),
    block('D Little'),
    block('Answer: C — Many'),
  ]
  const { sections, summary } = processImportedQuestionBlocks(blocks, [])
  const questions = allQuestionsFromSections(sections)
  assert.equal(summary.questions, 1, `only the real Q1 imports, got ${summary.questions}`)
  assert.ok(!/60 minutes|answer sheet|turn this page/i.test(plainRichText(questions[0].text)),
    'no cover wording leaked into the question stem')
  assert.equal(questions[0].correctAnswer, 2)
}

runUnusualCoverWordingTest()

// 5. Sequential imperative stems in an UNHEADED paper are real questions —
//    the cover guards must not reject "2 Calculate the area…" just because
//    it starts with an instruction verb.
function runUnheadedImperativeStemTest() {
  const blocks = [
    block('1 What is 2 + 3?'),
    block('A 4'),
    block('B 5'),
    block('C 6'),
    block('D 7'),
    block('Answer: B — 5'),
    block('2 Calculate the area of a rectangle with sides 4 m and 3 m.'),
    block('A 7 square metres'),
    block('B 12 square metres'),
    block('C 14 square metres'),
    block('D 24 square metres'),
    block('Answer: B — 12 square metres'),
  ]
  const { summary, sections } = processImportedQuestionBlocks(blocks, [])
  assert.equal(summary.questions, 2, `imperative sequential stem imported, got ${summary.questions}`)
  const questions = allQuestionsFromSections(sections)
  assert.equal(String(questions[1].sourceQuestionNumber), '2')
  assert.equal(questions[1].options.length, 4)
}

runUnheadedImperativeStemTest()

// 6. A bare "1 <text>" appearing while a NON-1-based range is active (e.g. a
//    worked example whose "Example" label was lost) must not become a
//    phantom Q1.
function runNoColdStartInsideRangeTest() {
  const blocks = [
    block('Part 2: Questions 21 – 22'),
    block('1 The chief received homage from his subjects.'),
    block('21 The word postponed means …'),
    block('A committed.'),
    block('B concluded.'),
    block('C moved.'),
    block('D abolished.'),
    block('Answer: C — moved'),
    block('22 The word embarrassed means …'),
    block('A feel anxious.'),
    block('B waiting.'),
    block('C get angry.'),
    block('D feel silly.'),
    block('Answer: A — feel anxious'),
  ]
  const { summary, sections } = processImportedQuestionBlocks(blocks, [])
  const nums = allQuestionsFromSections(sections).map(q => String(q.sourceQuestionNumber))
  assert.deepEqual(nums, ['21', '22'], `no phantom Q1 inside the 21–22 range: ${nums}`)
  assert.equal(summary.questions, 2)
}

runNoColdStartInsideRangeTest()

// 7. Even if unusually-worded cover items slip past the shape guards and
//    become phantom questions, they must not POISON the numbering: the
//    "Part 1: Questions 1 – 2" heading resyncs lastQuestionNumber to the
//    declared range, so the real Q1/Q2 still import with their options.
function runNumberingResyncAfterCoverLeakTest() {
  const blocks = [
    // Deliberately worded to evade both shape guards (digits defeat the
    // short-imperative rule; no instruction verb at line start; no cover
    // vocabulary from COVER_INSTRUCTION_HINT_RE).
    block('1 Candidates get 90 minutes in total today'),
    block('2 Extra sheets are available at the front desk'),
    block('Part 1: Questions 1 – 2'),
    block('1 … people have died of COVID 19 in the world.'),
    block('A Small'),
    block('B Plenty'),
    block('C Many'),
    block('D Little'),
    block('Answer: C — Many'),
    block('2 The girl can sing … she cannot dance.'),
    block('A and'),
    block('B but'),
    block('C nor'),
    block('D or'),
    block('Answer: B — but'),
  ]
  const { sections } = processImportedQuestionBlocks(blocks, [])
  const questions = allQuestionsFromSections(sections)
  const withOptions = questions.filter(q => (q.options || []).length === 4)
  assert.equal(withOptions.length, 2, `both real questions kept their options, got ${withOptions.length}`)
  assert.equal(withOptions[0].correctAnswer, 2, 'real Q1 resolves its answer despite the cover leak')
  assert.equal(withOptions[1].correctAnswer, 1, 'real Q2 resolves its answer despite the cover leak')
}

runNumberingResyncAfterCoverLeakTest()

// ── Flattened multi-question Word table recovery ───────────────────────────
// Reproduces the phone report where an English DOCX imported as only two huge
// cards: Word had flattened several numbered MCQs into each table row, so the
// parser saw only the first number and swallowed Q27-Q30 (and Q46-Q60) into it.
function flattenedMcqRun(first, last) {
  return Array.from({ length: last - first + 1 }, (_, index) => {
    const number = first + index
    return [
      number,
      `Which answer is correct for item ${number}?`,
      'A choice alpha',
      'B choice beta',
      'C choice gamma',
      'D choice delta',
      'Answer: B — choice beta',
    ].join(' ')
  }).join(' ')
}

function flattenedOptionOnlyRun(first, last) {
  return Array.from({ length: last - first + 1 }, (_, index) => {
    const number = first + index
    return [
      number,
      `A sentence-alpha-item-${number}`,
      `B sentence-beta-item-${number}`,
      `C sentence-gamma-item-${number}`,
      `D sentence-delta-item-${number}`,
      'Answer: C',
    ].join(' ')
  }).join(' ')
}

function runFlattenedWordTableRecoveryTest() {
  const blocks = [
    block('GRADE SEVEN ENGLISH EXAMINATION'),
    block('Part 1: Questions 1 – 20 — Choose the best answer.'),
    block(flattenedMcqRun(1, 20), { source: 'docx-table' }),
    block('Part 2: Questions 21 – 25 — Choose the word that is correctly spelt.'),
    block(flattenedMcqRun(21, 25), { source: 'docx-table' }),
    block('Part 3: Questions 26 – 30 — Choose the sentence which is correctly punctuated.'),
    block(flattenedOptionOnlyRun(26, 30), { source: 'docx-table' }),
    block('Part 4: Questions 31 – 45 — Choose the best answer.'),
    block(flattenedMcqRun(31, 45), { source: 'docx-table' }),
    block('Reading Comprehension — Questions 46 – 60'),
    block('Story 1'),
    block('The notice is dated 20th October 2025. The meeting runs from 14:00 to 15:30 hours.'),
    block(flattenedMcqRun(46, 50), { source: 'docx-table' }),
    block('Story 2'),
    block('A second passage contains ordinary prose and no hidden questions.'),
    block(flattenedMcqRun(51, 55), { source: 'docx-table' }),
    block('Story 3'),
    block('A third passage completes the reading section.'),
    block(flattenedMcqRun(56, 60), { source: 'docx-table' }),
  ]
  const warnings = []
  const { sections, summary, processedBlocks } = processImportedQuestionBlocks(blocks, warnings)
  const questions = allQuestionsFromSections(sections)

  assert.equal(summary.questions, 60, `flattened paper must recover all 60 questions, got ${summary.questions}`)
  assert.equal(summary.passages, 3, 'all three reading passages must survive')
  assert.equal(summary.needsReview, 0, 'confidently recovered questions must not be review-only cards')
  assert.deepEqual(
    questions.map(question => Number(question.sourceQuestionNumber)),
    Array.from({ length: 60 }, (_, index) => index + 1),
    'source numbering must remain unique and ordered from 1 to 60',
  )
  assert.ok(questions.every(question => question.options.length === 4),
    'every recovered MCQ must keep all four options')
  assert.ok(questions.filter(question => Number(question.sourceQuestionNumber) < 26 || Number(question.sourceQuestionNumber) > 30)
    .every(question => question.correctAnswer === 1),
  'inline Answer: B markers must remain attached to their questions')
  assert.ok(questions.filter(question => Number(question.sourceQuestionNumber) >= 26 && Number(question.sourceQuestionNumber) <= 30)
    .every(question => question.correctAnswer === 2),
  'option-only punctuation items must keep their Answer: C markers')
  assert.match(plainRichText(findQuestion(sections, 26).text), /correctly punctuated/i,
    'the range instruction must supply the stem for number-only option runs')
  assert.ok(!warnings.some(warning => /question number was not found/i.test(warning)),
    'the recovered run must not emit missing-number warnings')
  assert.ok(processedBlocks.some(item => item.recoveredFromFlattenedTable),
    'the recovery marker should remain available for diagnostics')

  const passages = sections.filter(section => section.kind === 'passage')
  assert.deepEqual(passages.map(section => section.passage.questions.length), [5, 5, 5],
    'Q46-Q60 must be distributed five per passage')
  assert.match(plainRichText(passages[0].passage.passageText), /20th October 2025/i)
  assert.match(plainRichText(passages[0].passage.passageText), /14:00 to 15:30/i)

  // A declared range followed only by date/time prose must remain untouched;
  // at least two sequential question numbers plus complete A-D choices are
  // required before the normalizer changes a block.
  const dateBlock = block(
    'The notice is dated 20 October 2025 and the event runs from 14:00 to 15:30.',
    { source: 'docx-table' },
  )
  const untouched = expandFlattenedQuestionRuns([
    block('Questions 14 – 20'),
    dateBlock,
  ])
  assert.equal(untouched.length, 2)
  assert.equal(untouched[1], dateBlock, 'dates and times must not become question boundaries')
}

runFlattenedWordTableRecoveryTest()

console.log('All documentQuizParserCore tests passed.')
