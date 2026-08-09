import assert from 'node:assert/strict'
import {
  createPassageSection,
  createStandaloneSection,
  insertStandaloneSection,
  serializeQuizSections,
  hydrateQuizSections,
  patchSectionsWithAssignedIds,
} from './quizSections.js'

// ── Insert a question at any position (between two cards / top of a Part) ──
// Question numbers derive purely from sections[] order, so splicing a new
// standalone section into the right slot must renumber automatically and keep
// the new card in the correct Part. Pins the pure helper behind the editor's
// "Insert question here" dividers.
function runInsertStandaloneTest() {
  const base = [
    createStandaloneSection({ text: 'Q1', partId: 'partA' }),
    createStandaloneSection({ text: 'Q2', partId: 'partA' }),
    createStandaloneSection({ text: 'Q3', partId: 'partB' }),
  ]
  const numberOf = (sections, text) => {
    const { questions } = serializeQuizSections(sections, [])
    const q = questions.find(x => String(x.text).includes(text))
    return q ? q.order : null
  }

  // Insert AFTER the first card → new card becomes Q2, old Q2/Q3 shift up.
  const afterFirst = insertStandaloneSection(base, { anchorId: base[0].id, mode: 'after', partId: 'partA' })
  assert.equal(afterFirst.sections.length, 4, 'insert grows the list by one')
  assert.equal(afterFirst.sections[1].id, afterFirst.insertedId, 'new section lands at index 1 (right after the anchor)')
  assert.equal(afterFirst.sections[1].question.partId, 'partA', 'inserted question inherits the requested Part')
  assert.equal(afterFirst.insertedQuestionId, afterFirst.sections[1].question.localId, 'insertedQuestionId points at the new card for scroll/focus')
  assert.equal(numberOf(afterFirst.sections, 'Q1'), 1, 'Q1 keeps number 1')
  assert.equal(numberOf(afterFirst.sections, 'Q2'), 3, 'old Q2 shifts from 2 → 3')
  assert.equal(numberOf(afterFirst.sections, 'Q3'), 4, 'old Q3 shifts from 3 → 4')
  // The blank inserted card takes the freed-up number 2.
  const insertedOrder = serializeQuizSections(afterFirst.sections, [])
    .questions.find(q => q.localId === afterFirst.insertedQuestionId).order
  assert.equal(insertedOrder, 2, 'the inserted blank card takes number 2 (between old 1 and 2)')

  // Insert BEFORE a card → lands at that card's slot.
  const beforeThird = insertStandaloneSection(base, { anchorId: base[2].id, mode: 'before', partId: 'partB' })
  assert.equal(beforeThird.sections[2].id, beforeThird.insertedId, 'before-mode splices at the anchor index')
  assert.equal(beforeThird.sections[2].question.partId, 'partB', 'before-insert inherits Part B')

  // anchorId null → very top of the paper.
  const atTop = insertStandaloneSection(base, { anchorId: null })
  assert.equal(atTop.sections[0].id, atTop.insertedId, 'null anchor inserts at the very start')

  // Unknown anchor (deleted mid-interaction) → append, never throw.
  const orphan = insertStandaloneSection(base, { anchorId: 'gone', mode: 'after' })
  assert.equal(orphan.sections[orphan.sections.length - 1].id, orphan.insertedId, 'unknown anchor appends at the end')

  // Purity: the input array is never mutated.
  assert.equal(base.length, 3, 'insert never mutates the input sections array')

  console.log('runInsertStandaloneTest passed (insert between / before / top / unknown anchor + renumber)')
}

runInsertStandaloneTest()

