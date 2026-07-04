/**
 * Unit tests for the guided past-paper navigation helpers
 * (src/components/papers/paperNav.js).
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
} from '../src/components/papers/paperNav.js'

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

console.log(`\n✓ past-paper-nav: ${passed} assertions passed`)
