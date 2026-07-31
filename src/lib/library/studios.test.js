#!/usr/bin/env node
/**
 * Studio registry invariants + the classification predicate.
 *
 * Run: npm run test:library-studios
 */

import assert from 'node:assert/strict'
import { LIBRARY_SECTIONS, LIBRARY_TYPES } from '../../config/library.js'
import {
  LIBRARY_DIMENSIONS,
  STUDIOS,
  STUDIO_BY_ID,
  computeClassificationState,
  creatableStudios,
  getStudio,
  missingRequiredDimensions,
  requireStudio,
} from './studios.js'

let failures = 0
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`) } catch (err) {
    failures++
    console.error(`  ✗ ${name}\n    ${err.message}`)
  }
}

console.log('\nlibrary/studios')

test('there is one entry per library section, in the same order', () => {
  assert.equal(STUDIOS.length, LIBRARY_SECTIONS.length)
  assert.deepEqual(STUDIOS.map((s) => s.id), LIBRARY_SECTIONS.map((s) => s.id))
  assert.equal(STUDIOS.length, 12, 'all twelve studios are registered')
})

test('ids, labels and create routes come from LIBRARY_SECTIONS', () => {
  for (const studio of STUDIOS) {
    const section = LIBRARY_SECTIONS.find((s) => s.id === studio.id)
    assert.equal(studio.label, section.label)
    assert.equal(studio.createRoute, section.createTo || null)
  }
})

test('requiredDimensions ⊆ hierarchy, for every studio', () => {
  for (const studio of STUDIOS) {
    for (const dim of studio.requiredDimensions) {
      assert.ok(
        studio.hierarchy.includes(dim),
        `${studio.id}: required "${dim}" is not in its hierarchy`,
      )
    }
  }
})

test('every dimension named is a real LibraryDimension, and none repeats', () => {
  for (const studio of STUDIOS) {
    for (const dim of studio.hierarchy) {
      assert.ok(LIBRARY_DIMENSIONS.includes(dim), `${studio.id}: unknown dimension "${dim}"`)
    }
    assert.equal(
      new Set(studio.hierarchy).size, studio.hierarchy.length,
      `${studio.id}: a dimension appears twice in its hierarchy`,
    )
  }
})

test('hierarchies follow the declared dimension order', () => {
  // Drill-down goes curriculum → grade → term → subject; a studio that skips a
  // level is fine, one that reorders them would file documents inconsistently.
  for (const studio of STUDIOS) {
    const positions = studio.hierarchy.map((d) => LIBRARY_DIMENSIONS.indexOf(d))
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b), studio.id)
  }
})

test('every studio names a collection, and the aiGenerations sharing is explicit', () => {
  for (const studio of STUDIOS) {
    assert.ok(studio.collection, `${studio.id} has no collection`)
  }
  // Phase 0 reality: eleven sections share one collection, which is why every
  // query filters on `studio`. If this ever stops being true the index shapes
  // change with it.
  const shared = STUDIOS.filter((s) => s.collection === 'aiGenerations')
  assert.ok(shared.length > 1, 'aiGenerations is shared by several studios')
  assert.equal(STUDIO_BY_ID[LIBRARY_TYPES.ASSESSMENTS].collection, 'assessments')
})

test('syllabi are read-only and have no create route', () => {
  const syllabi = STUDIO_BY_ID[LIBRARY_TYPES.SYLLABI]
  assert.equal(syllabi.readOnly, true)
  assert.equal(syllabi.createRoute, null)
  assert.ok(!creatableStudios().some((s) => s.id === LIBRARY_TYPES.SYLLABI))
  assert.ok(creatableStudios().length > 0)
})

test('lookup helpers', () => {
  assert.equal(getStudio(LIBRARY_TYPES.LESSON_PLANS).id, LIBRARY_TYPES.LESSON_PLANS)
  assert.equal(getStudio('nope'), null)
  assert.throws(() => requireStudio('nope'), /Unknown library studio/)
})

/* ── computeClassificationState ────────────────────────────── */

const lessonPlans = STUDIO_BY_ID[LIBRARY_TYPES.LESSON_PLANS]
const timetables = STUDIO_BY_ID[LIBRARY_TYPES.CLASS_TIMETABLES]

test('a timetable with no term and no curriculum is COMPLETE', () => {
  // The spec's own example: those dimensions are browsable for a timetable,
  // never required, so it must never appear in Needs-sorting.
  const meta = { curriculum: null, grade: 'grade-4', term: null, subject: null }
  assert.equal(computeClassificationState(meta, timetables), 'complete')
  assert.deepEqual(missingRequiredDimensions(meta, timetables), [])
})

test('a lesson plan with a null grade NEEDS SORTING', () => {
  const meta = { curriculum: 'cbc', grade: null, term: 2, subject: 'mathematics' }
  assert.equal(computeClassificationState(meta, lessonPlans), 'needs_sorting')
  assert.deepEqual(missingRequiredDimensions(meta, lessonPlans), ['grade'])
})

test('missing one, two or three required fields is ONE state — it counts once', () => {
  const one = { curriculum: 'cbc', grade: null, term: 2, subject: 'mathematics' }
  const two = { curriculum: 'cbc', grade: null, term: null, subject: 'mathematics' }
  const three = { curriculum: null, grade: null, term: null, subject: 'mathematics' }
  for (const meta of [one, two, three]) {
    assert.equal(computeClassificationState(meta, lessonPlans), 'needs_sorting')
  }
  // The reason the derived field exists: a single state, so a document missing
  // three fields is counted once by one equality query rather than three times
  // by an OR across dimensions.
  assert.equal(new Set([one, two, three].map(
    (m) => computeClassificationState(m, lessonPlans),
  )).size, 1)
  assert.equal(missingRequiredDimensions(three, lessonPlans).length, 3)
})

test('absent and explicitly null are the same thing', () => {
  assert.equal(computeClassificationState({}, lessonPlans), 'needs_sorting')
  assert.equal(
    computeClassificationState({ curriculum: null, grade: null, term: null, subject: null }, lessonPlans),
    'needs_sorting',
  )
})

test('a fully specified lesson plan is COMPLETE', () => {
  assert.equal(computeClassificationState(
    { curriculum: 'cbc', grade: 'grade-4', term: 1, subject: 'mathematics' },
    lessonPlans,
  ), 'complete')
})

test('missing fields are reported in hierarchy order', () => {
  assert.deepEqual(
    missingRequiredDimensions({}, lessonPlans),
    ['curriculum', 'grade', 'term', 'subject'],
  )
})

if (failures) {
  console.error(`\n${failures} test(s) failed\n`)
  process.exit(1)
}
console.log('\nAll library/studios tests passed\n')
