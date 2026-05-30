/**
 * Regression test for the smart-import question-jumbling bug.
 *
 * The deterministic parser (processImportedQuestionBlocks) always emits
 * sections in true document order. "Smart import" sends the document to an LLM
 * to recover rich structure (fractions, tables, vertical arithmetic) — but an
 * LLM does NOT reliably preserve question order. The old reconciliation matched
 * the AI's sections to the parser's sections *by position* (Nth smart
 * standalone == Nth document standalone) and, when the document had no named
 * parts, used the raw AI order outright. Both assumptions broke the moment the
 * AI returned questions shuffled or grouped, producing the recurring
 * "questions jumbled / Q45 sitting at position 20, even the numbers are wrong"
 * reports.
 *
 * The fix (documentQuizReconcile.js#reconcileSmartSectionOrder) matches each
 * smart section to the parser section it represents *by content* and orders the
 * result strictly by that section's document index.
 *
 * IMPORTANT: this test exercises the REAL exported reconcileSmartSectionOrder
 * function — not a re-implemented copy of it — so it actually guards the code
 * path the importer runs. It feeds the function deliberately SHUFFLED smart
 * sections (the real failure mode) and asserts the output is back in document
 * order.
 */

import assert from 'node:assert/strict'
import { processImportedQuestionBlocks } from '../src/components/quiz/documentQuizParserCore.js'
import { reconcileSmartSectionOrder } from '../src/components/quiz/documentQuizReconcile.js'

// ─── helpers matching the parser test conventions ─────────────────────────

function block(text, overrides = {}) {
  return { text, assets: [], source: 'docx', numberedList: false, ...overrides }
}

function mcqBlock(number, stem, options, answerLetter) {
  const answerText = options['ABCD'.indexOf(answerLetter)]
  return [
    block(`${number}. ${stem}`),
    block(`A   ${options[0]}`),
    block(`B   ${options[1]}`),
    block(`C   ${options[2]}`),
    block(`D   ${options[3]}`),
    block(`Answer: ${answerLetter}  —  ${answerText}`),
  ]
}

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

