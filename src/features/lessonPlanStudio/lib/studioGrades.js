/**
 * The grades the Lesson Plan Studio offers, per curriculum mode.
 *
 * These used to live inside LessonDetailsForm.jsx, where nothing could reach
 * them: a JSX component is not importable by the plain-node suite, so the one
 * list that decides what a teacher can pick was the one list no test could
 * read. That is how Nursery and Reception were added here and nowhere else, and
 * spent months filing every early-childhood lesson plan into Unsorted.
 *
 * They are a MODULE now so `studioGrades.test.js` can check them against
 * `src/config/library.js` — the folders the library actually has — and fail the
 * build when the two drift apart. See CURRICULUM_MODES below for why this file
 * declares a list at all rather than deriving one.
 *
 * Pure — no React, no Firebase.
 *
 * @typedef {{ group: string, value: string, label: string }} StudioGrade
 */

/**
 * CBC (2023). Matches GRADE_FORMS[CBC] in src/config/library.js exactly, and a
 * test holds them to that.
 *
 * NOT derived from src/config/educationLevels.js, though it agrees with it
 * today: the library's OBC list numbers its upper years Grade 10/11/12 where
 * the ladder names them Form 3/4/5, so a shared derivation would rename those
 * folders and strand every OBC document already filed under the old name.
 * Until that migration happens, the lists are separate and pinned by test.
 *
 * @type {StudioGrade[]}
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

/**
 * 2013 / previous curriculum. The data file (/syllabi/curriculum-data-2013.json)
 * stores one sheet per grade ("Grade 1" … "Grade 12"), so each entry's `value`
 * must be the literal grade — a group name like "Lower Primary" matches no
 * sheet and yields an empty subject list. Grades with no data in the 2013 file
 * (ECE, Grade 9) are intentionally omitted so the dropdown never offers a dead
 * option.
 *
 * @type {StudioGrade[]}
 */
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

/**
 * Curriculum mode → its grade list and the library curriculum it files under.
 *
 * The `syllabus` here is the SAME value LessonPlanStudio passes as
 * `classification.syllabusHint` (`mode === 'previous' ? 'OBC' : 'CBC'`). It is
 * declared beside the grades so the drift test can check each list against the
 * folders of the curriculum those grades actually file into — checking CBC
 * grades against OBC folders would prove nothing.
 */
export const CURRICULUM_MODES = [
  { mode: 'cbc',      syllabus: 'CBC', grades: CBC_GRADES },
  { mode: 'previous', syllabus: 'OBC', grades: PREVIOUS_GRADES },
]

/** The grade list for the active curriculum mode. */
export function gradeListFor(curriculumMode) {
  return curriculumMode === 'previous' ? PREVIOUS_GRADES : CBC_GRADES
}

/** Every valid grade value for a mode. */
export function gradeValuesFor(curriculumMode) {
  return new Set(gradeListFor(curriculumMode).map((g) => g.value))
}

/** Group grades by their `group` key, for <optgroup> rendering. */
export function groupedGrades(grades) {
  const map = new Map()
  for (const g of grades) {
    if (!map.has(g.group)) map.set(g.group, [])
    map.get(g.group).push(g)
  }
  return map
}
