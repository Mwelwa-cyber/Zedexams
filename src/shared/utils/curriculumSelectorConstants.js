/**
 * curriculumSelectorConstants — pure, dependency-light helpers shared by the
 * standardized StudioCurriculumSelector across every teacher studio.
 *
 * The grade lists + grouping helpers are VERBATIM copies of the ones inside the
 * Lesson Plan Studio's LessonDetailsForm.jsx. They are copied (not refactored
 * out) on purpose: the task requires the Lesson Plan Studio to stay byte-for-byte
 * unchanged, so its section files must not be touched. Keep the two in sync if
 * the reference ever adds a grade.
 *
 * The mapping helpers (studioLabelToKbGrade / selectorPayloadToServerInputs)
 * bridge the studio-stack value shapes ("Grade 4" / raw syllabi subject keys)
 * to the shape the teacher-tool Cloud Functions already validate against
 * ("G4" / canonical subject slugs) — WITHOUT which every generation call would
 * fail the server's ALLOWED_GRADES / ALLOWED_SUBJECTS checks.
 *
 * This module imports only pure helpers (paperTaxonomy + subjectName), so it is
 * unit-testable under plain `node`.
 */

import { studioGradeToKbGrade, toKbSubjectKey } from './paperTaxonomy.js'
import { cleanSubjectName } from './subjectName.js'
import { mapLegacyTopicValue } from '../../utils/curriculumTopicCell.js'

/**
 * Grade lists per curriculum mode. Copied verbatim from
 * src/features/lessonPlanStudio/components/sections/LessonDetailsForm.jsx.
 *
 * Each entry: { value: string, label: string, group: string }
 */
export const CBC_GRADES = [
  { group: 'ECE',            value: 'Nursery',    label: 'Nursery' },
  { group: 'ECE',            value: 'Reception',  label: 'Reception' },
  { group: 'Lower Primary',  value: 'Grade 1',    label: 'Grade 1' },
  { group: 'Lower Primary',  value: 'Grade 2',    label: 'Grade 2' },
  { group: 'Lower Primary',  value: 'Grade 3',    label: 'Grade 3' },
  { group: 'Upper Primary',  value: 'Grade 4',    label: 'Grade 4' },
  { group: 'Upper Primary',  value: 'Grade 5',    label: 'Grade 5' },
  { group: 'Upper Primary',  value: 'Grade 6',    label: 'Grade 6' },
  { group: 'Secondary',      value: 'Form 1',     label: 'Form 1' },
  { group: 'Secondary',      value: 'Form 2',     label: 'Form 2' },
  { group: 'Secondary',      value: 'Form 3',     label: 'Form 3' },
  { group: 'Secondary',      value: 'Form 4',     label: 'Form 4' },
]

// 2013 / previous curriculum. The data file (/syllabi/curriculum-data-2013.json)
// stores one sheet per grade ("Grade 1" … "Grade 12"), so each entry's `value`
// must be the literal grade — a group name like "Lower Primary" matches no sheet
// and yields an empty subject list. Grades with no data in the 2013 file (ECE,
// Grade 9) are intentionally omitted so the dropdown never offers a dead option.
export const PREVIOUS_GRADES = [
  { group: 'Lower Primary',  value: 'Grade 1',    label: 'Grade 1' },
  { group: 'Lower Primary',  value: 'Grade 2',    label: 'Grade 2' },
  { group: 'Lower Primary',  value: 'Grade 3',    label: 'Grade 3' },
  { group: 'Lower Primary',  value: 'Grade 4',    label: 'Grade 4' },
  { group: 'Upper Primary',  value: 'Grade 5',    label: 'Grade 5' },
  { group: 'Upper Primary',  value: 'Grade 6',    label: 'Grade 6' },
  { group: 'Upper Primary',  value: 'Grade 7',    label: 'Grade 7' },
  { group: 'Secondary',      value: 'Grade 8',    label: 'Grade 8' },
  { group: 'Secondary',      value: 'Grade 10',   label: 'Grade 10' },
  { group: 'Secondary',      value: 'Grade 11',   label: 'Grade 11' },
  { group: 'Secondary',      value: 'Grade 12',   label: 'Grade 12' },
]

/** Return the grade list for the active curriculum mode. */
export function gradeListFor(curriculumMode) {
  return curriculumMode === 'previous' ? PREVIOUS_GRADES : CBC_GRADES
}

/** Return all valid grade values for a given mode. */
export function gradeValuesFor(curriculumMode) {
  return new Set(gradeListFor(curriculumMode).map((g) => g.value))
}