// A minimal fixture matching the real G7 English 2023 paper structure:
//   Q1–Q25   — no named part (unnamed/default part)
//   Q26–Q30  — "Questions 26 – 30" range heading (not a SECTION/PART → unnamed)
//   Q31–Q38  — "Part 4: Questions 31 – 38" (the ONLY named part)
//   Q39–Q45  — "Questions 39 – 45" (unnamed)
//   Q46–Q60  — Reading Comprehension passages (unnamed part)
// Compressed: Q1, Q2, Q25, Q26, Q30, Q31, Q38, Q39, Q45, then two stories.
function makeG7EnglishFixture() {
  return [
    block('Grade 7 English — 2023'),
    block('Each question contains a sentence from which a word or group of words is missing. Choose the word or group of words that makes the sentence right.'),
    ...mcqBlock(1, 'Zacheaus climbed a tree to see Jesus … he was short.', ['and', 'because', 'but', 'yet'], 'B'),
    ...mcqBlock(2, 'The children are now old enough to look after …', ['himself.', 'itself.', 'ourselves.', 'themselves.'], 'D'),
    ...mcqBlock(25, 'My parents often advise me not to … with my friends.', ['quarel', 'quarell', 'quarrel', 'quarrell'], 'C'),

    block('Questions 26 – 30'),
    block('Choose the sentence which is correctly punctuated.'),
    ...numberOnlyStemQuestion(26, [
      'The Bible was translated into Chitonga Cinyanja Luvale and Icibemba.',
      'The Bible was translated into Chitonga, Cinyanja, Luvale and Icibemba.',
      'The Bible was translated into, Chitonga Cinyanja Luvale and Icibemba.',
      'The Bible, was translated, into Chitonga Cinyanja Luvale and, Icibemba.',
    ], 'B'),
    ...numberOnlyStemQuestion(30, [
      '"Aha! There comes our teacher!" said Patra.',
      'Aha! There comes our teacher." said Patra.',
      'Aha! "There comes our teacher," said Patra.',
      '"Aha! There comes our teacher," said Patra.',
    ], 'A'),

    // "Part 4" is the ONLY named SECTION/PART heading in this document, and it
    // is NOT the first part — the bug that jumbled Q31+ to the front.
    block('Part 4: Questions 31 – 38'),
    block('Choose the answer that gives the right meaning of the underlined word or group of words.'),
    ...mcqBlock(31, 'Mary managed to attend the interview despite being late. The correct rephrasing is that Mary …', ['attended the interview.', 'did not attend the interview.', 'missed the interview.', 'was not late for the interview.'], 'A'),
    ...mcqBlock(38, '"I would rather starve than steal." Chiyembekezo preferred …', ['both starving and stealing.', 'neither starving nor stealing.', 'starving to stealing.', 'stealing to starving.'], 'C'),

    block('Questions 39 – 45'),
    block('Choose the paragraph which has the sentences in the best order.'),
    ...numberOnlyStemQuestion(39, [
      'Immediately, she ran out of the house to buy some biscuits. Yesterday, mother told Chikumbi to clean the house.',
      'While she was cleaning, she found a one kwacha coin under the table. Immediately, she ran out of the house.',
      'Yesterday, mother told Chikumbi to clean the house. Unfortunately, she lost the money on her way to the shop.',
      'Yesterday, mother told Chikumbi to clean the house. While she was cleaning, she found a one kwacha coin.',
    ], 'D'),
    ...numberOnlyStemQuestion(45, [
      'Football is played all over the world. The organisation that runs it is FIFA based in Switzerland. The FAZ has members in all ten provinces. In Zambia, football is run by the FAZ.',
      'Football is played all over the world. The organisation that runs it is FIFA based in Switzerland. In Zambia, football is run by the FAZ. The FAZ has members in all the ten provinces.',
      'In Zambia, football is run by the FAZ. The FAZ has members in all the ten provinces. Football is played all over the world. The organisation that runs it is FIFA.',
      'In Zambia, football is run by the FAZ. Football is played all over the world. The organisation that runs it is FIFA. The FAZ has members in all the ten provinces.',
    ], 'B'),

    // Reading Comprehension — passages under no named part.
    block('Reading Comprehension — Questions 46 – 60'),
    block('Story 1'),
    block('Once upon a time, the grandson of a headman developed a bad cough. The people saw that the boy\'s life was in danger and called in a witchdoctor.'),
    ...mcqBlock(46, 'According to the text, why was ancestor Kaulu angry? They …', ['bewitched the boy.', 'did not give him some beer.', 'did not understand what the calabash said.', 'offered him some beer.'], 'B'),
    ...mcqBlock(50, 'The primary traditional use of calabashes is as …', ['containers.', 'drums.', 'plates.', 'pots.'], 'A'),

    block('Story 2'),
    block('Crocodiles are large semiaquatic reptiles that live throughout the tropics in Africa, Asia, the Americas and Australia.'),
    ...mcqBlock(51, 'The word hatchlings means young animals that have recently emerged from the …', ['womb.', 'water.', 'leaves.', 'eggs.'], 'D'),
    ...mcqBlock(55, 'The prefix semi in the word semiaquatic means …', ['full.', 'large.', 'quick.', 'half.'], 'D'),
  ]
}

