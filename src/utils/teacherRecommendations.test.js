/**
 * Unit tests for teacherRecommendations.js — plain-node assertion script,
 * run via `npm run test:recommendations`. Every condition is exercised both
 * ways: the recommendation appears when its condition is true and is absent
 * when it is not (no false or padded recommendations).
 */

import { buildRecommendations, buildProfileRecommendations, subjectsTaught } from './teacherRecommendations.js'

let passed = 0
function check(name, cond) {
  if (!cond) throw new Error(`FAIL: ${name}`)
  passed += 1
  console.log(`  ✓ ${name}`)
}

const CAL = {
  year: 2026,
  termNumber: 2,
  weekNumber: 8,
  beginning: '2026-05-18',
  ending: '2026-05-22',
  beginningLabel: '18 May 2026',
  endingLabel: '22 May 2026',
  isActiveTermNow: true,
}
const IN_WEEK = new Date(2026, 4, 19, 10, 0, 0).getTime()

let idSeq = 0
function gen(tool, { subject, grade, term, createdAt = IN_WEEK, output = {}, header = {}, meta } = {}) {
  return {
    id: `g${++idSeq}`,
    tool,
    createdAt,
    inputs: { subject, grade, term: term != null ? String(term) : null },
    output: { header: { subject, grade, term, ...header }, ...output },
    ...(meta ? { meta } : {}),
  }
}

const FOCUS_W8 = (subject) => gen('weekly_forecast', {
  subject, grade: 'G4', term: 2, header: { weekNumber: 8 },
  output: { days: [{ day: 'Monday', topic: 'Topic A' }, { day: 'Wednesday', topic: 'Topic B' }] },
})

function ids(args) {
  return buildRecommendations(args).map((r) => r.id)
}

/* ── subjectsTaught ranking ──────────────────────────────────────── */
{
  const gens = [
    gen('lesson_plan', { subject: 'mathematics', term: 2 }),
    gen('lesson_plan', { subject: 'mathematics', term: 2 }),
    gen('notes', { subject: 'english', term: 1 }),
  ]
  const ranked = subjectsTaught({ generations: gens, profileSubject: '', termNumber: 2 })
  check('current-term activity outranks old activity', ranked[0].subject === 'mathematics')
  const withProfile = subjectsTaught({ generations: [], profileSubject: 'creative_arts', termNumber: 2 })
  check('profile subject counts as evidence', withProfile[0]?.subject === 'creative arts')
}

/* ── 1. subject not planned yet ──────────────────────────────────── */
{
  const gens = [FOCUS_W8('mathematics')]
  const recs = buildRecommendations({ generations: gens, calendar: CAL })
  const scheme = recs.find((r) => r.id.startsWith('scheme-'))
  check('unschemed subject → Create Scheme recommendation', Boolean(scheme))
  check('scheme card names the subject and routes to the studio',
    scheme.title.startsWith('Mathematics') && scheme.to === '/teacher/generate/scheme-of-work')

  const withScheme = [...gens, gen('scheme_of_work', { subject: 'mathematics', grade: 'G4', term: 2 })]
  check('scheme exists → no scheme recommendation',
    !ids({ generations: withScheme, calendar: CAL }).some((i) => i.startsWith('scheme-')))
}

/* ── 2. record of work behind ────────────────────────────────────── */
{
  const base = [
    gen('scheme_of_work', { subject: 'english', grade: 'G4', term: 2 }),
    FOCUS_W8('english'),
    gen('lesson_plan', { subject: 'english', grade: 'G4', term: 2 }),
  ]
  check('lessons this week + no record → Record of Work is behind',
    ids({ generations: base, calendar: CAL }).includes('record-behind'))

  const recorded = [...base, gen('record_of_work', {
    subject: 'english', grade: 'G4', term: 2,
    output: { weeks: [{ week: '8', coverage: 'full' }] },
  })]
  check('record updated this week → recommendation gone',
    !ids({ generations: recorded, calendar: CAL }).includes('record-behind'))

  // Deep-link: an existing record opens IN THE STUDIO at the oldest due
  // unrecorded week — not simply today's week.
  const behindRecord = gen('record_of_work', {
    subject: 'english', grade: 'G4', term: 2,
    output: { weeks: [
      { week: '5', coverage: 'full' },
      { week: '6', topic: 'Fractions', coverage: '' }, // oldest unresolved
      { week: '7', coverage: 'partial' },
      { week: '8', coverage: '' },                     // current week, also unrecorded
    ] },
  })
  const withBehind = buildRecommendations({ generations: [...base, behindRecord], calendar: CAL })
  const behind = withBehind.find((r) => r.id === 'record-behind')
  check('behind recommendation targets the oldest due unrecorded week',
    Boolean(behind) &&
    behind.actionLabel === 'Update Week 6' &&
    new RegExp(`/teacher/generate/record-of-work\\?id=${behindRecord.id}&week=6$`).test(behind.to))
  check('behind copy names the planned work without accusatory wording',
    behind.title === 'Record of Work needs updating' &&
    /planned work for Week 6/.test(behind.text) &&
    !/fail|neglect/i.test(behind.text))
  check('no existing record still routes to create-new',
    (() => {
      const none = buildRecommendations({ generations: base, calendar: CAL }).find((r) => r.id === 'record-behind')
      return none && none.to === '/teacher/generate/record-of-work' && none.actionLabel === 'Update now'
    })())
}

