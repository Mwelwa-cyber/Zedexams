import assert from 'node:assert/strict'
import {
  diffImportedSections,
  mergeImportedSections,
  isQuestionChanged,
  remapPreservedAnswer,
} from './quizReimportDiff.js'

function standalone({
  id,
  number,
  text,
  options = ['', '', '', ''],
  correctAnswer = 0,
  explanation = '',
  marks = 1,
  type = 'mcq',
  diagramText = '',
  sharedInstruction = '',
  _id,
  localId,
  topic = '',
  partId = null,
}) {
  return {
    kind: 'standalone',
    id: id || `sec-${number}`,
    question: {
      _id,
      localId: localId || `q-${number}`,
      sourceQuestionNumber: number,
      text,
      options,
      correctAnswer,
      explanation,
      marks,
      type,
      diagramText,
      sharedInstruction,
      topic,
      partId,
    },
  }
}

function passage(id) {
  return { kind: 'passage', id, passage: { questions: [] } }
}

// ── isQuestionChanged ──────────────────────────────────────────────

function runIsChangedTest() {
  const base = standalone({ number: 1, text: 'What is 2+2?', options: ['1', '2', '3', '4'], correctAnswer: 3 }).question

  assert.equal(isQuestionChanged(base, { ...base }), false,
    'identical questions are not changed')

  assert.equal(isQuestionChanged(base, { ...base, text: '  What is 2+2?  ' }), false,
    'leading/trailing whitespace is normalised')

  assert.equal(isQuestionChanged(base, { ...base, text: 'What  is  2+2?' }), false,
    'collapsed internal whitespace runs are normalised')

  assert.equal(isQuestionChanged(base, { ...base, text: 'What is 3+3?' }), true,
    'a different stem registers as changed')

  assert.equal(isQuestionChanged(base, { ...base, options: ['1', '2', '5', '4'] }), true,
    'a different option registers as changed')

  assert.equal(isQuestionChanged(base, { ...base, correctAnswer: 2 }), true,
    'a different correct answer registers as changed')

  assert.equal(isQuestionChanged(base, { ...base, marks: 2 }), true,
    'a different marks value registers as changed')

  assert.equal(isQuestionChanged(base, { ...base, type: 'short_answer' }), true,
    'a different type registers as changed')

  console.log('runIsChangedTest passed')
}

runIsChangedTest()

// ── diffImportedSections ───────────────────────────────────────────

function runDiffTest() {
  const existing = [
    standalone({ number: 1, text: 'Q1 original', _id: 'fb-1' }),
    standalone({ number: 2, text: 'Q2 original', _id: 'fb-2' }),
    standalone({ number: 3, text: 'Q3 original (extra)', _id: 'fb-3' }),
  ]
  const incoming = [
    standalone({ number: 1, text: 'Q1 original' }),       // unchanged
    standalone({ number: 2, text: 'Q2 EDITED' }),         // changed
    standalone({ number: 4, text: 'Q4 brand new' }),      // added
    // existing Q3 is now missing → removed
  ]

  const diff = diffImportedSections(existing, incoming)

  assert.equal(diff.unchanged.length, 1, 'one question matched without change')
  assert.equal(diff.unchanged[0].question.sourceQuestionNumber, 1)

  assert.equal(diff.changed.length, 1, 'one question matched with changes')
  assert.equal(diff.changed[0].sourceQuestionNumber, '2')
  assert.match(diff.changed[0].before.question.text, /Q2 original/)
  assert.match(diff.changed[0].after.question.text, /Q2 EDITED/)

  assert.equal(diff.added.length, 1, 'Q4 is added')
  assert.equal(diff.added[0].question.sourceQuestionNumber, 4)

  assert.equal(diff.removed.length, 1, 'Q3 is removed')
  assert.equal(diff.removed[0].question.sourceQuestionNumber, 3)

  console.log('runDiffTest passed')
}

runDiffTest()

// ── mergeImportedSections ──────────────────────────────────────────

