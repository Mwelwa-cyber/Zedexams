import assert from 'node:assert/strict'
import { processImportedQuestionBlocks } from './documentQuizParserCore.js'
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

console.log('documentQuizParserCore regression test passed')
