import assert from 'node:assert/strict'
import {
  parseDeclaredRanges,
  collectDeclaredRanges,
  declaredNumbers,
  reconcilePaperNumbering,
  assignPartsFromRanges,
} from './pastPaperParts.js'

let pass = 0
function test(name, fn) {
  fn()
  pass += 1
  console.log(`  ok  ${name}`)
}

// ── parseDeclaredRanges — the dash / bracket / "to" variants ECZ papers use ──
test('parseDeclaredRanges reads the PSLE English Part headings', () => {
  const ranges = parseDeclaredRanges([
    'Part 1: Questions 1 – 20',
    'Part 4: Questions 31 – 38',
    'PART 2: (Questions 46— 60)',
    'Now do questions 46 – 50.',
    'Now do questions 51 to 55.',
  ])
  const pairs = ranges.map(r => [r.start, r.end])
  assert.deepEqual(pairs, [[1, 20], [31, 38], [46, 60], [46, 50], [51, 55]], 'all five ranges parsed across dash/bracket/to variants')
  assert.equal(ranges[0].label, 'Part 1', 'nearby "Part N" label captured')
  assert.equal(ranges[2].label, 'Part 2', 'label captured through the "(Questions …)" bracket form')
})

test('parseDeclaredRanges ignores non-ranges and absurd spans', () => {
  const ranges = parseDeclaredRanges([
    'Answer all questions.',
    'Questions 5 – 3',          // end < start
    'Questions 1 – 999',        // span too wide
    'There are 20 questions.',  // no range
  ])
  assert.equal(ranges.length, 0, 'no false ranges from prose or reversed/huge spans')
})

// ── collectDeclaredRanges — merge explicit `parts` + scanned text ──
test('collectDeclaredRanges prefers the explicit parts array and dedupes', () => {
  const merged = {
    parts: [
      { label: 'Part 4', sectionTitle: 'Section A', firstNumber: 31, lastNumber: 38, instruction: 'Choose the correct meaning of the underlined word.' },
    ],
    sections: [
      // A passage whose instructions repeat a range already given explicitly.
      { kind: 'passage', title: 'Comprehension', instructions: 'Now do questions 46 – 60.', passageText: '', questions: [
        { sourceQuestionNumber: 46, text: 'Q?', options: ['a', 'b'], sectionTitle: '', sharedInstruction: '' },
      ] },
      // A standalone whose shared instruction carries a spelling range.
      { kind: 'standalone', question: { sourceQuestionNumber: 21, text: '', options: ['a', 'b', 'c', 'd'], sectionTitle: 'Part 2: Questions 21 – 25', sharedInstruction: 'Choose the correctly spelled word.' } },
    ],
  }
  const ranges = collectDeclaredRanges(merged)
  const pairs = ranges.map(r => [r.start, r.end])
  assert.deepEqual(pairs, [[21, 25], [31, 38], [46, 60]], 'ranges merged from parts + passage + question text, sorted, deduped')
  const part4 = ranges.find(r => r.start === 31)
  assert.equal(part4.instruction, 'Choose the correct meaning of the underlined word.', 'explicit part instruction retained')
})

test('declaredNumbers builds the full authoritative set', () => {
  const nums = declaredNumbers([{ start: 1, end: 3 }, { start: 5, end: 6 }])
  assert.deepEqual(nums, [1, 2, 3, 5, 6], 'union of ranges, sorted, no gaps invented')
})

// ── reconcilePaperNumbering — the 60 → 65 over-count + mis-read repair ──
function buildStandalone(n, overrides = {}) {
  return { kind: 'standalone', question: { sourceQuestionNumber: n, text: `Question ${n}`, options: ['a', 'b', 'c', 'd'], ocrConfidence: 0.9, sectionTitle: '', sharedInstruction: '', ...overrides } }
}

test('reconcile drops phantom questions numbered outside every declared range', () => {
  // Declared 1–5, but the model hallucinated a 6th and 7th.
  const ranges = [{ start: 1, end: 5 }]
  const sections = [1, 2, 3, 4, 5, 61, 62].map(n => buildStandalone(n))
  const result = reconcilePaperNumbering(sections, ranges)
  assert.equal(result.sections.length, 5, 'the two out-of-range phantoms are dropped (over-count fixed)')
  assert.equal(result.droppedOutOfRange, 2, 'both phantoms counted')
  assert.deepEqual(result.sections.map(s => s.question.sourceQuestionNumber), [1, 2, 3, 4, 5], 'the real five survive')
})

