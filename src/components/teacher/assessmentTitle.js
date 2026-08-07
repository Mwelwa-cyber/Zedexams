// What an assessment paper is CALLED — the one place a paper's name is built.
//
// Two different strings, deliberately:
//
//   • the DOCUMENT title — what the library, Recent Documents, the dashboard
//     and the download filename call this paper. Its whole job is to identify
//     one paper among a teacher's others, so it carries the SUBJECT and the
//     TERM as well as the level, type and year.
//
//   • the printed HEADER title — the line under the school name on the paper
//     itself. The subject prints on its OWN line directly beneath it (see the
//     header block in assessmentPaperLayout.js), so putting it in the title
//     would print the subject twice on every paper.
//
// Before the split there was one string doing both jobs: "GRADE 4 END OF TERM 1
// TEST - 2026" — level + type + year and nothing else. Seven papers spanning
// Integrated Science, Technology Studies and Home Economics across two terms
// all carried that identical name in the library, so a teacher could not tell
// their own papers apart.
//
// Pure module: no React, no Firebase. The studio, the title backfill and the
// phantom-paper cleanup all import it, and it is tested under plain `node`
// (scripts/test-assessment-title.mjs).

import { paperGradeLabel, normalizeAssessmentType } from './paperTaxonomy.js'
import { ASSESSMENT_TYPE_LABELS } from './assessmentStudioMeta.js'

// The separator between a title's segments. A hyphen, not an en dash: it is
// what every stored title already uses, it survives a Word/PDF round-trip on
// every machine, and it is safe in a download filename.
const SEP = ' - '

// Term numbers a Zambian school year has. Used when recognising a title that a
// previous build generated — it stamped a DEFAULT term rather than the paper's
// own, so a Term 2 paper can be carrying "TERM 1" in its title (see
// isGeneratedAssessmentTitle).
const TERM_NUMBERS = ['1', '2', '3']

/**
 * The paper's term as the paper itself states it — never a default.
 *
 * Accepts every shape a stored/authored term arrives in: 2, '2', 'Term 2',
 * 'TERM 2'. Returns '' when the paper does not say, which is what keeps a
 * termless paper from being titled "TERM 1" (Bug 2's misreported term).
 */
export function readPaperTerm(paper = {}) {
  const raw = paper?.term
  if (raw === 0 || raw === '0') return ''
  if (raw == null) return ''
  const text = String(raw).trim()
  if (!text) return ''
  const digits = text.replace(/^term\s*/i, '').trim()
  return digits
}

/** The level word a title opens with: "GRADE 4", "FORM 1", "NURSERY". */
export function readPaperLevelWord(paper = {}) {
  return paperGradeLabel(paper?.grade).toUpperCase()
}

/** The subject segment, uppercased; '' when the paper carries no subject. */
export function readPaperSubject(paper = {}) {
  return String(paper?.subject ?? '').trim().toUpperCase()
}

/**
 * The year the title ends with. Reads the paper's own fields and only falls
 * back to `fallbackYear` when the paper states nothing — a backfill passes the
 * paper's creation year here so a 2025 paper is never retitled 2026.
 */
export function readPaperYear(paper = {}, fallbackYear = new Date().getFullYear()) {
  const stated = paper?.year ?? paper?.assessmentYear
  if (stated) return String(stated)
  if (paper?.assessmentDate) {
    const parsed = new Date(paper.assessmentDate)
    if (!Number.isNaN(parsed.getTime())) return String(parsed.getFullYear())
  }
  return String(fallbackYear)
}

/**
 * How the paper's TYPE reads, with the term folded in where the type is a
 * termly one: "END OF TERM 2 TEST", "MID-TERM 1 TEST", "TERM 3 TOPIC TEST",
 * "MOCK EXAMINATION".
 *
 * Examination-category types (mock_exam / examination / final_exam) cover the
 * whole syllabus rather than one term, so they never carry a term — and each
 * keeps its OWN wording (an Examination is never titled "Mock Examination").
 *
 * `term` is passed in rather than read here so the recogniser below can ask
 * "what would this have looked like with term N?" without inventing a term for
 * the paper.
 */
export function assessmentTypePhrase({ assessmentType, term = '' } = {}) {
  const canonical = normalizeAssessmentType(assessmentType)
  // Label the paper by the value it actually carries where we have a word for
  // it (a legacy 'mock' reads "Mock Exam"), else by the canonical type.
  const label = ASSESSMENT_TYPE_LABELS[assessmentType]
    || ASSESSMENT_TYPE_LABELS[canonical]
    || 'Assessment'
  const upper = String(label).toUpperCase()
  const termBit = String(term ?? '').trim()
  if (canonical === 'mock_exam' || canonical === 'examination' || canonical === 'final_exam') {
    return upper
  }
  if (!termBit) return upper
  if (canonical === 'end_of_term') return `END OF TERM ${termBit} TEST`
  if (canonical === 'mid_term') return `MID-TERM ${termBit} TEST`
  return `TERM ${termBit} ${upper}`
}

/**
 * The title printed on the paper itself — no subject, because the header
 * prints the subject on its own line right below this one.
 *
 * "GRADE 4 END OF TERM 2 TEST - 2026"
 */
