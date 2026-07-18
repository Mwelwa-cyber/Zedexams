/**
 * Unit tests for teacherRecommendations.js — plain-node assertion script,
 * run via `npm run test:recommendations`. Every condition is exercised both
 * ways: the recommendation appears when its condition is true and is absent
 * when it is not (no false or padded recommendations).
 */

import { buildRecommendations, buildProfileRecommendations, subjectsTaught } from './teacherRecommendations.js'
import { subjectLabelOf } from './prepareThisWeek.js'

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
  check('scheme card names the subject and deep-links to the studio with its context',
    scheme.title.startsWith('Mathematics') &&
    scheme.to.startsWith('/teacher/generate/scheme-of-work?') &&
    scheme.to.includes('subject=mathematics') &&
    scheme.to.includes('grade=G4') &&
    scheme.to.includes('term=2'))

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

/* ── subject-binding: every per-assignment scheme card keeps its OWN subject ──
   Regression for the dashboard bug where all cards' titles read the single
   highest-scored subject (e.g. "Technology Studies is not planned yet") while
   only the scope tag differed. */
{
  const SUBJECTS = ['english', 'home_economics', 'mathematics', 'integrated_science', 'social_studies', 'technology_studies']
  const G4 = SUBJECTS.map((s, i) => ({ id: `g4-${i}`, grade: 'G4', subject: s, isActive: true }))
  // One subject (technology_studies) has the most current-term activity, so a
  // GLOBAL ranking would surface it on every card. Binding to the assignment
  // must keep each card on its own subject.
  const gens = [
    gen('lesson_plan', { subject: 'technology_studies', grade: 'G4', term: 2 }),
    gen('lesson_plan', { subject: 'technology_studies', grade: 'G4', term: 2 }),
    gen('lesson_plan', { subject: 'mathematics', grade: 'G4', term: 2 }),
  ]
  const list = buildProfileRecommendations({ generations: gens, calendar: CAL, assignments: G4 })
  const schemeCards = list.filter((r) => r.type === 'missing-scheme')

  check('1. every Grade 4 assignment with no scheme gets its own card',
    schemeCards.length === 6)
  check('2. each card title matches its own assignment subject (no shared/stale subject)',
    schemeCards.every((r) => r.title === `${subjectLabelOf(r.subjectId)} is not planned yet`) &&
    new Set(schemeCards.map((r) => r.title)).size === 6)
  check('2b. no card borrows Technology Studies except the Technology Studies card',
    schemeCards.filter((r) => /Technology Studies/.test(r.title)).length === 1)
  check('2c. title, scope and CTA all agree on the subject',
    schemeCards.every((r) => {
      const sub = r.subjectId.replace(/ /g, '_')
      return r.scope.includes(subjectLabelOf(r.subjectId)) &&
        r.title.startsWith(subjectLabelOf(r.subjectId)) &&
        r.to.includes(`subject=${sub}`)
    }))
  check('2d. description is subject-specific (names grade + subject)',
    schemeCards.every((r) => r.text === `Create a Scheme of Work for Grade 4 ${subjectLabelOf(r.subjectId)} using the correct syllabus and current school calendar.`))
  check('2e. immutable identifiers are stamped per card',
    schemeCards.every((r) => r.assignmentId && r.gradeId === 'G4' && r.gradeLabel === 'Grade 4' && r.termId === 2 && r.schoolYear === 2026))
}

/* ── 3. a scheme for ONE subject only clears that subject ──────────── */
{
  const A = [
    { id: 'a-en', grade: 'G4', subject: 'english', isActive: true },
    { id: 'a-ts', grade: 'G4', subject: 'technology_studies', isActive: true },
  ]
  const withTsScheme = [gen('scheme_of_work', { subject: 'technology_studies', grade: 'G4', term: 2 })]
  const list = buildProfileRecommendations({ generations: withTsScheme, calendar: CAL, assignments: A })
  const subjects = list.filter((r) => r.type === 'missing-scheme').map((r) => r.subjectId)
  check('3. a Technology Studies scheme does NOT remove the English recommendation',
    subjects.includes('english'))
  check('3b. the Technology Studies scheme removes only its own card',
    !subjects.includes('technology studies'))
}

/* ── 4. creating an English scheme removes only English ───────────── */
{
  const A = [
    { id: 'a-en', grade: 'G4', subject: 'english', isActive: true },
    { id: 'a-ma', grade: 'G4', subject: 'mathematics', isActive: true },
    { id: 'a-ts', grade: 'G4', subject: 'technology_studies', isActive: true },
  ]
  const before = buildProfileRecommendations({ generations: [], calendar: CAL, assignments: A })
    .filter((r) => r.type === 'missing-scheme').map((r) => r.subjectId).sort()
  check('4. before any scheme, all three subjects are unplanned',
    JSON.stringify(before) === JSON.stringify(['english', 'mathematics', 'technology studies']))

  const afterEnglish = buildProfileRecommendations({
    generations: [gen('scheme_of_work', { subject: 'english', grade: 'G4', term: 2 })],
    calendar: CAL, assignments: A,
  }).filter((r) => r.type === 'missing-scheme').map((r) => r.subjectId).sort()
  check('4b. creating an English scheme removes ONLY the English card',
    JSON.stringify(afterEnglish) === JSON.stringify(['mathematics', 'technology studies']))

  // Grade-scoping: an English scheme for a DIFFERENT grade must not clear the
  // Grade 4 English card.
  const otherGradeScheme = buildProfileRecommendations({
    generations: [gen('scheme_of_work', { subject: 'english', grade: 'G7', term: 2 })],
    calendar: CAL, assignments: [{ id: 'a-en', grade: 'G4', subject: 'english', isActive: true }],
  }).filter((r) => r.type === 'missing-scheme').map((r) => r.subjectId)
  check('4c. a scheme in another grade does not satisfy this grade',
    otherGradeScheme.includes('english'))
}

