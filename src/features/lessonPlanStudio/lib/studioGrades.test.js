#!/usr/bin/env node
/**
 * The studio's grade dropdown and the library's folder list must agree.
 *
 * This is the test that was missing when Nursery and Reception were added. They
 * went into the studio's list and nowhere else, so teachers could pick a grade
 * the library had no folder for, and every early-childhood lesson plan filed
 * into Unsorted — silently, for months, because nothing compared the two lists.
 *
 * A grade reaches its folder through THREE independent declarations:
 *
 *   1. the studio offers it          → CBC_GRADES / PREVIOUS_GRADES (studioGrades.js)
 *   2. the classifier resolves it    → resolveGradeForm (utils/libraryClassification.js)
 *   3. the library has a folder      → GRADE_FORMS (config/library.js)
 *
 * Miss (2) and the plan lands in Unsorted. Miss (3) and it lands on a grey
 * orphan tile with no subject list — half-working, which is arguably worse
 * because it looks deliberate. This test walks every grade the studio offers
 * and checks all three, so adding a grade to one list and forgetting the others
 * fails CI instead of reaching a teacher.
 *
 * Run: npm run test:studio-grades
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { CBC_GRADES, CURRICULUM_MODES, PREVIOUS_GRADES, gradeListFor, gradeValuesFor } from './studioGrades.js'
import { resolveGradeForm } from '../../../utils/libraryClassification.js'
import { getActiveGradeForms } from '../../../config/library.js'

test('every grade the studio offers resolves to a library folder', () => {
  // The whole point. Checked per curriculum, because a CBC grade proved against
  // OBC's folders would prove nothing — and it is exactly the CBC/OBC pairing
  // that makes this easy to get wrong.
  for (const { mode, syllabus, grades } of CURRICULUM_MODES) {
    const folders = new Set(getActiveGradeForms(syllabus).map((g) => g.value))
    for (const grade of grades) {
      const { gradeForm } = resolveGradeForm(grade.value, syllabus)
      assert.ok(
        gradeForm,
        `${mode}: the studio offers "${grade.value}" but resolveGradeForm returns null — `
        + 'a plan saved for it files into Unsorted. Teach it to resolveGradeForm '
        + '(src/utils/libraryClassification.js).',
      )
      assert.ok(
        folders.has(gradeForm),
        `${mode}: "${grade.value}" resolves to "${gradeForm}", which is not a ${syllabus} folder. `
        + `Add it to GRADE_FORMS[${syllabus}] (src/config/library.js).`,
      )
    }
  }
})

test('a grade resolves to the same folder under its own curriculum only', () => {
  // The CBC/OBC crux: 'Grade 10' is a real OBC year and CBC's Form 3. A grade
  // must resolve under the curriculum whose list declares it.
  assert.equal(resolveGradeForm('Grade 10', 'OBC').gradeForm, 'Grade 10')
  assert.equal(resolveGradeForm('G10', 'CBC').gradeForm, 'Form 3')
})

test('the studio never offers a grade twice', () => {
  for (const { mode, grades } of CURRICULUM_MODES) {
    const values = grades.map((g) => g.value)
    assert.equal(new Set(values).size, values.length, `${mode} has a duplicate grade`)
  }
})

test('every entry is a complete option', () => {
  // A missing label renders a blank row; a missing group drops it out of every
  // <optgroup> and off the dropdown entirely.
  for (const { mode, grades } of CURRICULUM_MODES) {
    for (const g of grades) {
      for (const key of ['value', 'label', 'group']) {
        assert.ok(g[key] && typeof g[key] === 'string', `${mode}: an entry is missing ${key}`)
      }
    }
  }
})

test('ECE is offered by CBC only', () => {
  // The 2013 syllabus declares no early-childhood years and its data file has
  // no sheet for them, so offering one would be a dead option.
  const cbc = CBC_GRADES.map((g) => g.value)
  assert.ok(cbc.includes('Nursery') && cbc.includes('Reception'))
  const previous = PREVIOUS_GRADES.map((g) => g.value)
  assert.ok(!previous.includes('Nursery') && !previous.includes('Reception'))
})

test('gradeListFor maps the studio\'s own mode strings', () => {
  // 'previous' is the studio's spelling for the 2013 curriculum; anything else
  // is CBC. A mismatch here shows a teacher the wrong curriculum's grades.
  assert.equal(gradeListFor('previous'), PREVIOUS_GRADES)
  assert.equal(gradeListFor('cbc'), CBC_GRADES)
  assert.equal(gradeListFor(undefined), CBC_GRADES)
  assert.ok(gradeValuesFor('cbc').has('Nursery'))
})
