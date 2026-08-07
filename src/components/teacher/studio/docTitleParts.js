// What the studio's top bar CALLS the paper it is editing, at every width.
//
// The bug this exists for: the bar rendered one string —
// "GRADE 4 INTEGRATED SCIENCE - END OF TERM 1 TEST - 2026" — and let CSS
// `text-overflow: ellipsis` shorten it. On a phone that cut off everything
// after the subject, so the title said "Grade 4 Integrated Science…" and the
// teacher could no longer tell WHICH of their Grade 4 Science papers was open.
// An ellipsis truncates by POSITION; what a title can afford to lose is decided
// by MEANING, and the two are unrelated. The type and the year sit at the end,
// so they are exactly what a right-hand ellipsis eats first.
//
// So the title is composed from the paper's own fields at each width instead,
// and degrades in a stated priority order:
//
//   1. drop the redundant trailing word "Test"   ("End of Term 1 Test" → "End of Term 1")
//   2. abbreviate the type                       ("End of Term 1" → "EOT 1")
//   3. move the facts onto a second line         (subject above, everything else below)
//
// Nothing is ever DROPPED — step 3 restates every fact on line 2 — so the
// guarantee holds at 360px: level, subject, type, term, year and save status
// are all still on screen.
//
// Pure module: no React, no Firebase, no DOM. Tested under plain `node`
// (scripts/test-doc-title.mjs).

import { paperGradeLabel, normalizeAssessmentType } from '../paperTaxonomy.js'
import { readPaperTerm, readPaperYear } from '../assessmentTitle.js'

// Three renderings of every canonical assessment type, longest first, in two
// variants: `termed` (the paper states a term) and `bare` (it does not — never
// invent one, the same rule readPaperTerm holds to).
//
// `{t}` is the term number. Which word each type may lose is declared HERE
// rather than applied as a blanket "strip the trailing Test" rule, because for
// a topic or weekly test that word is the whole meaning — "Term 1 Topic" is not
// a kind of paper, while "End of Term 1" plainly is.
const TYPE_FORMS = {
  topic_test: {
    termed: { full: 'Term {t} Topic Test', medium: 'Term {t} Topic Test', short: 'Topic T{t}' },
    bare: { full: 'Topic Test', medium: 'Topic Test', short: 'Topic' },
  },
  weekly_test: {
    termed: { full: 'Term {t} Weekly Test', medium: 'Term {t} Weekly Test', short: 'Weekly T{t}' },
    bare: { full: 'Weekly Test', medium: 'Weekly Test', short: 'Weekly' },
  },
  mid_term: {
    termed: { full: 'Mid-Term {t} Test', medium: 'Mid-Term {t}', short: 'MT {t}' },
    bare: { full: 'Mid-Term Test', medium: 'Mid-Term', short: 'MT' },
  },
  end_of_term: {
    termed: { full: 'End of Term {t} Test', medium: 'End of Term {t}', short: 'EOT {t}' },
    bare: { full: 'End-of-Term Test', medium: 'End-of-Term', short: 'EOT' },
  },
  // Examination-category papers cover the whole syllabus rather than one term,
  // so they never carry a term — the same rule assessmentTypePhrase applies.
  mock_exam: {
    termed: null,
    bare: { full: 'Mock Examination', medium: 'Mock Exam', short: 'Mock' },
  },
  examination: {
    termed: null,
    bare: { full: 'Examination', medium: 'Examination', short: 'Exam' },
  },
  final_exam: {
    termed: null,
    bare: { full: 'Final Examination', medium: 'Final Exam', short: 'Final' },
  },
}

// Words that stay lowercase mid-title ("End of Term 2 Test", not "End Of…").
const SMALL_WORDS = new Set(['of', 'and', 'the', 'a', 'an', 'in', 'on', 'for', 'to', 'with'])

function capitalizeWord(word) {
  return word
    .split('-')
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join('-')
}

/** "INTEGRATED SCIENCE" / "integrated science" → "Integrated Science". */
export function toTitleCase(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word, i) => (i > 0 && SMALL_WORDS.has(word) ? word : capitalizeWord(word)))
    .join(' ')
}

function fill(template, term) {
  return String(template).replace('{t}', term).replace(/\s{2,}/g, ' ').trim()
}

/**
 * The three renderings of this paper's type, term folded in where the type
 * takes one.
 *
 * @returns {{ full: string, medium: string, short: string }}
 */
