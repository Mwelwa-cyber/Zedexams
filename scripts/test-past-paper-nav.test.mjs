/**
 * Unit tests for the guided past-paper navigation helpers
 * (src/features/papers/lib/paperNav.js).
 *
 * Plain-node assertion script — run with
 * `node scripts/test-past-paper-nav.test.mjs` or `npm run test:papers-nav`.
 * Throws on the first failed assertion. Kept free of React/Firebase so
 * the pure Grade → Year → Subject → Paper → Quiz logic is verifiable in
 * isolation and the /papers/:id/quiz link contract can't regress.
 */
import {
  ANY,
  deriveYears,
  filterByGrade,
  subjectsForYear,
  siblingPapers,
  quizPath,
  viewPath,
  isSpecimen,
  filterPapers,
  resolveArchiveGrade,
} from '../src/features/papers/lib/paperNav.js'

let passed = 0
function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  passed++
}
function eq(a, b, msg) {
  assert(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)
}
function deepEq(a, b, msg) {
  assert(JSON.stringify(a) === JSON.stringify(b), `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)
}

const PAPERS = [
  { id: 'p1', title: 'Grade 7 Mathematics 2025 Paper 1', grade: '7', subject: 'mathematics', year: 2025, paperNumber: 1, quizId: 'q1' },
  { id: 'p2', title: 'Grade 7 Mathematics 2025 Paper 2', grade: '7', subject: 'mathematics', year: 2025, paperNumber: 2 },
  { id: 'p3', title: 'Grade 7 English 2025', grade: '7', subject: 'english', year: 2025, quizId: 'q3', slug: 'grade-7-english-2025' },
  { id: 'p4', title: 'Grade 7 Science 2024', grade: '7', subject: 'science', year: 2024 },
  { id: 'p5', title: 'Grade 12 Mathematics 2025', grade: '12', subject: 'mathematics', year: 2025 },
  { id: 'p6', title: 'Grade 7 English 2025 (Specimen)', grade: '7', subject: 'english', year: 2025, specimen: true },
  { id: 'p7', title: 'Undated paper', grade: '7', subject: 'english', year: null },
]

/* ── deriveYears ───────────────────────────────────────────────── */
deepEq(deriveYears(PAPERS), [2025, 2024], 'distinct numeric years, newest first')
deepEq(deriveYears([]), [], 'empty list → no years')
deepEq(deriveYears(null), [], 'null input is safe')
deepEq(deriveYears([{ year: 2020 }, { year: 2020 }]), [2020], 'dedupes years')

/* ── filterByGrade ─────────────────────────────────────────────── */
eq(filterByGrade(PAPERS, '7').length, 6, 'grade 7 filter count')
eq(filterByGrade(PAPERS, '12').length, 1, 'grade 12 filter count')
eq(filterByGrade(PAPERS, ANY).length, PAPERS.length, 'ANY returns all')
eq(filterByGrade(PAPERS, 7).length, 6, 'numeric grade coerces to string')

/* ── subjectsForYear (Screen 2 grouping) ───────────────────────── */
const g7y2025 = subjectsForYear(PAPERS, '7', 2025)
deepEq(g7y2025.map((s) => s.subject), ['english', 'mathematics'], 'subjects sorted by id')
eq(g7y2025.find((s) => s.subject === 'mathematics').papers.length, 2, 'maths has two papers')
eq(g7y2025.find((s) => s.subject === 'mathematics').papers[0].paperNumber, 1, 'papers ordered by number')
eq(subjectsForYear(PAPERS, '7', 2024).length, 1, 'only science in 2024')
eq(subjectsForYear(PAPERS, '12', 2024).length, 0, 'no grade-12 2024 papers')

/* ── siblingPapers (prev/next nav) ─────────────────────────────── */
const sibs = siblingPapers(PAPERS, '7', 2025)
deepEq(sibs.map((p) => p.subject), ['english', 'mathematics'], 'one paper per subject, ordered')
eq(sibs[1].id, 'p1', 'maths sibling is Paper 1 (first)')

/* ── link builders (quiz-link contract) ────────────────────────── */
eq(quizPath('abc'), '/papers/abc/quiz', 'quiz path is /papers/:id/quiz')
eq(viewPath(PAPERS[2]), '/papers/p3/grade-7-english-2025', 'view path uses slug when present')
eq(viewPath(PAPERS[0]), '/papers/p1', 'view path falls back to id')
eq(viewPath(null), '/papers', 'view path is safe for null')

/* ── isSpecimen ────────────────────────────────────────────────── */
eq(isSpecimen(PAPERS[5]), true, 'specimen flag detected')
eq(isSpecimen({ title: 'Some SPECIMEN paper' }), true, 'specimen title detected')
eq(isSpecimen(PAPERS[0]), false, 'ordinary paper is not specimen')

/* ── filterPapers (search + quick filters + sort) ──────────────── */
eq(filterPapers(PAPERS, { grade: '7', query: 'mathematics' }).length, 2, 'search by subject word')
eq(filterPapers(PAPERS, { query: '2024' }).length, 1, 'search by year')
eq(filterPapers(PAPERS, { grade: '7', quizOnly: true }).length, 2, 'quizOnly keeps papers with quizId')
// The Quiz step of the Past Paper Studio is optional. A paper published with
// it skipped still carries the id of the quiz that was being authored, so
// quizOnly has to read the derived status — filtering on the bare id would
// promise a quiz that has no questions in it yet.
eq(
  filterPapers(
    [{ id: 'pending', grade: '7', year: 2025, quizId: 'q-draft', quizStatus: 'pending' }],
    { quizOnly: true },
  ).length,
  0,
  'quizOnly drops a paper whose quiz is still pending',
)
eq(
  filterPapers(
    [{ id: 'legacy', grade: '7', year: 2019, quizId: 'q-old' }],
    { quizOnly: true },
  ).length,
  1,
  'quizOnly keeps a pre-quizStatus paper that has a quizId',
)
eq(
  filterPapers(PAPERS, {
    grade: '7',
    query: 'maths',
    labelOf: (id) => (id === 'mathematics' ? 'Maths' : id),
  }).length,
  2,
  'labelOf feeds the search haystack (Maths label matches, English does not)',
)
const sortedAz = filterPapers(PAPERS, { grade: '7', sort: 'az' })
assert(sortedAz[0].title.localeCompare(sortedAz[1].title) <= 0, 'az sort is alphabetical')
const sortedOld = filterPapers(PAPERS, { grade: '7', sort: 'oldest' }).filter((p) => p.year)
assert(sortedOld[0].year <= sortedOld[sortedOld.length - 1].year, 'oldest sort ascending by year')

// ── Source labelling ─────────────────────────────────────────────────────

const ECZ_2025 = {
  id: 'ecz', grade: '7', subject: 'science', year: 2025, title: 'Grade 7 Integrated Science — ECZ',
  source: 'ecz', isOfficial: true, sourceConfidence: 'explicit', paperNumber: null,
}
const MOCK_2025 = {
  id: 'mock', grade: '7', subject: 'science', year: 2025, title: 'Grade 7 Integrated Science — PRISCA',
  source: 'prisca', isOfficial: false, sourceConfidence: 'explicit', paperNumber: 1,
}

// The Grade 7 / 2025 / Integrated Science card: two papers, one subject.
const sci = subjectsForYear([MOCK_2025, ECZ_2025], '7', 2025)
eq(sci.length, 1, 'both papers group under one subject card')
eq(sci[0].papers.length, 2, 'the card lists both papers')
eq(
  sci[0].papers[0].id,
  'ecz',
  'THE OFFICIAL PAPER SORTS FIRST — even though the mock is the one with a paper number',
)

// "Official only" — the acceptance criterion.
eq(
  filterPapers([ECZ_2025, MOCK_2025], { officialOnly: true }).map((p) => p.id).join(),
  'ecz',
  'officialOnly returns exactly the ECZ paper',
)
eq(
  filterPapers([ECZ_2025, { ...MOCK_2025, isOfficial: true }], { officialOnly: true })
    .map((p) => p.id).join(),
  'ecz',
  'officialOnly re-derives from the SOURCE — a stored boolean cannot smuggle a mock through',
)
eq(filterPapers([ECZ_2025, MOCK_2025], {}).length, 2, 'without the filter both papers list')

// The source is searchable, because it is now a thing a learner can type.
eq(filterPapers([ECZ_2025, MOCK_2025], { query: 'prisca' }).map((p) => p.id).join(), 'mock',
  'searching a publisher finds its paper')

// An UNLABELLED paper is listed, not hidden. #2191 dropped these from every
// learner surface, which combined with the rules gate to empty the archive.
const UNLABELLED = { id: 'x', grade: '7', subject: 'science', year: 2024, sourceConfidence: 'unknown' }
const LEGACY = { id: 'y', grade: '7', subject: 'science', year: 2023 }
eq(
  filterPapers([ECZ_2025, UNLABELLED, LEGACY], { grade: '7' }).length,
  3,
  'unlabelled and pre-source papers are still listed',
)
eq(
  filterPapers([ECZ_2025, UNLABELLED, LEGACY], { grade: '7', officialOnly: true }).map((p) => p.id).join(),
  'ecz',
  '"Official only" still narrows to ECZ — that filter is a CHOICE, not a gate',
)

// ── resolveArchiveGrade ─────────────────────────────────────────────
//
// Which grade the archive opens on, and whether a grade switch belongs
// on the screen at all. Before this the answers were the literal '7' and
// an unconditional yes, so a learner's own profile was never read and a
// child was offered grade browsing on a child surface (L-14).

const G = ['7', '12']

// A visitor with no account: the archive's default, and the toggle —
// they are most of this page's traffic and have no profile to read.
eq(resolveArchiveGrade({ grades: G }).grade, '7', 'signed out opens on the default grade')
eq(resolveArchiveGrade({ grades: G }).showGradeToggle, true, 'signed out keeps the grade toggle')

// A learner: their own grade, and no toggle.
const g7 = resolveArchiveGrade({ profileGrade: 7, isLearner: true, grades: G })
eq(g7.grade, '7', "a Grade 7 learner opens on their own grade")
eq(g7.showGradeToggle, false, 'a learner is not offered grade browsing')
// Numeric or string, the caller should not have to care.
eq(resolveArchiveGrade({ profileGrade: '12', isLearner: true, grades: G }).grade, '12', "a learner's grade is read whichever type it arrives as")

// A grade this archive does not hold falls back rather than opening an
// empty screen that insists it is the learner's grade. (ECZ retired
// Grade 9; the archive is 7 and 12.)
eq(resolveArchiveGrade({ profileGrade: 5, isLearner: true, grades: G }).grade, '7', 'a grade with no papers here falls back to the default')
eq(resolveArchiveGrade({ profileGrade: 9, isLearner: true, grades: G }).grade, '7', 'a retired grade falls back to the default')
eq(resolveArchiveGrade({ profileGrade: null, isLearner: true, grades: G }).grade, '7', 'a learner with no grade yet falls back to the default')

// A deep link outranks the profile: a shared ?grade=12 link is someone
// going to a specific paper, not browsing.
eq(resolveArchiveGrade({ urlGrade: '12', profileGrade: 7, isLearner: true, grades: G }).grade, '12', '?grade= outranks the profile')
// ...but a nonsense one does not silently become the URL's word.
eq(resolveArchiveGrade({ urlGrade: '9', profileGrade: 7, isLearner: true, grades: G }).grade, '7', 'an unknown ?grade= is ignored, not trusted')
eq(resolveArchiveGrade({ urlGrade: 'nonsense', grades: G }).grade, '7', 'a junk ?grade= is ignored')

// Teachers and parents are signed in and legitimately browse both grades,
// so the rule is `isLearner`, never "is signed in".
eq(resolveArchiveGrade({ isLearner: false, profileGrade: 7, grades: G }).showGradeToggle, true, 'a teacher or parent keeps the toggle')
eq(resolveArchiveGrade({ isLearner: false, profileGrade: 7, grades: G }).grade, '7', 'a non-learner is not scoped to a profile grade')

// Called with nothing at all — the shape the hub sees on its very first
// render, before the profile has loaded.
eq(resolveArchiveGrade().grade, '7', 'no arguments still yields a grade')
eq(resolveArchiveGrade().showGradeToggle, true, 'no arguments still yields a toggle decision')

console.log(`\n✓ past-paper-nav: ${passed} assertions passed`)
