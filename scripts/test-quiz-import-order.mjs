/**
 * Regression test for the smart-import section-ordering bug.
 *
 * Root cause (fixed in documentQuizImporter.js): when the smart-import path
 * sorted sections back into document order, it used `partOrderMap.get(partId)
 * ?? partOrderMap.size` as the sort key.  `partOrderMap` only contained NAMED
 * parts (unnamed/default parts were filtered out).  For the G7 English 2023
 * paper the only named part is "Part 4: Questions 31 – 38" which received sort
 * key 0, while all sections without a named part (Q1–Q30 and Q46–Q60) received
 * the fallback key `partOrderMap.size = 1`.  That made Q31–Q45 sort BEFORE
 * Q1–Q30 — exactly the jumbling teachers reported ("question 45 at position 20").
 *
 * The fix replaces the part-index sort key with a local-section-index sort key
 * derived from the deterministic parser's own section list (which is always in
 * document order).
 *
 * This test:
 *   1. Drives `processImportedQuestionBlocks` with a minimal fixture that
 *      reproduces the document structure (unnamed-part questions first, then a
 *      named part, then passages under unnamed part).
 *   2. Verifies the parser emits sections in the correct document order.
 *   3. Simulates the smart-import merge step — the part that the sort bug lived
 *      in — and confirms the resulting section list is still in document order
 *      after sorting.
 */

import assert from 'node:assert/strict'
import { processImportedQuestionBlocks } from '../src/components/quiz/documentQuizParserCore.js'
import { createStandaloneSection, createPassageSection } from '../src/utils/quizSections.js'

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