test('reconcile dedupes a number read twice, keeping the more complete card', () => {
  const ranges = [{ start: 1, end: 3 }]
  const sections = [
    buildStandalone(1),
    buildStandalone(2, { ocrConfidence: 0.4, options: ['a', 'b'] }),      // weak read of 2
    buildStandalone(2, { ocrConfidence: 0.95, options: ['a', 'b', 'c', 'd'] }), // strong read of 2
    buildStandalone(3),
  ]
  const result = reconcilePaperNumbering(sections, ranges)
  assert.equal(result.sections.length, 3, 'the duplicate is removed')
  assert.equal(result.droppedDuplicate, 1, 'one duplicate counted')
  const two = result.sections.find(s => s.question.sourceQuestionNumber === 2)
  assert.equal(two.question.options.length, 4, 'the more complete read of #2 is the survivor')
})

test('reconcile snaps mis-read numbers to the declared sequence when counts match', () => {
  // Five questions in reading order, but the model mis-read #3 as #31 and #4 as
  // #7 — both out of the declared 1–5 range would normally drop them, so this
  // case models an IN-range mis-order: declared 1..5, read as 1,2,4,3,5.
  const ranges = [{ start: 1, end: 5 }]
  const sections = [
    buildStandalone(1, { text: 'first' }),
    buildStandalone(2, { text: 'second' }),
    buildStandalone(4, { text: 'third' }),
    buildStandalone(3, { text: 'fourth' }),
    buildStandalone(5, { text: 'fifth' }),
  ]
  const result = reconcilePaperNumbering(sections, ranges)
  assert.equal(result.snapped, true, 'counts match the declared total → snap fires')
  assert.deepEqual(
    result.sections.map(s => s.question.sourceQuestionNumber),
    [1, 2, 3, 4, 5],
    'numbers snap to the declared sequence in reading order (3rd card becomes 3, 4th becomes 4)',
  )
  assert.deepEqual(result.missing, [], 'nothing missing after a clean snap')
})

test('reconcile does NOT wipe a mid-paper excerpt the model renumbered from 1', () => {
  // The real "imported 0 questions" bug: a teacher imports pages 9–12 of a PSLE
  // paper — Section B "Questions 39–45" — but the vision model renumbered that
  // excerpt 1..7. The declared range is 39–45, so EVERY question is "out of
  // range". The old code dropped them all and returned an empty paper. It must
  // instead keep them and (counts match: 7 read, 7 declared) snap to 39–45.
  const ranges = [{ start: 39, end: 45 }]
  const sections = [1, 2, 3, 4, 5, 6, 7].map(n => buildStandalone(n, { text: `ordering item ${n}` }))
  const result = reconcilePaperNumbering(sections, ranges)
  assert.equal(result.droppedOutOfRange, 0, 'nothing is dropped when NO number lines up with the range')
  assert.equal(result.sections.length, 7, 'all seven questions survive (not zero)')
  assert.equal(result.snapped, true, 'the count matches the declared total → snap realigns the numbers')
  assert.deepEqual(
    result.sections.map(s => s.question.sourceQuestionNumber),
    [39, 40, 41, 42, 43, 44, 45],
    'the excerpt is realigned to the declared 39–45 sequence',
  )
})

test('reconcile still drops a genuine phantom when the numbering DOES line up', () => {
  // Guard: the anti-wipe change must not weaken the normal case. Here most
  // numbers are in-range (1–5), so a stray 61 is still a phantom and dropped.
  const ranges = [{ start: 1, end: 5 }]
  const sections = [1, 2, 3, 4, 5, 61].map(n => buildStandalone(n))
  const result = reconcilePaperNumbering(sections, ranges)
  assert.equal(result.droppedOutOfRange, 1, 'the out-of-range phantom is still removed')
  assert.deepEqual(result.sections.map(s => s.question.sourceQuestionNumber), [1, 2, 3, 4, 5])
})

test('reconcile does NOT snap on a partial extraction; it reports the gap', () => {
  const ranges = [{ start: 1, end: 5 }]
  // Only four of five present (3 is missing).
  const sections = [1, 2, 4, 5].map(n => buildStandalone(n))
  const result = reconcilePaperNumbering(sections, ranges)
  assert.equal(result.snapped, false, 'no snap when the count is short of the declared total')
  assert.deepEqual(result.missing, [3], 'the genuinely missing number is reported')
  assert.deepEqual(result.sections.map(s => s.question.sourceQuestionNumber), [1, 2, 4, 5], 'read numbers left intact')
})

