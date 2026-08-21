// scripts/test-parent-app.mjs
//
// Pure-logic tests for the parent app (functions/parentApp/parentAppCore.js).
// Run with `npm run test:parent-app`.
//
// The cases worth pinning are the ones where being wrong is invisible: an
// activity filed under the wrong DAY (the parent sees "Today" and it was
// last night), a status pill that calls a child on track a fortnight after
// they stopped, an approval button for a request that has already expired,
// and a weekly report that claims a figure nobody measured.

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const core = require('../functions/parentApp/parentAppCore.js')

const {
  ONE_DAY_MS,
  buildWeeklyReport,
  childPlanState,
  childStatus,
  dayKey,
  dayLabel,
  describeStatus,
  groupActivityByDay,
  shapeApprovalFeed,
} = core

let passed = 0
const t = (name, fn) => { fn(); passed += 1; void name }

/** An email body as trimmed lines, so a link can be compared for equality. */
const lines = (text) => String(text).split('\n').map((l) => l.trim())

/* ── Days, in Lusaka rather than in UTC ────────────────────────────── */

t('a day is a Lusaka day, not a UTC one', () => {
  // 22:30 UTC on the 14th is 00:30 on the 15th in Lusaka. A Cloud Function
  // runs in UTC, so without the shift this evening's work would be filed
  // under the wrong date — and "Today" would list yesterday's revision.
  assert.equal(dayKey(Date.UTC(2026, 9, 14, 22, 30)), '2026-10-15')
  assert.equal(dayKey(Date.UTC(2026, 9, 14, 21, 30)), '2026-10-14')
  // And the other end: 01:00 UTC is still the same Lusaka day.
  assert.equal(dayKey(Date.UTC(2026, 9, 14, 1, 0)), '2026-10-14')
})

t('day headings read Today / Yesterday / a dated weekday', () => {
  const now = Date.UTC(2026, 9, 15, 9, 0)
  assert.equal(dayLabel('2026-10-15', now), 'Today')
  assert.equal(dayLabel('2026-10-14', now), 'Yesterday')
  assert.equal(dayLabel('2026-10-12', now), 'Mon 12 Oct')
})

t('the heading and its contents can never disagree about the day', () => {
  // Both come from the same key, so this is structural rather than lucky.
  const now = Date.UTC(2026, 9, 15, 9, 0)
  const days = groupActivityByDay(
    [{ type: 'quiz', title: 'Daily quiz', at: Date.UTC(2026, 9, 14, 22, 30) }],
    { now },
  )
  assert.equal(days.length, 1)
  assert.equal(days[0].key, '2026-10-15')
  assert.equal(days[0].label, 'Today')
  assert.equal(days[0].items[0].time, '00:30')
})

/* ── The timeline ──────────────────────────────────────────────────── */

const at = (daysAgo, now) => now - daysAgo * ONE_DAY_MS

t('activity groups newest day first, newest item first within a day', () => {
  const now = Date.UTC(2026, 9, 15, 12, 0)
  const days = groupActivityByDay([
    { type: 'quiz', title: 'older today', at: now - 5 * 3600_000 },
    { type: 'game', title: 'newer today', at: now - 1 * 3600_000 },
    { type: 'note', title: 'yesterday', at: at(1, now) },
  ], { now })

  assert.deepEqual(days.map((d) => d.label), ['Today', 'Yesterday'])
  assert.deepEqual(days[0].items.map((i) => i.title), ['newer today', 'older today'])
})

t('an item with no readable time is dropped, never filed under today', () => {
  const now = Date.UTC(2026, 9, 15, 12, 0)
  const days = groupActivityByDay([
    { type: 'quiz', title: 'timeless', at: null },
    { type: 'quiz', title: 'garbled', at: 'sometime' },
    { type: 'quiz', title: 'real', at: now - 3600_000 },
  ], { now })
  assert.equal(days.length, 1)
  assert.deepEqual(days[0].items.map((i) => i.title), ['real'])
})

t('the window is honoured at both ends', () => {
  const now = Date.UTC(2026, 9, 15, 12, 0)
  const days = groupActivityByDay([
    { type: 'quiz', title: 'inside', at: at(6, now) },
    { type: 'quiz', title: 'too old', at: at(9, now) },
    { type: 'quiz', title: 'absurd future', at: now + 5 * ONE_DAY_MS },
  ], { now, days: 7 })
  const titles = days.flatMap((d) => d.items.map((i) => i.title))
  assert.deepEqual(titles, ['inside'])
})

