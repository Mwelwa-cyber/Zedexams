#!/usr/bin/env node
/**
 * Early-childhood library filing.
 *
 * Nursery and Reception were added to the studio's grade dropdown long after
 * the library's folder list was written, and nothing connected the two: the
 * studio saved `grade: 'Nursery'`, resolveGradeForm matched none of its
 * patterns, and every early-childhood lesson plan filed into Unsorted. The
 * stored ladder code was worse — 'ECE_N' resolved to 'Grade 1', so the same
 * work filed into a primary folder where it looked correctly sorted.
 *
 * These are the two halves that have to agree: the classifier must RESOLVE an
 * early-childhood grade, and the library must OFFER a folder with that exact
 * name for it to land in.
 *
 * Run: npm run test:library-ece
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { classifyForLibrary, resolveGradeForm } from './libraryClassification.js'
import { LIBRARY_TYPES, getActiveGradeForms } from '../config/library.js'

test('every spelling the app produces resolves to an ECE folder', () => {
  // The studio dropdown's value (CBC_GRADES in LessonDetailsForm.jsx) and the
  // stored ladder code (storedValueForRung in config/educationLevels.js).
  for (const spelling of ['Nursery', 'nursery', 'ECE_N', 'ece_n']) {
    assert.deepEqual(resolveGradeForm(spelling, 'CBC'), { syllabus: 'CBC', gradeForm: 'Nursery' }, spelling)
  }
  for (const spelling of ['Reception', 'reception', 'ECE_R']) {
    assert.deepEqual(resolveGradeForm(spelling, 'CBC'), { syllabus: 'CBC', gradeForm: 'Reception' }, spelling)
  }
})

test('a bare ECE folds onto Nursery', () => {
  // Predates the Nursery/Reception split and spans both years; matches
  // LEGACY_LEVEL_ALIASES in canonicalEducation.js, which pitches down not up.
  assert.equal(resolveGradeForm('ECE', 'CBC').gradeForm, 'Nursery')
})

test('an ECE grade never resolves into a primary folder', () => {
  // The specific regression: 'ECE_N' → 'Grade 1' filed early-childhood work
  // into a primary folder, which is worse than Unsorted because it looks sorted.
  for (const spelling of ['Nursery', 'Reception', 'ECE_N', 'ECE_R', 'ECE']) {
    assert.notEqual(resolveGradeForm(spelling, 'CBC').gradeForm, 'Grade 1', spelling)
  }
})

test('ECE stays in CBC even when the caller hints OBC', () => {
  // The 2013 syllabus declares no early-childhood years, so there is no OBC
  // folder to pull these into.
  assert.equal(resolveGradeForm('Nursery', 'OBC').syllabus, 'CBC')
})

test('the library offers a folder for every grade the classifier resolves', () => {
  // The two halves of the bug. A grade that resolves but has no folder is
  // reachable only as an orphan tile; a folder with no grade resolving to it
  // is permanently empty. Either alone reads as "fixed" and is not.
  const folders = getActiveGradeForms('CBC').map((g) => g.value)
  for (const spelling of ['Nursery', 'Reception', 'ECE_N', 'ECE_R']) {
    const { gradeForm } = resolveGradeForm(spelling, 'CBC')
    assert.ok(folders.includes(gradeForm), `no CBC folder named ${gradeForm} (from ${spelling})`)
  }
})

test('a saved ECE lesson plan carries its grade into the path', () => {
  const coords = classifyForLibrary({
    libraryType: LIBRARY_TYPES.LESSON_PLANS,
    syllabusHint: 'CBC',
    grade: 'Nursery',
    subject: 'English Language',
  })
  assert.equal(coords.gradeForm, 'Nursery')
  assert.ok(coords.path.includes('Nursery'), coords.path)
  assert.ok(!coords.path.includes('Unsorted'), coords.path)
})

test('the primary and secondary grades are untouched', () => {
  // The ECE branch runs before the numeric patterns, so it must not shadow
  // them — and OBC's own numbering is not the ladder's, so it is left alone.
  assert.deepEqual(resolveGradeForm('Grade 4', 'CBC'), { syllabus: 'CBC', gradeForm: 'Grade 4' })
  assert.deepEqual(resolveGradeForm('G4', 'CBC'), { syllabus: 'CBC', gradeForm: 'Grade 4' })
  assert.deepEqual(resolveGradeForm('G10', 'OBC'), { syllabus: 'OBC', gradeForm: 'Grade 10' })
  assert.deepEqual(resolveGradeForm('G10', 'CBC'), { syllabus: 'CBC', gradeForm: 'Form 3' })
})

test('OBC keeps the grade folders it already files into', () => {
  // Deriving OBC from the canonical ladder would rename Grade 10/11/12 to
  // Form 3/4/5 and strand every OBC document already filed under the old name.
  const obc = getActiveGradeForms('OBC').map((g) => g.value)
  for (const g of ['Grade 10', 'Grade 11', 'Grade 12']) assert.ok(obc.includes(g), g)
})