/** Group grades by their `group` key for <optgroup> rendering. */
export function groupedGrades(grades) {
  const map = new Map()
  for (const g of grades) {
    if (!map.has(g.group)) map.set(g.group, [])
    map.get(g.group).push(g)
  }
  return map
}

/** Curriculum mode → the framework code the server grounding understands. */
export function curriculumToFramework(curriculumMode) {
  return curriculumMode === 'previous' ? '2013' : '2023'
}

/**
 * Studio-stack grade LABEL ("Grade 4" / "Form 1" / "Nursery") → KB grade code
 * ("G4" / "F1" / "ECE_N"), the shape the teacher-tool Cloud Functions accept.
 *
 * This is the missing piece: paperTaxonomy.studioGradeToKbGrade only handles
 * already-coded values ('4' → 'G4', 'G4'/'F1'/'ECE_N' pass through). It does
 * NOT parse the human labels the studio-stack grade picker emits — it would
 * turn "Grade 4" into "GRADE4" and "Nursery" into "GNURSERY", both of which
 * fail the server's ALLOWED_GRADES check. Handle the label families here, then
 * fall back to studioGradeToKbGrade for anything already coded.
 *
 * @param {string} label e.g. "Grade 4", "Form 1", "Nursery", "Reception"
 * @returns {string} KB grade code, e.g. "G4", "F1", "ECE_N"
 */
export function studioLabelToKbGrade(label) {
  const raw = String(label || '').trim()
  if (!raw) return ''
  const lower = raw.toLowerCase()
  if (lower === 'nursery') return 'ECE_N'
  if (lower === 'reception') return 'ECE_R'
  const form = lower.match(/^form\s*(\d+)$/)
  if (form) return `F${form[1]}`
  const grade = lower.match(/^grade\s*(\d+)$/)
  if (grade) return `G${grade[1]}`
  // Already a coded value ('4', 'G4', 'F1', 'ECE_N') — reuse the shared helper.
  return studioGradeToKbGrade(raw)
}

/**
 * Canonical subject slug for any subject shape — raw syllabi key, strand key,
 * clean label or already-canonical slug. Used to match a seeded subject (which
 * may arrive as a slug like 'mathematics' from a legacy deep link) against the
 * loaded syllabi subject keys.
 */
export function subjectSlugOf(subjectKeyOrLabel) {
  return toKbSubjectKey(cleanSubjectName(subjectKeyOrLabel))
}

/**
 * KB grade code → studio grade LABEL (the inverse of studioLabelToKbGrade).
 * Accepts codes ('G5', 'F1', 'ECE_N'), bare numbers ('5') and already-correct
 * labels ('Grade 5', 'Form 1', 'Nursery' — returned unchanged). Used to
 * normalize deep-link / Teaching-Kit seeds, which historically carried KB
 * codes, into the label shape the selector's cascade matches against.
 *
 * @param {string} value grade in any known shape
 * @returns {string} studio grade label, or '' when unrecognisable
 */
export function kbGradeToStudioLabel(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const upper = raw.toUpperCase()
  if (upper === 'ECE_N') return 'Nursery'
  if (upper === 'ECE_R') return 'Reception'
  const g = upper.match(/^G(\d+)$/)
  if (g) return `Grade ${g[1]}`
  const f = upper.match(/^F(\d+)$/)
  if (f) return `Form ${f[1]}`
  if (/^\d+$/.test(upper)) return `Grade ${upper}`
  // Already a label ('Grade 5', 'Form 1', 'Nursery') — pass through.
  return raw
}

/**
 * Fold a Forms-syllabus KB code onto the grade code the Teaching Profile and
 * the rest of the app store (F1 → G8 … F5 → G12, the same equivalence
 * paperTaxonomy + kbLookupCandidates already use). Anything that isn't an
 * F-code passes through unchanged ('G4', 'ECE_N', '').
 */
export function foldFormCodeToGrade(code) {
  const m = String(code || '').trim().toUpperCase().match(/^F(\d+)$/)
  return m ? `G${Number(m[1]) + 7}` : String(code || '')
}

/**
 * Teaching-profile grade code → the studio grade LABEL the selector's cascade
 * matches, PER CURRICULUM: the CBC syllabi key secondary as Forms (G8 →
 * 'Form 1'), the 2013 sheets key it by grade (G8 → 'Grade 8'). Primary and the
 * ECE bands are label-identical in both. Returns '' for an unrecognisable
 * value; a label the current curriculum doesn't offer is cleared by the
 * selector's own validity guard, so callers don't need to pre-filter.
 *
 * @param {string} code e.g. 'G4', 'G8', 'ECE_N'
 * @param {'cbc'|'previous'|string} curriculumMode
 */