// ── Issue 2: passage short-answer sub-questions must NOT be forced to MCQ ──
// The passage UI can add short-answer sub-questions; serialization used to
// hard-code type:'mcq', silently converting them and corrupting the saved
// paper + marking key. Pin the round-trip so it can't regress.
function runPassageShortAnswerRoundTripTest() {
  const passageSection = createPassageSection({
    title: 'Comprehension',
    passageText: 'Once upon a time…',
    questions: [
      { type: 'mcq', text: 'Pick one', options: ['a', 'b', 'c', 'd'], correctAnswer: 1 },
      { type: 'short_answer', text: 'Explain the moral', options: [], correctAnswer: 'Be kind' },
    ],
  })

  const serialized = serializeQuizSections([passageSection], [])
  const mcq = serialized.questions.find(q => q.text === 'Pick one')
  const short = serialized.questions.find(q => q.text === 'Explain the moral')

  assert.equal(mcq.type, 'mcq', 'MCQ sub-question keeps its type')
  assert.equal(short.type, 'short_answer',
    'short-answer sub-question must NOT be coerced to mcq on save')
  assert.deepEqual(short.options, [],
    'short-answer sub-question carries no options')

  // Reopen the saved paper — the short-answer must come back as short_answer.
  // The passage's stimulus text is what the learner reads in the runner; a
  // dropped passageText is the "English quiz lost its passage" failure. Pin
  // it through both halves of the round-trip.
  const serializedPassage = serialized.passages.find(p => p.title === 'Comprehension')
  assert(serializedPassage, 'passage serializes into passages[]')
  assert.equal(serializedPassage.passageText, 'Once upon a time…',
    'passageText must survive serialization')

  const { sections } = hydrateQuizSections(serialized.questions, serialized.passages, [], [])
  const reopened = sections.find(s => s.kind === 'passage')
  assert(reopened, 'passage section round-trips')
  assert.equal(reopened.passage.passageText, 'Once upon a time…',
    'passageText must survive serialize → hydrate (reopen) round-trip')
  const reopenedShort = reopened.passage.questions.find(q => q.type === 'short_answer')
  assert(reopenedShort, 'short-answer sub-question reopens as short_answer, not mcq')
  assert.equal(typeof reopenedShort.correctAnswer, 'string',
    'short-answer correctAnswer reopens as a string')
  assert.deepEqual(reopenedShort.options, [],
    'short-answer sub-question reopens with no options')

  console.log('runPassageShortAnswerRoundTripTest passed (mcq + short_answer preserved)')
}

runPassageShortAnswerRoundTripTest()

// ── Issue 1: essay / numeric / matching / sequence persist + reopen ──
function runStandaloneTypeRoundTripTest() {
  const sections = [
    createStandaloneSection({ type: 'essay', text: 'Discuss', options: [], correctAnswer: '' }),
    createStandaloneSection({
      type: 'numeric', text: '6×7?', options: [], correctAnswer: '42',
      numericTolerance: 1, numericUnit: 'kg',
    }),
    createStandaloneSection({
      type: 'matching', text: 'Match', options: [],
      matchingLeft: ['a', 'b'], matchingRight: ['1', '2'], matchingAnswer: [0, 1],
    }),
    createStandaloneSection({
      type: 'sequence', text: 'Order', options: [],
      sequenceItems: ['x', 'y', 'z'], sequenceAnswer: [1, 2, 3],
    }),
  ]

  const serialized = serializeQuizSections(sections, [])
  const { sections: reopened } = hydrateQuizSections(serialized.questions, [], [], [])
  const byType = Object.fromEntries(reopened.map(s => [s.question.type, s.question]))

  assert(byType.essay, 'essay reopens as essay')
  assert.deepEqual(byType.essay.options, [], 'essay reopens with no options')

  assert(byType.numeric, 'numeric reopens as numeric')
  assert.equal(byType.numeric.numericTolerance, 1, 'numeric tolerance round-trips')
  assert.equal(byType.numeric.numericUnit, 'kg', 'numeric unit round-trips')

  assert(byType.matching, 'matching reopens as matching')
  assert.deepEqual(byType.matching.matchingAnswer, [0, 1], 'matching answer round-trips')

  assert(byType.sequence, 'sequence reopens as sequence')
  assert.deepEqual(byType.sequence.sequenceAnswer, [1, 2, 3], 'sequence answer round-trips')

  console.log('runStandaloneTypeRoundTripTest passed (essay/numeric/matching/sequence)')
}

runStandaloneTypeRoundTripTest()

