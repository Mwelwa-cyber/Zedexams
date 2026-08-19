// The paper's name as a TEACHER READS it — on the library card and in the
// builder's document title bar.
//
// One of three names a paper has, and the only one written for a screen:
//
//   • assessmentTitle.buildAssessmentDocumentTitle — the FILED name. Uppercase,
//     hyphen-separated, safe in a download filename. It is what the paper is
//     stored as.
//   • assessmentTitle.buildAssessmentHeaderTitle   — the name PRINTED on the
//     paper, which omits the subject because the header prints it below.
//   • this module                                  — the READ name, in one line
//     for a card and in three width-dependent forms for the bar.
//
// The card and the bar used to derive this separately, and disagreed about
// whose name a stored title was — the card asked `titleSource === 'manual'`,
// the bar asked isGeneratedAssessmentTitle. Both were half of the decision
// `planTitleBackfill` already had to make correctly, so they now share it:
// assessmentTitle.isTeacherAuthoredTitle. See the note there for why the
// precedence is the backfill's rather than either renderer's.
//
// Two rules make this more than formatting:
//
//   1. **Never trust the stored title string.** One live paper's stored title
//      says "End of Term 1" while its `term` field is 2. The type + term shown
//      here are always derived from `assessmentType` + `term` (via
//      readPaperTerm, which returns '' rather than defaulting), so a stale
//      generated title cannot misreport the paper. A title a HUMAN chose is
//      still theirs — isTeacherAuthoredTitle decides which is which, and it is
//      the same call the unattended title backfill makes before it writes.
//
//   2. **Degradation is by priority, never by ellipsis.** A CSS ellipsis on
//      "GRADE 4 INTEGRATED SCIENCE - END OF TERM 1 TEST - 2026" eats the type
//      and the year — the two facts that say which paper this is. So the narrow
//      form drops the redundant word "Test", then abbreviates the type, then
//      moves facts onto a second line. Every distinguishing fact survives at
//      360px.
//
// Pure module: no React, no DOM, no Firebase. Tested under plain `node`
// (scripts/test-doc-title-model.mjs).

import { paperGradeLabel, normalizeAssessmentType } from '../../../shared/utils/paperTaxonomy.js'
import { joinDash, joinDot } from '../../../utils/responsiveTitle.js'
import {
  assessmentTypePhrase, readPaperTerm, readPaperYear, teacherAuthoredTitle,
} from './assessmentTitle.js'

// Words that stay lowercase inside a title — never as the first word. Without
// this "END OF TERM 2 TEST" title-cases to "End Of Term 2 Test", which is not
// how a Zambian paper is written.
const MINOR_WORDS = new Set(['of', 'the', 'and', 'a', 'an', 'in', 'for', 'to'])

/**
 * Title-case one UPPERCASE phrase, hyphenated compounds included
 * ("MID-TERM" → "Mid-Term") and numbers left alone.
 */
export function titleCasePhrase(phrase) {
  const words = String(phrase ?? '').trim().split(/\s+/).filter(Boolean)
  return words
    .map((word, index) => {
      const lower = word.toLowerCase()
      if (index > 0 && MINOR_WORDS.has(lower)) return lower
      // Capitalise each hyphen-separated part so MID-TERM reads Mid-Term.
      return lower
        .split('-')
        .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
        .join('-')
    })
    .join(' ')
}

/**
 * The paper's type with its term folded in, as a reader would write it:
 * "End of Term 2 Test", "Mid-Term 1 Test", "Term 3 Topic Test",
 * "Mock Examination".
 *
 * Delegates the RULES to assessmentTypePhrase — which term-bearing types carry
 * a term, which examination types never do — and only changes the casing. A
 * test asserts the two stay identical once uppercased, so this cannot drift
 * into a second opinion about what a paper is called.
 */
export function paperTypePhrase(paper = {}) {
  return titleCasePhrase(assessmentTypePhrase({
    assessmentType: paper?.assessmentType,
    term: readPaperTerm(paper),
  }))
}

