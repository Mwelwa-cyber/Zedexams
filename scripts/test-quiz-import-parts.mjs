/**
 * Acceptance test for the G7 English 2023 import structure (parts + passages
 * + numbering). Complements scripts/test-quiz-import-order.mjs (which focuses
 * on the smart-import reconcile path). This test drives the DETERMINISTIC
 * parser (processImportedQuestionBlocks) over a full 1..60 fixture that mirrors
 * the real document's headings:
 *
 *   Q1–20    no heading (top instruction only) → unnamed/default part
 *   Q21–25   "Questions 21 – 25"  → named part
 *   Q26–30   "Questions 26 – 30"  → named part (number-only punctuation stems)
 *   Q31–38   "Part 4: Questions 31 – 38" → named part (literal Part label)
 *   Q39–45   "Questions 39 – 45"  → named part (paragraph-ordering stems)
 *   Q46–60   "Reading Comprehension — Questions 46 – 60" → Reading Comprehension
 *            part containing Story 1 / Story 2 / Story 3 passages (5 Qs each)
 *
 * Asserts: Q1 first; Q20<Q21, Q38<Q39; Q46–60 after the stories; passages not
 * counted as questions; exactly 60 questions, 3 passages; no duplicate/missing
 * numbers (1..60 complete); parts in document order; determinism on re-run.
 */

import assert from 'node:assert/strict'
import { processImportedQuestionBlocks } from '../src/components/quiz/documentQuizParserCore.js'

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

const FOUR = (tag) => [`${tag} option A`, `${tag} option B`, `${tag} option C`, `${tag} option D`]

// Build a full 1..60 fixture in document order.
function makeFullG7Fixture() {
  const blocks = []

  blocks.push(block('Grade 7 English — 2023'))
  blocks.push(block('Each question contains a sentence from which a word or group of words is missing. Choose the word or group of words that makes the sentence right.'))

  // Q1–20 (no heading)
  for (let n = 1; n <= 20; n += 1) {
    blocks.push(...mcqBlock(n, `Sentence completion item number ${n}, choose the best word to fill the gap.`, FOUR(`q${n}`), 'B'))
  }

  // Q21–25 under "Questions 21 – 25"
  blocks.push(block('Questions 21 – 25'))
  blocks.push(block('Choose the word that means the same as the underlined word.'))
  for (let n = 21; n <= 25; n += 1) {
    blocks.push(...mcqBlock(n, `Synonym item number ${n}, pick the closest meaning.`, FOUR(`q${n}`), 'A'))
  }

  // Q26–30 under "Questions 26 – 30" (number-only punctuation stems)
  blocks.push(block('Questions 26 – 30'))
  blocks.push(block('Choose the sentence which is correctly punctuated.'))
  for (let n = 26; n <= 30; n += 1) {
    blocks.push(...numberOnlyStemQuestion(n, FOUR(`q${n}`), 'C'))
  }

  // Q31–38 under literal "Part 4: Questions 31 – 38"
  blocks.push(block('Part 4: Questions 31 – 38'))
  blocks.push(block('Choose the answer that gives the right meaning of the underlined word or group of words.'))
  for (let n = 31; n <= 38; n += 1) {
    blocks.push(...mcqBlock(n, `Meaning item number ${n}, identify the correct rephrasing.`, FOUR(`q${n}`), 'D'))
  }

  // Q39–45 under "Questions 39 – 45" (paragraph-ordering stems)
  blocks.push(block('Questions 39 – 45'))
  blocks.push(block('Choose the paragraph which has the sentences in the best order.'))
  for (let n = 39; n <= 45; n += 1) {
    blocks.push(...numberOnlyStemQuestion(n, FOUR(`q${n}`), 'B'))
  }

  // Q46–60 under "Reading Comprehension" — three stories, 5 questions each.
  blocks.push(block('Reading Comprehension — Questions 46 – 60'))
  blocks.push(block('Story 1'))
  blocks.push(block('Once upon a time the grandson of a headman developed a bad cough. The people called in a witchdoctor to help the boy who was very ill.'))
  for (let n = 46; n <= 50; n += 1) {
    blocks.push(...mcqBlock(n, `Comprehension item number ${n} about Story 1.`, FOUR(`q${n}`), 'A'))
  }
  blocks.push(block('Story 2'))
  blocks.push(block('Crocodiles are large semiaquatic reptiles that live throughout the tropics in Africa, Asia, the Americas and Australia.'))
  for (let n = 51; n <= 55; n += 1) {
    blocks.push(...mcqBlock(n, `Comprehension item number ${n} about Story 2.`, FOUR(`q${n}`), 'B'))
  }
  blocks.push(block('Story 3'))
  blocks.push(block('Football is played all over the world. In Zambia, football is run by the Football Association of Zambia, the FAZ.'))
  for (let n = 56; n <= 60; n += 1) {
    blocks.push(...mcqBlock(n, `Comprehension item number ${n} about Story 3.`, FOUR(`q${n}`), 'C'))
  }

  return blocks
}