// Deterministic shuffle (seeded) so the test is reproducible across runs.
function seededShuffle(arr, seed) {
  const a = arr.slice()
  let s = seed
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Turn the parser's local sections into the shape smart import returns
// (smartSectionsToLocal output): kind + question / passage. Crucially we DROP
// sourceQuestionNumber so the test proves ordering is recovered from CONTENT,
// not from any surviving number metadata. `rewrite` lets us simulate the AI
// lightly rephrasing a stem (appended whitespace/words) to confirm fuzzy match.
function toSmartSection(localSection, rewrite = s => s) {
  if (localSection.kind === 'passage') {
    return {
      kind: 'passage',
      passage: {
        title: localSection.passage?.title ?? '',
        instructions: localSection.passage?.instructions ?? '',
        passageText: localSection.passage?.passageText ?? '',
        questions: (localSection.passage?.questions || []).map(q => ({
          text: rewrite(q.text),
          options: q.options,
          correctAnswer: q.correctAnswer,
          type: q.type,
        })),
      },
    }
  }
  return {
    kind: 'standalone',
    question: {
      text: rewrite(localSection.question?.text ?? ''),
      options: localSection.question?.options ?? [],
      correctAnswer: localSection.question?.correctAnswer ?? 0,
      type: localSection.question?.type ?? 'mcq',
    },
  }
}

// Document-order list of "first question number" per section, used to assert
// the reconciled output is in ascending document order.
function expectedSectionNumbers(local) {
  return local.sections.map(s =>
    s.kind === 'passage'
      ? Number(s.passage?.questions?.[0]?.sourceQuestionNumber)
      : Number(s.question?.sourceQuestionNumber),
  )
}

// Map a reconciled (smart-shaped) section back to its document number by
// content-matching against the local sections. Mirrors how a human would
// verify "is this the right question in the right slot".
function numberForReconciledSection(section, local) {
  const norm = t => String(t || '').replace(/<[^>]+>/g, ' ').replace(/[^a-z0-9 ]+/gi, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
  // Match on stem + options (options disambiguate identical-stem number-only
  // questions) — the same basis reconcileSmartSectionOrder uses.
  const qSig = q => `${norm(q?.text)} ${(q?.options || []).map(o => norm(typeof o === 'string' ? o : o?.text)).join(' ')}`.trim()
  const sigOf = s => s.kind === 'passage'
    ? `${norm(s.passage?.title)} ${qSig(s.passage?.questions?.[0])}`.trim()
    : qSig(s.question)
  const numOf = s => s.kind === 'passage'
    ? Number(s.passage?.questions?.[0]?.sourceQuestionNumber)
    : Number(s.question?.sourceQuestionNumber)
  const sig = sigOf(section)
  let bestNum = null
  let bestScore = 0
  for (const ls of local.sections) {
    const lsSig = sigOf(ls)
    const ta = new Set(sig.split(' ').filter(Boolean))
    const tb = new Set(lsSig.split(' ').filter(Boolean))
    let inter = 0
    for (const t of ta) if (tb.has(t)) inter += 1
    const score = inter / (ta.size + tb.size - inter || 1)
    if (score > bestScore) {
      bestScore = score
      bestNum = numOf(ls)
    }
  }
  return bestNum
}

function assertAscending(nums, label) {
  for (let i = 1; i < nums.length; i++) {
    assert.ok(
      nums[i] > nums[i - 1],
      `${label}: Q${nums[i]} appears after Q${nums[i - 1]} — expected strictly ascending document order. Full order: ${nums.join(', ')}`,
    )
  }
}

// ─── Test 1: Parser output is in document order ───────────────────────────

function runParserOrderTest() {
  const { sections, parts } = processImportedQuestionBlocks(makeG7EnglishFixture(), [])

  // Range headings ("Questions 26 – 30", "Questions 39 – 45") and the literal
  // "Part 4" heading all become named parts now, in document order. The
  // comprehension section is grouped under a "Reading Comprehension" part.
  const namedParts = parts.filter(p => String(p.title ?? '').trim())
  assert.ok(namedParts.length >= 1, `expected at least 1 named part, got ${namedParts.length}`)
  assert.ok(namedParts.some(p => /Part 4/i.test(p.title)), 'expected a "Part 4" named part')
  // Parts must appear in document order: scanning the expected sequence, each
  // title's index in the actual array must strictly increase.
  const partTitles = namedParts.map(p => p.title)
  const expectedOrder = ['Questions 26 – 30', 'Part 4: Questions 31 – 38', 'Questions 39 – 45', 'Reading Comprehension']
  const positions = expectedOrder.filter(t => partTitles.includes(t)).map(t => partTitles.indexOf(t))
  for (let i = 1; i < positions.length; i += 1) {
    assert.ok(positions[i] > positions[i - 1], `parts out of document order: ${partTitles.join(' | ')}`)
  }

  const allQs = sections.flatMap(s =>
    s.kind === 'passage' ? (s.passage?.questions || []) : [s.question],
  )
  const sourceNums = allQs.map(q => Number(q.sourceQuestionNumber)).filter(Boolean)
  assertAscending(sourceNums, 'parser')
  assert.equal(sourceNums[0], 1, 'first question must be Q1')
  assert.equal(sourceNums[sourceNums.length - 1], 55, 'last question must be Q55')

  console.log('test-quiz-import-order: parser produces correct document order — PASSED')
}

// ─── Test 2: reconcile recovers document order from SHUFFLED AI output ─────

function runShuffledSmartImportTest() {
  const local = processImportedQuestionBlocks(makeG7EnglishFixture(), [])

  // Simulate the AI returning every section SHUFFLED, with the comprehension
  // passages pulled to the front (a documented AI habit) and a couple of stems
  // lightly rephrased — the real-world failure mode.
  const passages = local.sections.filter(s => s.kind === 'passage')
  const standalones = local.sections.filter(s => s.kind === 'standalone')
  const lightRewrite = t => `${t} ` // trailing space: a no-op rephrase
  const smartSections = [
    ...passages.map(s => toSmartSection(s)),
    ...seededShuffle(standalones, 1337).map(s => toSmartSection(s, lightRewrite)),
  ]

  // Sanity: the AI input order is NOT document order (so the test is meaningful).
  const inputNums = smartSections.map(s => numberForReconciledSection(s, local))
  const isAscendingInput = inputNums.every((n, i) => i === 0 || n > inputNums[i - 1])
  assert.ok(!isAscendingInput, 'precondition: shuffled smart input must NOT already be in order')

  const { sections, parts } = reconcileSmartSectionOrder(local, smartSections)

  // No questions lost or duplicated.
  assert.equal(sections.length, local.sections.length, 'section count must be preserved')

  // The reconciled output must be in ascending document order.
  const outNums = sections.map(s => numberForReconciledSection(s, local))
  assertAscending(outNums, 'reconciled')
  assert.equal(outNums[0], 1, 'first reconciled section must be Q1, not a comprehension passage or Part 4')

  // Part structure preserved: the named parts the parser detected (range
  // headings + the literal "Part 4" + Reading Comprehension) survive
  // reconciliation. The unnamed default part is dropped.
  assert.ok(parts.length >= 1, 'reconcile must return the named parts')
  assert.ok(parts.some(p => /Part 4/i.test(p.title)), 'reconcile must keep the "Part 4" named part')
  assert.ok(parts.every(p => String(p.title ?? '').trim()), 'reconcile must drop the unnamed default part')

  console.log('test-quiz-import-order: reconcile recovers document order from shuffled AI output — PASSED')
}

// ─── Test 3: reconcile works when there are NO named parts ────────────────
// This is the path the old code handled with `sections = smart.sections`
// (raw AI order, no reordering at all) — a silent jumbling vector.

function runNoNamedPartsTest() {
  // Deliberately NO part-creating headings: no "Reading Comprehension"
  // banner, no range heading, no "Part/Section N". The passage is introduced
  // by a bare comprehension instruction + "Story 1" label, which open a
  // passage block WITHOUT creating a named part.
  const blocks = [
    block('Answer ALL questions.'),
    ...mcqBlock(1, 'The cat sat on the …', ['mat', 'hat', 'bat', 'rat'], 'A'),
    ...mcqBlock(2, 'Birds can … in the sky.', ['swim', 'fly', 'dig', 'run'], 'B'),
    ...mcqBlock(3, 'Water is made of hydrogen and …', ['carbon', 'oxygen', 'nitrogen', 'helium'], 'B'),
    block('Read the passage below and answer the questions that follow.'),
    block('Story 1'),
    block('The sun is a star at the centre of our solar system. It gives us light and heat every day.'),
    ...mcqBlock(4, 'The sun is at the centre of our …', ['galaxy', 'solar system', 'planet', 'moon'], 'B'),
    ...mcqBlock(5, 'The sun gives us light and …', ['rain', 'wind', 'heat', 'snow'], 'C'),
  ]
  const local = processImportedQuestionBlocks(blocks, [])
  assert.equal(
    local.parts.filter(p => String(p.title ?? '').trim()).length,
    0,
    'this fixture must have NO named parts',
  )

  // AI returns them badly out of order: passage first, then Q3, Q1, Q2.
  const passages = local.sections.filter(s => s.kind === 'passage').map(s => toSmartSection(s))
  const standalones = local.sections.filter(s => s.kind === 'standalone').map(s => toSmartSection(s))
  const smartSections = [passages[0], standalones[2], standalones[0], standalones[1]]

  const { sections, parts } = reconcileSmartSectionOrder(local, smartSections)
  const outNums = sections.map(s => numberForReconciledSection(s, local))
  assertAscending(outNums, 'reconciled (no named parts)')
  assert.deepEqual(parts, [], 'no named parts → parts must be empty')

  console.log('test-quiz-import-order: reconcile fixes the no-named-parts (raw-AI-order) path — PASSED')
}

// ─── Test 4: an AI-recovered extra question stays adjacent, order preserved ─

function runAiExtraQuestionTest() {
  const local = processImportedQuestionBlocks(makeG7EnglishFixture(), [])
  const standalones = local.sections.filter(s => s.kind === 'standalone').map(s => toSmartSection(s))
  const passages = local.sections.filter(s => s.kind === 'passage').map(s => toSmartSection(s))

  // AI splits Q1 into Q1 + a brand-new extra it "recovered" right after it.
  const extra = {
    kind: 'standalone',
    question: { text: 'A completely new sub-question the AI recovered from vertical arithmetic.', options: ['1', '2', '3', '4'], correctAnswer: 0, type: 'mcq' },
  }
  const smartSections = [standalones[0], extra, ...standalones.slice(1), ...passages]

  const { sections } = reconcileSmartSectionOrder(local, smartSections)

  // The extra survives (no question dropped) and the matched questions are
  // still in ascending document order ignoring the unmatched extra.
  assert.equal(sections.length, smartSections.length, 'AI-recovered extra must not be dropped')
  const matchedNums = sections
    .map(s => ({ s, num: numberForReconciledSection(s, local) }))
    .filter(({ s }) => !/completely new sub-question/.test(s.question?.text || ''))
    .map(({ num }) => num)
  assertAscending(matchedNums, 'reconciled (with AI extra)')

  // The extra should sit right after Q1 (its AI predecessor), i.e. at index 1.
  const extraIdx = sections.findIndex(s => /completely new sub-question/.test(s.question?.text || ''))
  assert.equal(extraIdx, 1, `AI-recovered extra should stay adjacent to its predecessor (index 1), got ${extraIdx}`)

  console.log('test-quiz-import-order: AI-recovered extra stays adjacent, order preserved — PASSED')
}

// ─── Run tests ────────────────────────────────────────────────────────────

runParserOrderTest()
runShuffledSmartImportTest()
runNoNamedPartsTest()
runAiExtraQuestionTest()

console.log('test-quiz-import-order: ALL PASSED')
