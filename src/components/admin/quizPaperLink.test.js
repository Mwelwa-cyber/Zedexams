/**
 * quizPaperLink.test.js
 *
 * The Unassign action in /admin/content writes `isPublished: false`. On a quiz
 * a past paper links to, that is a silent outage for every learner — the
 * failure that took twelve published papers dark. These assertions pin the
 * detection that puts a warning in front of it, and the two claims the warning
 * itself must not get wrong.
 *
 * Plain-node (see CLAUDE.md): run with `node`, throw on failure.
 */

import assert from 'node:assert/strict'

import {
  claimedPaperId,
  describeQuizPaperLink,
  unassignWarning,
} from './quizPaperLink.js'

let passed = 0
function t(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

console.log('describeQuizPaperLink')

t('an ordinary practice quiz is not linked', () => {
  const link = describeQuizPaperLink({ id: 'q1', quizType: 'practice' }, [])
  assert.equal(link.linked, false)
  assert.equal(link.confirmedBy, null)
})

t("a paper pointing AT the quiz is the authoritative signal", () => {
  // The paper's `quizId` is the field every learner surface routes on.
  const link = describeQuizPaperLink(
    { id: 'q1' },
    [{ id: 'p1', quizId: 'q1', title: 'Grade 7 Social Studies 2019' }],
  )
  assert.equal(link.linked, true)
  assert.equal(link.confirmedBy, 'paper')
  assert.equal(link.paperId, 'p1')
  assert.equal(link.paperTitle, 'Grade 7 Social Studies 2019')
})

t('the quiz\'s own claim counts even when no loaded paper confirms it', () => {
  // The papers list may be filtered, paged, or on another tab. Absence from it
  // is never proof the quiz is unlinked — that reading is what lets the
  // outage through.
  const link = describeQuizPaperLink({ id: 'q1', linkedPaperId: 'p9' }, [])
  assert.equal(link.linked, true)
  assert.equal(link.confirmedBy, 'quiz')
  assert.equal(link.paperId, 'p9')
  assert.equal(link.paperTitle, null)
})

t('the legacy sourcePastPaperId field is honoured too', () => {
  assert.equal(claimedPaperId({ sourcePastPaperId: 'p3' }), 'p3')
  assert.equal(describeQuizPaperLink({ id: 'q1', sourcePastPaperId: 'p3' }, []).linked, true)
})

t('a claimed paper that IS loaded gets named', () => {
  const link = describeQuizPaperLink(
    { id: 'q1', linkedPaperId: 'p9' },
    [{ id: 'p9', title: 'Grade 7 Mathematics 2023' }],
  )
  assert.equal(link.paperTitle, 'Grade 7 Mathematics 2023')
})

t('the authoritative direction wins when the two disagree', () => {
  // A stale `linkedPaperId` must not misname the paper that actually breaks.
  const link = describeQuizPaperLink(
    { id: 'q1', linkedPaperId: 'p-old' },
    [{ id: 'p-now', quizId: 'q1', title: 'The paper that breaks' }],
  )
  assert.equal(link.confirmedBy, 'paper')
  assert.equal(link.paperId, 'p-now')
})

t('blank and non-string ids are not links', () => {
  assert.equal(describeQuizPaperLink({ id: 'q1', linkedPaperId: '   ' }, []).linked, false)
  assert.equal(describeQuizPaperLink({ id: 'q1', linkedPaperId: null }, []).linked, false)
  assert.equal(describeQuizPaperLink({ id: 'q1', linkedPaperId: 0 }, []).linked, false)
  assert.equal(claimedPaperId(null), null)
})

t('a missing or malformed papers list never throws', () => {
  // It is called during a render that may run before the papers have loaded.
  assert.equal(describeQuizPaperLink({ id: 'q1' }).linked, false)
  assert.equal(describeQuizPaperLink({ id: 'q1' }, null).linked, false)
  assert.equal(describeQuizPaperLink(null, [{ id: 'p1', quizId: 'q1' }]).linked, false)
  assert.equal(describeQuizPaperLink({ id: 'q1' }, [null, undefined, {}]).linked, false)
})

t('a quiz with no id is not matched by a paper pointing at nothing', () => {
  // Both sides absent must not read as "these match".
  assert.equal(describeQuizPaperLink({}, [{ id: 'p1', quizId: undefined }]).linked, false)
})

console.log('unassignWarning')

t('the warning says the PAPER stays visible', () => {
  // The reason this outage went unnoticed is that nothing looks removed. A
  // warning that omits this teaches the admin the wrong model.
  const { message } = unassignWarning({ confirmedBy: 'paper', paperTitle: 'Paper X' })
  assert.match(message, /stays visible/i)
})

t('the warning does not scope the breakage to signed-out or free learners', () => {
  // BOTH read clauses require isPublished, and neither consults the
  // subscription — a Max subscriber is refused exactly like an anonymous
  // visitor. Copy implying otherwise sends the next investigation the wrong way.
  for (const link of [{ confirmedBy: 'paper', paperTitle: 'P' }, { confirmedBy: 'quiz' }]) {
    const { message } = unassignWarning(link)
    assert.ok(
      !/only (signed[- ]out|logged[- ]out|free|anonymous)/i.test(message),
      `copy scopes the outage too narrowly: ${message}`,
    )
    assert.match(message, /signed in or out, free or paid/i)
  }
})

t('the warning names the paper when it is known', () => {
  assert.match(unassignWarning({ confirmedBy: 'paper', paperTitle: 'Grade 7 English 2023' }).message, /Grade 7 English 2023/)
})

t('an unnamed paper still produces readable copy', () => {
  const { message, title, confirmLabel } = unassignWarning({ confirmedBy: 'quiz' })
  assert.match(message, /a published past paper/i)
  assert.ok(!message.includes('undefined') && !message.includes('null'))
  assert.ok(title.length > 0 && confirmLabel.length > 0)
})

t('the warning survives a null link (dialog renders before it is set)', () => {
  const { title, message, confirmLabel } = unassignWarning(null)
  assert.ok(title.length > 0 && message.length > 0 && confirmLabel.length > 0)
  assert.ok(!message.includes('undefined'))
})

t('it says how to undo the change', () => {
  assert.match(unassignWarning({ confirmedBy: 'paper' }).message, /publish the quiz again/i)
})

console.log(`\n${passed} assertions passed.`)