t('Firestore Timestamps are accepted alongside numbers', () => {
  const now = Date.UTC(2026, 9, 15, 12, 0)
  const ts = { toMillis: () => now - 3600_000 }
  const days = groupActivityByDay([{ type: 'quiz', title: 'ts', at: ts }], { now })
  assert.equal(days[0].items[0].title, 'ts')
})

t('the row cap applies to the newest rows, not an arbitrary slice', () => {
  const now = Date.UTC(2026, 9, 15, 12, 0)
  const items = Array.from({ length: 10 }, (_, i) => ({
    type: 'quiz', title: `q${i}`, at: now - i * 60_000,
  }))
  const days = groupActivityByDay(items, { now, limit: 3 })
  assert.deepEqual(days.flatMap((d) => d.items.map((i) => i.title)), ['q0', 'q1', 'q2'])
})

t('rubbish in the list does not take the family down with it', () => {
  const now = Date.now()
  assert.deepEqual(groupActivityByDay(null, { now }), [])
  assert.deepEqual(groupActivityByDay([null, 'x', 42], { now }), [])
})

/* ── Status ────────────────────────────────────────────────────────── */

t('status reports when a child stopped, not how well they did', () => {
  const now = Date.UTC(2026, 9, 15, 12, 0)
  assert.equal(childStatus({ lastActiveAt: at(0, now), now }), 'on_track')
  assert.equal(childStatus({ lastActiveAt: at(2, now), now }), 'on_track')
  assert.equal(childStatus({ lastActiveAt: at(4, now), now }), 'needs_nudge')
  assert.equal(childStatus({ lastActiveAt: at(20, now), now }), 'quiet')
  assert.equal(childStatus({ lastActiveAt: null, now }), 'not_started')
})

t('every status has words a parent would use', () => {
  for (const s of ['on_track', 'needs_nudge', 'quiet', 'not_started']) {
    assert.equal(typeof describeStatus(s), 'string')
    assert.ok(describeStatus(s).length > 0)
  }
  assert.equal(describeStatus('???'), 'Not started yet')
})

/* ── The approval feed ─────────────────────────────────────────────── */

const children = new Map([['kid1', { displayName: 'Milton Phiri' }]])

t('a pending request for my child reaches the feed', () => {
  const now = Date.UTC(2026, 9, 15, 12, 0)
  const feed = shapeApprovalFeed([{
    id: 'r1', uid: 'kid1', feature: 'PAPER_CONTINUE', status: 'sent',
    createdAt: now - 3600_000, expiresAt: now + ONE_DAY_MS,
    planId: 'term_pass', priceZMW: 120,
  }], children, now)

  assert.equal(feed.length, 1)
  assert.equal(feed[0].childName, 'Milton Phiri')
  assert.equal(feed[0].planId, 'term_pass')
  assert.equal(feed[0].priceZMW, 120)
})

t('an expired request never renders an approve button', () => {
  // Approving one would take the parent to a pay link that has already
  // died — a failure after they had decided to say yes.
  const now = Date.UTC(2026, 9, 15, 12, 0)
  const feed = shapeApprovalFeed([{
    id: 'r1', uid: 'kid1', status: 'sent', createdAt: now - 8 * ONE_DAY_MS, expiresAt: now - 60_000,
  }], children, now)
  assert.deepEqual(feed, [])
})

t('an already-paid request leaves the feed', () => {
  const now = Date.now()
  const feed = shapeApprovalFeed([{ id: 'r1', uid: 'kid1', status: 'paid', createdAt: now }], children, now)
  assert.deepEqual(feed, [])
})

t('a request for a child I am NOT linked to is invisible', () => {
  // The callable authorises separately; this is the second layer, and it
  // is the one that stops another family's child appearing in my feed.
  const now = Date.now()
  const feed = shapeApprovalFeed([{ id: 'r1', uid: 'someone-elses-kid', status: 'sent', createdAt: now }], children, now)
  assert.deepEqual(feed, [])
})

t('the feed is newest first', () => {
  const now = Date.UTC(2026, 9, 15, 12, 0)
  const feed = shapeApprovalFeed([
    { id: 'old', uid: 'kid1', status: 'sent', createdAt: now - 2 * ONE_DAY_MS },
    { id: 'new', uid: 'kid1', status: 'sent', createdAt: now - 3600_000 },
  ], children, now)
  assert.deepEqual(feed.map((f) => f.id), ['new', 'old'])
})

