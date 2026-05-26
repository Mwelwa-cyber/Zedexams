import assert from 'node:assert/strict'
import { metadataFromText, processImportedQuestionBlocks } from './documentQuizParserCore.js'
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
  assert.equal(metadata.subject, 'Mathematics',
    'subject should still match the dedicated header line')
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

console.log('documentQuizParserCore regression test passed')
