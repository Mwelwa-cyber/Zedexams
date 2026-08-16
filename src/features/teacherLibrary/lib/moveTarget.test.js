#!/usr/bin/env node
/**
 * Move-to-folder rules: which dimensions a document can be re-filed along,
 * what each may be set to, and what a change invalidates.
 *
 * Run: npm run test:library-move
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  UNSORTED,
  applyMoveChange,
  buildMoveDraft,
  coordsFromDraft,
  describeDestination,
  isMoved,
  moveDimensions,
  optionsFor,
} from './moveTarget.js'
import { LIBRARY_SECTION_BY_ID, LIBRARY_TYPES } from '../../../config/library.js'

const lessonPlans = LIBRARY_SECTION_BY_ID[LIBRARY_TYPES.LESSON_PLANS]
const syllabi = LIBRARY_SECTION_BY_ID[LIBRARY_TYPES.SYLLABI]
const assessments = LIBRARY_SECTION_BY_ID[LIBRARY_TYPES.ASSESSMENTS]

const row = (library) => ({ id: 'doc-1', tool: 'lesson_plan', library })

/* ── Dimensions ──────────────────────────────────────────────── */

test('the studio is never a dimension', () => {
  // bucketIntoTree reads the top folder from the row's `tool`, so a
  // libraryType written here would be ignored — offering it would be a
  // control that does nothing.
  for (const section of [lessonPlans, syllabi, assessments]) {
    assert.ok(!moveDimensions(section).includes('libraryType'))
  }
})

test('a section without a term level is never offered one', () => {
  assert.ok(moveDimensions(lessonPlans).includes('term'))
  assert.ok(!moveDimensions(syllabi).includes('term'))
  assert.ok(moveDimensions(assessments).includes('assessmentType'))
  assert.ok(!moveDimensions(lessonPlans).includes('assessmentType'))
})

/* ── The starting draft ──────────────────────────────────────── */

test('the draft starts where the document is filed', () => {
  const draft = buildMoveDraft(
    row({ syllabus: 'CBC', gradeForm: 'Grade 4', term: 'Term 2', subject: 'Mathematics' }),
    lessonPlans,
  )
  assert.deepEqual(draft, {
    syllabus: 'CBC', gradeForm: 'Grade 4', term: 'Term 2', subject: 'Mathematics',
  })
})

test('a missing dimension starts as Unsorted, not undefined', () => {
  const draft = buildMoveDraft(row({ syllabus: 'CBC' }), lessonPlans)
  assert.equal(draft.gradeForm, UNSORTED)
  assert.equal(draft.term, UNSORTED)
})

test('a dimension the section lacks is dropped, never carried through', () => {
  // A Syllabi document holding a stale term must not silently keep it.
  const draft = buildMoveDraft(row({ syllabus: 'CBC', term: 'Term 2' }), syllabi)
  assert.ok(!('term' in draft))
})

test('the legacy CDC spelling opens as OBC', () => {
  // bucketIntoTree folds CDC→OBC on read; without the same fold here the
  // dialog would show a curriculum no option offers and write CDC back out.
  assert.equal(buildMoveDraft(row({ syllabus: 'CDC' }), lessonPlans).syllabus, 'OBC')
})

/* ── Options ─────────────────────────────────────────────────── */

test('Nursery and Reception are offered under CBC and not under OBC', () => {
  const cbc = optionsFor('gradeForm', { syllabus: 'CBC' }).map((o) => o.value)
  assert.ok(cbc.includes('Nursery'))
  assert.ok(cbc.includes('Reception'))

  const obc = optionsFor('gradeForm', { syllabus: 'OBC' }).map((o) => o.value)
  assert.ok(!obc.includes('Nursery'))
  assert.ok(!obc.includes('Reception'))
})

test('every dimension can be cleared, and Unsorted is offered last', () => {
  for (const dim of moveDimensions(assessments)) {
    const opts = optionsFor(dim, { syllabus: 'CBC', gradeForm: 'Grade 4' })
    assert.equal(opts.at(-1).value, UNSORTED, `${dim} offers Unsorted last`)
  }
})

test('the value the document holds today is always offered', () => {
  // An early-childhood document's subject is a raw syllabus key, which no
  // registry lists. Dropping it would turn "move this" into "move this and
  // lose where it was", with no way back.
  const key = 'Early Childhood Education Syllabi (3-5 Years)::3-4 Years - English Language'
  const opts = optionsFor('subject', { syllabus: 'CBC', gradeForm: 'Nursery' }, key)
  const mine = opts.find((o) => o.value === key)
  assert.ok(mine, 'the current subject survives a dimension the registry cannot describe')
  assert.equal(mine.isCurrent, true)
})

