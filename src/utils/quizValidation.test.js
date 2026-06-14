import assert from 'node:assert/strict'
import { collectQuizIssues, validateStandaloneQuestion } from './quizValidation.js'

// The inline issue badge in QuizSectionsEditor groups validation issues
// by question localId. If collectQuizIssues stops attaching `localId` to
// per-question issues the badge silently disappears for every card, so
// pin that contract here.
function runLocalIdAttachmentTest() {
  const sections = [
    {
      kind: 'standalone',
      id: 's1',
      question: {
        localId: 'q-aaa',
        type: 'mcq',
        text: 'What is 2 + 2?',
        // 1 option only → triggers `opt-count-...`
        options: ['4'],
        correctAnswer: 0,
      },
    },
    {
      kind: 'standalone',
      id: 's2',
      question: {
        localId: 'q-bbb',
        type: 'mcq',
        text: 'What is 3 + 3?',
        options: ['4', '5', '6', '7'],
        // Out-of-range index → triggers `correct-...`
        correctAnswer: 9,
      },
    },
  ]

  const { issues } = collectQuizIssues({
    form: { title: 'Test', subject: 'Mathematics', grade: '7' },
    sections,
    parts: [],
    questionNumbers: { 'q-aaa': 1, 'q-bbb': 2 },
  })

  const q1Issues = issues.filter(i => i.localId === 'q-aaa')
  const q2Issues = issues.filter(i => i.localId === 'q-bbb')

  assert(q1Issues.length >= 1, 'Q1 must produce at least one per-question issue with localId attached')
  assert(q2Issues.length >= 1, 'Q2 must produce at least one per-question issue with localId attached')

  // Make sure quiz-level issues stay null on localId so they don't
  // accidentally collide with a question's badge count.
  const titleIssue = issues.find(i => i.id === 'title')
  if (titleIssue) {
    assert.equal(titleIssue.localId, null, 'quiz-level issues must have localId=null')
  }

  console.log(`runLocalIdAttachmentTest passed (${q1Issues.length} on q-aaa, ${q2Issues.length} on q-bbb)`)
}

runLocalIdAttachmentTest()

// Quiz-level issues (missing title) must NOT carry a localId — they
// belong to the form, not a card.
function runQuizLevelLocalIdNullTest() {
  const { issues } = collectQuizIssues({
    form: { title: '', subject: '', grade: null },
    sections: [],
    parts: [],
    questionNumbers: {},
  })

  for (const issue of issues) {
    assert.equal(issue.localId, null,
      `quiz-level issue "${issue.id}" must have localId=null, saw ${JSON.stringify(issue.localId)}`)
  }

  console.log(`runQuizLevelLocalIdNullTest passed (${issues.length} quiz-level issues, all localId=null)`)
}

runQuizLevelLocalIdNullTest()

// ── Full support for essay / numeric / matching / sequence ──────────
// Regression: these block types are offered in the Assessment Studio but used
// to be rejected as "unrecognised type" by the shared validation, so a teacher
// could build a paper that failed at save time. They must now validate per
// type — complete questions pass, incomplete ones surface a targeted issue.

function issuesFor(question) {
  const { issues } = collectQuizIssues({
    form: { title: 'T', subject: 'Mathematics', grade: '7' },
    sections: [{ kind: 'standalone', id: 's', question: { localId: 'q', ...question } }],
    parts: [],
    questionNumbers: { q: 1 },
  })
  // Only the per-question issues (quiz-level ones are unrelated here).
  return issues.filter(i => i.localId === 'q')
}

function runFullTypeSupportTest() {
  // Essay — text is enough; no "unrecognised type", no answer required.
  assert.equal(issuesFor({ type: 'essay', text: 'Discuss climate change.' }).length, 0,
    'a complete essay question must produce no issues')

  // Numeric — needs a finite answer for the marking key.
  assert.equal(issuesFor({ type: 'numeric', text: 'What is 6 × 7?', correctAnswer: '42' }).length, 0,
    'a numeric question with an answer must produce no issues')
  const numericBlank = issuesFor({ type: 'numeric', text: 'What is 6 × 7?', correctAnswer: '' })
  assert(numericBlank.some(i => i.id.startsWith('numeric-')),
    'a numeric question with a blank answer must be flagged')
  const numericNaN = issuesFor({ type: 'numeric', text: 'q', correctAnswer: 'abc' })
  assert(numericNaN.some(i => i.id.startsWith('numeric-')),
    'a numeric question with a non-number answer must be flagged')

  // Matching — needs ≥2 pairs and a valid mapping for every prompt.
  assert.equal(issuesFor({
    type: 'matching', text: 'Match the capitals.',
    matchingLeft: ['Zambia', 'Kenya'], matchingRight: ['Lusaka', 'Nairobi'], matchingAnswer: [0, 1],
  }).length, 0, 'a complete matching question must produce no issues')
  const matchingUnset = issuesFor({
    type: 'matching', text: 'Match the capitals.',
    matchingLeft: ['Zambia', 'Kenya'], matchingRight: ['Lusaka', 'Nairobi'], matchingAnswer: [-1, -1],
  })
  assert(matchingUnset.some(i => i.id.startsWith('matching-')),
    'a matching question with no mapping must be flagged')

  // Sequence — needs ≥2 items and a complete 1..n ordering.
  assert.equal(issuesFor({
    type: 'sequence', text: 'Order the life cycle.',
    sequenceItems: ['Egg', 'Larva', 'Adult'], sequenceAnswer: [1, 2, 3],
  }).length, 0, 'a complete sequence question must produce no issues')
  const sequenceUnset = issuesFor({
    type: 'sequence', text: 'Order the life cycle.',
    sequenceItems: ['Egg', 'Larva', 'Adult'], sequenceAnswer: [0, 0, 0],
  })
  assert(sequenceUnset.some(i => i.id.startsWith('sequence-')),
    'a sequence question with no order set must be flagged')
  const sequenceDupe = issuesFor({
    type: 'sequence', text: 'Order it.',
    sequenceItems: ['A', 'B', 'C'], sequenceAnswer: [1, 1, 2],
  })
  assert(sequenceDupe.some(i => i.id.startsWith('sequence-')),
    'a sequence question with duplicate positions must be flagged')

  // A genuinely unknown type is still a blocker.
  const unknown = issuesFor({ type: 'wormhole', text: 'q' })
  assert(unknown.some(i => i.id.startsWith('type-')),
    'an unrecognised type must still be flagged')

  // The single-question validator agrees with the collector.
  assert.equal(validateStandaloneQuestion({ type: 'essay', text: 'x' }, 'Q1', {}), true,
    'validateStandaloneQuestion accepts a complete essay')
  assert.equal(validateStandaloneQuestion({ type: 'numeric', text: 'x', correctAnswer: '' }, 'Q1', {}), false,
    'validateStandaloneQuestion rejects a numeric without an answer')
  assert.equal(validateStandaloneQuestion({
    type: 'matching', text: 'x',
    matchingLeft: ['a', 'b'], matchingRight: ['1', '2'], matchingAnswer: [0, 1],
  }, 'Q1', {}), true, 'validateStandaloneQuestion accepts a complete matching question')

  console.log('runFullTypeSupportTest passed (essay/numeric/matching/sequence + unknown)')
}

runFullTypeSupportTest()