/* ── 5. CTA carries the exact subject + assignment context ────────── */
{
  const A = [{ id: 'a-is', grade: 'G4', subject: 'integrated_science', className: 'B', curriculumType: 'cbc', isActive: true }]
  const rec = buildProfileRecommendations({ generations: [], calendar: CAL, assignments: A })
    .find((r) => r.type === 'missing-scheme')
  check('5. CTA deep-links to the Scheme Studio with subject/grade/term/curriculum/class',
    rec.to.startsWith('/teacher/generate/scheme-of-work?') &&
    rec.to.includes('subject=integrated_science') &&
    rec.to.includes('grade=G4') &&
    rec.to.includes('term=2') &&
    rec.to.includes('curriculum=cbc') &&
    rec.to.includes('className=B'))
  check('5b. the CTA subject matches the card subject (never a default)',
    rec.subjectId === 'integrated science' && rec.subjectName === 'Integrated Science')
}

/* ── 6. reordering assignments does not change subject names ──────── */
{
  const base = [
    { id: 'a-en', grade: 'G4', subject: 'english', isActive: true },
    { id: 'a-ma', grade: 'G4', subject: 'mathematics', isActive: true },
    { id: 'a-ts', grade: 'G4', subject: 'technology_studies', isActive: true },
  ]
  const reversed = [...base].reverse()
  const titleFor = (list, id) => list.find((r) => r.assignmentId === id)?.title
  const a = buildProfileRecommendations({ generations: [], calendar: CAL, assignments: base })
    .filter((r) => r.type === 'missing-scheme')
  const b = buildProfileRecommendations({ generations: [], calendar: CAL, assignments: reversed })
    .filter((r) => r.type === 'missing-scheme')
  check('6. each assignment keeps its subject title regardless of ordering',
    titleFor(a, 'a-en') === 'English is not planned yet' &&
    titleFor(b, 'a-en') === 'English is not planned yet' &&
    titleFor(a, 'a-ts') === 'Technology Studies is not planned yet' &&
    titleFor(b, 'a-ts') === 'Technology Studies is not planned yet')
}

/* ── 7. purity — repeated calls / switching don't leak the prev subject ── */
{
  const A1 = [{ id: 'a-en', grade: 'G4', subject: 'english', isActive: true }]
  const A2 = [{ id: 'a-ts', grade: 'G4', subject: 'technology_studies', isActive: true }]
  // Simulate a re-render on the same profile, then a profile switch, then back.
  const first = buildProfileRecommendations({ generations: [], calendar: CAL, assignments: A1 }).find((r) => r.type === 'missing-scheme')
  buildProfileRecommendations({ generations: [], calendar: CAL, assignments: A2 })
  const again = buildProfileRecommendations({ generations: [], calendar: CAL, assignments: A1 }).find((r) => r.type === 'missing-scheme')
  check('7. switching assignments and back yields the same subject (no leak)',
    first.title === 'English is not planned yet' && again.title === 'English is not planned yet')
  check('7b. each call returns fresh recommendation objects (no shared reference)',
    first !== again)

  // A multi-assignment build must not share object references between cards
  // (mutating one card can never bleed into another).
  const multi = buildProfileRecommendations({
    generations: [], calendar: CAL,
    assignments: [
      { id: 'm-en', grade: 'G4', subject: 'english', isActive: true },
      { id: 'm-ma', grade: 'G4', subject: 'mathematics', isActive: true },
    ],
  }).filter((r) => r.type === 'missing-scheme')
  check('7c. sibling cards are distinct objects with distinct subjects',
    multi[0] !== multi[1] && multi[0].subjectId !== multi[1].subjectId)
}

/* ── 8. no duplicate cards for the same assignment + type ─────────── */
{
  // Same assignment id appearing twice (aliasing / a stale duplicate) must not
  // yield two identical cards.
  const dupes = [
    { id: 'a-en', grade: 'G4', subject: 'english', isActive: true },
    { id: 'a-en', grade: 'G4', subject: 'english', isActive: true },
  ]
  const list = buildProfileRecommendations({ generations: [], calendar: CAL, assignments: dupes })
  check('8. duplicate assignments produce a single card (deduped by id)',
    list.filter((r) => r.type === 'missing-scheme').length === 1)
  check('8b. every id in a profile build is unique',
    new Set(list.map((r) => r.id)).size === list.length)
}

console.log(`\nteacherRecommendations: ${passed} checks passed`)
