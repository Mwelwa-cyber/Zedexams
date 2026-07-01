import assert from 'node:assert/strict'
import {
  createPassageSection,
  createStandaloneSection,
  serializeQuizSections,
  hydrateQuizSections,
} from './quizSections.js'

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
