/**
 * Placement rules for inserting a banked question into a paper.
 *
 * Plain-node assertion script — `node scripts/test-question-bank-placement.mjs`
 * or `npm run test:question-bank-placement`. Throws on the first failed
 * assertion.
 *
 * The load-bearing claims here are the ones whose failure is SILENT in the
 * product: a question placed in a section of the wrong type, a question number
 * that disagrees with the printed page, an option dropped on the way in, and a
 * paper copy still sharing nested state with the bank record.
 */

import assert from 'node:assert/strict'
import {
  buildPlacementPlan, deriveSectionType, isTypeCompatible, normalizePlacementType,
  placementTypeLabel, optionCountConflict, buildInsertedQuestion, sectionQuestionCount,
} from '../src/utils/questionBankPlacement.js'
import { serializeQuizSections } from '../src/utils/quizSections.js'
import { buildQuestionNumberMap, getQuestionKey } from '../functions/shared/assessment/questionNumberingCore.js'

let passed = 0
function check(label, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${label}`)
}

/* ── fixtures ─────────────────────────────────────────────────────────── */

let idSeed = 0
function standalone(question = {}, partId = null) {
  idSeed += 1
  return {
    id: `section-${idSeed}`,
    kind: 'standalone',
    question: {
      localId: `q-${idSeed}`,
      text: question.text ?? `Question ${idSeed}`,
      type: question.type ?? 'mcq',
      options: question.options ?? ['a', 'b', 'c', 'd'],
      marks: question.marks ?? 1,
      partId,
      ...question,
    },
  }
}

function passage(count, type = 'short_answer', partId = null) {
  idSeed += 1
  return {
    id: `section-${idSeed}`,
    kind: 'passage',
    partId,
    passage: {
      id: `passage-${idSeed}`,
      questions: Array.from({ length: count }, (_, i) => ({
        localId: `pq-${idSeed}-${i}`, text: `Follow-up ${i + 1}`, type, options: [], marks: 2, partId,
      })),
    },
  }
}

function pagebreak(partId = null) {
  idSeed += 1
  return { id: `section-${idSeed}`, kind: 'pagebreak', partId }
}

/* ── type vocabulary ──────────────────────────────────────────────────── */

console.log('\nquestion-bank-placement')

check('legacy type spellings fold onto one canonical name', () => {
  assert.equal(normalizePlacementType('fill'), 'fill_blanks')
  assert.equal(normalizePlacementType('short'), 'short_answer')
  assert.equal(normalizePlacementType('True/False'), 'tf')
  assert.equal(normalizePlacementType('structured'), 'diagram')
  assert.equal(normalizePlacementType(''), 'mcq')
})

check('True/False is its own family — never folded into multiple choice', () => {
  assert.equal(isTypeCompatible('mcq', 'tf'), false)
  assert.equal(isTypeCompatible('tf', 'mcq'), false)
  assert.equal(isTypeCompatible('tf', 'tf'), true)
})

check('empty and mixed sections accept anything; a typed one does not', () => {
  assert.equal(isTypeCompatible('empty', 'essay'), true)
  assert.equal(isTypeCompatible('mixed', 'essay'), true)
  assert.equal(isTypeCompatible('diagram', 'mcq'), false)
  assert.equal(isTypeCompatible('diagram', 'structured'), true)
})

check('a section takes its type from its questions', () => {
  assert.equal(deriveSectionType([]), 'empty')
  assert.equal(deriveSectionType([{ type: 'mcq' }, { type: 'mcq' }]), 'mcq')
  assert.equal(deriveSectionType([{ type: 'mcq' }, { type: 'essay' }]), 'mixed')
  // Two spellings of one type still agree.
  assert.equal(deriveSectionType([{ type: 'short' }, { type: 'short_answer' }]), 'short_answer')
})

check('labels are the words a teacher reads, not the stored key', () => {
  assert.equal(placementTypeLabel('mcq'), 'Multiple choice')
  assert.equal(placementTypeLabel('tf'), 'True / False')
  assert.equal(placementTypeLabel('diagram'), 'Structured')
})

/* ── the plan ─────────────────────────────────────────────────────────── */

check('a blank starter paper offers one position, and it REPLACES the starter', () => {
  const plan = buildPlacementPlan({ sections: [standalone({ text: '', options: ['', '', '', ''] })], parts: [] }, { type: 'mcq' })
  assert.equal(plan.isBlankPaper, true)
  assert.equal(plan.groups.length, 1)
  assert.equal(plan.groups[0].options.length, 1)
  assert.equal(plan.groups[0].options[0].number, 1)
  assert.equal(plan.groups[0].options[0].replaceStarter, true)
  assert.equal(plan.defaultOptionId, 'start')
})

check('a paper with no sections at all reads as blank, not as incompatible', () => {
  const plan = buildPlacementPlan({ sections: [], parts: [] }, { type: 'essay' })
  assert.equal(plan.isBlankPaper, true)
  assert.equal(plan.hasCompatible, true)
  assert.equal(plan.groups[0].options[0].number, 1)
  assert.equal(plan.groups[0].options[0].anchorId, null)
})

check('positions are numbered by printed question number, end included', () => {
  const partA = { id: 'p-a', title: 'Multiple choice', order: 0 }
  const sections = [
    standalone({ type: 'mcq' }, 'p-a'),
    standalone({ type: 'mcq' }, 'p-a'),
    standalone({ type: 'mcq' }, 'p-a'),
  ]
  const plan = buildPlacementPlan({ sections, parts: [partA] }, { type: 'mcq' })
  assert.equal(plan.groups.length, 1)
  const group = plan.groups[0]
  assert.equal(group.label, 'Section A — Multiple choice')
  assert.deepEqual(group.options.map(o => o.number), [1, 2, 3, 4])
  assert.equal(group.options[3].isEnd, true)
  assert.match(group.options[3].label, /end of section/)
})

check('a passage contributes one number per follow-up; a pagebreak contributes none', () => {
  const sections = [
    standalone({ type: 'mcq' }),          // Q1
    passage(3, 'short_answer'),           // Q2 Q3 Q4
    pagebreak(),                          // no number
    standalone({ type: 'mcq' }),          // Q5
  ]
  assert.equal(sectionQuestionCount(sections[1]), 3)
  assert.equal(sectionQuestionCount(sections[2]), 0)
  const plan = buildPlacementPlan({ sections, parts: [] }, { type: 'mcq' })
  assert.deepEqual(plan.groups[0].options.map(o => o.number), [1, 2, 5, 5, 6])
})

check('placement numbering agrees with the numbers the paper prints', () => {
  // The claim: "as Qn" is the number the inserted question would actually
  // carry. Prove it by numbering the paper the way the renderers do and
  // checking each insertion point against the question it lands in front of.
  const sections = [
    standalone({ type: 'mcq' }),
    passage(2, 'short_answer'),
    standalone({ type: 'mcq' }),
  ]
  const serialized = serializeQuizSections(sections, [])
  const numbers = buildQuestionNumberMap(serialized.questions)
  const plan = buildPlacementPlan({ sections, parts: [] }, { type: 'mcq' })
  const options = plan.groups[0].options

  // Point 0 sits before the first standalone question…
  assert.equal(options[0].number, numbers[getQuestionKey(serialized.questions[0])])
  // …point 1 before the passage's first follow-up…
  assert.equal(options[1].number, numbers[getQuestionKey(serialized.questions[1])])
  // …point 2 before the trailing standalone…
  assert.equal(options[2].number, numbers[getQuestionKey(serialized.questions[3])])
  // …and the end point takes the number after the last question.
  assert.equal(options[3].number, serialized.questions.length + 1)
})

check('an incompatible section is RETURNED with a reason, never filtered away', () => {
  const parts = [
    { id: 'p-a', title: 'Multiple choice', order: 0 },
    { id: 'p-b', title: 'Structured', order: 1 },
  ]
  const sections = [
    standalone({ type: 'mcq' }, 'p-a'),
    standalone({ type: 'mcq' }, 'p-a'),
    standalone({ type: 'diagram', options: [] }, 'p-b'),
  ]
  const plan = buildPlacementPlan({ sections, parts }, { type: 'mcq' })
  assert.equal(plan.groups.length, 2)
  const structured = plan.groups[1]
  assert.equal(structured.compatible, false)
  // The positions still exist — disabled, and each says why.
  assert.equal(structured.options.length, 2)
  assert.equal(structured.options[0].compatible, false)
  assert.match(structured.options[0].reason, /Q3 is in Section B — Structured/)
  assert.match(structured.options[0].reason, /multiple choice question/)
})

check('a paper with no compatible section says so instead of placing anyway', () => {
  const parts = [{ id: 'p-a', title: 'Structured', order: 0 }]
  const sections = [
    standalone({ type: 'diagram', options: [] }, 'p-a'),
    standalone({ type: 'diagram', options: [] }, 'p-a'),
  ]
  const plan = buildPlacementPlan({ sections, parts }, { type: 'mcq' })
  assert.equal(plan.hasCompatible, false)
  assert.equal(plan.defaultOptionId, null)
  assert.equal(plan.neededTypeLabel, 'Multiple choice')
})

check('the default position is the end of an EXACT-type section, not a mixed one', () => {
  const parts = [
    { id: 'p-a', title: 'Mixed', order: 0 },
    { id: 'p-b', title: 'Multiple choice', order: 1 },
  ]
  const sections = [
    standalone({ type: 'mcq' }, 'p-a'),
    standalone({ type: 'essay', options: [] }, 'p-a'),
    standalone({ type: 'mcq' }, 'p-b'),
  ]
  const plan = buildPlacementPlan({ sections, parts }, { type: 'mcq' })
  assert.equal(plan.groups[0].sectionType, 'mixed')
  assert.equal(plan.groups[1].sectionType, 'mcq')
  const chosen = plan.groups[1].options.find(o => o.isEnd)
  assert.equal(plan.defaultOptionId, chosen.id)
  assert.equal(chosen.number, 4)
})

check('an empty section is offered — that is what an empty section is for', () => {
  const parts = [{ id: 'p-a', title: 'Multiple choice', order: 0 }]
  // A Part with no sections of its own produces no run; a Part holding only a
  // pagebreak does, and it is empty.
  const sections = [pagebreak('p-a')]
  const plan = buildPlacementPlan({ sections, parts }, { type: 'mcq' })
  assert.equal(plan.groups[0].sectionType, 'empty')
  assert.equal(plan.groups[0].compatible, true)
})

check('interleaved sections split into contiguous runs, each with its own points', () => {
  const parts = [{ id: 'p-a', title: 'A', order: 0 }, { id: 'p-b', title: 'B', order: 1 }]
  const sections = [
    standalone({ type: 'mcq' }, 'p-a'),
    standalone({ type: 'mcq' }, 'p-b'),
    standalone({ type: 'mcq' }, 'p-a'),
  ]
  const plan = buildPlacementPlan({ sections, parts }, { type: 'mcq' })
  assert.equal(plan.groups.length, 3)
  assert.deepEqual(plan.groups.map(g => g.label), ['Section A — A', 'Section B — B', 'Section A — A'])
  // Every option anchors on a real section id, so the caller can splice by id.
  for (const group of plan.groups) {
    for (const option of group.options) assert.ok(option.anchorId)
  }
})

check('ungrouped questions are their own group and are labelled as such', () => {
  const plan = buildPlacementPlan({ sections: [standalone({ type: 'mcq' })], parts: [] }, { type: 'mcq' })
  assert.equal(plan.groups[0].partId, null)
  assert.equal(plan.groups[0].label, 'Questions not in a section')
})

/* ── option count ─────────────────────────────────────────────────────── */

check('an A–E question into an A–D paper is reported, not trimmed', () => {
  const conflict = optionCountConflict({ type: 'mcq', options: ['a', 'b', 'c', 'd', 'e'] }, 4)
  assert.deepEqual(conflict, { have: 5, allowed: 4 })
  // Blank trailing slots are not options.
  assert.equal(optionCountConflict({ type: 'mcq', options: ['a', 'b', 'c', 'd', ''] }, 4), null)
  // Fits, so nothing to say.
  assert.equal(optionCountConflict({ type: 'mcq', options: ['a', 'b'] }, 4), null)
  // A question with no options can never conflict.
  assert.equal(optionCountConflict({ type: 'essay', options: [] }, 4), null)
  // An unset paper setting is not a limit of zero.
  assert.equal(optionCountConflict({ type: 'mcq', options: ['a', 'b', 'c', 'd', 'e'] }, undefined), null)
})

/* ── the copy ─────────────────────────────────────────────────────────── */

check('the paper copy shares NO nested state with the bank question', () => {
  const source = {
    text: 'Add 1/2 and 1/4',
    type: 'mcq',
    options: ['3/4', '1/2', '2/6', '1/8'],
    correctAnswer: 0,
    imageDiagram: { libraryKey: 'fraction_bar', params: { parts: 4 } },
    diagramLabels: [{ id: 'l1', x: 0.2, y: 0.3, text: 'numerator' }],
  }
  const copy = buildInsertedQuestion(source, { id: 'row-1', ownerId: 'u1', version: 3 }, { uid: 'u1', now: '2026-08-08T10:00:00.000Z' })

  copy.options[0] = 'EDITED'
  copy.imageDiagram.params.parts = 99
  copy.diagramLabels[0].text = 'EDITED'
  assert.deepEqual(source.options, ['3/4', '1/2', '2/6', '1/8'])
  assert.equal(source.imageDiagram.params.parts, 4)
  assert.equal(source.diagramLabels[0].text, 'numerator')
})

check('provenance records where the copy came from and nothing more', () => {
  const copy = buildInsertedQuestion({ text: 'x', type: 'mcq' }, { id: 'row-1', ownerId: 'u1', version: 3 }, { uid: 'u1', now: '2026-08-08T10:00:00.000Z' })
  assert.equal(copy.sourceQuestionId, 'row-1')
  assert.equal(copy.sourceBank, 'mine')
  assert.equal(copy.sourceVersion, 3)
  assert.equal(copy.insertedAt, '2026-08-08T10:00:00.000Z')
  // Back-compat with papers filed before this flow.
  assert.equal(copy.sourceBankId, 'row-1')
})

check('a Master-Bank row is provenanced as master by OWNERSHIP, not by filter', () => {
  const copy = buildInsertedQuestion({ text: 'x', type: 'mcq' }, { id: 'row-9', ownerId: 'someone-else', masterEligible: true }, { uid: 'u1' })
  assert.equal(copy.sourceBank, 'master')
  // No stored version on the row → null rather than NaN, which Firestore rejects.
  assert.equal(copy.sourceVersion, null)
})

check('in-paper identity is never carried in from the stored row', () => {
  // A legacy row that still holds a localId must not bring it: two questions
  // sharing one localId collapse to a single entry in the number map.
  const copy = buildInsertedQuestion(
    { text: 'x', type: 'mcq', localId: 'question-old', partId: 'p-stale', passageId: 'ps-1', order: 7 },
    { id: 'row-1' },
    { uid: 'u1' },
  )
  assert.equal('localId' in copy, false)
  assert.equal('partId' in copy, false)
  assert.equal('passageId' in copy, false)
  assert.equal('order' in copy, false)
})

check('every insertion point carries the Part it would join', () => {
  const parts = [{ id: 'p-a', title: 'Multiple choice', order: 0 }]
  const sections = [standalone({ type: 'mcq' }, 'p-a'), standalone({ type: 'mcq' })]
  const plan = buildPlacementPlan({ sections, parts }, { type: 'mcq' })
  assert.deepEqual(plan.groups.map(g => g.options.map(o => o.partId)), [['p-a', 'p-a'], [null, null]])
})

check('the copy arrives unlocked, unedited and unsaved', () => {
  const copy = buildInsertedQuestion(
    { text: 'x', type: 'mcq', locked: true, teacherEdited: true, _id: 'firestore-id' },
    { id: 'row-1' },
    { uid: 'u1' },
  )
  assert.equal(copy.locked, false)
  assert.equal(copy.teacherEdited, false)
  assert.equal(copy._id, null)
})

check('no provenance is invented for a question that came from nowhere', () => {
  const copy = buildInsertedQuestion({ text: 'x', type: 'mcq' }, {}, { uid: 'u1' })
  assert.equal(copy.sourceQuestionId, null)
  assert.equal(copy.sourceBank, null)
  assert.equal(copy.insertedAt, null)
  assert.equal(buildInsertedQuestion(null, {}), null)
})

console.log(`\n✅ question-bank-placement: ${passed} assertions passed\n`)
