// Regression tests for the Assessment Paper Studio's library-save gating
// (src/features/assessmentStudio/lib/assessmentAutosave.js) — every assessment type, test
// and examination alike, is authored through the one studio.
//
// Two bugs are pinned here.
//
// 1. The auto-save-on-download used to gate on the device DRAFT dirty flag,
//    which the per-keystroke device autosave clears ~1s after typing stops. So
//    once a paper had a library doc, a second download saw "not dirty" and
//    silently skipped writing the latest edits — the teacher's work never
//    reached the library. The fix gates on LIBRARY dirtiness instead.
//
// 2. PHANTOM PAPERS: loading /teacher/assessment-papers/new and doing nothing
//    filed a paper holding one blank question, every time. Two independent
//    causes, both covered below — the studio decided "the teacher has edited
//    this" from a content heuristic its own School-Profile seeding defeated
//    (isUntouchedPaper), and the gate counted the blank starter question as
//    content (authoredQuestionCount).

import assert from 'node:assert/strict'
import {
  shouldAutosaveToLibrary,
  shouldAutosaveOnDownload,
  paperSignature,
  isUntouchedPaper,
} from '../src/features/assessmentStudio/lib/assessmentAutosave.js'
import {
  countAuthoredQuestions,
  createStandaloneSection,
  createPassageSection,
  emptyQuestion,
} from '../src/utils/quizSections.js'
import { applySchoolProfileDefaults } from '../src/utils/schoolProfile.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const baseAutosave = {
  uid: 'teacher-1',
  authoredQuestionCount: 3,
  libraryDirty: true,
  saving: false,
  exporting: false,
  editLoading: false,
  importing: false,
  generating: false,
}

console.log('shouldAutosaveToLibrary')

test('fires for a paper with content and unsaved library changes', () => {
  assert.equal(shouldAutosaveToLibrary(baseAutosave), true)
})

test('does not fire without a signed-in user', () => {
  assert.equal(shouldAutosaveToLibrary({ ...baseAutosave, uid: '' }), false)
})

test('does not fire when nothing changed since the last library write', () => {
  assert.equal(shouldAutosaveToLibrary({ ...baseAutosave, libraryDirty: false }), false)
})

test('does not fire on an empty (no-question) paper', () => {
  assert.equal(shouldAutosaveToLibrary({ ...baseAutosave, authoredQuestionCount: 0 }), false)
})

test('THE PHANTOM: a paper whose only question is the blank starter is never filed', () => {
  // The raw question count is 1 here — countAuthoredQuestions is what the gate
  // reads, and a blank starter question does not count as content. Passing the
  // raw count is what filed a junk paper on every visit to /new.
  const sections = [createStandaloneSection()]
  assert.equal(countAuthoredQuestions(sections), 0)
  assert.equal(
    shouldAutosaveToLibrary({
      ...baseAutosave,
      authoredQuestionCount: countAuthoredQuestions(sections),
      // Even with the dirty flag somehow set, the paper must not be filed.
      libraryDirty: true,
    }),
    false,
  )
})

test('fires as soon as one question has real content', () => {
  const sections = [
    createStandaloneSection({ text: '<p>Name two mammals.</p>' }),
    createStandaloneSection(),
  ]
  assert.equal(countAuthoredQuestions(sections), 1)
  assert.equal(
    shouldAutosaveToLibrary({ ...baseAutosave, authoredQuestionCount: countAuthoredQuestions(sections) }),
    true,
  )
})

console.log('countAuthoredQuestions')

test('counts written passage sub-questions and ignores blank ones', () => {
  const sections = [
    createPassageSection({
      questions: [
        emptyQuestion({ text: '<p>Who narrates the story?</p>' }),
        emptyQuestion(),
      ],
    }),
    createStandaloneSection(),
  ]
  assert.equal(countAuthoredQuestions(sections), 1)
})

test('a page break is not a question', () => {
  assert.equal(countAuthoredQuestions([{ kind: 'pagebreak', id: 'pb-1' }]), 0)
})

/*
 * Bug 1's root cause: "has the teacher touched this paper?" was answered from
 * paper CONTENT ("one empty starter question AND no title AND no school name"),
 * and the studio's own School-Profile seeding writes a school name onto an
 * untouched paper. Every teacher with a saved school name therefore had an
 * apparently-edited paper the moment /new finished loading, and the autosave
 * filed it. The answer is now identity against the baseline the machine
 * established, which the seeding re-arms.
 */
