/**
 * The Question Bank's filters in the URL, and the redirect that keeps them.
 *
 * `node scripts/test-question-bank-deep-link.mjs` or
 * `npm run test:question-bank-deep-link`.
 *
 * The standalone `/teacher/question-bank` page is gone. Every claim below is
 * about a link that already exists somewhere — a bookmark, a dashboard link, a
 * message sent to a teacher — continuing to open what it opened before.
 */

import assert from 'node:assert/strict'
import {
  bankFiltersFromParams, bankFiltersToParams, questionBankRedirectPath,
} from '../src/components/teacher/questionBankDeepLink.js'

let passed = 0
function check(label, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${label}`)
}

console.log('\nquestion-bank-deep-link')

check('every filter round-trips through the URL', () => {
  const filters = {
    term: 'photosynthesis', scope: 'mine', grade: '7', subject: 'Integrated Science',
    topic: 'Plants', subtopic: 'Leaves', type: 'mcq', difficulty: 'easy', marks: '2',
    source: 'ai', withDiagram: 'yes', sort: 'mostUsed', favouritesOnly: true,
  }
  const params = bankFiltersToParams(filters)
  assert.deepEqual(bankFiltersFromParams(params), filters)
})

check('the reader and the writer know the same keys', () => {
  // A key one side knows and the other does not is a filter that can be
  // reached but never linked to — or linked to but never restored.
  const everyFilter = {
    term: 'a', scope: 'master', grade: '4', subject: 'Maths', topic: 't', subtopic: 's',
    type: 'essay', difficulty: 'hard', marks: '5', source: 'manual', withDiagram: 'no',
    sort: 'mostUsed', favouritesOnly: true,
  }
  const written = [...bankFiltersToParams(everyFilter).keys()].sort()
  const read = Object.keys(bankFiltersFromParams(bankFiltersToParams(everyFilter))).sort()
  assert.equal(written.length, read.length)
  assert.equal(written.length, Object.keys(everyFilter).length)
})

check('an absent key is left to the default, not written as a blank', () => {
  const params = new URLSearchParams('grade=4')
  const filters = bankFiltersFromParams(params)
  assert.deepEqual(filters, { grade: '4' })
  // Nothing is invented for the keys the link did not carry.
  assert.equal('term' in filters, false)
  assert.equal('scope' in filters, false)
})

check('defaults are dropped from the link rather than pinned into it', () => {
  const params = bankFiltersToParams({ scope: 'all', sort: 'newest', grade: '4', term: '' })
  assert.equal(params.get('grade'), '4')
  assert.equal(params.has('scope'), false)
  assert.equal(params.has('sort'), false)
  assert.equal(params.has('q'), false)
})

check('a filter turned off is REMOVED from an existing query, not left stale', () => {
  const base = new URLSearchParams('grade=4&type=mcq&starred=1&view=bank')
  const params = bankFiltersToParams({ grade: '4', type: '', favouritesOnly: false }, base)
  assert.equal(params.get('grade'), '4')
  assert.equal(params.has('type'), false)
  assert.equal(params.has('starred'), false)
  // Params this module does not own are left exactly as they were.
  assert.equal(params.get('view'), 'bank')
})

check('the starred flag is a boolean in both directions', () => {
  assert.equal(bankFiltersFromParams(new URLSearchParams('starred=1')).favouritesOnly, true)
  assert.equal(bankFiltersFromParams(new URLSearchParams('starred=true')).favouritesOnly, true)
  assert.equal(bankFiltersFromParams(new URLSearchParams('starred=0')).favouritesOnly, false)
  assert.equal(bankFiltersToParams({ favouritesOnly: true }).get('starred'), '1')
})

check('garbage in the URL is ignored rather than becoming a filter', () => {
  const filters = bankFiltersFromParams(new URLSearchParams('nonsense=1&grade=%20%20&q=x'))
  assert.deepEqual(filters, { term: 'x' })
  assert.deepEqual(bankFiltersFromParams(null), {})
  assert.deepEqual(bankFiltersFromParams({}), {})
})

check('the retired route redirects into the studio bank view', () => {
  const path = questionBankRedirectPath('')
  assert.equal(path, '/teacher/assessment-papers/new?view=bank')
})

check('the redirect carries the whole incoming query, filters included', () => {
  const path = questionBankRedirectPath('?grade=4&subject=Mathematics&type=mcq')
  const [, query] = path.split('?')
  const params = new URLSearchParams(query)
  assert.equal(params.get('view'), 'bank')
  assert.deepEqual(bankFiltersFromParams(params), { grade: '4', subject: 'Mathematics', type: 'mcq' })
})

check('a param this module never heard of still survives the redirect', () => {
  // Dropping it is a silent loss the teacher cannot see; an analytics tag or a
  // filter added later has to make the trip.
  const params = new URLSearchParams(questionBankRedirectPath('?utm_source=email&future=1').split('?')[1])
  assert.equal(params.get('utm_source'), 'email')
  assert.equal(params.get('future'), '1')
})

check('an incoming view= is overridden — the bank view is the destination', () => {
  const params = new URLSearchParams(questionBankRedirectPath('?view=preview').split('?')[1])
  assert.equal(params.get('view'), 'bank')
})

console.log(`\n✅ question-bank-deep-link: ${passed} assertions passed\n`)
