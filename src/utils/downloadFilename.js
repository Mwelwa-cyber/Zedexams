/**
 * Human-readable download filenames.
 *
 * Historically every studio built its own slug — e.g.
 * `g5_mathematics_fractions_worksheet_2026-06-14.docx`. Teachers downloading
 * those couldn't tell at a glance what a file was once it left the app and
 * landed in their Downloads folder. This helper produces names that read like
 * the thing itself: "Grade 4 Mathematics Lesson Plan.docx",
 * "Grade 4 Integrated Science Notes.docx".
 *
 * Grade/subject codes are resolved to their proper labels via the same
 * authoritative lists the studio dropdowns use (TEACHER_GRADES /
 * TEACHER_SUBJECTS), so "G4" → "Grade 4" and "mathematics" → "Mathematics".
 */

import { TEACHER_GRADES, TEACHER_SUBJECTS } from '../config/teacherTaxonomy.js'

const GRADE_LABELS = Object.fromEntries(
  TEACHER_GRADES.filter((g) => g.value).map((g) => [g.value, g.label]),
)
const SUBJECT_LABELS = Object.fromEntries(
  TEACHER_SUBJECTS.filter((s) => s.value).map((s) => [s.value, s.label]),
)

/** Title-case a free-text string, collapsing separators to single spaces. */
function titleCase(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b([a-z])/g, (_m, c) => c.toUpperCase())
}

/**
 * "G4" / "4" / "grade 4" → "Grade 4". Dual names ("Grade 8 / Form 1") and age
 * bands ("Nursery (3–4 yrs)") are trimmed to their primary form so the
 * filename stays clean and filesystem-legal.
 */
export function gradeLabel(grade) {
  const raw = String(grade ?? '').trim()
  if (!raw) return ''
  let label = GRADE_LABELS[raw] || GRADE_LABELS[raw.toUpperCase()]
  if (!label) {
    if (/grade/i.test(raw)) label = titleCase(raw)
    else {
      const digits = raw.match(/\d+/)
      label = digits ? `Grade ${digits[0]}` : titleCase(raw)
    }
  }
  return label.split('/')[0].replace(/\s*\([^)]*\)/g, '').trim()
}

/** "mathematics" → "Mathematics"; "science" → "Integrated Science". */
export function subjectLabel(subject) {
  const raw = String(subject ?? '').trim()
  if (!raw) return ''
  return SUBJECT_LABELS[raw] || SUBJECT_LABELS[raw.toLowerCase()] || titleCase(raw)
}

/** Strip characters that are illegal in filenames, keeping spaces/()-. */
function sanitize(name) {
  return String(name || '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/(\s*-\s*)+/g, ' - ')
    .replace(/^[\s-]+|[\s-]+$/g, '')
    .slice(0, 120)
    .trim()
}

/**
 * Build a human-readable download filename.
 *
 *   buildDownloadName({ docType: 'Lesson Plan', grade: 'G4', subject: 'mathematics' })
 *     → "Grade 4 Mathematics Lesson Plan.docx"
 *   buildDownloadName({ docType: 'Notes', grade: 'G4', subject: 'science', topic: 'Plants' })
 *     → "Grade 4 Integrated Science Notes - Plants.docx"
 *   buildDownloadName({ docType: 'Worksheet', grade: 'G4', subject: 'maths', variant: 'Answer Key' })
 *     → "Grade 4 Mathematics Worksheet (Answer Key).docx"
 *
 * @param {object} opts
 * @param {string} opts.docType  Human label, e.g. "Lesson Plan", "Notes".
 * @param {string} [opts.grade]
 * @param {string} [opts.subject]
 * @param {string} [opts.topic]  Appended after a " - " when present.
 * @param {string|number} [opts.term]
 * @param {string|number} [opts.year]
 * @param {string|number} [opts.week]
 * @param {string} [opts.variant]  Trailing "(…)" qualifier, e.g. "Answer Key".
 * @param {string} [opts.extra]    Any other detail to append (e.g. class name).
 * @param {string} [opts.ext]      File extension without the dot. Default "docx".
 */
export function buildDownloadName({
  docType,
  grade,
  subject,
  topic,
  term,
  year,
  week,
  variant,
  extra,
  ext = 'docx',
} = {}) {
  const head = [gradeLabel(grade), subjectLabel(subject), docType]
    .filter(Boolean)
    .join(' ')

  const detailParts = []
  const topicLabel = titleCase(topic)
  if (topicLabel && !head.toLowerCase().includes(topicLabel.toLowerCase())) {
    detailParts.push(topicLabel)
  }
  const extraLabel = titleCase(extra)
  if (extraLabel && !head.toLowerCase().includes(extraLabel.toLowerCase())) {
    detailParts.push(extraLabel)
  }
  if (term != null && term !== '') detailParts.push(`Term ${term}`)
  if (week != null && week !== '') detailParts.push(`Week ${week}`)
  if (year != null && year !== '') detailParts.push(String(year))

  let name = head || titleCase(docType) || 'Document'
  if (detailParts.length) name += ` - ${detailParts.join(' ')}`
  if (variant) name += ` (${variant})`

  const safe = sanitize(name) || 'Document'
  return `${safe}.${ext}`
}

/**
 * Filename for an assessment paper, which carries a free-text title.
 *
 * Auto-generated titles already lead with "Grade N Subject …", so they read
 * perfectly as-is. A custom title like "My Test Paper" carries no grade/subject
 * context, so we prepend it — keeping the title as the detail — so the download
 * still says what it is.
 *
 * @param {object} opts
 * @param {string} [opts.title]
 * @param {string} [opts.grade]
 * @param {string} [opts.subject]
 * @param {string} [opts.variant]  e.g. "Marking Key", "Answer Sheet".
 * @param {string} [opts.ext]
 */
export function buildAssessmentName({ title, grade, subject, variant, ext = 'docx' }) {
  const trimmed = String(title || '').trim()
  if (!trimmed) {
    return buildDownloadName({ docType: 'Assessment', grade, subject, variant, ext })
  }
  const g = gradeLabel(grade)
  // Title already carries the grade context (or there's no grade to add) → use
  // it directly. Otherwise lead with grade/subject and keep the title as detail.
  if (!g || trimmed.toLowerCase().includes(g.toLowerCase())) {
    return buildDownloadName({ docType: trimmed, variant, ext })
  }
  return buildDownloadName({ grade, subject, topic: trimmed, variant, ext })
}