// Flatten sections to a document-order list of { num, kind, isPassage }.
function flatten(sections) {
  const out = []
  sections.forEach(section => {
    if (section.kind === 'passage') {
      out.push({ passage: true, title: section.passage?.title, count: (section.passage?.questions || []).length })
      ;(section.passage?.questions || []).forEach(q =>
        out.push({ num: Number(q.sourceQuestionNumber), passage: false }))
      return
    }
    out.push({ num: Number(section.question?.sourceQuestionNumber), passage: false })
  })
  return out
}

function run() {
  const fixture = makeFullG7Fixture()
  const result = processImportedQuestionBlocks(fixture, [])
  const { sections, parts, summary } = result

  // ── Counts ──────────────────────────────────────────────────────────────
  assert.equal(summary.questions, 60, `expected 60 questions, got ${summary.questions}`)
  assert.equal(summary.passages, 3, `expected 3 passages, got ${summary.passages}`)

  // Passages are NOT counted as questions: the question count equals the
  // number of real sub-questions, and each passage owns exactly 5.
  const passageSections = sections.filter(s => s.kind === 'passage')
  assert.equal(passageSections.length, 3, 'expected 3 passage sections')
  passageSections.forEach(s => {
    assert.equal((s.passage?.questions || []).length, 5,
      `passage "${s.passage?.title}" must own 5 questions, got ${(s.passage?.questions || []).length}`)
  })

  // ── Ordering ─────────────────────────────────────────────────────────────
  const flat = flatten(sections)
  const nums = flat.filter(e => !e.passage).map(e => e.num)

  assert.equal(nums[0], 1, 'Q1 must be first')
  assert.equal(nums[nums.length - 1], 60, 'Q60 must be last')

  // Q20 before Q21; Q38 before Q39.
  assert.ok(nums.indexOf(20) < nums.indexOf(21), 'Q20 must come before Q21')
  assert.ok(nums.indexOf(38) < nums.indexOf(39), 'Q38 must come before Q39')

  // Q46–60 appear AFTER the Story/Text passages: the first passage section in
  // document order must precede Q46, and all of 46..60 sit after it.
  const firstPassageIdx = flat.findIndex(e => e.passage)
  const q46Idx = flat.findIndex(e => !e.passage && e.num === 46)
  assert.ok(firstPassageIdx >= 0 && firstPassageIdx < q46Idx,
    'Story passages must appear before Q46–60')
  for (let n = 46; n <= 60; n += 1) {
    const idx = flat.findIndex(e => !e.passage && e.num === n)
    assert.ok(idx > firstPassageIdx, `Q${n} must appear after the first passage`)
  }

  // No duplicate, no missing: nums is exactly 1..60.
  const sorted = [...nums].sort((a, b) => a - b)
  assert.equal(sorted.length, 60, `expected 60 numbered questions, got ${sorted.length}`)
  for (let n = 1; n <= 60; n += 1) {
    assert.equal(sorted[n - 1], n, `question number ${n} is missing or duplicated`)
  }
  assert.equal(new Set(nums).size, 60, 'duplicate question numbers detected')

  // Numbers strictly ascending in document order (no renumbering, no reorder).
  for (let i = 1; i < nums.length; i += 1) {
    assert.ok(nums[i] > nums[i - 1],
      `numbers not in ascending document order at index ${i}: ${nums[i - 1]} then ${nums[i]}`)
  }

  // ── Parts in document order ──────────────────────────────────────────────
  const namedParts = parts.filter(p => String(p.title ?? '').trim())
  const expectedPartOrder = [
    'Questions 21 – 25',
    'Questions 26 – 30',
    'Part 4: Questions 31 – 38',
    'Questions 39 – 45',
    'Reading Comprehension',
  ]
  const titles = namedParts.map(p => p.title)
  expectedPartOrder.forEach(t => assert.ok(titles.includes(t), `missing expected part "${t}" (got: ${titles.join(' | ')})`))
  // Each expected part's index must strictly increase → parts in document order.
  const positions = expectedPartOrder.map(t => titles.indexOf(t))
  for (let i = 1; i < positions.length; i += 1) {
    assert.ok(positions[i] > positions[i - 1], `parts out of document order: ${titles.join(' | ')}`)
  }

  // Section/part order is non-decreasing by first question number: walk the
  // sections, the first question number of each section must never decrease.
  let prevFirstNum = 0
  sections.forEach(section => {
    const firstNum = section.kind === 'passage'
      ? Number(section.passage?.questions?.[0]?.sourceQuestionNumber)
      : Number(section.question?.sourceQuestionNumber)
    assert.ok(firstNum >= prevFirstNum,
      `section order regressed: ${firstNum} after ${prevFirstNum}`)
    prevFirstNum = firstNum
  })

  // ── orderIndex present and document-ordered ──────────────────────────────
  sections.forEach((section, i) => {
    assert.equal(section.orderIndex, i, `section ${i} orderIndex must equal array position`)
  })

  console.log('test-quiz-import-parts: G7 structure (60 questions, 3 passages, parts in order) — PASSED')

  // ── Determinism: re-run produces identical order ─────────────────────────
  const rerun = processImportedQuestionBlocks(makeFullG7Fixture(), [])
  const numsA = flatten(sections).filter(e => !e.passage).map(e => e.num)
  const numsB = flatten(rerun.sections).filter(e => !e.passage).map(e => e.num)
  assert.deepEqual(numsB, numsA, 'import must be deterministic across runs')
  assert.deepEqual(
    rerun.parts.filter(p => String(p.title ?? '').trim()).map(p => p.title),
    namedParts.map(p => p.title),
    'part order must be deterministic across runs',
  )
  console.log('test-quiz-import-parts: re-running the import is deterministic — PASSED')

  // ── Options: "Group comprehension" OFF emits Q46–60 as standalones ───────
  const ungrouped = processImportedQuestionBlocks(makeFullG7Fixture(), [], { groupComprehension: false })
  assert.equal(ungrouped.summary.passages, 0, 'group-comprehension OFF must yield 0 passages')
  assert.equal(ungrouped.summary.questions, 60, 'group-comprehension OFF must still total 60 questions')
  const ungroupedNums = ungrouped.sections.map(s => Number(s.question?.sourceQuestionNumber))
  for (let i = 1; i < ungroupedNums.length; i += 1) {
    assert.ok(ungroupedNums[i] > ungroupedNums[i - 1], 'ungrouped order must stay ascending')
  }
  assert.equal(ungroupedNums[0], 1, 'ungrouped first question must be Q1')
  assert.equal(ungroupedNums[ungroupedNums.length - 1], 60, 'ungrouped last question must be Q60')
  console.log('test-quiz-import-parts: group-comprehension OFF flattens passages, keeps order — PASSED')

  // ── Options: "Preserve numbering" OFF renumbers 1..N sequentially ─────────
  const renumbered = processImportedQuestionBlocks(makeFullG7Fixture(), [], { preserveNumbering: false })
  const renumberedNums = flatten(renumbered.sections).filter(e => !e.passage).map(e => e.num)
  assert.equal(renumberedNums.length, 60, 'renumber must keep 60 questions')
  for (let n = 1; n <= 60; n += 1) {
    assert.equal(renumberedNums[n - 1], n, `renumber must assign ${n} at position ${n - 1}`)
  }
  console.log('test-quiz-import-parts: preserve-numbering OFF renumbers 1..N — PASSED')

  console.log('test-quiz-import-parts: ALL PASSED')
}

run()