/* ── 3. create worksheet ─────────────────────────────────────────── */
{
  const base = [
    gen('scheme_of_work', { subject: 'english', grade: 'G4', term: 2 }),
    gen('lesson_plan', { subject: 'english', grade: 'G4', term: 2 }),
  ]
  check('lesson without worksheet → Create worksheet',
    ids({ generations: base, calendar: CAL }).includes('worksheet-missing'))
  const withWs = [...base, gen('worksheet', { subject: 'english', grade: 'G4', term: 2 })]
  check('worksheet exists this week → recommendation gone',
    !ids({ generations: withWs, calendar: CAL }).includes('worksheet-missing'))
}

/* ── 4. Friday short test ────────────────────────────────────────── */
{
  const gens = [gen('scheme_of_work', { subject: 'english', grade: 'G4', term: 2 }), FOCUS_W8('english')]
  const recs = buildRecommendations({ generations: gens, calendar: CAL })
  const test = recs.find((r) => r.id === 'friday-short-test')
  check('weekly topics + no test → Create Friday’s short test', Boolean(test))
  check('short-test copy never promises a Quiz Studio',
    test.title === 'Create Friday’s short test' &&
    test.actionLabel === 'Create short test' &&
    !/quiz/i.test(test.title) && !/quiz/i.test(test.actionLabel))
  check('short-test deep link preselects grade, subject and term',
    test.to.startsWith('/teacher/test-papers/new?') &&
    test.to.includes('grade=G4') && test.to.includes('subject=english') && test.to.includes('term=2'))
  const withTest = { generations: gens, calendar: CAL, assessments: [{ id: 'a1', questionCount: 5, createdAt: IN_WEEK }] }
  check('a test created this week → short-test recommendation gone',
    !ids(withTest).includes('friday-short-test'))
}

/* ── preferred subject keeps recommendations on the visible context ─ */
{
  const gens = [
    FOCUS_W8('english'),
    gen('lesson_plan', { subject: 'english', grade: 'G4', term: 2 }),
    gen('scheme_of_work', { subject: 'english', grade: 'G4', term: 2 }),
    // Newer maths forecast would win context WITHOUT the preference.
    gen('weekly_forecast', { subject: 'mathematics', grade: 'G5', term: 2, header: { weekNumber: 8 }, output: { days: [{ day: 'Monday', topic: 'Algebra' }] } }),
  ]
  const recs = buildRecommendations({ generations: gens, calendar: CAL, preferredSubject: 'english' })
  const record = recs.find((r) => r.id === 'record-behind')
  check('week-scoped recommendations follow the persisted subject context', Boolean(record))
}

/* ── 5. draft test papers ────────────────────────────────────────── */
{
  const args = { generations: [], calendar: CAL, assessments: [
    { id: 'a1', questionCount: 0, createdAt: IN_WEEK },
    { id: 'a2', questionCount: 7, createdAt: IN_WEEK },
  ] }
  const recs = buildRecommendations(args)
  const drafts = recs.find((r) => r.id === 'draft-papers')
  check('empty paper → Review drafts, routed to Test Papers',
    Boolean(drafts) && drafts.to === '/teacher/test-papers')
  check('papers with questions are not called drafts', drafts.text.includes('your unfinished test paper'))
  check('no empty papers → no draft recommendation',
    !ids({ generations: [], calendar: CAL, assessments: [{ id: 'a2', questionCount: 7, createdAt: IN_WEEK }] })
      .includes('draft-papers'))
}