/**
 * The same phrase without the trailing word "Test" — used where the context
 * already says it is a paper ("Grade 4 · End of Term 1 · 2026"). "Examination"
 * is never trimmed: it is the noun, not a redundant suffix.
 */
export function paperTypePhraseShortWords(paper = {}) {
  return paperTypePhrase(paper).replace(/\s+Test$/i, '')
}

// The abbreviated type used by the medium form, keyed by canonical type. Kept
// as a declared table rather than a truncation rule so a teacher never meets an
// abbreviation nobody chose.
const SHORT_TYPE = {
  topic_test: (term) => (term ? `Topic T${term}` : 'Topic Test'),
  weekly_test: (term) => (term ? `Weekly T${term}` : 'Weekly Test'),
  mid_term: (term) => (term ? `Mid-Term ${term}` : 'Mid-Term'),
  end_of_term: (term) => (term ? `EOT ${term}` : 'EOT'),
  mock_exam: () => 'Mock Exam',
  examination: () => 'Exam',
  final_exam: () => 'Final Exam',
}

/** The abbreviated type + term for the medium-width form ("EOT 1"). */
export function paperTypeAbbrev(paper = {}) {
  const canonical = normalizeAssessmentType(paper?.assessmentType)
  // hasOwnProperty, not `SHORT_TYPE[canonical] ||`: a bare lookup finds
  // Object.prototype's members too, so 'constructor' resolved to `Object` (and
  // returned a String OBJECT where every caller wants a string) and
  // '__proto__' resolved to a non-function and threw. normalizeAssessmentType
  // now refuses both, so this is the second lock rather than the only one --
  // but this is the line that turns a bad stored value into a crash, so it is
  // the line that should refuse it. (CodeQL #77.)
  const build = Object.prototype.hasOwnProperty.call(SHORT_TYPE, canonical)
    ? SHORT_TYPE[canonical]
    : SHORT_TYPE.topic_test
  return build(readPaperTerm(paper))
}

/**
 * How a stored subject should READ.
 *
 * Left exactly as stored whenever the author cased it themselves — a subject
 * containing any lowercase letter is a deliberate spelling ("Integrated
 * Science", "iGCSE Mathematics") and re-casing it can only damage it. Only a
 * subject stored in full capitals is re-cased, because "INTEGRATED SCIENCE"
 * shouted in the middle of a sentence is a rendering accident, not a choice.
 *
 * Short all-caps words survive that pass: ICT, PE and R.E are acronyms, and
 * blanket title-casing turns them into "Ict", "Pe" and "R.e" — which is what
 * the library did before this module owned the rule.
 */
export function readableSubject(subject) {
  const text = String(subject ?? '').trim()
  if (!text) return ''
  if (/[a-z]/.test(text)) return text
  return text
    .split(/\s+/)
    .map((word) => {
      const letters = word.replace(/[^A-Z]/g, '')
      // 3 letters or fewer with no lowercase anywhere: an acronym, kept as-is.
      if (letters.length <= 3) return word
      return titleCasePhrase(word)
    })
    .join(' ')
}

/**
 * A teacher-authored name for this paper, or '' when the name is ours — the
 * one decision, shared with the title backfill (see assessmentTitle.js).
 */
export function paperCustomName(paper = {}, { fallbackYear } = {}) {
  return teacherAuthoredTitle(paper, { fallbackYear })
}

/**
 * Everything the on-screen names are built from, derived once.
 *
 * @param {object} paper  a stored assessment doc OR the studio's live `form`
 *                        — both carry grade / subject / assessmentType / term /
 *                        year, which is the whole input here.
 */
