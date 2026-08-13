/**
 * The §11 acceptance results, as fixtures.
 *
 * Every assertion here is one of the required outcomes stated in the brief,
 * written against the canonical document rather than against a renderer — which
 * is the point of there BEING a canonical document. A result that holds on the
 * document holds in the preview, the print window, the PDF and Word, because
 * those four consume it; a result asserted against one renderer would say
 * nothing about the other three.
 *
 * What is deliberately NOT here: anything needing a browser. Measured
 * pagination, the rendered `.docx` and the print window have their own suites
 * (`test:paper-pagination`, `test:paper-golden`, the Vitest specs) because they
 * need a DOM. This file is the part that is decidable from the document.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 */

import assert from 'node:assert/strict'
import { buildAssessmentDocument, bodyBlocks } from '../../../utils/assessmentDocument.js'
import { sanitizePaperStems } from './inlineOptionStem.js'
import { collectPaperIntegrityIssues } from '../../../../functions/shared/assessment/paperIntegrityCore.js'
import { buildPagePlan } from './paperPagePlan.js'
import { PAGINATION_STATES } from '../../../utils/paperPaginationCore.js'
import { optionLabel } from '../../../utils/mcqChoices.js'

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (err) {
    console.error(`  ✗   ${name}\n      ${err.message}`)
    process.exitCode = 1
  }
}

/* ── Fixtures ────────────────────────────────────────────────────────────── */

const mcq = (n, over = {}) => ({
  localId: `q${n}`,
  order: n,
  type: 'mcq',
  text: `Question ${n}?`,
  options: ['Alpha', 'Beta', 'Gamma', 'Delta'],
  correctAnswer: 0,
  marks: 1,
  ...over,
})

/** A 25-question, one-mark, four-choice section — the brief's first result. */
const twentyFiveOneMark = {
  schoolName: 'Kabulonga Primary',
  subject: 'Mathematics',
  grade: 4,
  term: 2,
  year: 2026,
  assessmentType: 'end_of_term',
  answerChoiceCount: 4,
  parts: [{ id: 'p1', title: 'Multiple choice', marksMode: 'uniform', marksPerQuestion: 1 }],
}
const twentyFiveQuestions = Array.from({ length: 25 }, (_, i) => mcq(i + 1, { partId: 'p1' }))

const questionBlocks = (doc) => doc.blocks.filter((b) => b.kind === 'question')

console.log('\n— multiple choice: the count the teacher chose —')

test('a 25-question one-mark section displays 25 marks', () => {
  const doc = buildAssessmentDocument(twentyFiveOneMark, twentyFiveQuestions)
  assert.equal(doc.totalMarks, 25)
  assert.equal(doc.marks.sections[0].marks, 25)
  // And the same number reaches the cover line, rather than being re-summed.
  assert.equal(doc.blocks.find((b) => b.kind === 'learnerFields').totalMarks, 25)
  assert.equal(doc.blocks.find((b) => b.kind === 'sectionHeader').marks, 25)
})

test('a four-choice section renders A, B, C and D everywhere', () => {
  const doc = buildAssessmentDocument(twentyFiveOneMark, twentyFiveQuestions)
  for (const block of questionBlocks(doc)) {
    assert.equal(block.options.length, 4)
    assert.equal(block.choiceCount, 4)
    assert.deepEqual(block.options.map((_, i) => optionLabel(i)), ['A', 'B', 'C', 'D'])
  }
})

test('a three-choice paper renders exactly A, B and C', () => {
  const doc = buildAssessmentDocument(
    { ...twentyFiveOneMark, answerChoiceCount: 3 },
    [mcq(1, { partId: 'p1' })],
  )
  const block = questionBlocks(doc)[0]
  assert.equal(block.options.length, 3)
  assert.deepEqual(block.options, ['Alpha', 'Beta', 'Gamma'])
})

test('a five-choice paper renders A through E', () => {
  const doc = buildAssessmentDocument(
    { ...twentyFiveOneMark, answerChoiceCount: 5 },
    [mcq(1, { partId: 'p1', options: ['A1', 'B1', 'C1', 'D1', 'E1'] })],
  )
  assert.equal(questionBlocks(doc)[0].options.length, 5)
  assert.equal(optionLabel(4), 'E')
})

test('a section overrides the paper, and the marking key follows it', () => {
  const paper = {
    ...twentyFiveOneMark,
    answerChoiceCount: 4,
    parts: [{ id: 'p1', title: 'Three-choice section', answerChoiceCount: 3 }],
  }
  const questions = [mcq(1, { partId: 'p1' })]
  const forLearners = buildAssessmentDocument(paper, questions, { mode: 'paper' })
  const forMarking = buildAssessmentDocument(paper, questions, { mode: 'scheme' })
  assert.equal(questionBlocks(forLearners)[0].options.length, 3)
  assert.equal(
    questionBlocks(forMarking)[0].options.length, 3,
    'the marking key must not offer a choice the learner never saw',
  )
})