function runMergeTest() {
  const existing = [
    standalone({ number: 1, text: 'Q1 manual edit', _id: 'fb-1', localId: 'q-1-existing', topic: 'Fractions' }),
    standalone({ number: 2, text: 'Q2 original', _id: 'fb-2', localId: 'q-2-existing' }),
    standalone({ number: 99, text: 'Manually-added by teacher', _id: 'fb-99', localId: 'q-99-existing' }),
  ]
  const incoming = [
    standalone({ number: 1, text: 'Q1 ALSO EDITED IN DOC' }),
    standalone({ number: 2, text: 'Q2 EDITED IN DOC' }),
    standalone({ number: 3, text: 'Q3 brand new' }),
  ]

  const merged = mergeImportedSections(existing, incoming)

  // Order: existing first (preserving its order), then incoming-only.
  assert.equal(merged.length, 4,
    `merge keeps existing-only (Q99) AND matched (Q1, Q2) AND adds new (Q3) — got ${merged.length}`)

  const byNum = Object.fromEntries(
    merged.map((s) => [String(s.question.sourceQuestionNumber), s]),
  )

  // Matched questions take the incoming TEXT but keep existing _id /
  // localId / topic so Firestore updates in place.
  assert.equal(byNum['1'].question._id, 'fb-1', 'Q1 keeps existing Firestore id')
  assert.equal(byNum['1'].question.localId, 'q-1-existing', 'Q1 keeps existing localId')
  assert.equal(byNum['1'].question.topic, 'Fractions',
    'Q1 keeps the teacher-set topic the importer doesn\'t supply')
  assert.match(byNum['1'].question.text, /ALSO EDITED IN DOC/,
    'Q1 picks up the new text from the docx')

  assert.equal(byNum['2'].question._id, 'fb-2')
  assert.match(byNum['2'].question.text, /EDITED IN DOC/)

  // Existing-only question stays untouched.
  assert.equal(byNum['99'].question._id, 'fb-99')
  assert.match(byNum['99'].question.text, /Manually-added by teacher/)

  // New-only question appended.
  assert.equal(byNum['3'].question.sourceQuestionNumber, 3)
  assert.match(byNum['3'].question.text, /brand new/)

  console.log('runMergeTest passed')
}

runMergeTest()

// Passages flow through merge unchanged — both existing and incoming.
function runPassagePassthroughTest() {
  const existing = [
    passage('p-existing'),
    standalone({ number: 1, text: 'Q1', _id: 'fb-1' }),
  ]
  const incoming = [
    passage('p-incoming'),
    standalone({ number: 1, text: 'Q1 EDITED' }),
    standalone({ number: 2, text: 'Q2 new' }),
  ]

  const merged = mergeImportedSections(existing, incoming)

  // Both passages should be present.
  const passageIds = merged.filter((s) => s.kind === 'passage').map((s) => s.id)
  assert.ok(passageIds.includes('p-existing'), 'existing passage preserved')
  assert.ok(passageIds.includes('p-incoming'), 'incoming passage appended')

  console.log('runPassagePassthroughTest passed')
}

runPassagePassthroughTest()

// Empty existing → merge is just incoming, in incoming order.
function runFirstImportTest() {
  const incoming = [
    standalone({ number: 1, text: 'Q1 first' }),
    standalone({ number: 2, text: 'Q2 first' }),
  ]
  const merged = mergeImportedSections([], incoming)
  assert.equal(merged.length, 2)
  assert.equal(merged[0].question.sourceQuestionNumber, 1)
  assert.equal(merged[1].question.sourceQuestionNumber, 2)
  console.log('runFirstImportTest passed')
}

runFirstImportTest()

// ── Blank-answer preservation (scanned re-import must not wipe the key) ────