/* ── holidays suppress week-scoped nags ──────────────────────────── */
{
  const gens = [
    gen('scheme_of_work', { subject: 'english', grade: 'G4', term: 2 }),
    FOCUS_W8('english'),
    gen('lesson_plan', { subject: 'english', grade: 'G4', term: 2 }),
  ]
  const holidayIds = ids({ generations: gens, calendar: { ...CAL, isActiveTermNow: false } })
  check('holiday suppresses record/worksheet/short-test recommendations',
    !holidayIds.includes('record-behind') && !holidayIds.includes('worksheet-missing') && !holidayIds.includes('friday-short-test'))
}

/* ── no data → no recommendations (never padded) ─────────────────── */
{
  check('empty inputs produce an empty list', buildRecommendations({ calendar: CAL }).length === 0)
  const list = buildRecommendations({})
  check('missing calendar produces no week-scoped or scheme cards',
    !list.some((r) => r.id.startsWith('scheme-') || r.id === 'record-behind' || r.id === 'friday-short-test'))
}

/* ── uniqueness ──────────────────────────────────────────────────── */
{
  const gens = [
    gen('scheme_of_work', { subject: 'english', grade: 'G4', term: 2 }),
    FOCUS_W8('english'),
    gen('lesson_plan', { subject: 'english', grade: 'G4', term: 2 }),
  ]
  const list = ids({ generations: gens, calendar: CAL, assessments: [{ id: 'a1', questionCount: 0, createdAt: IN_WEEK }] })
  check('every recommendation id is unique', new Set(list).size === list.length)
}

/* ── buildProfileRecommendations — whole-profile (all assignments) ── */
{
  const A = [
    { id: 'asg-1', grade: 'G4', subject: 'mathematics', isActive: true },
    { id: 'asg-2', grade: 'G5', subject: 'english', isActive: true },
  ]
  const drafts = [{ id: 'a1', questionCount: 0, createdAt: IN_WEEK }]
  const list = buildProfileRecommendations({ calendar: CAL, assignments: A, assessments: drafts })
  const byId = new Map(list.map((r) => [r.id, r]))

  check('emits an unplanned-scheme card for EACH class',
    byId.has('scheme-mathematics::asg-1') && byId.has('scheme-english::asg-2'))
  check('per-assignment cards carry a scope label',
    byId.get('scheme-mathematics::asg-1').scope === 'Grade 4 · Mathematics' &&
    byId.get('scheme-english::asg-2').scope === 'Grade 5 · English')
  check('a profile-wide card (draft papers) appears exactly once',
    list.filter((r) => r.id === 'draft-papers').length === 1)
  check('every id is unique across classes', new Set(list.map((r) => r.id)).size === list.length)
  check('classes are interleaved (both surface before the global card)', (() => {
    const g = list.findIndex((r) => r.id === 'draft-papers')
    const m = list.findIndex((r) => r.id.startsWith('scheme-mathematics'))
    const e = list.findIndex((r) => r.id.startsWith('scheme-english'))
    return m < g && e < g
  })())
}

/* same subject in two classes/streams — never merged, stays distinct */
{
  const streams = [
    { id: 'asg-a', grade: 'G4', subject: 'mathematics', className: 'A', isActive: true },
    { id: 'asg-b', grade: 'G4', subject: 'mathematics', className: 'B', isActive: true },
  ]
  const list = buildProfileRecommendations({ calendar: CAL, assignments: streams })
  const byId = new Map(list.map((r) => [r.id, r]))
  check('same grade+subject in two classes produces two distinct cards',
    byId.has('scheme-mathematics::asg-a') && byId.has('scheme-mathematics::asg-b'))
  check('each stream keeps its class in the scope label',
    byId.get('scheme-mathematics::asg-a').scope === 'Grade 4 A · Mathematics' &&
    byId.get('scheme-mathematics::asg-b').scope === 'Grade 4 B · Mathematics')
  check('no id collision between streams', new Set(list.map((r) => r.id)).size === list.length)
}

/* single (or no) active assignment → identical to buildRecommendations */
{
  const one = [{ grade: 'G4', subject: 'english', isActive: true }]
  const profile = buildProfileRecommendations({ calendar: CAL, assignments: one })
  const single = buildRecommendations({ calendar: CAL, profileSubject: 'english', preferredSubject: 'english', profileGrade: 'G4' })
  check('one active assignment matches single-context output',
    JSON.stringify(profile.map((r) => r.id)) === JSON.stringify(single.map((r) => r.id)))
  check('no assignments → no scope tags, unchanged behaviour',
    buildProfileRecommendations({ calendar: CAL, assignments: [] }).every((r) => !r.scope))
}

console.log(`\nteacherRecommendations: ${passed} checks passed`)