export function paperDisplayFacts(paper = {}, { fallbackYear } = {}) {
  const level = paperGradeLabel(paper?.grade)
  const subject = readableSubject(paper?.subject)
  return {
    level,
    subject,
    // Grade + subject, which is how a teacher refers to the class this is for.
    levelSubject: [level, subject].filter(Boolean).join(' '),
    type: paperTypePhrase(paper),
    typeNoTest: paperTypePhraseShortWords(paper),
    typeAbbrev: paperTypeAbbrev(paper),
    term: readPaperTerm(paper),
    year: readPaperYear(paper, fallbackYear),
    paperName: String(paper?.paperName ?? '').trim(),
    customName: paperCustomName(paper, { fallbackYear }),
  }
}

/**
 * The library card's one-line name.
 *
 * "Grade 4 Integrated Science — End of Term 2 Test"
 *
 * Always carries the SUBJECT, and always the term the paper's own `term` field
 * states — the two facts whose absence let seven different Grade 4 papers read
 * as one name, and whose staleness in a stored title let a Term 2 paper call
 * itself Term 1.
 *
 * `fallbackLabel` names the kind of thing this is for a paper that carries
 * neither a level nor a subject nor a name — the only case with nothing to
 * build from.
 */
export function paperCardTitle(paper = {}, { fallbackYear, fallbackLabel = 'assessment paper' } = {}) {
  const f = paperDisplayFacts(paper, { fallbackYear })
  if (f.customName) return f.customName
  const lead = f.levelSubject
  if (lead) return `${lead} — ${f.type}`
  return String(paper?.title ?? '').trim() || `Untitled ${String(fallbackLabel).toLowerCase()}`
}

// Width thresholds for the document title bar. These are CONTAINER widths, not
// viewport widths — the bar's back button, status chip and Save take room the
// viewport says nothing about, so a 760px phone-landscape viewport leaves the
// title about 510px. The numbers are the rendered width of the string each mode
// produces (measured in Chromium at the studio's type sizes) plus headroom:
// the wide form is ~400px, the medium form ~310px.
export const DOC_TITLE_WIDE = 430
export const DOC_TITLE_MEDIUM = 330

/**
 * The document title for a given available width, composed from structure.
 *
 * Returns `{ mode, line1, line2 }`:
 *   • wide   — "Grade 4 Integrated Science — End of Term 1 Test · 2026"
 *   • medium — "Grade 4 Integrated Science — EOT 1 · 2026"   (drops "Test",
 *              abbreviates the type; grade, subject, term and year all survive)
 *   • narrow — line1 "Integrated Science"
 *              line2 "Grade 4 · End of Term 1 · 2026 · Draft"
 *
 * `status` is the one word the bar's chip would show. It rides on line 2 in the
 * narrow form (where the chip is hidden) so the state is never the fact that
 * gets dropped.
 */
export function composeDocTitle(paper = {}, { width = DOC_TITLE_WIDE, status = '', fallbackYear } = {}) {
  const f = paperDisplayFacts(paper, { fallbackYear })
  const head = f.customName || f.levelSubject || f.level || 'Untitled paper'

  if (width >= DOC_TITLE_WIDE) {
    return {
      mode: 'wide',
      line1: joinDot([joinDash(head, f.type), f.year]),
      line2: '',
      facts: f,
    }
  }

  if (width >= DOC_TITLE_MEDIUM) {
    return {
      mode: 'medium',
      line1: joinDot([joinDash(head, f.typeAbbrev), f.year]),
      line2: '',
      facts: f,
    }
  }

  // Narrow: the subject (or the teacher's own name) leads, because it is what
  // tells two open papers apart at a glance; everything else moves to line 2.
  const line1 = f.customName || f.subject || f.level || 'Untitled paper'
  const line2Parts = [
    // Only repeat the level on line 2 when line 1 didn't already carry it.
    f.customName ? f.levelSubject : f.level,
    f.typeNoTest,
    f.year,
    status,
  ]
  return { mode: 'narrow', line1, line2: joinDot(line2Parts), facts: f }
}

// joinDash / joinDot moved to src/utils/responsiveTitle.js when the past-paper
// archive needed the same drop-a-whole-fact composition. The separators are
// the shared part; the PRIORITY ORDER above is not, and stays here.
