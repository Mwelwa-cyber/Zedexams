import assert from 'node:assert/strict'
import {
  diffImportedSections,
  mergeImportedSections,
  isQuestionChanged,
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
