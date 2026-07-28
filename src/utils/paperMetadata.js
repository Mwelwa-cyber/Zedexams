/**
 * The words on the paper that identify it, resolved once so every renderer
 * prints the same ones.
 *
 * ## The defect this closes
 *
 * The studio showed a teacher "Grade 4" everywhere they authored, and then the
 * printed header said "GRADE FOUR" — because `buildPaperTitle` mapped the number
 * through a word list unconditionally. Nobody chose that. A teacher searching
 * their downloads for "Grade 4 Mathematics" does not find the file, and a school
 * whose other papers say "Grade 4" now has one that does not match.
 *
 * So the style is a SETTING, `numeral` by default, and the written-number form
 * is available to schools whose house style wants it. Defaulting to what the
 * teacher typed is the rule: a renderer may format, it may not rename.
 *
 * ## Learner field labels
 *
 * "Name", "Learner's Name", "Pupil's Name", "Candidate's Name" are all correct
 * in Zambian schools depending on the level and the paper — a mock examination
 * says Candidate, a Grade 3 test says Pupil. Presets rather than free text for
 * the common four, plus a custom label, because the field also has to fit the
 * ruled line beside it in three renderers.
 */

const GRADE_WORDS = Object.freeze({
  1: 'ONE', 2: 'TWO', 3: 'THREE', 4: 'FOUR', 5: 'FIVE', 6: 'SIX',
  7: 'SEVEN', 8: 'EIGHT', 9: 'NINE', 10: 'TEN', 11: 'ELEVEN', 12: 'TWELVE',
})

export const GRADE_NUMBER_STYLES = Object.freeze([
  Object.freeze({ id: 'numeral', label: 'Numbers — “Grade 4”' }),
  Object.freeze({ id: 'word', label: 'Words — “Grade Four”' }),
])

/**
 * Numerals, because that is what the teacher typed.
 *
 * Changing this default changes the printed header of every paper in the
 * product, which is exactly why it is stated here rather than implied by a
 * lookup table three call sites deep.
 */
export const DEFAULT_GRADE_NUMBER_STYLE = 'numeral'

export function normalizeGradeNumberStyle(value) {
  const v = String(value || '').trim().toLowerCase()
  return v === 'word' ? 'word' : DEFAULT_GRADE_NUMBER_STYLE
}

/**
 * The grade as it appears in the paper title.
 *
 * Returns the bare grade token — the caller supplies "GRADE". A non-numeric
 * level (the 2013 syllabus's "Form 4", a nursery band) passes through untouched
 * in both styles, because there is no word form of something that is not a
 * number and inventing one would rename the level.
 */
export function formatGradeToken(grade, style = DEFAULT_GRADE_NUMBER_STYLE) {
  const raw = String(grade ?? '').trim()
  if (!raw) return ''
  if (normalizeGradeNumberStyle(style) !== 'word') return raw.toUpperCase()
  const n = Number(raw)
  if (Number.isInteger(n) && GRADE_WORDS[n]) return GRADE_WORDS[n]
  return raw.toUpperCase()
}

/* ── Learner fields ──────────────────────────────────────────────────────── */

export const LEARNER_NAME_LABELS = Object.freeze([
  Object.freeze({ id: 'name', label: 'Name' }),
  Object.freeze({ id: 'learner', label: "Learner's Name" }),
  Object.freeze({ id: 'pupil', label: "Pupil's Name" }),
  Object.freeze({ id: 'candidate', label: "Candidate's Name" }),
  Object.freeze({ id: 'custom', label: 'Custom…' }),
])

const NAME_LABEL_BY_ID = Object.freeze(Object.fromEntries(
  LEARNER_NAME_LABELS.filter((o) => o.id !== 'custom').map((o) => [o.id, o.label]),
))

export const DEFAULT_NAME_LABEL_STYLE = 'name'

/**
 * The label printed beside the name line.
 *
 * A custom label is trimmed and length-capped, because it has to share a printed
 * line with a rule the learner writes on: an unbounded label pushes that rule off
 * the page in the preview and wraps in Word, and the two failures look different
 * enough that nobody connects them.
 */
export function resolveNameFieldLabel(assessment = {}) {
  const style = String(assessment.nameFieldStyle || '').trim().toLowerCase()
  if (style === 'custom') {
    const custom = String(assessment.nameFieldLabel || '').trim().slice(0, 40)
    return custom || NAME_LABEL_BY_ID[DEFAULT_NAME_LABEL_STYLE]
  }
  return NAME_LABEL_BY_ID[style] || NAME_LABEL_BY_ID[DEFAULT_NAME_LABEL_STYLE]
}

/**
 * Every learner-information field, resolved.
 *
 * The visibility flags keep their existing defaults (name/date/marks on, class
 * off) so no saved paper changes shape on load.
 */
export function resolveLearnerFields(assessment = {}) {
  return {
    name: {
      show: assessment.showNameField !== false,
      label: resolveNameFieldLabel(assessment),
    },
    date: {
      show: assessment.showDateField !== false,
      label: String(assessment.dateFieldLabel || 'Date').trim().slice(0, 40) || 'Date',
      value: assessment.assessmentDate || '',
    },
    classField: {
      show: Boolean(assessment.showClassField),
      label: String(assessment.classFieldLabel || 'Class').trim().slice(0, 40) || 'Class',
      value: assessment.className || '',
    },
    marks: {
      show: assessment.showMarksField !== false,
      label: String(assessment.marksFieldLabel || 'Total marks').trim().slice(0, 40) || 'Total marks',
    },
  }
}

/* ── The metadata block ──────────────────────────────────────────────────── */

/**
 * Everything that identifies the paper, in the exact strings that get printed.
 *
 * Resolved here rather than at each renderer so "identical metadata in preview
 * and export" is a property of the data instead of a claim about four code
 * paths. A renderer that wants the subject prints `meta.subject`; there is no
 * second place to derive it from.
 */
export function buildPaperMetadata(assessment = {}) {
  const year = assessment.year
    ?? assessment.assessmentYear
    ?? (assessment.assessmentDate ? new Date(assessment.assessmentDate).getFullYear() : new Date().getFullYear())
  return {
    schoolName: String(assessment.schoolName || '').trim(),
    schoolLogoUrl: String(assessment.schoolLogoUrl || '').trim(),
    motto: String(assessment.motto || '').trim(),
    address: String(assessment.address || '').trim(),
    emisNumber: String(assessment.emisNumber || '').trim(),
    subject: String(assessment.subject || '').trim(),
    paperName: String(assessment.paperName || '').trim(),
    grade: assessment.grade ?? '',
    gradeNumberStyle: normalizeGradeNumberStyle(assessment.gradeNumberStyle),
    gradeToken: formatGradeToken(assessment.grade, assessment.gradeNumberStyle),
    term: assessment.term ?? '',
    year: Number(year) || new Date().getFullYear(),
    assessmentType: assessment.assessmentType || '',
    duration: assessment.duration ?? null,
    curriculum: assessment.curriculum || '',
    footerText: String(assessment.footerText || '').trim(),
    endOfPaperText: assessment.endOfPaperText ? String(assessment.endOfPaperText) : '',
    learnerFields: resolveLearnerFields(assessment),
  }
}
