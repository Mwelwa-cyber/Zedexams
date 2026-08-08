/**
 * The paper's IDENTITY: the dedupe key, the derived title, and the on-screen
 * composition that shortens by dropping whole facts.
 *
 * The three are tested together because they are one contract — the key says
 * which papers are the same paper, and the two title functions must name the
 * same paper the same way whether the string is being stored or rendered.
 *
 * Plain-node script — `npm run test:paper-identity`.
 */

import assert from 'node:assert/strict'
import {
  canDerivePaperKey,
  derivedPaperTitle,
  paperKey,
  paperSlug,
} from './pastPaperNormalize.js'
import {
  PAPER_TITLE_MEDIUM,
  PAPER_TITLE_WIDE,
  composePaperRow,
  composePaperTitle,
  fullPaperTitle,
  paperTitleFacts,
} from './paperTitleCore.js'
import { joinDot, pickWidthTier } from './responsiveTitle.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ok  ${name}`)
}

const ECZ = { grade: '7', subject: 'science', year: 2025, source: 'ecz', paperNumber: 1 }
const MOCK = { grade: '7', subject: 'science', year: 2025, source: 'prisca', paperNumber: 'mock' }

console.log('\npaperKey — the dedupe identity')

test('the documented format, exactly', () => {
  assert.equal(paperKey(ECZ), 'g7-2025-science-ecz-1')
  assert.equal(paperKey(MOCK), 'g7-2025-science-prisca-mock')
})

test('THE WHOLE POINT: same grade+year+subject, different source → different key', () => {
  // This is the case the archive could not represent at all before: Grade 7,
  // 2025, Integrated Science with both an ECZ paper and a PRISCA mock.
  assert.notEqual(paperKey(ECZ), paperKey(MOCK))
})

test('a paper with no number keys on "na", not on nothing', () => {
  assert.equal(paperKey({ ...ECZ, paperNumber: null }), 'g7-2025-science-ecz-na')
})

test('an unlabelled paper still keys deterministically', () => {
  // Two unlabelled papers colliding is the signal a human needs; a key that
  // was simply absent would produce no signal at all.
  assert.equal(paperKey({ ...ECZ, source: null }), 'g7-2025-science-unknown-1')
  assert.equal(paperKey({ ...ECZ, source: null }), paperKey({ ...ECZ, source: undefined }))
})

test('the inputs are normalised before keying, so spellings converge', () => {
  const typed = { grade: 'Grade 7', subject: 'Maths', year: '2025', source: 'ECZ', paperNumber: 'Paper 1' }
  assert.equal(paperKey(typed), 'g7-2025-mathematics-ecz-1')
})

test('the key is NOT the slug — the slug carries no source', () => {
  // Two publishers legitimately share a shareable URL alias, so the SEO slug
  // is identical for these two and only the key tells them apart. Folding the
  // two roles into one string is how a mock would overwrite the ECZ paper's
  // URL; keeping them separate is why the slug is left alone here.
  const eczP1 = { ...ECZ, paperNumber: 1 }
  const mockP1 = { ...MOCK, paperNumber: 1 }
  assert.equal(paperSlug(eczP1), paperSlug(mockP1))
  assert.notEqual(paperKey(eczP1), paperKey(mockP1))
})

test('canDerivePaperKey requires grade, subject and year', () => {
  assert.equal(canDerivePaperKey(ECZ), true)
  assert.equal(canDerivePaperKey({ ...ECZ, year: null }), false)
  assert.equal(canDerivePaperKey({ ...ECZ, subject: '' }), false)
  assert.equal(canDerivePaperKey({}), false)
})

console.log('\nderivedPaperTitle — the stored name')

test('carries grade, subject, number, source and year', () => {
  assert.equal(derivedPaperTitle(ECZ), 'Grade 7 Integrated Science — Paper 1 · ECZ · 2025')
})

test('a mock names its publisher, so the two papers read differently', () => {
  assert.notEqual(derivedPaperTitle(ECZ), derivedPaperTitle(MOCK))
  assert.match(derivedPaperTitle(MOCK), /PRISCA mock/)
})

test('missing facts are dropped, never printed as gaps or "undefined"', () => {
  const bare = derivedPaperTitle({ grade: '7', subject: 'english', year: 2024 })
  assert.equal(bare, 'Grade 7 English — 2024')
  assert.doesNotMatch(bare, /undefined|null|—\s*$|·\s*·/)
})