export function assignmentGradeToStudioLabel(code, curriculumMode) {
  const upper = String(code || '').trim().toUpperCase()
  if (!upper) return ''
  if (upper === 'ECE_N') return 'Nursery'
  if (upper === 'ECE_R') return 'Reception'
  const g = upper.match(/^G(\d+)$/)
  if (!g) return kbGradeToStudioLabel(code)
  const n = Number(g[1])
  if (n >= 8 && curriculumMode !== 'previous') return `Form ${n - 7}`
  return `Grade ${n}`
}

/**
 * Normalize a loose seed (deep link, Teaching-Kit handoff, edited record)
 * into the exact seed shape StudioCurriculumSelector's state expects.
 *
 * Accepts any mix of legacy and new shapes:
 *   curriculumMode | curriculum ('cbc'/'previous') | framework ('2023'/'2013')
 *   gradeLabel ('Grade 5') | grade ('G5' / '5' / 'Grade 5')
 *   subjectKey (raw syllabi key) | subject (canonical slug or key)
 * When no curriculum is given but other coordinates are, defaults to 'cbc'
 * so the seeded cascade is actually usable (a null mode leaves every field
 * disabled and the seed would otherwise be dead on arrival).
 *
 * @param {object|null} seedLike
 * @returns {{curriculumMode, gradeLabel, subjectKey, topic, subtopic}}
 */
export function normalizeSelectorSeed(seedLike) {
  const s = seedLike || {}
  const modeRaw = String(s.curriculumMode ?? s.curriculum ?? '').toLowerCase()
  let curriculumMode =
    modeRaw === 'previous' || modeRaw === 'cbc' ? modeRaw :
    String(s.framework || '') === '2013' ? 'previous' :
    String(s.framework || '') === '2023' ? 'cbc' : null
  const gradeLabel = kbGradeToStudioLabel(s.gradeLabel || s.grade || '')
  const subjectKey = String(s.subjectKey || s.subject || '')
  let topic = String(s.topic || '')
  let subtopic = String(s.subtopic || '')
  // Compatibility (Phase 7): an old saved selection may have captured the
  // malformed combined "topic + first sub-topic" label. Remap it to the
  // corrected split so the cascade re-seeds onto the real topic + sub-topic
  // options instead of dead-ending on a value no picker offers any more. This
  // is in-memory only — it never rewrites the stored record.
  const remap = mapLegacyTopicValue(topic, subtopic)
  if (remap.remapped) {
    topic = remap.topic
    if (!subtopic) subtopic = remap.subtopic
  }
  if (!curriculumMode && (gradeLabel || subjectKey || topic)) curriculumMode = 'cbc'
  return { curriculumMode, gradeLabel, subjectKey, topic, subtopic }
}

/**
 * Map a StudioCurriculumSelector payload to the input shape the teacher-tool
 * Cloud Functions already validate + ground against, plus the explicit
 * curriculum/framework flags that drive CBC-vs-Previous AI branching.
 *
 * The studio-stack keeps the RAW syllabi subject key in state (so topic/subtopic
 * lookups match) and the human grade LABEL (so the cascade filters correctly).
 * Both must be translated before they reach the server:
 *   - grade LABEL  → KB code via studioLabelToKbGrade   ("Grade 4" → "G4")
 *   - subject KEY  → clean name → canonical slug         ("Mathematics Syllabus
 *                    (Grades 4-6)" → "Mathematics" → "mathematics")
 *
 * @param {object} payload StudioCurriculumSelector onChange payload
 * @returns {{grade, subject, subjectLabel, topic, subtopic, curriculum, framework}}
 */
export function selectorPayloadToServerInputs(payload = {}) {
  const {
    curriculumMode = null,
    gradeLabel = '',
    subjectKey = '',
    topic = '',
    subtopic = '',
  } = payload
  const subjectLabel = cleanSubjectName(subjectKey)
  return {
    grade: studioLabelToKbGrade(gradeLabel),
    subject: toKbSubjectKey(subjectLabel),
    subjectLabel,
    topic,
    subtopic,
    curriculum: curriculumMode === 'previous' ? 'previous' : 'cbc',
    framework: curriculumToFramework(curriculumMode),
  }
}