console.log('isUntouchedPaper')

const blankPaper = () => ({
  form: { title: '', subject: 'Integrated Science', grade: '4', term: '1', schoolName: '' },
  sections: [createStandaloneSection()],
  parts: [],
})

test('an untouched paper matches its own baseline', () => {
  const paper = blankPaper()
  assert.equal(isUntouchedPaper(paper, paperSignature(paper)), true)
})

test('THE BUG: School-Profile branding is not an edit once the baseline is re-armed', () => {
  const paper = blankPaper()
  const seeded = {
    ...paper,
    form: applySchoolProfileDefaults(paper.form, {
      schoolName: 'Kabulonga Primary School',
      defaultDuration: 90,
      defaultCoverInstructions: 'Answer ALL questions.',
    }),
  }
  // The old content heuristic read this as edited — a school name is present.
  assert.equal(Boolean(seeded.form.schoolName.trim()), true)
  // Re-armed baseline (what the seeding effect does) → still untouched.
  assert.equal(isUntouchedPaper(seeded, paperSignature(seeded)), true)
  // And it is genuinely a different paper from the pre-seeding one, so the
  // re-arm is doing real work rather than the signatures happening to agree.
  assert.notEqual(paperSignature(seeded), paperSignature(paper))
})

test('typing into a field makes the paper touched', () => {
  const paper = blankPaper()
  const baseline = paperSignature(paper)
  const edited = { ...paper, form: { ...paper.form, schoolName: 'Typed by the teacher' } }
  assert.equal(isUntouchedPaper(edited, baseline), false)
})

test('adding a question makes the paper touched', () => {
  const paper = blankPaper()
  const baseline = paperSignature(paper)
  const edited = { ...paper, sections: [...paper.sections, createStandaloneSection()] }
  assert.equal(isUntouchedPaper(edited, baseline), false)
})

test('changing a setting makes the paper touched', () => {
  const paper = blankPaper()
  const baseline = paperSignature(paper)
  const edited = { ...paper, form: { ...paper.form, term: '2' } }
  assert.equal(isUntouchedPaper(edited, baseline), false)
})

test('key ORDER is not an edit — the same values in a different shape agree', () => {
  const paper = blankPaper()
  const reordered = {
    ...paper,
    form: { schoolName: '', term: '1', grade: '4', subject: 'Integrated Science', title: '' },
  }
  assert.equal(isUntouchedPaper(reordered, paperSignature(paper)), true)
})

test('with no baseline armed, nothing is assumed untouched', () => {
  // Fail towards "the teacher may have edited this" rather than towards
  // silently dropping their work.
  assert.equal(isUntouchedPaper(blankPaper(), null), false)
})

test('yields to an explicit save / export / import / generation', () => {
  for (const flag of ['saving', 'exporting', 'importing', 'generating', 'editLoading']) {
    assert.equal(
      shouldAutosaveToLibrary({ ...baseAutosave, [flag]: true }),
      false,
      `expected no autosave while ${flag} is true`,
    )
  }
})

console.log('shouldAutosaveOnDownload')

test('THE BUG: an already-filed paper with library edits still saves on download', () => {
  // Pre-fix this used the draft-dirty flag, which the device autosave had
  // already cleared → false → the edit was lost from the library.
  assert.equal(
    shouldAutosaveOnDownload({ errorCount: 0, libraryDirty: true, hasLibraryDoc: true }),
    true,
  )
})

test('a never-saved paper always saves on download', () => {
  assert.equal(
    shouldAutosaveOnDownload({ errorCount: 0, libraryDirty: false, hasLibraryDoc: false }),
    true,
  )
})

test('a clean, already-filed paper does not re-save', () => {
  assert.equal(
    shouldAutosaveOnDownload({ errorCount: 0, libraryDirty: false, hasLibraryDoc: true }),
    false,
  )
})

test('a paper with validation errors is not filed on download', () => {
  assert.equal(
    shouldAutosaveOnDownload({ errorCount: 2, libraryDirty: true, hasLibraryDoc: false }),
    false,
  )
})

console.log(`\n${passed} assertions passed.`)