test('trimming to a shorter list never edits the stored question', () => {
  const stored = mcq(1, { partId: 'p1' })
  const before = [...stored.options]
  buildAssessmentDocument({ ...twentyFiveOneMark, answerChoiceCount: 3 }, [stored])
  assert.deepEqual(stored.options, before, 'switching back must restore the fourth option')
})

console.log('\n— marks —')

test('one mark per question totals the question count', () => {
  const doc = buildAssessmentDocument({ ...twentyFiveOneMark, parts: [] }, [mcq(1), mcq(2), mcq(3)])
  assert.equal(doc.totalMarks, 3)
})

test('two marks per question doubles it, from the section rule alone', () => {
  const doc = buildAssessmentDocument(
    { ...twentyFiveOneMark, parts: [{ id: 'p1', title: 'A', marksMode: 'uniform', marksPerQuestion: 2 }] },
    [mcq(1, { partId: 'p1' }), mcq(2, { partId: 'p1' }), mcq(3, { partId: 'p1' })],
  )
  assert.equal(doc.totalMarks, 6)
  assert.ok(questionBlocks(doc).every((b) => b.marks === 2))
})

test('mixed per-question marks add up', () => {
  const doc = buildAssessmentDocument({ ...twentyFiveOneMark, parts: [] }, [
    mcq(1, { marks: 1 }),
    mcq(2, { marks: 3 }),
    { localId: 'q3', order: 3, type: 'essay', text: 'Discuss.', marks: 10 },
  ])
  assert.equal(doc.totalMarks, 14)
})

test('marks can be hidden beside questions without changing the total', () => {
  const shown = buildAssessmentDocument({ ...twentyFiveOneMark, parts: [] }, [mcq(1)])
  const hidden = buildAssessmentDocument(
    { ...twentyFiveOneMark, parts: [], showQuestionMarks: false }, [mcq(1)],
  )
  assert.equal(questionBlocks(shown)[0].showMarks, true)
  assert.equal(questionBlocks(hidden)[0].showMarks, false)
  assert.equal(shown.totalMarks, hidden.totalMarks)
})

test('totals agree in the cover, the sections and the marking key', () => {
  const paper = {
    ...twentyFiveOneMark,
    parts: [
      { id: 'p1', title: 'Multiple choice', marksMode: 'uniform', marksPerQuestion: 1 },
      { id: 'p2', title: 'Structured' },
    ],
  }
  const questions = [
    ...Array.from({ length: 10 }, (_, i) => mcq(i + 1, { partId: 'p1' })),
    { localId: 'qs', order: 11, type: 'short', text: 'Explain.', marks: 5, partId: 'p2' },
  ]
  const paperDoc = buildAssessmentDocument(paper, questions, { mode: 'paper' })
  const keyDoc = buildAssessmentDocument(paper, questions, { mode: 'scheme' })
  const sectionTotals = paperDoc.blocks.filter((b) => b.kind === 'sectionHeader').map((b) => b.marks)
  assert.deepEqual(sectionTotals, [10, 5])
  assert.equal(sectionTotals.reduce((a, b) => a + b, 0), paperDoc.totalMarks)
  assert.equal(keyDoc.totalMarks, paperDoc.totalMarks)
  assert.equal(paperDoc.blocks.find((b) => b.kind === 'learnerFields').totalMarks, 15)
})

console.log('\n— no option list appears twice —')

test('a stem carrying its own choices is cleaned, and the list is left alone', () => {
  const dirty = [{
    localId: 'q1',
    order: 1,
    type: 'mcq',
    text: 'Which organ pumps blood? A. Lung B. Heart C. Liver D. Kidney',
    options: ['Lung', 'Heart', 'Liver', 'Kidney'],
    correctAnswer: 1,
    marks: 1,
  }]
  const { questions } = sanitizePaperStems(dirty)
  const doc = buildAssessmentDocument({ ...twentyFiveOneMark, parts: [] }, questions)
  const block = questionBlocks(doc)[0]
  assert.equal(block.text, 'Which organ pumps blood?')
  assert.deepEqual(block.options, ['Lung', 'Heart', 'Liver', 'Kidney'])
  // The choices appear exactly once: in the option list, not in the stem.
  for (const option of block.options) {
    assert.ok(!block.text.includes(option), `"${option}" must not also be in the stem`)
  }
})