// ── Stimulus answer-space + passage total marks round-trip ──
// Answer-space settings (format/lines/labelled-blanks), per-sub-question word
// banks, and a passage's pinned total must survive serialize → hydrate.
function runStimulusAnswerSpaceRoundTripTest() {
  const passageSection = createPassageSection({
    passageKind: 'diagram',
    title: 'Study the diagram below and answer the questions that follow.',
    manualMarks: 7,
    questions: [
      {
        type: 'short_answer', text: 'Name the parts P, Q and R.', options: [], correctAnswer: 'P=nose',
        answerFormat: 'labelled_blanks', blankLabels: ['P', 'Q', 'R'], wordBank: ['Nose', 'Lungs'],
      },
      {
        type: 'short_answer', text: 'State the function of R.', options: [], correctAnswer: 'gas exchange',
        answerFormat: 'lines', answerLines: 3,
      },
      {
        type: 'short_answer', text: 'Answered on the diagram.', options: [], correctAnswer: '',
        answerFormat: 'none',
      },
    ],
  })

  const serialized = serializeQuizSections([passageSection], [])
  const savedPassage = serialized.passages[0]
  assert.equal(savedPassage.passageKind, 'diagram', 'passageKind diagram persists')
  assert.equal(savedPassage.manualMarks, 7, 'passage manualMarks persists')

  const labelled = serialized.questions.find(q => q.answerFormat === 'labelled_blanks')
  assert(labelled, 'labelled-blanks sub-question serialized')
  assert.deepEqual(labelled.blankLabels, ['P', 'Q', 'R'], 'blankLabels persist')
  assert.deepEqual(labelled.wordBank, ['Nose', 'Lungs'], 'wordBank persists')

  const { sections: reopened } = hydrateQuizSections(
    serialized.questions, serialized.passages, [], serialized.pagebreaks,
  )
  const passage = reopened.find(s => s.kind === 'passage')
  assert(passage, 'passage reopens')
  assert.equal(passage.passage.passageKind, 'diagram', 'passageKind reopens as diagram')
  assert.equal(passage.passage.manualMarks, 7, 'manualMarks reopens')

  const subLabelled = passage.passage.questions.find(q => q.answerFormat === 'labelled_blanks')
  assert(subLabelled, 'labelled-blanks sub-question reopens')
  assert.deepEqual(subLabelled.blankLabels, ['P', 'Q', 'R'], 'blankLabels reopen')
  assert.deepEqual(subLabelled.wordBank, ['Nose', 'Lungs'], 'wordBank reopens on the sub-question')

  const subLines = passage.passage.questions.find(q => q.answerLines === 3)
  assert(subLines, 'custom answer-lines sub-question reopens with its line count')

  const subNone = passage.passage.questions.find(q => q.answerFormat === 'none')
  assert(subNone, "'none' answer-space sub-question reopens")

  console.log('runStimulusAnswerSpaceRoundTripTest passed (answer-space + passage total)')
}

runStimulusAnswerSpaceRoundTripTest()

// ── answerLines: never-set stays null; explicit 0 stays 0 ──
// The renderers (PaperBlocks / assessmentToPdf / assessmentToDocx) treat an
// explicit 0 as "print no ruled lines" and null as "use the per-type
// default". Number(null) is 0 in JS, so the old normalizeAnswerSpace turned
// every never-set count into an explicit 0 on save — after one save→reload
// short-answer questions printed with NO answer space.
function runAnswerLinesNullVsZeroTest() {
  const sections = [
    createStandaloneSection({
      type: 'short_answer', text: 'Never-set line count.', options: [], correctAnswer: '',
      answerLines: null,
    }),
    createStandaloneSection({
      type: 'short_answer', text: 'Explicit zero (answered on the diagram).', options: [], correctAnswer: '',
      answerLines: 0,
    }),
  ]
  const serialized = serializeQuizSections(sections, [])
  const neverSet = serialized.questions.find(q => q.text.includes('Never-set'))
  const explicitZero = serialized.questions.find(q => q.text.includes('Explicit zero'))
  assert.equal(neverSet.answerLines, null, 'never-set answerLines serializes as null (per-type default)')
  assert.equal(explicitZero.answerLines, 0, 'an explicit 0 persists as 0 (no lines)')
  console.log('runAnswerLinesNullVsZeroTest passed (null vs explicit 0)')
}