test('a current value the registry DOES list is not duplicated', () => {
  const opts = optionsFor('subject', { syllabus: 'CBC', gradeForm: 'Grade 4' }, 'Mathematics')
  assert.equal(opts.filter((o) => o.value === 'Mathematics').length, 1)
})

/* ── Cascades ────────────────────────────────────────────────── */

test('changing grade drops a subject the new grade does not have', () => {
  const draft = { syllabus: 'CBC', gradeForm: 'Grade 4', term: 'Term 2', subject: 'Integrated Science' }
  const next = applyMoveChange(draft, lessonPlans, 'gradeForm', 'Nursery')
  assert.equal(next.subject, UNSORTED, 'Grade 4 science does not survive into Nursery')
  assert.equal(next.term, 'Term 2', 'unrelated answers are kept')
})

test('changing grade KEEPS a subject the new grade also has', () => {
  const draft = { syllabus: 'CBC', gradeForm: 'Grade 4', term: 'Term 2', subject: 'Mathematics' }
  const next = applyMoveChange(draft, lessonPlans, 'gradeForm', 'Grade 5')
  assert.equal(next.subject, 'Mathematics')
})

test('an unrepresentable subject survives every change EXCEPT its own grade', () => {
  // An early-childhood subject is stored as a raw syllabus key that no registry
  // lists. Re-terming such a document must not cost the teacher that subject —
  // but moving it to a grade that does not declare it must, or the move just
  // rebuilds the same unnavigable folder one level down.
  const key = 'Early Childhood Education Syllabi (3-5 Years)::3-4 Years - English Language'
  const draft = { syllabus: 'CBC', gradeForm: 'Nursery', term: UNSORTED, subject: key }

  assert.equal(applyMoveChange(draft, lessonPlans, 'term', 'Term 2').subject, key)
  assert.equal(applyMoveChange(draft, lessonPlans, 'gradeForm', 'Grade 1').subject, UNSORTED)
})

test('changing term cascades nothing', () => {
  const draft = { syllabus: 'CBC', gradeForm: 'Grade 4', term: 'Term 1', subject: 'Mathematics' }
  assert.equal(applyMoveChange(draft, lessonPlans, 'term', 'Term 3').subject, 'Mathematics')
})

test('a cleared subject is not resurrected by a cascade', () => {
  const draft = { syllabus: 'CBC', gradeForm: 'Grade 4', term: UNSORTED, subject: UNSORTED }
  assert.equal(applyMoveChange(draft, lessonPlans, 'gradeForm', 'Grade 5').subject, UNSORTED)
})

/* ── Coords ──────────────────────────────────────────────────── */

test('coords carry the section, and a rebuilt path', () => {
  const coords = coordsFromDraft(
    { syllabus: 'CBC', gradeForm: 'Nursery', term: 'Term 1', subject: 'English Language' },
    lessonPlans,
  )
  assert.equal(coords.libraryType, LIBRARY_TYPES.LESSON_PLANS)
  assert.equal(coords.gradeForm, 'Nursery')
  assert.ok(coords.path.includes('Nursery'), 'the stored path cannot drift from the folder')
})

test('a cleared dimension is written as null, not as the empty string', () => {
  const coords = coordsFromDraft({ syllabus: 'CBC', gradeForm: UNSORTED, term: UNSORTED, subject: UNSORTED }, lessonPlans)
  assert.equal(coords.gradeForm, null)
  assert.equal(coords.term, null)
})

test('a dimension the section lacks is never written', () => {
  const coords = coordsFromDraft({ syllabus: 'CBC', gradeForm: 'Grade 4', term: 'Term 2' }, syllabi)
  assert.equal(coords.term, null)
})

/* ── Move state ──────────────────────────────────────────────── */

test('isMoved is false until something actually changes', () => {
  const doc = row({ syllabus: 'CBC', gradeForm: 'Grade 4', term: 'Term 2', subject: 'Mathematics' })
  assert.equal(isMoved(buildMoveDraft(doc, lessonPlans), doc, lessonPlans), false)
  assert.equal(isMoved({ ...buildMoveDraft(doc, lessonPlans), gradeForm: 'Grade 5' }, doc, lessonPlans), true)
})

test('clearing a dimension counts as a move', () => {
  const doc = row({ syllabus: 'CBC', gradeForm: 'Grade 4' })
  assert.equal(isMoved({ ...buildMoveDraft(doc, lessonPlans), gradeForm: UNSORTED }, doc, lessonPlans), true)
})

/* ── Destination line ────────────────────────────────────────── */

test('the destination names its Unsorted levels rather than hiding them', () => {
  const line = describeDestination({ syllabus: 'CBC', gradeForm: 'Nursery', term: UNSORTED, subject: 'English' }, lessonPlans)
  assert.equal(line, 'Lesson Plans / CBC / Nursery / Unsorted / English')
})
