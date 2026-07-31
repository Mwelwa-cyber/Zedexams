#!/usr/bin/env node
/**
 * The save contract: lifecycle-scoped validation, derived classification,
 * stamped identity, and named-field merges on update.
 *
 * Run: npm run test:library-save
 */

import assert from 'node:assert/strict'
import { LIBRARY_TYPES } from '../../config/library.js'
import {
  MissingDimensionsError,
  UnknownValueError,
  buildSavePlan,
  normalizeLibraryDimensions,
} from './saveLibraryDocumentCore.js'
import { LIBRARY_META_FIELD, metaPath } from './queries.js'

/** The written metadata, whichever shape the plan used (nested vs dot paths). */
const written = (result) => (result.op === 'create'
  ? result.fields[LIBRARY_META_FIELD]
  : Object.fromEntries(Object.entries(result.fields)
    .filter(([k]) => k.startsWith(`${LIBRARY_META_FIELD}.`))
    .map(([k, v]) => [k.slice(LIBRARY_META_FIELD.length + 1), v])))

let failures = 0
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`) } catch (err) {
    failures++
    console.error(`  ✗ ${name}\n    ${err.message}`)
  }
}

console.log('\nlibrary/saveLibraryDocumentCore')

const UID = 'teacher_1'
const TS = '__server_timestamp__'
const YEAR = 2026

const plan = (overrides = {}) => buildSavePlan({
  studioId: LIBRARY_TYPES.LESSON_PLANS,
  meta: {},
  targetState: 'classified',
  uid: UID,
  timestamp: TS,
  currentYear: YEAR,
  ...overrides,
})

const FULL_META = {
  curriculum: 'CBC', grade: 'Grade 4', term: 'Term 2', subject: 'Mathematics',
  title: 'Fractions — introduction',
}

/* ── Normalisation ─────────────────────────────────────────── */

test('dimensions are normalised through the taxonomy', () => {
  assert.deepEqual(normalizeLibraryDimensions(FULL_META), {
    curriculum: 'cbc', grade: 'grade-4', term: 2, subject: 'mathematics',
  })
})

test('absent and explicit null both pass normalisation', () => {
  assert.deepEqual(normalizeLibraryDimensions({}), {
    curriculum: null, grade: null, term: null, subject: null,
  })
  assert.deepEqual(normalizeLibraryDimensions({ term: null, grade: '' }).grade, null)
})

test('an unknown enum value is rejected, never silently nulled', () => {
  // Nulling it would file the document into Unsorted and look like the teacher
  // simply had not filled it in.
  assert.throws(() => normalizeLibraryDimensions({ grade: 'Grade 99' }), UnknownValueError)
  assert.throws(() => normalizeLibraryDimensions({ curriculum: 'ZBC' }), UnknownValueError)
  assert.throws(() => normalizeLibraryDimensions({ term: 'Term 7' }), UnknownValueError)
  try {
    normalizeLibraryDimensions({ grade: 'Grade 99' })
  } catch (err) {
    assert.equal(err.field, 'grade')
    assert.match(err.message, /Grade 99/)
  }
})

/* ── Lifecycle-scoped validation ───────────────────────────── */

test('classified with a missing required dimension throws, naming the field', () => {
  const meta = { ...FULL_META, grade: null }
  assert.throws(() => plan({ meta }), MissingDimensionsError)
  try {
    plan({ meta })
  } catch (err) {
    assert.deepEqual(err.missing, ['grade'])
    assert.match(err.message, /grade/)
  }
})

test('the SAME meta saves cleanly as a working document', () => {
  // An autosave or a half-generated AI document must never fail on metadata the
  // teacher has not reached yet.
  const result = plan({ meta: { ...FULL_META, grade: null }, targetState: 'working' })
  assert.equal(result.op, 'create')
  assert.equal(written(result).libraryState, 'working')
  assert.equal(written(result).classificationState, 'needs_sorting')
})

test('a working document is classified everywhere as absent, not as unsorted', () => {
  // classificationState is still computed on a working save — it has to be, or
  // the transition to classified would be the first time anything knew. What
  // keeps it out of the Unsorted bucket is libraryState, which every folder and
  // triage query filters on.
  const working = plan({ meta: {}, targetState: 'working' })
  assert.equal(written(working).libraryState, 'working')
  assert.equal(written(working).classificationState, 'needs_sorting')
})

test('a non-required null is valid — a timetable files with no term', () => {
  const result = plan({
    studioId: LIBRARY_TYPES.CLASS_TIMETABLES,
    meta: { grade: 'Grade 4', term: null, curriculum: null, title: 'Grade 4 timetable' },
  })
  assert.equal(written(result).classificationState, 'complete')
  assert.equal(written(result).libraryState, 'classified')
})

test('working → classified validates at the transition', () => {
  const existing = {
    createdBy: UID, studio: LIBRARY_TYPES.LESSON_PLANS, libraryState: 'working',
    classificationState: 'needs_sorting', academicYear: YEAR,
  }
  assert.throws(
    () => plan({ docId: 'doc1', existing, meta: { ...FULL_META, term: null } }),
    MissingDimensionsError,
  )
  const promoted = plan({ docId: 'doc1', existing, meta: FULL_META })
  assert.equal(promoted.op, 'update')
  assert.equal(written(promoted).libraryState, 'classified')
  assert.equal(written(promoted).classificationState, 'complete')
  assert.equal(promoted.before.libraryState, 'working')
  assert.equal(promoted.meta.libraryState, 'classified')
})

test('an unknown lifecycle state is refused', () => {
  assert.throws(() => plan({ targetState: 'published' }), /Unknown library state/)
})

test('a read-only studio cannot be saved into', () => {
  assert.throws(
    () => plan({ studioId: LIBRARY_TYPES.SYLLABI, meta: FULL_META }),
    /cannot be saved from a studio/,
  )
})

test('an unknown studio is refused', () => {
  assert.throws(() => plan({ studioId: 'imaginary_studio' }), /Unknown library studio/)
})

test('a save with no uid is refused', () => {
  assert.throws(() => plan({ uid: null, meta: FULL_META }), /Sign in again/)
})

/* ── Stamping + spoofing ───────────────────────────────────── */

test('studio, createdBy and classificationState cannot be spoofed through meta', () => {
  const result = plan({
    meta: {
      ...FULL_META,
      studio: LIBRARY_TYPES.ASSESSMENTS,
      createdBy: 'someone_else',
      classificationState: 'complete',
      libraryState: 'archived',
      libraryMetaVersion: 99,
      metaSource: 'migrated_inferred',
      scope: 'school',
      schoolId: 'school_1',
    },
  })
  assert.equal(written(result).studio, LIBRARY_TYPES.LESSON_PLANS, 'studio comes from the call')
  assert.equal(written(result).createdBy, UID, 'author comes from auth')
  assert.equal(written(result).libraryState, 'classified', 'lifecycle comes from targetState')
  assert.equal(written(result).libraryMetaVersion, 1)
  assert.equal(written(result).metaSource, 'user_set')
  assert.equal(written(result).scope, 'personal')
  assert.equal(written(result).schoolId, null)
})

test('classificationState is derived even when the caller asserts otherwise', () => {
  const result = plan({
    meta: { grade: 'Grade 4', classificationState: 'complete' },
    targetState: 'working',
  })
  assert.equal(written(result).classificationState, 'needs_sorting')
})

test('a create stamps the author, the timestamps and the year', () => {
  const result = plan({ meta: FULL_META })
  assert.equal(result.op, 'create')
  assert.equal(written(result).createdBy, UID)
  assert.equal(written(result).createdAt, TS)
  assert.equal(written(result).updatedAt, TS)
  assert.equal(written(result).academicYear, YEAR)
  assert.equal(written(result).title, 'Fractions — introduction')
  assert.equal(written(result).status, 'draft', 'content status defaults to draft')
  // The block is nested under one field, so the library's `status` and `grade`
  // cannot collide with the server-owned `aiGenerations.status` or the
  // 'G4'-vocabulary `assessments.grade`.
  assert.ok(!('status' in result.fields), 'no bare top-level status field')
  assert.ok(!('grade' in result.fields), 'no bare top-level grade field')
  assert.equal(result.collection, 'aiGenerations')
})

test('a classified draft is normal — status and libraryState are different axes', () => {
  const result = plan({ meta: { ...FULL_META, status: 'draft' } })
  assert.equal(written(result).status, 'draft')
  assert.equal(written(result).libraryState, 'classified')
  assert.equal(written(result).classificationState, 'complete')
})

/* ── Legacy documents getting their first block ────────────── */

test('a legacy document with no block is given one, with the identity stamped', () => {
  // Every document in the library today is this case. Firestore-wise it is an
  // update; contract-wise it is the document's first block, so `createdBy` has
  // to be written — the rule requiring it to equal the caller would otherwise
  // reject the write, and every legacy document would be unmigratable.
  const result = plan({
    docId: 'legacy_1',
    existing: null,
    documentExists: true,
    existingCreatedAt: 'original_created_at',
    meta: FULL_META,
  })
  assert.equal(result.op, 'update')
  assert.equal(result.bootstrap, true)
  assert.equal(written(result).createdBy, UID, 'the author is stamped on the first block')
  // The document's own creation time is kept, so the block records when the
  // document was written rather than when it was migrated.
  assert.equal(written(result).createdAt, 'original_created_at')
})

test('a legacy document with no recorded creation time falls back to now', () => {
  const result = plan({
    docId: 'legacy_2', existing: null, documentExists: true, meta: FULL_META,
  })
  assert.equal(written(result).createdAt, TS)
  assert.equal(written(result).createdBy, UID)
})

test('a document that already has a block is NOT re-stamped', () => {
  const result = plan({
    docId: 'doc_1',
    existing: { createdBy: 'original_author', libraryState: 'classified', academicYear: YEAR },
    documentExists: true,
    meta: FULL_META,
  })
  assert.equal(result.bootstrap, false)
  assert.ok(!('createdBy' in written(result)))
  assert.ok(!('createdAt' in written(result)))
})

/* ── Partial updates ───────────────────────────────────────── */

const CLASSIFIED_EXISTING = {
  createdBy: UID, studio: LIBRARY_TYPES.LESSON_PLANS,
  curriculum: 'cbc', grade: 'grade-4', term: 2, subject: 'mathematics',
  libraryState: 'classified', classificationState: 'complete', academicYear: YEAR,
}

test('a title-only update preserves every classification dimension', () => {
  // `meta` is a Partial<LibraryMeta>: a dimension the caller did not mention is
  // not a dimension the caller cleared.
  const result = plan({
    docId: 'doc_1', existing: CLASSIFIED_EXISTING, documentExists: true,
    meta: { title: 'Updated title' },
  })
  const after = written(result)
  assert.equal(after.title, 'Updated title')
  assert.equal(after.curriculum, 'cbc')
  assert.equal(after.grade, 'grade-4')
  assert.equal(after.term, 2)
  assert.equal(after.subject, 'mathematics')
  assert.equal(after.classificationState, 'complete')
})

test('a working autosave with no classification fields preserves the filing', () => {
  // The dangerous one: a working save skips validation by design, so erasing
  // the dimensions here would be silent — the plan would still succeed and the
  // document would quietly leave its folder.
  const result = plan({
    docId: 'doc_1', existing: CLASSIFIED_EXISTING, documentExists: true,
    meta: { title: 'autosaved' }, targetState: 'working',
  })
  assert.equal(written(result).grade, 'grade-4')
  assert.equal(written(result).term, 2)
  assert.equal(written(result).classificationState, 'complete')
})

test('an explicit null clears a dimension on a working save', () => {
  const result = plan({
    docId: 'doc_1', existing: CLASSIFIED_EXISTING, documentExists: true,
    meta: { grade: null }, targetState: 'working',
  })
  assert.equal(written(result).grade, null)
  assert.equal(written(result).term, 2, 'the dimensions not mentioned are untouched')
  assert.equal(written(result).classificationState, 'needs_sorting')
})

test('an explicit null is refused when the document must stay classified', () => {
  assert.throws(() => plan({
    docId: 'doc_1', existing: CLASSIFIED_EXISTING, documentExists: true,
    meta: { grade: null },
  }), MissingDimensionsError)
})

test('a create still reads absent as null — there is nothing to preserve', () => {
  const result = plan({ meta: { title: 'new' }, targetState: 'working' })
  assert.equal(written(result).grade, null)
  assert.equal(written(result).classificationState, 'needs_sorting')
})

/* ── Named-field merges ────────────────────────────────────── */

test('an update writes named fields only — never the author, never createdAt', () => {
  const existing = {
    createdBy: 'original_author', studio: LIBRARY_TYPES.LESSON_PLANS,
    libraryState: 'classified', academicYear: 2025, createdAt: 'old_ts',
  }
  const result = plan({ docId: 'doc1', existing, meta: FULL_META })
  assert.equal(result.op, 'update')
  assert.ok(!('createdBy' in written(result)), 'createdBy is immutable on update')
  assert.ok(!('createdAt' in written(result)), 'createdAt is never restated')
  assert.equal(result.meta.createdBy, 'original_author', 'the stored author survives')
  assert.equal(written(result).updatedAt, TS)
})

test('the payload passes through untouched, alongside the metadata fields', () => {
  const payload = { html: '<p>plan</p>', data: { steps: [1, 2] }, nested: { keep: true } }
  const result = plan({ meta: FULL_META, payload })
  assert.equal(result.fields.html, payload.html)
  assert.deepEqual(result.fields.data, payload.data)
  assert.deepEqual(result.fields.nested, payload.nested)
  // A payload can never overwrite a stamped field.
  const spoofed = plan({
    meta: FULL_META,
    payload: { libraryMeta: { studio: 'x', createdBy: 'y' }, studio: 'x' },
  })
  assert.equal(written(spoofed).studio, LIBRARY_TYPES.LESSON_PLANS)
  assert.equal(written(spoofed).createdBy, UID)
})

test('the year is inherited on update unless the caller changes it', () => {
  const existing = { createdBy: UID, academicYear: 2025, libraryState: 'classified' }
  assert.equal(written(plan({ docId: 'd', existing, meta: FULL_META })).academicYear, 2025)
  assert.equal(
    written(plan({ docId: 'd', existing, meta: { ...FULL_META, academicYear: 2027 } })).academicYear,
    2027,
  )
})

/* ── Archiving ─────────────────────────────────────────────── */

test('archivedAt is stamped on the way in and cleared on the way out', () => {
  const existing = { createdBy: UID, libraryState: 'classified', academicYear: YEAR }
  const archived = plan({ docId: 'd', existing, meta: FULL_META, targetState: 'archived' })
  assert.equal(written(archived).archivedAt, TS)

  // Re-saving an already-archived document must not keep moving the date.
  const stillArchived = plan({
    docId: 'd',
    existing: { ...existing, libraryState: 'archived', archivedAt: 'first_ts' },
    meta: FULL_META,
    targetState: 'archived',
  })
  assert.ok(!('archivedAt' in stillArchived.fields))

  const restored = plan({
    docId: 'd',
    existing: { ...existing, libraryState: 'archived', archivedAt: 'first_ts' },
    meta: FULL_META,
    targetState: 'classified',
  })
  assert.equal(written(restored).archivedAt, null)
})

if (failures) {
  console.error(`\n${failures} test(s) failed\n`)
  process.exit(1)
}
console.log('\nAll library/saveLibraryDocumentCore tests passed\n')