test('a legitimate labelled list in a stem is preserved', () => {
  const sequencing = [{
    localId: 'q1',
    order: 1,
    type: 'mcq',
    text: 'Arrange in order: A. seed B. seedling C. tree',
    options: ['A, B, C', 'C, B, A', 'B, A, C'],
    correctAnswer: 0,
    marks: 1,
  }]
  const { questions, changed } = sanitizePaperStems(sequencing)
  assert.equal(changed, false, 'teacher content is never deleted to satisfy a pattern')
  assert.equal(questions[0].text, sequencing[0].text)
})

console.log('\n— diagrams —')

test('a figure keeps its configured dimensions on the block every renderer reads', () => {
  const doc = buildAssessmentDocument({ ...twentyFiveOneMark, parts: [] }, [
    mcq(1, { imageUrl: 'https://example.test/heart.png', imageWidth: 'medium', figureAlign: 'right', figureBorder: true }),
  ])
  const block = questionBlocks(doc)[0]
  assert.equal(block.figure.widthMm, 75)
  assert.equal(block.figure.widthEmu, 75 * 36000)
  assert.equal(block.figureAlign, 'right')
  assert.equal(block.figureBorder, true)
  assert.equal(block.figureKeepWithQuestion, true, 'a diagram stays with its question by default')
})

test('a question with no figure carries no figure box to misapply', () => {
  const block = questionBlocks(buildAssessmentDocument({ ...twentyFiveOneMark, parts: [] }, [mcq(1)]))[0]
  assert.equal(block.imageUrl, '')
  assert.equal(block.imageDiagram, null)
})

console.log('\n— preview and export are the same document —')

test('the preview and the exports walk one block list, in one order', () => {
  const doc = buildAssessmentDocument(twentyFiveOneMark, twentyFiveQuestions)
  const numbers = questionBlocks(doc).map((b) => b.number)
  assert.deepEqual(numbers, Array.from({ length: 25 }, (_, i) => i + 1))
  // Every block carries its position, which is the join key between the
  // renderer that measures the pages and the preview that draws them.
  doc.blocks.forEach((block, i) => assert.equal(block.index, i))
})

test('the preview draws the pages the measurement found, not its own', () => {
  const doc = buildAssessmentDocument(twentyFiveOneMark, twentyFiveQuestions)
  const body = bodyBlocks(doc)
  const measured = {
    status: PAGINATION_STATES.READY,
    pageCount: 3,
    pages: [
      { pageNumber: 1, blockIndexes: body.slice(0, 10).map((_, i) => i) },
      { pageNumber: 2, blockIndexes: body.slice(10, 20).map((_, i) => i + 10) },
      { pageNumber: 3, blockIndexes: body.slice(20).map((_, i) => i + 20) },
    ],
    issues: [],
  }
  const plan = buildPagePlan(measured, body.length)
  assert.equal(plan.pageCount, 3, 'a three-page paper previews as three pages')
  assert.equal(plan.pages.flatMap((p) => p.blockIndexes).length, body.length)
})

test('the paper code is not a body block, so it is not drawn at the end of page 3', () => {
  const doc = buildAssessmentDocument(twentyFiveOneMark, twentyFiveQuestions)
  assert.ok(doc.blocks.some((b) => b.kind === 'footerCode'))
  assert.ok(!bodyBlocks(doc).some((b) => b.kind === 'footerCode'))
})

console.log('\n— metadata is identical everywhere —')

test('the grade prints as the teacher typed it', () => {
  const doc = buildAssessmentDocument(twentyFiveOneMark, twentyFiveQuestions)
  assert.match(doc.meta.title, /GRADE 4/)
  assert.ok(!doc.meta.title.includes('FOUR'))
  assert.equal(doc.blocks.find((b) => b.kind === 'header').title, doc.meta.title)
})

test('the learner field labels reach the block the renderers read', () => {
  const doc = buildAssessmentDocument(
    { ...twentyFiveOneMark, nameFieldStyle: 'candidate' }, twentyFiveQuestions,
  )
  assert.equal(doc.blocks.find((b) => b.kind === 'learnerFields').labels.name, "Candidate's Name")
})

test('school, subject, title and totals are one value, not four derivations', () => {
  const doc = buildAssessmentDocument(twentyFiveOneMark, twentyFiveQuestions)
  const header = doc.blocks.find((b) => b.kind === 'header')
  assert.equal(header.schoolName, doc.meta.schoolName)
  assert.equal(header.subject, doc.meta.subject.toUpperCase())
})

console.log('\n— landscape and other sheets —')

