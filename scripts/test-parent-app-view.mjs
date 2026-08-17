// scripts/test-parent-app-view.mjs
//
// Pure-logic tests for the parent app's presentation decisions
// (src/features/parentPortal/lib/parentAppView.js). Run with
// `npm run test:parent-app-view`.
//
// Two of these are about not printing machinery at a parent: a gate id
// this build does not know must not reach a sentence as
// "PAPER_CONTINUE", and an unknown timestamp must not render as "NaN
// days ago". The third is the ordering rule the dashboard depends on.

import assert from 'node:assert/strict'
import {
  agoInDays,
  describeFeature,
  describeRequest,
  firstNameOf,
  greetingFor,
  initialOf,
  sortChildren,
  statusPill,
} from '../src/features/parentPortal/lib/parentAppView.js'

let passed = 0
const t = (name, fn) => { fn(); passed += 1; void name }

t('names reduce to a first name and an initial', () => {
  assert.equal(firstNameOf('Milton Phiri'), 'Milton')
  assert.equal(firstNameOf('  Grace   Phiri '), 'Grace')
  assert.equal(firstNameOf(''), '')
  assert.equal(firstNameOf(null), '')
  assert.equal(initialOf('milton'), 'M')
  assert.equal(initialOf(''), 'Z')
  assert.equal(initialOf(undefined), 'Z')
})

t('the greeting follows the clock and degrades safely', () => {
  assert.equal(greetingFor(7), 'Good morning')
  assert.equal(greetingFor(13), 'Good afternoon')
  assert.equal(greetingFor(20), 'Good evening')
  assert.equal(greetingFor(NaN), 'Hello')
  assert.equal(greetingFor(undefined), 'Hello')
})

t('every status has a pill, and an unknown one is not an error state', () => {
  for (const s of ['on_track', 'needs_nudge', 'quiet', 'not_started']) {
    const pill = statusPill(s)
    assert.ok(pill.label.length > 0)
    assert.ok(['ok', 'warn', 'idle'].includes(pill.tone), `${s} -> ${pill.tone}`)
  }
  assert.equal(statusPill('who-knows').tone, 'idle')
})

t('a gate id this build does not know never reaches the sentence', () => {
  // The server's allow-list can grow ahead of the client. A parent must
  // not be shown "Wants NEW_GATE_ID".
  assert.equal(describeFeature('PAPER_CONTINUE'), 'to finish a past paper')
  assert.equal(describeFeature('SOMETHING_NEW'), 'more of ZedExams')
  assert.equal(describeFeature(undefined), 'more of ZedExams')
  assert.doesNotMatch(describeFeature('SOMETHING_NEW'), /SOMETHING_NEW/)
})

t('a request reads as a sentence, with the price when there is one', () => {
  assert.equal(
    describeRequest({ feature: 'AUTO_MARKING', priceZMW: 120 }),
    'Wants full marking and review · from K120',
  )
  // No price known -> no price clause, rather than "from K0" or "from KNaN".
  assert.equal(describeRequest({ feature: 'AUTO_MARKING' }), 'Wants full marking and review')
  assert.equal(describeRequest({ feature: 'AUTO_MARKING', priceZMW: 0 }), 'Wants full marking and review')
  assert.doesNotMatch(describeRequest({}), /undefined|NaN|K0/)
})

t('an unknown time renders as nothing, never as NaN', () => {
  const now = Date.UTC(2026, 9, 15, 12, 0)
  assert.equal(agoInDays(now - 3600_000, now), 'today')
  assert.equal(agoInDays(now - 86_400_000, now), 'yesterday')
  assert.equal(agoInDays(now - 3 * 86_400_000, now), '3 days ago')
  assert.equal(agoInDays(null, now), '')
  assert.equal(agoInDays(undefined, now), '')
  assert.equal(agoInDays('soon', now), '')
  assert.equal(agoInDays(0, now), '')
})

t('children are ordered by who needs attention, then alphabetically', () => {
  const kids = [
    { childUid: 'a', displayName: 'Aaron', status: 'on_track' },
    { childUid: 'b', displayName: 'Bwalya', status: 'needs_nudge' },
    { childUid: 'c', displayName: 'Chanda', status: 'quiet' },
    { childUid: 'd', displayName: 'Daliso', status: 'not_started' },
  ]
  assert.deepEqual(sortChildren(kids).map((k) => k.childUid), ['c', 'b', 'd', 'a'])
})

t('children with the same status stay alphabetical', () => {
  const kids = [
    { childUid: 'z', displayName: 'Zoe', status: 'on_track' },
    { childUid: 'a', displayName: 'Aaron', status: 'on_track' },
  ]
  assert.deepEqual(sortChildren(kids).map((k) => k.displayName), ['Aaron', 'Zoe'])
})

t('sorting does not mutate the caller’s array, and survives rubbish', () => {
  const kids = [{ childUid: 'b', status: 'quiet' }, { childUid: 'a', status: 'on_track' }]
  const copy = [...kids]
  sortChildren(kids)
  assert.deepEqual(kids, copy)
  assert.deepEqual(sortChildren(null), [])
  assert.equal(sortChildren([null, undefined]).length, 2)
})

console.log(`parent app view helpers — ${passed} total assertions passed`)