export function buildAssessmentHeaderTitle(paper = {}, { fallbackYear } = {}) {
  const phrase = assessmentTypePhrase({
    assessmentType: paper?.assessmentType,
    term: readPaperTerm(paper),
  })
  return `${readPaperLevelWord(paper)} ${phrase}${SEP}${readPaperYear(paper, fallbackYear)}`
}

/**
 * The name the paper is FILED under — level, subject, type (with its term) and
 * year, so two papers differing only in subject or term are two different names.
 *
 * "GRADE 4 INTEGRATED SCIENCE - END OF TERM 2 TEST - 2026"
 *
 * A paper with no subject falls back to the header shape, which is exactly what
 * such a paper has always been called.
 */
export function buildAssessmentDocumentTitle(paper = {}, { fallbackYear } = {}) {
  const subject = readPaperSubject(paper)
  if (!subject) return buildAssessmentHeaderTitle(paper, { fallbackYear })
  const phrase = assessmentTypePhrase({
    assessmentType: paper?.assessmentType,
    term: readPaperTerm(paper),
  })
  const year = readPaperYear(paper, fallbackYear)
  return `${readPaperLevelWord(paper)} ${subject}${SEP}${phrase}${SEP}${year}`
}

/**
 * Compare titles the way a reader would: case, dash flavour and runs of
 * whitespace are not what makes two titles different.
 */
export function normalizeTitleForCompare(title) {
  return String(title ?? '')
    // Every dash flavour (hyphen-variants U+2010–U+2015, minus sign) → hyphen.
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

/**
 * Every title THIS CODEBASE could have generated for `paper`, across builds.
 *
 * Why the set is wide: the recogniser it feeds decides whether a stored title
 * is ours to rewrite or a teacher's to leave alone, and a build that stamped
 * the wrong term is precisely the bug being repaired — a Term 2 paper is
 * carrying "END OF TERM 1 TEST". So the variants cover
 *
 *   • the current document shape (with subject) and header shape (without),
 *   • the paper's own term AND every other term number, because the term in a
 *     stored title cannot be trusted to have come from the paper,
 *   • a termless phrase, for papers saved before the term reached the title.
 */
export function generatedAssessmentTitleVariants(paper = {}, { fallbackYear } = {}) {
  const level = readPaperLevelWord(paper)
  const subject = readPaperSubject(paper)
  const year = readPaperYear(paper, fallbackYear)
  const terms = ['', readPaperTerm(paper), ...TERM_NUMBERS]
  const variants = new Set()
  for (const term of terms) {
    const phrase = assessmentTypePhrase({ assessmentType: paper?.assessmentType, term })
    variants.add(`${level} ${phrase}${SEP}${year}`)
    if (subject) variants.add(`${level} ${subject}${SEP}${phrase}${SEP}${year}`)
  }
  return [...variants]
}

/**
 * Is `title` one this codebase generated for `paper` — i.e. safe for a
 * migration to replace?
 *
 * A blank title counts as generated (the studio fills one in for the teacher).
 * Anything else must match a generated variant exactly, so a teacher's own
 * wording is never rewritten. NOTE — the studio has no "paper title" input at
 * all today, so no title in the collection was hand-typed through it; this is
 * the guard that keeps that true if one is ever added, and the reason the
 * backfill can run unattended.
 */
export function isGeneratedAssessmentTitle(title, paper = {}, { fallbackYear } = {}) {
  const candidate = normalizeTitleForCompare(title)
  if (!candidate) return true
  return generatedAssessmentTitleVariants(paper, { fallbackYear })
    .some((variant) => normalizeTitleForCompare(variant) === candidate)
}

/**
 * Did a TEACHER name this paper — i.e. is the stored title theirs rather than
 * ours to replace?
 *
 * This is the one question three surfaces were each answering differently:
 *
 *   • the backfill (planTitleBackfill) checked `titleSource === 'manual'` and
 *     THEN fell back to isGeneratedAssessmentTitle;
 *   • the library card checked only the flag, so a paper named before the flag
 *     existed had its name rebuilt — a rename the backfill would have skipped;
 *   • the builder's title bar checked only the recogniser, because the live
 *     studio form carries no flag to check.
 *
 * The precedence below is the backfill's, unchanged, because it is the one that
 * already has to be right: it decides what an unattended migration WRITES, not
 * merely what a screen shows. The two signals answer different halves —
 * `titleSource` is exact but only exists on papers saved since it was added,
 * and the recogniser covers everything older by asking whether the words could
 * have come out of our own generator.
 *
 * NOT symmetric on the flag on purpose: `titleSource: 'auto'` does not
 * short-circuit to "ours". A paper saved as auto whose fields were edited
 * afterwards can carry a title no current variant matches, and treating that as
 * ours would let the backfill rewrite it on the strength of a stale flag.
 */
export function isTeacherAuthoredTitle(paper = {}, { fallbackYear } = {}) {
  const stored = String(paper?.title ?? '').trim()
  if (!stored) return false
  if (paper?.titleSource === 'manual') return true
  return !isGeneratedAssessmentTitle(stored, paper, { fallbackYear })
}

/** The teacher's own name for this paper, or '' when the name is ours. */
export function teacherAuthoredTitle(paper = {}, { fallbackYear } = {}) {
  return isTeacherAuthoredTitle(paper, { fallbackYear })
    ? String(paper.title).trim()
    : ''
}