/* ── The weekly report ─────────────────────────────────────────────── */

t('a busy week reads as a busy week', () => {
  const r = buildWeeklyReport({
    childName: 'Milton',
    quizzes: 5,
    notes: 3,
    streak: 12,
    strongest: [{ label: 'Integrated Science', percent: 62 }],
    weakTopics: [{ topic: 'Spelling', subjectLabel: 'English' }],
    daysToExam: 12,
  })
  assert.equal(r.quiet, false)
  assert.match(r.headline, /strong week/i)
  assert.match(r.wentWell, /Milton finished 5 quizzes and 3 topics\./)
  assert.match(r.wentWell, /12 days streak/)
  assert.match(r.wentWell, /Integrated Science is their strongest subject at 62%/)
  assert.match(r.focusOn, /Spelling \(English\)/)
  assert.match(r.suggestion, /12 days away/)
})

t('a quiet week is flagged so the Sunday email can be suppressed', () => {
  const r = buildWeeklyReport({ childName: 'Chanda', quizzes: 0, notes: 0 })
  assert.equal(r.quiet, true)
  assert.match(r.wentWell, /did not practise this week/)
  // No cheerful headline over an empty week.
  assert.doesNotMatch(r.headline, /strong/i)
})

t('an unmeasured figure is omitted, never invented', () => {
  const r = buildWeeklyReport({ childName: 'Milton', quizzes: 2, notes: 0 })
  // No weak topics known and no average -> says so, rather than naming a
  // topic the app never measured.
  assert.match(r.focusOn, /Not enough questions answered yet/)
  assert.doesNotMatch(r.focusOn, /undefined|NaN|null/)
  assert.doesNotMatch(r.wentWell, /undefined|NaN|null|0 topics/)
  // Nothing anywhere claims a time-on-task figure, which ZedExams does
  // not measure. See the note at the top of parentAppCore.
  const all = `${r.headline} ${r.wentWell} ${r.focusOn} ${r.suggestion}`
  assert.doesNotMatch(all, /\d+h ?\d*m|hours? (?:of )?(?:study|learning)/i)
})

t('singulars read properly — nobody wants "1 quizzes"', () => {
  const r = buildWeeklyReport({ childName: 'Milton', quizzes: 1, notes: 1, streak: 1 })
  assert.match(r.wentWell, /1 quiz and 1 topic\./)
  assert.match(r.wentWell, /1 day streak/)
  assert.doesNotMatch(r.wentWell, /1 quizzes|1 topics|1 days/)
})

t('a missing child name degrades rather than printing undefined', () => {
  const r = buildWeeklyReport({ quizzes: 3 })
  assert.match(r.wentWell, /Your child finished/)
  const all = `${r.headline} ${r.wentWell} ${r.focusOn} ${r.suggestion}`
  assert.doesNotMatch(all, /undefined/)
})

t('an average score is quoted only when there is one', () => {
  const withAvg = buildWeeklyReport({ childName: 'M', quizzes: 4, averageScore: 71.4 })
  assert.match(withAvg.focusOn, /averaging 71%/)
  const without = buildWeeklyReport({ childName: 'M', quizzes: 4, averageScore: null })
  assert.doesNotMatch(without.focusOn, /averaging/)
})

/* ── The Sunday email ──────────────────────────────────────────────── */

const { buildReportEmail } = core

