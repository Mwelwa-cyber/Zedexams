/**
 * paperNav — pure navigation/derivation helpers for the guided
 * past-paper flow (Grade → Year → Subject → Paper → Quiz).
 *
 * Deliberately free of React, Firebase, and icon imports so the logic
 * can be unit-tested under plain `node` (see
 * scripts/test-past-paper-nav.test.mjs). Presentation lives in
 * paperVisuals.js; data access lives in src/utils/pastPapers.js.
 */

import { paperQuizIsAttached } from '../../../utils/pastPaperQuizStatus.js'
import {
  comparePapersBySource,
  isOfficialSource,
  paperSourceLabel,
} from '../../../config/paperSources.js'

// Sentinel used by the hub for "no filter selected".
export const ANY = 'any'

/**
 * Distinct numeric years present in a paper list, newest first.
 * Non-numeric / missing years are ignored so a malformed doc can't
 * inject an empty year card.
 */
export function deriveYears(papers) {
  const years = new Set()
  for (const p of Array.isArray(papers) ? papers : []) {
    if (typeof p?.year === 'number' && Number.isFinite(p.year)) years.add(p.year)
  }
  return [...years].sort((a, b) => b - a)
}

/** Papers matching a grade token ('7' / '12'); ANY / falsy returns all. */
export function filterByGrade(papers, grade) {
  const list = Array.isArray(papers) ? papers : []
  if (!grade || grade === ANY) return list
  return list.filter((p) => String(p.grade) === String(grade))
}

/**
 * Group the papers for one grade+year by subject, returning one entry
 * per subject (sorted by subject id for a stable card order) with the
 * matching papers sorted by paper number then title. Powers Screen 2.
 */
export function subjectsForYear(papers, grade, year) {
  const list = filterByGrade(papers, grade).filter(
    (p) => year != null && year !== ANY && Number(p.year) === Number(year),
  )
  const bySubject = new Map()
  for (const p of list) {
    const key = p.subject || 'other'
    if (!bySubject.has(key)) bySubject.set(key, [])
    bySubject.get(key).push(p)
  }
  return [...bySubject.entries()]
    .map(([subject, group]) => ({
      subject,
      // Official first, then by paper number, then the mocks — the order a
      // learner looking for "the real 2025 paper" scans in. The old sort was
      // `paperNumber || 0` then title, which put a mock ahead of the ECZ paper
      // whenever the mock happened to carry a number and the exam did not.
      papers: [...group].sort(comparePapersBySource),
    }))
    .sort((a, b) => a.subject.localeCompare(b.subject))
}


/**
 * Ordered list of sibling papers for the same grade+year (one per
 * subject when a subject has several papers, its first). Drives the
 * viewer's ← Previous / Next Subject → navigation. Ordered by subject
 * id so prev/next is deterministic.
 */
export function siblingPapers(papers, grade, year) {
  return subjectsForYear(papers, grade, year).map((s) => s.papers[0]).filter(Boolean)
}

/** Route to the public quiz runner for a paper (never changes — quiz-link contract). */
export function quizPath(paperId) {
  return `/papers/${paperId}/quiz`
}

/** Route to the paper viewer, preferring the SEO slug alias when present. */
export function viewPath(paper) {
  if (!paper?.id) return '/papers'
  return paper.slug ? `/papers/${paper.id}/${paper.slug}` : `/papers/${paper.id}`
}

/** True when a paper is an ECZ specimen (flag or title match). */
export function isSpecimen(paper) {
  return Boolean(paper?.specimen) || /specimen/i.test(paper?.title || '')
}

/**
 * Search + filter + sort a paper list. `labelOf(subjectId)` is an
 * optional resolver so the search haystack can include the friendly
 * subject label; when omitted the raw subject id is used.
 */
export function filterPapers(papers, {
  grade, subject, year, query, quizOnly, officialOnly, sort, labelOf,
} = {}) {
  const q = (query || '').trim().toLowerCase()
  const rows = (Array.isArray(papers) ? papers : []).filter((p) => {
    if (grade && grade !== ANY && String(p.grade) !== String(grade)) return false
    if (subject && subject !== ANY && p.subject !== subject) return false
    if (year && year !== ANY && Number(p.year) !== Number(year)) return false
    // The derived `isOfficial` boolean is what the Firestore query filters on;
    // here the SOURCE is re-derived rather than the stored boolean trusted, so
    // a document whose two fields disagree can never show a mock under an
    // "Official only" filter.
    if (officialOnly && !isOfficialSource(p.source)) return false
    // "Has a quiz" is the derived status, not the raw id — a paper published
    // with the Studio's Quiz step skipped can carry the id of a quiz that has
    // no questions in it yet, and this filter is a promise to the learner.
    if (quizOnly && !paperQuizIsAttached(p)) return false
    if (q) {
      const label = labelOf ? labelOf(p.subject) : p.subject
      // The source is part of the haystack because "prisca" and "ecz" are now
      // things a learner can reasonably type — they are how the archive names
      // two papers that are otherwise the same paper.
      const hay = [
        p.title, label, p.year, `grade ${p.grade || ''}`,
        p.source, paperSourceLabel(p.source), p.session,
      ].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
  const sorted = [...rows]
  if (sort === 'az') sorted.sort((a, b) => (a.title || '').localeCompare(b.title || ''))
  else if (sort === 'oldest') sorted.sort((a, b) => (a.year || 0) - (b.year || 0))
  else sorted.sort((a, b) => (b.year || 0) - (a.year || 0))
  return sorted
}

/**
 * Which grade should the archive open on, and may the visitor switch?
 *
 * The hub used to answer the first question with the literal `'7'` and
 * the second with an unconditional yes — so a learner's own profile was
 * never consulted, and a child was offered a grade picker on a child
 * surface (`docs/learner/README.md` Ground rules; LEARNER_UI_AUDIT L-14).
 *
 * The four inputs are separate on purpose:
 *
 *   - `urlGrade` outranks everything. `?grade=12` is a deep link someone
 *     followed or shared, and honouring it costs nothing: a learner who
 *     lands on one is looking at a specific paper, not browsing.
 *   - `profileGrade` is the learner's own, and only when it is a grade
 *     this archive HAS. ECZ retired Grade 9, so the archive is 7 and 12;
 *     a Grade 5 learner has no papers here and gets the default rather
 *     than an empty screen insisting it is their grade.
 *   - `isLearner` alone decides the toggle. Not "is signed in" — a
 *     teacher and a parent legitimately browse both grades, and a
 *     signed-out visitor is most of this page's traffic and has no
 *     profile to read.
 *
 * Returns the grade as the same string token `PAPER_GRADES` holds, so
 * callers never have to think about `7` vs `'7'`.
 */
export function resolveArchiveGrade({
  urlGrade, profileGrade, isLearner, grades, fallback = '7',
} = {}) {
  const known = (Array.isArray(grades) ? grades : []).map(String)
  const has = (g) => g != null && known.includes(String(g))

  let grade = fallback
  if (has(urlGrade)) grade = String(urlGrade)
  else if (isLearner && has(profileGrade)) grade = String(profileGrade)

  return { grade, showGradeToggle: !isLearner }
}