export function typeForms(paper = {}) {
  const canonical = normalizeAssessmentType(paper?.assessmentType)
  const entry = TYPE_FORMS[canonical] || TYPE_FORMS.topic_test
  const term = entry.termed ? readPaperTerm(paper) : ''
  const forms = term ? entry.termed : entry.bare
  return {
    full: fill(forms.full, term),
    medium: fill(forms.medium, term),
    short: fill(forms.short, term),
  }
}

/**
 * Every fact the title is built from, each already in the casing it prints in.
 *
 * `customName` is a title the TEACHER chose. When present it replaces the
 * derived lead — but never the facts, which still print beside/below it, so a
 * paper named "Revision" is still identifiably the Grade 4 Science end-of-term
 * one.
 */
export function docTitleFacts(paper = {}, { status = '', fallbackYear } = {}) {
  const stored = String(paper?.title ?? '').trim()
  // A title the studio generated is not a name the teacher chose — the studio
  // fills one in for them, and rebuilding it from the fields is the whole point
  // of this module. Only an explicitly manual title counts as custom.
  const customName = paper?.titleSource === 'manual' && stored ? stored : ''
  return {
    level: paperGradeLabel(paper?.grade),
    subject: toTitleCase(paper?.subject),
    paperName: toTitleCase(paper?.paperName),
    type: typeForms(paper),
    year: readPaperYear(paper, fallbackYear),
    status: String(status || '').trim(),
    customName,
  }
}

function joinDot(parts) {
  return parts.filter(Boolean).join(' · ')
}

/**
 * The title at every width, from one set of facts.
 *
 * @returns {{
 *   facts: object,
 *   wide: string,          // "Grade 4 Integrated Science — End of Term 1 Test · 2026"
 *   medium: string,        // "Grade 4 Integrated Science — EOT 1 · 2026"
 *   narrow: { line1: string, line2: string },
 *   full: string,          // the longest form, for the details sheet + title attr
 * }}
 */
export function buildDocTitle(paper = {}, { status = '', fallbackYear } = {}) {
  const facts = docTitleFacts(paper, { status, fallbackYear })
  const { level, subject, paperName, type, year, customName } = facts

  // The lead — what the title opens with. A custom name owns it outright.
  const derivedLead = [level, subject].filter(Boolean).join(' ')
  const lead = customName || derivedLead

  const wide = joinDot([
    [lead, type.full].filter(Boolean).join(lead ? ' — ' : ''),
    paperName,
    year,
  ])
  const medium = joinDot([
    [lead, type.short].filter(Boolean).join(lead ? ' — ' : ''),
    year,
  ])

  // Narrow: line 1 is the one word a teacher scans for (the subject, or their
  // own name for the paper); line 2 restates every remaining fact, so nothing
  // the wide form said is lost — it is only relocated.
  const line1 = customName || subject || level || type.medium
  const line2 = joinDot([
    customName ? derivedLead : (subject ? level : ''),
    type.medium,
    paperName,
    year,
    facts.status,
  ])

  return {
    facts,
    wide,
    medium,
    narrow: { line1, line2 },
    full: joinDot([
      [derivedLead, type.full].filter(Boolean).join(derivedLead ? ' — ' : ''),
      paperName,
      year,
    ]),
  }
}

/**
 * The studio's live FORM, as a paper this module can read.
 *
 * The two shapes state "the teacher named this themselves" differently, and
 * translating between them is a real trap:
 *
 *   • a SAVED paper carries `titleSource: 'manual' | 'auto'` (stamped at save
 *     time in AssessmentStudio's persist payload);
 *   • the live FORM has no such field — `form.title` is EMPTY unless a human
 *     named the paper. mapAssessmentToForm deliberately drops a generated
 *     title on load precisely so that stays true.
 *
 * So a caller that hands the form's *displayed* title straight in (the studio
 * fills one in for the teacher) makes every paper look manually named, and one
 * that hands the raw form in makes a manually-named paper look generated —
 * losing the name the teacher chose. Convert here, once.
 */
export function paperFromStudioForm(form = {}) {
  const named = String(form?.title ?? '').trim()
  return { ...form, title: named, titleSource: named ? 'manual' : 'auto' }
}

/** The rendering for a viewport tier: 'wide' | 'medium' | 'narrow'. */
export function resolveDocTitle(paper, tier, options) {
  const built = buildDocTitle(paper, options)
  if (tier === 'narrow') return built.narrow
  if (tier === 'medium') return { line1: built.medium, line2: '' }
  return { line1: built.wide, line2: '' }
}