runAnswerLinesNullVsZeroTest()

// ── Diagram labels / table / drawing canvas round-trip ──
// These rich fields must survive serialize → hydrate for BOTH standalone and
// passage sub-questions (they previously survived only in the local draft).
function runDiagramFieldsRoundTripTest() {
  const sections = [
    createStandaloneSection({
      type: 'diagram', text: 'Label the heart', options: [], correctAnswer: '',
      imageUrl: 'https://x/heart.png',
      diagramLabels: [
        // Carries a dragged leader-tip (tx/ty) that must survive the round-trip.
        { id: 'l1', x: 0.5, y: 0.3, tx: 0.62, ty: 0.42, text: 'Aorta' },
        // A blank-text identify hotspot — the marker is its number, so it must
        // not be dropped on save (students still fill in blank #2).
        { id: 'l2', x: 0.7, y: 0.6, text: '' },
      ],
      diagramMode: 'identify',
      drawingHeight: 220,
    }),
    createStandaloneSection({
      type: 'short_answer', text: 'Read the table', options: [], correctAnswer: '',
      tableData: { headers: ['Animal', 'Legs'], rows: [['Dog', '4'], ['Bird', '2']] },
    }),
    createPassageSection({
      passageKind: 'diagram',
      title: 'Study the diagram and answer the questions.',
      questions: [
        {
          type: 'short_answer', text: 'Name the labelled parts', options: [], correctAnswer: '',
          diagramLabels: [{ id: 'p1', x: 0.2, y: 0.8, text: 'X' }],
          diagramMode: 'identify',
          drawingHeight: 160,
          tableData: { headers: ['Part'], rows: [['lung']] },
        },
      ],
    }),
  ]

  const serialized = serializeQuizSections(sections, [])
  const { sections: reopened } = hydrateQuizSections(
    serialized.questions, serialized.passages, [], serialized.pagebreaks,
  )

  const diagramQ = reopened.find(s => s.kind === 'standalone' && s.question.type === 'diagram')?.question
  assert(diagramQ, 'standalone diagram question reopens')
  assert.equal(diagramQ.diagramLabels.length, 2, 'all hotspots round-trip, incl. the blank-text one')
  assert.equal(diagramQ.diagramLabels[0].text, 'Aorta', 'label text round-trips')
  assert.equal(diagramQ.diagramLabels[1].text, '', 'blank-text identify hotspot survives save')
  assert.equal(diagramQ.diagramLabels[0].tx, 0.62, 'leader-tip tx survives save → reload')
  assert.equal(diagramQ.diagramLabels[0].ty, 0.42, 'leader-tip ty survives save → reload')
  assert.equal(diagramQ.diagramLabels[1].tx, undefined, 'a target-less label stays target-less (no spurious tip)')
  assert.equal(diagramQ.diagramMode, 'identify', 'diagramMode round-trips')
  assert.equal(diagramQ.drawingHeight, 220, 'drawingHeight round-trips')

  const tableQ = reopened.find(s => s.kind === 'standalone' && s.question.tableData)?.question
  assert(tableQ, 'standalone table question reopens')
  assert.deepEqual(tableQ.tableData.headers, ['Animal', 'Legs'], 'table headers round-trip')
  assert.equal(tableQ.tableData.rows.length, 2, 'table rows round-trip')

  const passage = reopened.find(s => s.kind === 'passage')
  const subQ = passage.passage.questions[0]
  assert.equal(subQ.diagramLabels.length, 1, 'passage sub-question diagram labels round-trip')
  assert.equal(subQ.diagramMode, 'identify', 'passage sub-question diagramMode round-trips')
  assert.equal(subQ.drawingHeight, 160, 'passage sub-question drawingHeight round-trips')
  assert.deepEqual(subQ.tableData.headers, ['Part'], 'passage sub-question table round-trips')

  console.log('runDiagramFieldsRoundTripTest passed (labels/table/canvas, standalone + passage)')
}