test('reconcile leaves a paper with no declared ranges untouched', () => {
  const sections = [buildStandalone(1), buildStandalone(99)]
  const result = reconcilePaperNumbering(sections, [])
  assert.equal(result.sections.length, 2, 'no ranges → nothing dropped (unusual layouts unharmed)')
  assert.equal(result.snapped, false, 'no snapping without ground-truth ranges')
})

test('reconcile handles phantoms inside a comprehension passage', () => {
  const ranges = [{ start: 46, end: 48 }]
  const sections = [
    { kind: 'passage', title: 'Text 1', instructions: '', passageText: 'A notice…', questions: [
      buildStandalone(46).question,
      buildStandalone(47).question,
      buildStandalone(48).question,
      buildStandalone(70).question, // phantom inside the passage
    ] },
  ]
  const result = reconcilePaperNumbering(sections, ranges)
  assert.equal(result.sections.length, 1, 'passage survives')
  assert.equal(result.sections[0].questions.length, 3, 'the phantom sub-question is dropped')
})

// ── assignPartsFromRanges — instruction-as-stem for spelling/punctuation ──
test('assignParts fills an empty stem with the Part instruction (the four choices are the question)', () => {
  const ranges = [
    { start: 26, end: 30, label: 'Part 3', sectionTitle: 'Section A', instruction: 'Choose the sentence which is correctly punctuated.' },
  ]
  const sections = [
    // A punctuation item as the importer sees it: no printed stem, four sentence options.
    { kind: 'standalone', question: {
      sourceQuestionNumber: 26,
      text: '',
      options: [
        'Cassava, maize potatoes and wheat are carbohydrate foods.',
        'Cassava; maize potatoes and wheat, are carbohydrate foods?',
        'Cassava, maize, potatoes and wheat are carbohydrate foods.',
        'Cassava. maize potatoes and wheat. are carbohydrate foods.',
      ],
      sectionTitle: 'Section A',
      sharedInstruction: 'Choose the sentence which is correctly punctuated.',
    } },
  ]
  const result = assignPartsFromRanges(sections, ranges)
  assert.equal(result.stemsFilled, 1, 'the empty stem was filled')
  const q = result.sections[0].question
  assert.equal(q.text, 'Choose the sentence which is correctly punctuated.', 'the Part instruction becomes the question stem')
  assert.equal(q.sharedInstruction, '', 'the promoted instruction is not also left as a duplicate shared-instruction line')
  assert.equal(q.options.length, 4, 'the four sentences remain the options')
  assert.match(q.sectionTitle, /Questions 26–30/, 'the question is labelled into its Part')
})

test('assignParts leaves a real stem alone but still labels its Part', () => {
  const ranges = [{ start: 31, end: 38, label: 'Part 4', sectionTitle: 'Section A', instruction: 'Choose the correct meaning.' }]
  const sections = [buildStandalone(31, { text: 'Mwengwe is too young to start Grade One. The sentence means that Mwengwe …' })]
  const result = assignPartsFromRanges(sections, ranges)
  assert.equal(result.stemsFilled, 0, 'a question that already has a stem is not overwritten')
  assert.equal(result.sections[0].question.text, 'Mwengwe is too young to start Grade One. The sentence means that Mwengwe …', 'real stem preserved')
  assert.match(result.sections[0].question.sectionTitle, /Part 4.*Questions 31–38/, 'still grouped into Part 4')
})

test('assignParts derives the instruction from siblings when the range carries none', () => {
  // No instruction on the range, but the spelling items share one — use it.
  const ranges = [{ start: 21, end: 22, label: 'Part 2', sectionTitle: 'Section A', instruction: '' }]
  const sections = [
    { kind: 'standalone', question: { sourceQuestionNumber: 21, text: '', options: ['tributaly', 'tributary', 'tributely', 'tributery'], sectionTitle: '', sharedInstruction: 'Choose the correctly spelled word.' } },
    { kind: 'standalone', question: { sourceQuestionNumber: 22, text: '', options: ['quite', 'quiett', 'quiet', 'queit'], sectionTitle: '', sharedInstruction: 'Choose the correctly spelled word.' } },
  ]
  const result = assignPartsFromRanges(sections, ranges)
  assert.equal(result.stemsFilled, 2, 'both empty spelling stems filled from the shared sibling instruction')
  assert.equal(result.sections[0].question.text, 'Choose the correctly spelled word.', 'derived instruction promoted to the stem')
})

console.log(`\nAll ${pass} pastPaperParts tests passed.`)
