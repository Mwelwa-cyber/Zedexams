// Regression tests for AssessmentStudio's library-save gating
// (src/components/teacher/assessmentAutosave.js), which drives both Exam Studio
// and Test Paper Studio.
//
// The bug this guards: the auto-save-on-download used to gate on the device
// DRAFT dirty flag, which the per-keystroke device autosave clears ~1s after
// typing stops. So once a paper had a library doc, a second download saw
// "not dirty" and silently skipped writing the latest edits — the teacher's
// work never reached the library. The fix gates on LIBRARY dirtiness instead.

import assert from 'node:assert/strict'
import {
  shouldAutosaveToLibrary,
  shouldAutosaveOnDownload,
} from '../src/components/teacher/assessmentAutosave.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const baseAutosave = {
  uid: 'teacher-1',
  hasAuthoredContent: true,
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
  assert.equal(shouldAutosaveToLibrary({ ...baseAutosave, hasAuthoredContent: false }), false)
})

test('B-1: the seeded empty starter question is not content', () => {
  // The gate used to read the QUESTION COUNT, and the studio seeds one empty
  // question so the builder opens as something rather than a blank rectangle.
  // That made the count 1 before anybody had typed, so every teacher who
  // merely OPENED the studio filed a junk paper: one question, no text, one
  // mark. A seeded slot is a UI affordance; content is what someone wrote.
  //
  // Passing the old shape must not resurrect the old behaviour either — an
  // unrecognised key reads as no content, which fails closed.
  assert.equal(shouldAutosaveToLibrary({ ...baseAutosave, hasAuthoredContent: false }), false)
  const oldShape = { ...baseAutosave, questionCount: 1 }
  delete oldShape.hasAuthoredContent
  assert.equal(shouldAutosaveToLibrary(oldShape), false)
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