function runBlankAnswerPreservationTest() {
  // Teacher imported a scanned paper, set every answer, then re-imported to
  // catch missing questions. Scanned imports ALWAYS carry correctAnswer: ''.
  const existing = [
    standalone({ number: 1, text: 'What is 2+2?', correctAnswer: 3, explanation: 'Because 2+2=4', _id: 'fb-1' }),
    standalone({ number: 2, text: 'Capital of Zambia?', correctAnswer: 0, _id: 'fb-2' }),
  ]
  const incoming = [
    standalone({ number: 1, text: 'What is 2+2?', correctAnswer: '', explanation: '' }),      // identical re-read
    standalone({ number: 2, text: 'Capital city of Zambia?', correctAnswer: '', explanation: '' }), // OCR drift
  ]

  // A blank incoming answer must NOT register as a change on its own.
  assert.equal(
    isQuestionChanged(existing[0].question, incoming[0].question),
    false,
    'identical text with a blank incoming answer is NOT a change',
  )

  const merged = mergeImportedSections(existing, incoming)
  const byNum = Object.fromEntries(merged.map((s) => [String(s.question.sourceQuestionNumber), s]))

  assert.equal(byNum['1'].question.correctAnswer, 3, 'unchanged question keeps its set answer')
  assert.equal(byNum['1'].question.explanation, 'Because 2+2=4', 'explanation survives')
  assert.equal(byNum['2'].question.correctAnswer, 0,
    'even a text-drifted question keeps the teacher\'s answer when the incoming one is blank')
  assert.match(byNum['2'].question.text, /Capital city/, 'the drifted question still takes the new text')

  // A REAL incoming answer (docx with a key) still wins.
  const keyed = mergeImportedSections(existing, [
    standalone({ number: 1, text: 'What is 2+2?', correctAnswer: 2 }),
  ])
  assert.equal(keyed[0].question.correctAnswer, 2, 'a non-blank incoming answer replaces the old one')

  console.log('runBlankAnswerPreservationTest passed')
}

runBlankAnswerPreservationTest()

// ── Occurrence-scoped matching (papers that restart numbering per section) ─

function runNumberingRestartTest() {
  // Section A Q1/Q2, then Section B restarts at Q1. A bare-number map used to
  // collapse both Q1s to the LAST incoming one, destroying Section A.
  const existing = [
    standalone({ number: 1, text: 'Add 2 + 3', _id: 'fb-a1', localId: 'a1', correctAnswer: 1 }),
    standalone({ number: 2, text: 'Subtract 5 - 2', _id: 'fb-a2', localId: 'a2', correctAnswer: 0 }),
    standalone({ number: 1, text: 'Write a composition about your school.', _id: 'fb-b1', localId: 'b1', type: 'short_answer', options: [] }),
  ]
  const incoming = [
    standalone({ number: 1, text: 'Add 2 + 3', correctAnswer: '' }),
    standalone({ number: 2, text: 'Subtract 5 - 2', correctAnswer: '' }),
    standalone({ number: 1, text: 'Write a composition about your school.', correctAnswer: '', type: 'short_answer', options: [] }),
  ]

  const diff = diffImportedSections(existing, incoming)
  assert.equal(diff.unchanged.length, 3, 'occurrence pairing matches both Q1s to their own section')
  assert.equal(diff.changed.length, 0)
  assert.equal(diff.added.length, 0)
  assert.equal(diff.removed.length, 0)

  const merged = mergeImportedSections(existing, incoming)
  assert.equal(merged.length, 3, 'no duplicate or dropped sections')
  assert.match(merged[0].question.text, /Add 2 \+ 3/, 'Section A Q1 intact')
  assert.equal(merged[0].question._id, 'fb-a1')
  assert.match(merged[2].question.text, /composition/, 'Section B Q1 intact — not overwritten by Section A (or vice versa)')
  assert.equal(merged[2].question._id, 'fb-b1')

  console.log('runNumberingRestartTest passed')
}

runNumberingRestartTest()

// ── Passage matching: no duplication + recovered children union in ─────────

function contentPassage({ id, title, children }) {
  return {
    kind: 'passage',
    id,
    passage: {
      title,
      passageText: 'Once upon a time in Kasama…',
      questions: children,
    },
  }
}

