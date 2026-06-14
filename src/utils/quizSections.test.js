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
  const { sections } = hydrateQuizSections(serialized.questions, serialized.passages, [], [])
  const reopened = sections.find(s => s.kind === 'passage')
  assert(reopened, 'passage section round-trips')
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