test('a paper with nothing to build from is named, not blank', () => {
  assert.equal(derivedPaperTitle({}), 'Untitled past paper')
  assert.equal(derivedPaperTitle({ title: 'Hand typed' }), 'Hand typed')
})

test('the stored name and the rendered full name are ONE name', () => {
  // The write path (pastPaperNormalize) must not import display code, so the
  // two functions are separate. This is what stops them drifting.
  for (const paper of [ECZ, MOCK, { grade: '12', subject: 'english', year: 2020, source: 'other' }]) {
    assert.equal(derivedPaperTitle(paper), fullPaperTitle(paper))
  }
})

console.log('\ncomposePaperTitle — degrades by priority, never by ellipsis')

test('wide keeps every distinguishing fact on one line', () => {
  const out = composePaperTitle(ECZ, { width: PAPER_TITLE_WIDE })
  assert.equal(out.mode, 'wide')
  assert.equal(out.line1, 'Integrated Science · Paper 1 · ECZ · 2025')
  assert.equal(out.line2, '')
})

test('medium drops the year — the LOWEST-priority fact, not the leftmost', () => {
  const out = composePaperTitle(ECZ, { width: PAPER_TITLE_MEDIUM })
  assert.equal(out.mode, 'medium')
  assert.match(out.line1, /ECZ/)
  assert.doesNotMatch(out.line1, /2025/)
})

test('narrow uses the curriculum short form and stacks the rest', () => {
  const out = composePaperTitle(ECZ, { width: 180 })
  assert.equal(out.mode, 'narrow')
  assert.equal(out.line1, 'Science')
  assert.match(out.line2, /Paper 1/)
  assert.match(out.line2, /ECZ/)
})

test('at a 360px phone the SOURCE is still on screen', () => {
  // The defect: "Grade 7 Integrated Sci…" — an ellipsis threw away the one
  // fact that says whether this is the real exam.
  const out = composePaperTitle(MOCK, { width: 210 })
  const rendered = `${out.line1} ${out.line2}`
  assert.match(rendered, /PRISCA mock/)
  assert.doesNotMatch(rendered, /…/)
})

test('nothing is ever cut mid-word at any width', () => {
  for (const width of [1200, 340, 300, 240, 210, 120, 0]) {
    const out = composePaperTitle(ECZ, { width })
    assert.doesNotMatch(`${out.line1}${out.line2}`, /…|\.\.\./, `width ${width} truncated`)
  }
})

test('an unmeasured width composes wide, not narrow', () => {
  // Guessing narrow before the first measurement makes every title flash
  // through its shortest form on first paint.
  assert.equal(composePaperTitle(ECZ, { width: undefined }).mode, 'wide')
  assert.equal(pickWidthTier(NaN, { wide: 340, medium: 240 }), 'wide')
})

console.log('\ncomposePaperRow — what a subject card lists')

test('the badge carries the source label and its official flag', () => {
  const row = composePaperRow(ECZ)
  assert.equal(row.badge.label, 'ECZ')
  assert.equal(row.badge.isOfficial, true)
  assert.equal(composePaperRow(MOCK).badge.isOfficial, false)
})

test('an unlabelled paper is badged "Unlabelled" — never silently blank', () => {
  const row = composePaperRow({ grade: '7', subject: 'english', year: 2024 })
  assert.equal(row.badge.label, 'Unlabelled')
  assert.equal(row.badge.isOfficial, false)
})

test('the secondary line says a mock is not an ECZ exam', () => {
  assert.match(composePaperRow(MOCK).secondary, /not an ECZ exam/i)
})

test('a session stands in for the year when the paper states one', () => {
  const row = composePaperRow({ ...ECZ, session: 'october' })
  assert.match(row.secondary, /October/)
})

test('the quiz state rides on line 2 in both directions', () => {
  assert.match(composePaperRow({ ...ECZ, quizId: 'q1', quizStatus: 'attached' }).secondary, /Quiz ready/)
  assert.match(composePaperRow(ECZ).secondary, /coming soon/i)
})

console.log('\nfacts + primitives')

test('facts expose the pieces a renderer needs, already resolved', () => {
  const f = paperTitleFacts(MOCK)
  assert.equal(f.subject, 'Integrated Science')
  assert.equal(f.sourceLabel, 'PRISCA mock')
  assert.equal(f.isOfficial, false)
  assert.equal(f.number, 'Mock paper')
})

test('joinDot drops empties instead of printing separator gaps', () => {
  assert.equal(joinDot(['a', '', null, 'b', undefined]), 'a · b')
  assert.equal(joinDot([]), '')
})

console.log(`\n${passed} assertions passed.\n`)