function childQ(number, text, correctAnswer = '') {
  return { localId: `pq-${number}-${text.length}`, sourceQuestionNumber: number, text, options: ['a', 'b', 'c', 'd'], correctAnswer }
}

function runPassageUnionTest() {
  const existing = [
    contentPassage({
      id: 'p-existing',
      title: 'The Honest Farmer',
      children: [childQ(5, 'Why did the farmer return the purse?', 2), childQ(6, 'What lesson does the story teach?', 1)],
    }),
  ]
  // Re-import of the SAME passage recovers a child (Q7) the first pass missed.
  const incoming = [
    contentPassage({
      id: 'p-incoming',
      title: 'The Honest Farmer',
      children: [childQ(5, 'Why did the farmer return the purse?'), childQ(6, 'What lesson does the story teach?'), childQ(7, 'Where was the farmer going?')],
    }),
  ]

  const merged = mergeImportedSections(existing, incoming)
  const passages = merged.filter((s) => s.kind === 'passage')
  assert.equal(passages.length, 1, 'the re-imported passage is NOT appended as a duplicate')
  assert.equal(passages[0].id, 'p-existing', 'the teacher\'s copy of the passage is kept')

  const children = passages[0].passage.questions
  assert.equal(children.length, 3, 'the newly-recovered child question unions in')
  assert.equal(children[0].correctAnswer, 2, 'existing children keep their set answers')
  assert.match(children[2].text, /Where was the farmer going/, 'the recovered Q7 lands at the end')

  // A genuinely NEW passage still appends.
  const withNew = mergeImportedSections(existing, [
    contentPassage({ id: 'p-new', title: 'A Trip to Livingstone', children: [childQ(8, 'Who travelled to Livingstone?')] }),
  ])
  assert.equal(withNew.filter((s) => s.kind === 'passage').length, 2, 'an unmatched passage appends as new')

  console.log('runPassageUnionTest passed')
}

runPassageUnionTest()

// ── Answer is remapped (not blindly copied) when options change on re-import ──

function runAnswerRemapTest() {
  const existing = { correctAnswer: 1, options: ['Lusaka', 'Ndola', 'Kitwe', 'Livingstone'] }

  // Options unchanged → keep the index.
  assert.deepEqual(
    remapPreservedAnswer(existing, { correctAnswer: '', options: ['Lusaka', 'Ndola', 'Kitwe', 'Livingstone'] }),
    { correctAnswer: 1 },
    'unchanged options keep the stored index',
  )

  // Options REORDERED → the answer follows the correct option's text to its new slot.
  assert.deepEqual(
    remapPreservedAnswer(existing, { correctAnswer: '', options: ['Ndola', 'Lusaka', 'Kitwe', 'Livingstone'] }),
    { correctAnswer: 0 },
    'reordered options: Ndola moved to index 0 — the answer follows it',
  )

  // The correct option is GONE → clear + flag rather than mark a wrong choice.
  const dropped = remapPreservedAnswer(existing, { correctAnswer: '', options: ['Lusaka', 'Kitwe', 'Livingstone', 'Chipata'] })
  assert.equal(dropped.correctAnswer, '', 'a vanished correct option clears the answer')
  assert.equal(dropped.requiresReview, true, 'and flags the question for review')
  assert.match(dropped.reviewNote, /options changed/i)

  // A written-answer (string) carries over untouched — no options to shift.
  assert.deepEqual(
    remapPreservedAnswer({ correctAnswer: 'photosynthesis', options: [] }, { correctAnswer: '', options: [] }),
    { correctAnswer: 'photosynthesis' },
  )

  // End-to-end through the merge: a matched blank re-import with reordered
  // options must not mark the wrong choice correct.
  const merged = mergeImportedSections(
    [standalone({ number: 5, correctAnswer: 1, options: ['Lusaka', 'Ndola', 'Kitwe', 'Livingstone'], _id: 'fb-5' })],
    [standalone({ number: 5, correctAnswer: '', options: ['Ndola', 'Lusaka', 'Kitwe', 'Livingstone'] })],
  )
  assert.equal(merged[0].question.correctAnswer, 0, 'merged answer follows Ndola to its new index')

  console.log('runAnswerRemapTest passed')
}