// A minimal fixture matching the G7 English 2023 paper structure:
//   Q1–Q25   — no named part (unnamed/default part)
//   Q26–Q30  — "Questions 26 – 30" range heading (not a SECTION/PART, so also unnamed part)
//   Q31–Q38  — "Part 4: Questions 31 – 38" (the ONLY named part)
//   Q39–Q45  — paragraph-ordering, still under "Part 4" heading in the doc
//   Q46–Q60  — Reading Comprehension passages (unnamed part)
//
// We use a compressed version: Q1, Q2, Q25, Q26, Q30, Q31, Q38, Q39, Q45,
// then comprehension (Q46–Q50 in one story, Q51–Q55 in another).
function makeG7EnglishFixture() {
  const blocks = [
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

    // "Part 4" is the ONLY named SECTION/PART heading in this document.
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

  return blocks
}

// ─── Test 1: Parser output is in document order ───────────────────────────

function runParserOrderTest() {
  const blocks = makeG7EnglishFixture()
  const warnings = []
  const { sections, parts, summary } = processImportedQuestionBlocks(blocks, warnings)

  // Verify parts structure
  const namedParts = parts.filter(p => String(p.title ?? '').trim())
  assert.equal(namedParts.length, 1, `expected 1 named part, got ${namedParts.length}`)
  assert.match(namedParts[0].title, /Part 4/i)

  // Collect all questions in section order
  const allQs = sections.flatMap(s =>
    s.kind === 'passage' ? (s.passage?.questions || []) : [s.question]
  )
  const sourceNums = allQs.map(q => Number(q.sourceQuestionNumber)).filter(Boolean)

  // The document order must be strictly increasing by question number:
  // Q1, Q2, Q25, Q26, Q30, Q31, Q38, Q39, Q45, Q46, Q50, Q51, Q55
  for (let i = 1; i < sourceNums.length; i++) {
    assert.ok(
      sourceNums[i] > sourceNums[i - 1],
      `Parser emitted Q${sourceNums[i]} after Q${sourceNums[i - 1]} — expected strictly ascending order`,
    )
  }

  assert.equal(sourceNums[0], 1, 'first question must be Q1')
  assert.equal(sourceNums[sourceNums.length - 1], 55, 'last question must be Q55')

  console.log('test-quiz-import-order: parser produces correct document order — PASSED')
  return { sections, parts, namedParts, summary }
}

// ─── Test 2: The smart-import section sort uses document order ────────────
//
// This test directly exercises the sort logic that was broken. We:
//   1. Run the parser to get `local` (sections + parts in document order).
//   2. Simulate smart-import returning sections in a reordered list (comprehension
//      sections first, then standalones — the documented AI behaviour).
//   3. Apply the fixed sort logic and verify the result is document order.

function runSmartImportSortTest() {
  // Re-run the parser to get local sections (document order).
  const blocks = makeG7EnglishFixture()
  const warnings = []
  const local = processImportedQuestionBlocks(blocks, warnings)

  const localParts = local.parts || []
  const namedLocalParts = localParts.filter(p => String(p.title ?? '').trim())
  const unnamedPartIds = new Set(
    localParts.filter(p => !String(p.title ?? '').trim()).map(p => p.id)
  )

  // We only exercise this path when there are named parts (the failing scenario).
  assert.ok(namedLocalParts.length > 0, 'fixture must have at least one named part')

  // Simulate the AI returning sections out of order: passages (comprehension)
  // first, then standalones. This is the case described in the code comments.
  const localStandalones = local.sections.filter(s => s.kind === 'standalone')
  const localPassages = local.sections.filter(s => s.kind === 'passage')

  // Build simulated smart sections in the order the AI might return them.
  // Use the actual local section data but reorder: passages first, then standalones.
  const smartSections = [
    ...localPassages.map(ps => ({
      kind: 'passage',
      title: ps.passage?.title ?? '',
      instructions: ps.passage?.instructions ?? '',
      passageText: ps.passage?.passageText ?? '',
      questions: (ps.passage?.questions || []).map(q => ({
        text: q.text,
        options: q.options,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation,
        type: q.type,
      })),
    })),
    ...localStandalones.map(ss => ({
      kind: 'standalone',
      question: {
        text: ss.question?.text ?? '',
        options: ss.question?.options ?? [],
        correctAnswer: ss.question?.correctAnswer ?? 0,
        explanation: ss.question?.explanation ?? '',
        type: ss.question?.type ?? 'mcq',
        sourceQuestionNumber: ss.question?.sourceQuestionNumber ?? null,
      },
    })),
  ]

  // Now apply the same logic as the fixed importQuizDocument code.
  const localSectionOrderMap = new Map(local.sections.map((s, i) => [s.id, i]))
  let siStandalone = 0
  let siPassage = 0

  const withPartIds = smartSections.map(s => {
    if (s.kind === 'passage') {
      const localSection = siPassage < localPassages.length ? localPassages[siPassage] : null
      const rawPartId = localSection?.partId ?? null
      siPassage++
      const partId = unnamedPartIds.has(rawPartId) ? null : rawPartId
      return {
        ...s, partId,
        _localSectionId: localSection?.id ?? null,
        passage: {
          ...s,
          questions: (s.questions || []).map(q => ({ ...q, partId })),
        },
      }
    }
    if (s.kind === 'standalone') {
      const localSection = siStandalone < localStandalones.length ? localStandalones[siStandalone] : null
      const rawPartId = localSection?.question?.partId ?? null
      siStandalone++
      const partId = unnamedPartIds.has(rawPartId) ? null : rawPartId
      return {
        ...s,
        question: { ...s.question, partId },
        _localSectionId: localSection?.id ?? null,
      }
    }
    return s
  })

  // Fixed sort: by local section order index.
  const sorted = withPartIds.slice().sort(
    (a, b) =>
      (localSectionOrderMap.get(a._localSectionId) ?? localSectionOrderMap.size)
    - (localSectionOrderMap.get(b._localSectionId) ?? localSectionOrderMap.size)
  )

  // Verify that the sorted order matches the local (document) order.
  // Standalones should precede passages, exactly matching local.sections order.
  const sortedIds = sorted.map(s => s._localSectionId)
  const expectedIds = local.sections.map(s => s.id)
  assert.deepEqual(
    sortedIds,
    expectedIds,
    'after sort, smart sections must be in the same order as local (document-order) sections',
  )

  // Verify the OLD (broken) sort would have produced a different order.
  // The old sort used namedLocalParts index as sort key with fallback = namedLocalParts.length.
  const partOrderMap = new Map(namedLocalParts.map((p, i) => [p.id, i]))
  const getPartId = s => s.kind === 'passage' ? s.partId : s.question?.partId
  const brokenSorted = withPartIds.slice().sort(
    (a, b) => (partOrderMap.get(getPartId(a)) ?? partOrderMap.size)
           - (partOrderMap.get(getPartId(b)) ?? partOrderMap.size)
  )
  const brokenIds = brokenSorted.map(s => s._localSectionId)
  assert.notDeepEqual(
    brokenIds,
    expectedIds,
    'the old (broken) sort must produce a different order — confirms the bug was real',
  )

  // Verify the first section in the fixed order has a standalone from Q1
  // (not a passage and not from Part 4).
  assert.equal(sorted[0].kind, 'standalone', 'first section after sort must be standalone (Q1), not a passage')

  // Verify Part 4 sections appear AFTER the unnamed-part standalones.
  const part4Id = namedLocalParts[0].id
  const part4Indices = sorted
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => getPartId(s) === part4Id)
    .map(({ i }) => i)
  const unnamedStandaloneIndices = sorted
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.kind === 'standalone' && getPartId(s) !== part4Id)
    .map(({ i }) => i)

  const lastUnnamedStandaloneIdx = Math.max(...unnamedStandaloneIndices)
  const firstPart4Idx = Math.min(...part4Indices)
  assert.ok(
    firstPart4Idx > lastUnnamedStandaloneIdx,
    `Part 4 sections (first at index ${firstPart4Idx}) must appear AFTER unnamed-part standalones (last at index ${lastUnnamedStandaloneIdx})`,
  )

  console.log('test-quiz-import-order: smart-import sort preserves document order — PASSED')
  console.log('test-quiz-import-order: old (broken) sort confirmed to produce wrong order — PASSED')
}

// ─── Run tests ────────────────────────────────────────────────────────────

runParserOrderTest()
runSmartImportSortTest()

console.log('test-quiz-import-order: ALL PASSED')
