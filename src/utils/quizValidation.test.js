import assert from 'node:assert/strict'
import { collectQuizIssues } from './quizValidation.js'

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