runAnswerRemapTest()

// ── Matched passage children are UPDATED (not just appended) on re-import ─────

function runPassageChildUpdateTest() {
  const existing = [
    contentPassage({
      id: 'p-existing',
      title: 'The Honest Farmer',
      children: [childQ(5, 'Why did the farmer return the purse?', 2)],
    }),
  ]
  // Re-import corrects Q5's OCR text AND recovers a missed Q6.
  const incoming = [
    contentPassage({
      id: 'p-incoming',
      title: 'The Honest Farmer',
      children: [
        childQ(5, 'Why did the farmer return the lost purse to its owner?'),  // corrected text, blank answer
        childQ(6, 'What lesson does the story teach?'),                        // newly recovered
      ],
    }),
  ]

  const merged = mergeImportedSections(existing, incoming)
  const children = merged.find((s) => s.kind === 'passage').passage.questions
  assert.equal(children.length, 2, 'the recovered child is added')
  assert.match(children[0].text, /lost purse to its owner/, 'the existing child takes the corrected re-import text')
  assert.equal(children[0].correctAnswer, 2, 'and keeps the teacher-set answer (options unchanged)')
  assert.match(children[1].text, /lesson does the story teach/, 'the new child appends')

  console.log('runPassageChildUpdateTest passed')
}

runPassageChildUpdateTest()

// ── Duplicate numbers are paired by CONTENT, not array position ──────────────

function runDuplicateNumberContentMatchTest() {
  // Numbering-restart paper: the FIRST import missed Section A's Q1 and kept
  // only Section B's Q1. The re-import brings BOTH Q1s. Position pairing would
  // merge Section B's saved id/answer onto Section A's text; content pairing
  // matches B↔B and treats A as genuinely new.
  const existing = [
    standalone({ number: 1, text: 'Write a composition about your school.', type: 'short_answer', options: [], correctAnswer: 'essay', _id: 'fb-B1', localId: 'B1' }),
  ]
  const incoming = [
    standalone({ number: 1, text: 'Add 2 and 3.', options: ['4', '5', '6', '7'], correctAnswer: '' }),      // Section A Q1 (new)
    standalone({ number: 1, text: 'Write a composition about your school.', type: 'short_answer', options: [], correctAnswer: '' }), // Section B Q1 (existing)
  ]

  const merged = mergeImportedSections(existing, incoming)
  assert.equal(merged.length, 2, 'both Q1s are present')
  // The existing Section B question keeps its identity + answer, matched to the
  // Section B incoming (same text), NOT to Section A's "Add 2 and 3".
  const kept = merged.find((s) => s.question._id === 'fb-B1')
  assert.ok(kept, 'the existing Section B Q1 is preserved by id')
  assert.match(kept.question.text, /composition/, 'and keeps its own text, not Section A’s')
  assert.equal(kept.question.correctAnswer, 'essay', 'and its saved answer')
  // Section A Q1 comes in as a NEW question (no stale id stamped on it).
  const added = merged.find((s) => /Add 2 and 3/.test(s.question.text))
  assert.ok(added, 'Section A Q1 is added')
  assert.ok(!added.question._id, 'the added question is not stamped with the existing id')

  // Diff reports it correctly too: one unchanged (B), one added (A), none changed/removed.
  const diff = diffImportedSections(existing, incoming)
  assert.equal(diff.added.length, 1, 'Section A Q1 is an add')
  assert.equal(diff.unchanged.length, 1, 'Section B Q1 is unchanged')
  assert.equal(diff.changed.length, 0)
  assert.equal(diff.removed.length, 0, 'nothing is wrongly reported as removed')

  console.log('runDuplicateNumberContentMatchTest passed')
}

runDuplicateNumberContentMatchTest()