test('a landscape paper resolves a landscape page and a wider column', () => {
  const portrait = buildAssessmentDocument(twentyFiveOneMark, twentyFiveQuestions)
  const landscape = buildAssessmentDocument(
    { ...twentyFiveOneMark, layout: { orientation: 'landscape' } }, twentyFiveQuestions,
  )
  assert.equal(landscape.layout.orientation, 'landscape')
  assert.equal(landscape.layout.page.widthMm, 297)
  assert.ok(landscape.layout.content.widthMm > portrait.layout.content.widthMm)
  assert.equal(landscape.totalMarks, portrait.totalMarks, 'orientation is not a content change')
})

test('a landscape paper’s figures resolve against ITS column', () => {
  const figure = mcq(1, { imageUrl: 'x', imageWidth: 'full' })
  const portrait = questionBlocks(
    buildAssessmentDocument({ ...twentyFiveOneMark, parts: [] }, [figure]),
  )[0]
  const landscapeDoc = buildAssessmentDocument(
    { ...twentyFiveOneMark, parts: [], layout: { orientation: 'landscape' } }, [figure],
  )
  const landscape = questionBlocks(landscapeDoc)[0]
  assert.ok(
    landscape.figure.widthMm <= landscapeDoc.layout.content.widthMm + 0.01,
    'never wider than the column it sits in',
  )
  // A landscape sheet is WIDER and SHORTER, and on this figure the height is
  // what binds: a full-width 297mm figure at 1.6 would be 186mm tall on a 210mm
  // page, so the cap narrows it to 151mm — below the portrait paper's 174mm.
  // Stated rather than assumed, because "landscape means bigger figures" is the
  // intuition and it is wrong.
  assert.ok(landscape.figure.heightMm <= landscapeDoc.layout.figure.maxHeightMm + 0.01)
  assert.ok(landscape.figure.widthMm < portrait.figure.widthMm)
  assert.ok(
    landscape.figure.heightMm > portrait.figure.heightMm * 0.8,
    'the figure is still a substantial share of the sheet, not a thumbnail',
  )
})

console.log('\n— saved papers keep working —')

test('a paper carrying none of the new fields renders unchanged', () => {
  // The shape a paper saved before any of this had: no layout object, no
  // choice count, no marks mode, no grade style.
  const legacy = {
    schoolName: 'Old School',
    subject: 'Science',
    grade: 7,
    parts: [{ id: 'p1', title: 'Section one' }],
  }
  const questions = [mcq(1, { partId: 'p1', options: ['a', 'b', 'c', 'd', 'e'], correctAnswer: 4 })]
  const doc = buildAssessmentDocument(legacy, questions)
  assert.equal(
    questionBlocks(doc)[0].options.length, 5,
    'a paper that never chose a count keeps printing every option it holds',
  )
  assert.equal(doc.totalMarks, 1)
  assert.equal(doc.layout.page.label, 'A4')
  assert.equal(collectPaperIntegrityIssues({ assessment: legacy, questions }).blockers.length, 0)
})

test('an empty paper builds a document rather than throwing', () => {
  const doc = buildAssessmentDocument({}, [])
  assert.equal(doc.questionCount, 0)
  assert.equal(doc.totalMarks, 0)
  assert.ok(Array.isArray(doc.blocks))
})

console.log('\n— the export gate catches what prints cleanly and is wrong —')

test('a correct answer that fell off the end blocks the export, and names the question', () => {
  // The paper is switched to A–C; question 13's answer was D. It prints
  // perfectly and the marking key marks against a choice nobody saw — which is
  // the whole class of defect a gate is for. The question is named by its
  // PRINTED position, because that is the number the teacher is looking at.
  const paper = { ...twentyFiveOneMark, answerChoiceCount: 3, parts: [] }
  const questions = [
    ...Array.from({ length: 12 }, (_, i) => mcq(i + 1)),
    mcq(13, { options: ['a', 'b', 'c', 'd'], correctAnswer: 3 }),
  ]
  const { blockers } = collectPaperIntegrityIssues({ assessment: paper, questions })
  assert.equal(blockers.length, 1)
  assert.match(blockers[0].message, /Question 13/)
  assert.match(blockers[0].message, /A–C/)
})

test('a paper whose cover total contradicts its questions blocks the export', () => {
  const { blockers } = collectPaperIntegrityIssues({
    assessment: { ...twentyFiveOneMark, parts: [], declaredTotalMarks: 30 },
    questions: [mcq(1), mcq(2)],
  })
  assert.ok(blockers.some((i) => /add up to 2/.test(i.message)))
})

test('the healthy 25-question fixture is not blocked by anything', () => {
  const { blockers } = collectPaperIntegrityIssues({
    assessment: twentyFiveOneMark, questions: twentyFiveQuestions,
  })
  assert.deepEqual(blockers, [])
})

console.log(`\n✓ paper acceptance — ${passed} tests passed`)