t('the email says the same thing the Reports screen says', () => {
  // One builder, two renderers. A parent who reads the email and then
  // opens the app must not find a different account of the same week.
  const report = buildWeeklyReport({
    childName: 'Milton', quizzes: 5, notes: 2, streak: 12,
    weakTopics: [{ topic: 'Spelling', subjectLabel: 'English' }],
  })
  const mail = buildReportEmail({ childName: 'Milton Phiri', report, quizzes: 5, notes: 2 })

  assert.match(mail.subject, /Milton Phiri's week on ZedExams/)
  assert.ok(mail.text.includes(report.wentWell))
  assert.ok(mail.text.includes(report.focusOn))
  assert.ok(mail.text.includes(report.suggestion))
  assert.ok(mail.text.includes(report.headline))
})

t('the email says where its claims come from, and offers a way out', () => {
  const report = buildWeeklyReport({ childName: 'Milton', quizzes: 3 })
  const mail = buildReportEmail({ childName: 'Milton', report, quizzes: 3 })
  assert.match(mail.text, /built from Milton's own quizzes/)
  assert.match(mail.text, /We do not measure time spent in the app/)
  assert.match(mail.text, /To stop these emails/)
  // EQUALITY on a whole line, not a substring search of the body.
  //
  // Two earlier shapes both tripped CodeQL's incomplete-URL-substring rule,
  // and both deserved to: `/https:\/\/zedexams\.com\/family/` matches
  // `https://evil.example/?x=https://zedexams.com/family`, and so does
  // `.includes('https://zedexams.com/family')` — substring containment IS
  // the vulnerability that query is named after, so swapping the regex for
  // `includes` swapped one spelling of the finding for another.
  //
  // The builder puts the link on a line of its own, so comparing whole
  // lines for equality is both what the rule asks for and a stricter
  // assertion than either: a URL merely embedded in some longer line would
  // now fail, which is exactly the case the rule is warning about.
  assert.ok(
    lines(mail.text).some((line) => line === 'https://zedexams.com/family'),
    'the email must link to the family dashboard on a line of its own',
  )
})

t('the email never claims a figure we do not hold', () => {
  const report = buildWeeklyReport({ childName: 'Milton', quizzes: 4 })
  const mail = buildReportEmail({ childName: 'Milton', report, quizzes: 4, notes: 0 })
  assert.doesNotMatch(mail.text, /undefined|NaN|null/)
  // "0 topics read" would be a claim about nothing; the clause is omitted.
  assert.doesNotMatch(mail.text, /0 topics/)
  assert.match(mail.text, /4 quizzes/)
})

t('a missing child name degrades to words', () => {
  const report = buildWeeklyReport({ quizzes: 1 })
  const mail = buildReportEmail({ report, quizzes: 1 })
  assert.match(mail.subject, /your child's week/)
  assert.doesNotMatch(mail.text, /undefined/)
})

/* ── Is the child paid for? ────────────────────────────────────────── */
//
// The bug these pin: a guardian bought a day pass, the money left their
// account, and no screen in the family app said anything had happened.
// The display half of that is fixed in the family app; this half is the
// server's answer to "is this child covered", which every one of those
// screens now renders and which nothing tested.
//
// `expiresAt` matters as much as the boolean, because it is what the
// dashboard turns into "Ends tomorrow" — and a wrong date on a day pass
// is a parent told their purchase has already lapsed.

t('a live expiry is premium, and reports when it ends', () => {
  const now = Date.UTC(2026, 7, 21, 9, 0)
  const state = childPlanState({
    subscriptionExpiry: now + 20 * ONE_DAY_MS,
    subscriptionPlan: 'monthly',
  }, now)
  assert.equal(state.premium, true)
  assert.equal(state.expiresAt, now + 20 * ONE_DAY_MS)
})

t('a day pass bought an hour ago reads as paid', () => {
  // The reported case. `durationDays: 1` leaves hours on the clock, and a
  // window this short is exactly where an off-by-a-comparison shows up as
  // "I paid and nothing happened".
  const now = Date.UTC(2026, 7, 21, 9, 0)
  const state = childPlanState({
    subscriptionExpiry: now + 23 * 3600_000,
    subscriptionPlan: 'day_pass',
  }, now)
  assert.equal(state.premium, true)
})

t('an expired plan is not premium, whatever the flags say', () => {
  const now = Date.UTC(2026, 7, 21, 9, 0)
  const state = childPlanState({
    // The flags outlive the period by design — nothing runs at the stroke
    // of expiry — so a stale `true` must lose to the date.
    isPremium: true,
    subscriptionStatus: 'active',
    subscriptionExpiry: now - ONE_DAY_MS,
  }, now);
  assert.equal(state.premium, false)
})

t('no information is not evidence of payment', () => {
  const now = Date.UTC(2026, 7, 21, 9, 0)
  assert.equal(childPlanState({}, now).premium, false)
  assert.equal(childPlanState(null, now).premium, false)
  assert.equal(childPlanState(undefined, now).premium, false)
})

t('an active flag with no expiry recorded still counts', () => {
  // The shape of every account activated before all the flags were
  // written. A live plan with a missing date must not read as free.
  const now = Date.UTC(2026, 7, 21, 9, 0)
  const state = childPlanState({subscriptionStatus: 'active'}, now)
  assert.equal(state.premium, true)
  assert.equal(state.expiresAt, null)
})

console.log(`parent app core — ${passed} total assertions passed`)