// A reconstructed paper can carry a wide timetable (7 cols) and a converted
// library-SVG shape ({libraryKey, params}). Both must survive save → reload so
// the professional export matches what the review screen showed.
function runReconstructionShapesRoundTripTest() {
  const sections = [
    createStandaloneSection({
      type: 'short_answer', text: 'Study the timetable', options: [], correctAnswer: '',
      tableData: {
        headers: ['Time', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Total'],
        rows: [['08:00', 'Eng', 'Sci', 'Eng', 'Maths', 'PE', '5']],
      },
    }),
    createStandaloneSection({
      type: 'diagram', text: 'Name the shape', options: [], correctAnswer: '',
      imageDiagram: { libraryKey: 'cylinder', params: { r: 'r', h: 'h' } },
    }),
  ]
  const serialized = serializeQuizSections(sections, [])
  const { sections: reopened } = hydrateQuizSections(serialized.questions, [], [], [])

  const wide = reopened.find(s => s.question?.tableData)?.question
  assert(wide, 'wide-table question reopens')
  assert.equal(wide.tableData.headers.length, 7, 'all 7 columns survive save (no 6-col truncation)')
  assert.equal(wide.tableData.rows[0].length, 7, 'row keeps all 7 cells')
  assert.equal(wide.tableData.headers[6], 'Total', 'the 7th column is preserved')

  const svgQ = reopened.find(s => s.question?.imageDiagram)?.question
  assert(svgQ, 'converted-SVG question reopens')
  assert.equal(svgQ.imageDiagram.libraryKey, 'cylinder', 'library shape key round-trips')
  assert.equal(svgQ.imageDiagram.params.h, 'h', 'shape params round-trip')

  console.log('runReconstructionShapesRoundTripTest passed (wide table + library SVG)')
}
runReconstructionShapesRoundTripTest()

runDiagramFieldsRoundTripTest()

// ── Short-answer SUB-PARTS round-trip + auto-summed marks ──
// A multi-part "(a)(b)(c)" short-answer question must survive serialize →
// hydrate intact, and the question's marks must auto-sum from its parts (the
// stem owns none) so the paper total stays honest.
function runSubPartsRoundTripTest() {
  const sections = [
    createStandaloneSection({
      type: 'short_answer',
      text: 'Fill in the blanks to complete the sentences below.',
      options: [],
      correctAnswer: '',
      // Marks deliberately set to a wrong value to prove they're recomputed.
      marks: 99,
      subParts: [
        { text: 'Foods such as meat belong to the group called ____', answer: 'protein', marks: 1, answerFormat: 'inline' },
        { text: 'Fats and oils give our bodies', answer: 'energy', marks: 1, answerFormat: 'inline' },
        { text: 'Describe a balanced diet.', answer: 'all food groups', marks: 2, answerFormat: 'lines', answerLines: 3 },
      ],
    }),
  ]

  const serialized = serializeQuizSections(sections, [])
  const saved = serialized.questions[0]
  assert.equal(saved.subParts.length, 3, 'three sub-parts serialize')
  assert.equal(saved.marks, 4, 'question marks auto-sum from parts (1+1+2), not the stale 99')
  assert.equal(serialized.totalMarks, 4, 'paper total reflects the summed parts')
  assert.equal(saved.subParts[0].answerFormat, 'inline', 'part answerFormat persists')
  assert.equal(saved.subParts[2].answerLines, 3, 'part answerLines persists')

  const { sections: reopened } = hydrateQuizSections(serialized.questions, serialized.passages, [], serialized.pagebreaks)
  const q = reopened.find(s => s.kind === 'standalone')?.question
  assert(q, 'sub-part question reopens')
  assert.equal(q.subParts.length, 3, 'sub-parts reopen')
  assert.equal(q.subParts[0].answer, 'protein', 'part answer round-trips')
  assert.equal(q.subParts[2].marks, 2, 'part marks round-trip')
  assert.equal(q.marks, 4, 'reopened question keeps the summed total')

  console.log('runSubPartsRoundTripTest passed (sub-parts persist + marks auto-sum)')
}

runSubPartsRoundTripTest()

// ── Passage imageDiagram serialize/hydrate round-trip ──
// A catalog shape diagram on a passage block (imageDiagram: {libraryKey, params})
// must survive serialize → hydrate so the PDF and DOCX renderers can draw it.
// This was the B1 layout-layer root cause: assessmentPaperLayout.js never forwarded
// imageDiagram from the raw passage, so the block always arrived as null downstream.
function runPassageImageDiagramRoundTripTest() {
  const passageSection = createPassageSection({
    title: 'Study the diagram below and answer the questions that follow.',
    passageKind: 'diagram',
    imageDiagram: { libraryKey: 'cylinder', params: { r: '3', h: '6' } },
    questions: [
      { type: 'short_answer', text: 'What shape is shown?', options: [], correctAnswer: 'cylinder' },
    ],
  })

  const serialized = serializeQuizSections([passageSection], [])
  const savedPassage = serialized.passages[0]
  assert(savedPassage, 'passage with imageDiagram serializes into passages[]')
  assert(savedPassage.imageDiagram, 'passage.imageDiagram serialized (not dropped)')
  assert.equal(savedPassage.imageDiagram.libraryKey, 'cylinder', 'imageDiagram.libraryKey persists through serialize')
  assert.deepEqual(savedPassage.imageDiagram.params, { r: '3', h: '6' }, 'imageDiagram.params persist through serialize')

  const { sections } = hydrateQuizSections(serialized.questions, serialized.passages, [], [])
  const passage = sections.find(s => s.kind === 'passage')
  assert(passage, 'passage section with imageDiagram reopens')
  assert(passage.passage.imageDiagram, 'passage.imageDiagram survives hydrate (not lost on reopen)')
  assert.equal(passage.passage.imageDiagram.libraryKey, 'cylinder', 'imageDiagram.libraryKey survives full round-trip')
  assert.deepEqual(passage.passage.imageDiagram.params, { r: '3', h: '6' }, 'imageDiagram.params survive full round-trip')

  console.log('runPassageImageDiagramRoundTripTest passed (passage imageDiagram serialize → hydrate)')
}

runPassageImageDiagramRoundTripTest()

// ── Data-integrity regression: repeated autosave must NOT duplicate questions ──
// Root cause of the "30 → 90" assessment duplication: a save that CREATED a
// question doc (because the in-memory question had no `_id` yet) never folded
// the assigned Firestore id back into state. So every subsequent autosave saw
// `_id:null` again and re-inserted all N questions — the subcollection grew by
// N per save (30 → 60 → 90). patchSectionsWithAssignedIds is the write-back
// that closes the loop. This test drives the full lifecycle against a fake
// Firestore that mirrors updateAssessmentWithQuestions' insert-vs-update rule.
function runNoDuplicateOnRepeatedSaveTest() {
  // A fake questions subcollection keyed by doc id. `saveRound` mirrors the
  // server: a question WITH `_id` updates in place; one WITHOUT gets a brand
  // new doc id. It returns the { localId, id } idMap the real hook returns.
  const store = new Map()
  let autoIdSeq = 0
  const saveRound = (questions) => {
    const idMap = []
    for (const q of questions) {
      if (q._id) {
        store.set(q._id, { ...q }) // update in place
        idMap.push({ localId: q.localId, id: q._id })
      } else {
        const id = `auto_${String(autoIdSeq++).padStart(4, '0')}`
        store.set(id, { ...q, _id: id }) // brand-new doc
        idMap.push({ localId: q.localId, id })
      }
    }
    return idMap
  }

  // Build a 30-question paper the way the AI-create / import path does: fresh
  // standalone sections, every question `_id:null` but carrying a stable localId.
  let sections = Array.from({ length: 30 }, (_, i) =>
    createStandaloneSection({ text: `<p>Question ${i + 1}</p>`, correctAnswer: i % 4 }))
  const parts = []

  assert.equal(serializeQuizSections(sections, parts).questionCount, 30, 'builder shows 30 to start')

  // First save (the create path): every question is inserted once.
  let idMap = saveRound(serializeQuizSections(sections, parts).questions)
  assert.equal(store.size, 30, 'first save inserts exactly 30 docs')
  // Write the assigned ids back into state — the fix.
  sections = patchSectionsWithAssignedIds(sections, idMap)
  assert(
    serializeQuizSections(sections, parts).questions.every(q => typeof q._id === 'string' && q._id),
    'after write-back every in-memory question carries a stable _id',
  )

  // Simulate FIVE more autosaves (edits, image-URL reconcile, refresh retries).
  // With the write-back in place these must all be in-place updates: the doc
  // count stays 30, never grows.
  for (let round = 0; round < 5; round++) {
    idMap = saveRound(serializeQuizSections(sections, parts).questions)
    sections = patchSectionsWithAssignedIds(sections, idMap)
    assert.equal(store.size, 30, `autosave round ${round + 1} keeps exactly 30 docs (no duplication)`)
  }

  // And a reload reads back exactly 30, in order.
  const reloaded = hydrateQuizSections([...store.values()], [], [], [])
  assert.equal(
    serializeQuizSections(reloaded.sections, reloaded.parts).questionCount, 30,
    'reload → Preview reports 30 questions',
  )

  console.log('runNoDuplicateOnRepeatedSaveTest passed (repeated autosave stays at 30, no duplication)')
}

runNoDuplicateOnRepeatedSaveTest()

// ── Proof the bug reproduces WITHOUT the write-back ──
// Guards against a future refactor that drops patchSectionsWithAssignedIds:
// skipping the write-back must still explode the count, so this test would
// start failing if someone silently removed the fix and expected 30.
function runWriteBackIsLoadBearingTest() {
  const store = new Map()
  let seq = 0
  const saveRound = (questions) => {
    for (const q of questions) {
      if (q._id) { store.set(q._id, { ...q }) } else {
        const id = `x_${seq++}`
        store.set(id, { ...q, _id: id })
      }
    }
  }
  const parts = []
  const sections = Array.from({ length: 30 }, (_, i) =>
    createStandaloneSection({ text: `<p>Q${i + 1}</p>` }))

  // Save three times but NEVER patch ids back — the pre-fix behaviour.
  for (let i = 0; i < 3; i++) saveRound(serializeQuizSections(sections, parts).questions)
  assert.equal(store.size, 90, 'without the write-back, three saves duplicate 30 → 90 (bug reproduced)')

  // patchSectionsWithAssignedIds must never OVERWRITE an existing _id (a stale
  // idMap can't repoint a question at the wrong doc).
  const withId = [createStandaloneSection({ text: 'Q' })]
  withId[0].question._id = 'real-id'
  const patched = patchSectionsWithAssignedIds(withId, [{ localId: withId[0].question.localId, id: 'other-id' }])
  assert.equal(patched[0].question._id, 'real-id', 'existing _id is never overwritten by a stale idMap')
  // A no-op patch returns the SAME array reference (skips a needless re-render).
  assert.equal(patchSectionsWithAssignedIds(withId, []), withId, 'empty idMap returns the same sections ref')

  console.log('runWriteBackIsLoadBearingTest passed (bug reproduces without write-back; _id never clobbered)')
}

runWriteBackIsLoadBearingTest()

function runFigureMetaRoundTripTest() {
  // figureMeta ({ sourcePage, box }) is importer-written and feeds the quiz
  // editor's "Crop from page" (which page to open + the AI-detected initial
  // crop box). It must survive a save → reload on questions AND passages —
  // both hydrate paths use explicit field lists, so a missing entry here is
  // exactly how the field would silently vanish.
  const { sections, parts } = hydrateQuizSections(
    [
      { id: 'q006', type: 'mcq', text: 'Which activity is shown?', options: ['A', 'B', 'C', 'D'], correctAnswer: 0, sourcePage: 3, sourceQuestionNumber: 6, figureMeta: { sourcePage: 3, box: { x: 0.1, y: 0.4, w: 0.5, h: 0.3 } }, order: 0 },
      { id: 'q007', type: 'mcq', text: 'Map question', options: ['A', 'B'], correctAnswer: 0, passageId: 'p001', figureMeta: { sourcePage: 2, box: null }, order: 1 },
    ],
    [{ id: 'p001', title: 'Map', passageText: '', imageUrl: '', passageKind: 'map', figureMeta: { sourcePage: 2, box: { x: 0, y: 0, w: 1, h: 0.5 } }, order: 1 }],
    [], [],
  )
  const std = sections.find(s => s.kind !== 'passage' && s.kind !== 'pagebreak')
  assert.deepEqual(std.question.figureMeta, { sourcePage: 3, box: { x: 0.1, y: 0.4, w: 0.5, h: 0.3 } }, 'standalone figureMeta hydrates')
  const passageSection = sections.find(s => s.kind === 'passage')
  assert.deepEqual(passageSection.passage.figureMeta, { sourcePage: 2, box: { x: 0, y: 0, w: 1, h: 0.5 } }, 'passage figureMeta hydrates')
  assert.deepEqual(passageSection.passage.questions[0].figureMeta, { sourcePage: 2, box: null }, 'passage-child figureMeta hydrates (boxless page-only form)')

  const serialized = serializeQuizSections(sections, parts)
  assert.deepEqual(serialized.questions.find(q => q.sourceQuestionNumber === 6).figureMeta, { sourcePage: 3, box: { x: 0.1, y: 0.4, w: 0.5, h: 0.3 } }, 'standalone figureMeta serializes')
  assert.deepEqual(serialized.passages[0].figureMeta, { sourcePage: 2, box: { x: 0, y: 0, w: 1, h: 0.5 } }, 'passage figureMeta serializes (explicit allow-list)')

  // Garbage/absent forms hydrate to null, never a half-shaped object.
  const { sections: bare } = hydrateQuizSections(
    [{ id: 'q1', type: 'mcq', text: 'Plain', options: ['A', 'B'], correctAnswer: 0, order: 0 },
     { id: 'q2', type: 'mcq', text: 'Bad', options: ['A', 'B'], correctAnswer: 0, figureMeta: { sourcePage: 'x', box: { x: 'a' } }, order: 1 }],
    [], [], [],
  )
  assert.equal(bare[0].question.figureMeta, null, 'absent figureMeta hydrates to null')
  assert.equal(bare[1].question.figureMeta, null, 'garbage figureMeta hydrates to null')

  console.log('runFigureMetaRoundTripTest passed (question + passage figureMeta serialize → hydrate)')
}

runFigureMetaRoundTripTest()

function runImagePositionRoundTripTest() {
  // The image-position choice ('below' | 'left' | 'right' | 'inline'; null =
  // above) must survive a save → reload. Hydrate uses explicit field lists,
  // so before hydrateImagePosition existed the choice was silently dropped on
  // reopen — the editor dropdown reset to "above" and the NEXT save wrote
  // null, un-setting what the admin picked ("image positioning not working").
  const { sections, parts } = hydrateQuizSections(
    [
      { id: 'q1', type: 'mcq', text: 'Which?', options: ['A', 'B'], correctAnswer: 0, imageUrl: 'https://x/i.jpg', imagePosition: 'below', order: 0 },
      { id: 'q2', type: 'mcq', text: 'Garbage', options: ['A', 'B'], correctAnswer: 0, imagePosition: 'sideways', order: 1 },
      { id: 'q3', type: 'mcq', text: 'Passage child', options: ['A', 'B'], correctAnswer: 0, passageId: 'p001', imagePosition: 'right', order: 2 },
    ],
    [{ id: 'p001', title: 'Story', passageText: 'Once…', imageUrl: '', passageKind: 'comprehension', order: 2 }],
    [], [],
  )
  const standalone = sections.filter(s => s.kind !== 'passage' && s.kind !== 'pagebreak')
  assert.equal(standalone[0].question.imagePosition, 'below', 'imagePosition survives hydrate')
  assert.equal(standalone[1].question.imagePosition, null, 'garbage imagePosition hydrates to null (renders as above)')
  const passageSection = sections.find(s => s.kind === 'passage')
  assert.equal(passageSection.passage.questions[0].imagePosition, 'right', 'passage-child imagePosition survives hydrate')

  const serialized = serializeQuizSections(sections, parts)
  assert.equal(serialized.questions.find(q => q.text.includes('Which')).imagePosition, 'below', 'imagePosition survives the full round trip')

  console.log('runImagePositionRoundTripTest passed (imagePosition serialize → hydrate)')
}

runImagePositionRoundTripTest()
