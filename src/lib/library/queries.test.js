#!/usr/bin/env node
/**
 * Query contracts: candidate enumeration, the single-equality Unsorted count,
 * and the lifecycle filter every folder query carries.
 *
 * Run: npm run test:library-queries
 */

import assert from 'node:assert/strict'
import { LIBRARY_TYPES } from '../../config/library.js'
import { STUDIOS, STUDIO_BY_ID } from './studios.js'
import { LIBRARY_GRADES, gradesForCurriculum, subjectsForGrade } from './taxonomy.js'
import {
  CLASSIFICATION_STATES,
  LIBRARY_META_FIELD,
  LIBRARY_META_FIELDS,
  LIBRARY_META_VERSION,
  LIBRARY_STATES,
  buildDocumentListQuery,
  buildFolderCountQueries,
  buildNeedsSortingQuery,
  dimensionCandidates,
  enumerateQueryShapes,
  folderCountKey,
  isFixedSetDimension,
  metaPath,
  nextDimension,
  normalizePathFilters,
} from './queries.js'

let failures = 0
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`) } catch (err) {
    failures++
    console.error(`  ✗ ${name}\n    ${err.message}`)
  }
}

console.log('\nlibrary/queries')

const UID = 'teacher_1'
const lessonPlans = STUDIO_BY_ID[LIBRARY_TYPES.LESSON_PLANS]
const timetables = STUDIO_BY_ID[LIBRARY_TYPES.CLASS_TIMETABLES]

// Filters address the nested block by path, so a test asking for 'grade' means
// `libraryMeta.grade` — the same path the index file declares.
const filterFor = (descriptor, field) => descriptor.filters.find((f) => f[0] === metaPath(field))

/* ── The metadata contract ─────────────────────────────────── */

test('the metadata block is version 1 and names every field it stamps', () => {
  assert.equal(LIBRARY_META_VERSION, 1)
  for (const field of ['createdBy', 'studio', 'libraryState', 'classificationState',
    'curriculum', 'grade', 'term', 'subject', 'academicYear', 'scope', 'schoolId']) {
    assert.ok(LIBRARY_META_FIELDS.includes(field), `${field} is part of the block`)
  }
  // The author field is `createdBy`, not `ownerId` — that naming is what makes
  // the future school model a non-breaking extension.
  assert.ok(!LIBRARY_META_FIELDS.includes('ownerId'))
  // The block is ONE nested field, so its names cannot collide with the
  // different-vocabulary `grade`/`term`/`status` those collections already own.
  assert.equal(LIBRARY_META_FIELD, 'libraryMeta')
  assert.equal(metaPath('grade'), 'libraryMeta.grade')
})

/* ── Path normalisation + level resolution ─────────────────── */

test('path filters are normalised, and anything unreadable becomes null', () => {
  assert.deepEqual(
    normalizePathFilters({ curriculum: 'CBC', grade: 'Grade 4', term: 'Term 2', subject: 'Mathematics' }),
    { curriculum: 'cbc', grade: 'grade-4', term: 2, subject: 'mathematics' },
  )
  assert.deepEqual(
    normalizePathFilters({ grade: 'Unsorted' }),
    { curriculum: null, grade: null, term: null, subject: null },
  )
})

test('the next level is the first unpinned dimension; a full path has none', () => {
  assert.equal(nextDimension(lessonPlans, {}), 'curriculum')
  assert.equal(nextDimension(lessonPlans, { curriculum: 'cbc' }), 'grade')
  assert.equal(nextDimension(lessonPlans, { curriculum: 'cbc', grade: 'grade-4' }), 'term')
  assert.equal(
    nextDimension(lessonPlans, { curriculum: 'cbc', grade: 'grade-4', term: 1, subject: 'mathematics' }),
    null,
  )
})

/* ── Candidate enumeration ─────────────────────────────────── */

test('candidates come from the taxonomy, narrowed by the path', () => {
  assert.deepEqual(dimensionCandidates('curriculum', {}).map((c) => c.value), ['cbc', 'obc'])
  assert.deepEqual(dimensionCandidates('term', {}).map((c) => c.value), [1, 2, 3])
  assert.deepEqual(
    dimensionCandidates('grade', { curriculum: 'cbc' }).map((c) => c.value),
    gradesForCurriculum('cbc').map((g) => g.id),
  )
  assert.deepEqual(
    dimensionCandidates('subject', { curriculum: 'cbc', grade: 'grade-4' }).map((c) => c.value),
    subjectsForGrade('cbc', 'grade-4').map((s) => s.id),
  )
  // No curriculum pinned: every grade is a candidate, because a document filed
  // under no curriculum still has to be countable.
  assert.equal(dimensionCandidates('grade', {}).length, LIBRARY_GRADES.length)
})

test('curriculum and term are fixed sets; grade and subject are dynamic', () => {
  assert.ok(isFixedSetDimension('curriculum'))
  assert.ok(isFixedSetDimension('term'))
  assert.ok(!isFixedSetDimension('grade'))
  assert.ok(!isFixedSetDimension('subject'))
})

/* ── buildFolderCountQueries ───────────────────────────────── */

test('one descriptor per candidate, plus exactly one Unsorted descriptor', () => {
  const descriptors = buildFolderCountQueries(lessonPlans, {}, { createdBy: UID })
  const candidates = descriptors.filter((d) => d.bucket === 'candidate')
  const unsorted = descriptors.filter((d) => d.bucket === 'unsorted')

  assert.deepEqual(candidates.map((d) => d.value), ['cbc', 'obc'])
  assert.equal(unsorted.length, 1, 'exactly one Unsorted descriptor')
})

test('the Unsorted descriptor is a SINGLE classificationState equality', () => {
  const [unsorted] = buildFolderCountQueries(lessonPlans, {}, { createdBy: UID })
    .filter((d) => d.bucket === 'unsorted')

  const classificationFilters = unsorted.filters.filter((f) => f[0] === metaPath('classificationState'))
  assert.equal(classificationFilters.length, 1, 'one filter, never an OR across dimensions')
  assert.deepEqual(
    classificationFilters[0],
    [metaPath('classificationState'), '==', CLASSIFICATION_STATES.NEEDS_SORTING],
  )

  // Never a per-field descriptor set: a document missing three fields must be
  // counted once, and that is only true if nothing here filters on the
  // dimensions themselves.
  for (const dim of ['curriculum', 'grade', 'term', 'subject']) {
    assert.equal(filterFor(unsorted, dim), undefined, `no ${dim} filter on the Unsorted count`)
  }
})

test('EVERY descriptor filters libraryState == classified', () => {
  const paths = [{}, { curriculum: 'cbc' }, { curriculum: 'cbc', grade: 'grade-4' }]
  for (const studio of STUDIOS) {
    for (const path of paths) {
      for (const descriptor of buildFolderCountQueries(studio, path, { createdBy: UID })) {
        assert.deepEqual(
          filterFor(descriptor, 'libraryState'),
          [metaPath('libraryState'), '==', LIBRARY_STATES.CLASSIFIED],
          `${studio.id} @ ${JSON.stringify(path)} / ${descriptor.label}`,
        )
      }
    }
  }
})

test('every descriptor is scoped to the author and the studio', () => {
  for (const descriptor of buildFolderCountQueries(lessonPlans, {}, { createdBy: UID })) {
    // Scoped by the COLLECTION's owner field — what the read rules gate on.
    assert.deepEqual(
      descriptor.filters.find((f) => f[0] === lessonPlans.ownerField),
      [lessonPlans.ownerField, '==', UID],
    )
    assert.deepEqual(filterFor(descriptor, 'studio'), [metaPath('studio'), '==', lessonPlans.id])
    assert.equal(descriptor.collection, lessonPlans.collection)
  }
})

test('a query with no author is refused, not emitted', () => {
  assert.throws(() => buildFolderCountQueries(lessonPlans, {}, {}), /createdBy is required/)
  assert.throws(() => buildDocumentListQuery(lessonPlans, {}, {}), /createdBy is required/)
})

test('the Unsorted descriptor appears at the studio root only', () => {
  // Needs-sorting is a property of a document, not of a folder. Repeating the
  // bucket down every branch would turn one number into many.
  const deeper = buildFolderCountQueries(lessonPlans, { curriculum: 'cbc' }, { createdBy: UID })
  assert.equal(deeper.filter((d) => d.bucket === 'unsorted').length, 0)
  assert.deepEqual(
    deeper.map((d) => d.value),
    gradesForCurriculum('cbc').map((g) => g.id),
  )
})

test('the path so far is carried into every candidate descriptor', () => {
  const descriptors = buildFolderCountQueries(
    lessonPlans, { curriculum: 'cbc', grade: 'grade-4' }, { createdBy: UID },
  )
  for (const descriptor of descriptors) {
    assert.deepEqual(filterFor(descriptor, 'curriculum'), [metaPath('curriculum'), '==', 'cbc'])
    assert.deepEqual(filterFor(descriptor, 'grade'), [metaPath('grade'), '==', 'grade-4'])
    assert.deepEqual(filterFor(descriptor, 'term'), [metaPath('term'), '==', descriptor.value])
  }
})

test('a leaf path fans out into nothing', () => {
  assert.deepEqual(
    buildFolderCountQueries(
      lessonPlans,
      { curriculum: 'cbc', grade: 'grade-4', term: 1, subject: 'mathematics' },
      { createdBy: UID },
    ),
    [],
  )
})

test('a studio without a level never fans out on it', () => {
  // Class timetables have no subject level at all.
  const path = { curriculum: 'cbc', grade: 'grade-4', term: 1 }
  assert.equal(nextDimension(timetables, path), null)
  assert.deepEqual(buildFolderCountQueries(timetables, path, { createdBy: UID }), [])
})

test('count keys are stable and distinct per candidate', () => {
  const descriptors = buildFolderCountQueries(lessonPlans, {}, { createdBy: UID })
  assert.equal(new Set(descriptors.map((d) => d.key)).size, descriptors.length)
  // The key a folder view reads is the key the invalidator drops.
  assert.equal(
    descriptors.find((d) => d.value === 'cbc').key,
    folderCountKey({
      createdBy: UID, studio: lessonPlans.id, academicYear: null, path: { curriculum: 'cbc' },
    }),
  )
})

test('the academic year is part of the filter and the key when pinned', () => {
  const [first] = buildFolderCountQueries(lessonPlans, {}, { createdBy: UID, academicYear: 2026 })
  assert.deepEqual(filterFor(first, 'academicYear'), [metaPath('academicYear'), '==', 2026])
  const [allYears] = buildFolderCountQueries(lessonPlans, {}, { createdBy: UID })
  assert.equal(filterFor(allYears, 'academicYear'), undefined)
  assert.notEqual(first.key, allYears.key)
})

/* ── buildDocumentListQuery ────────────────────────────────── */

test('the document list matches one lifecycle value, and archived is a separate view', () => {
  const normal = buildDocumentListQuery(lessonPlans, { curriculum: 'cbc' }, { createdBy: UID })
  assert.deepEqual(filterFor(normal, 'libraryState'), [metaPath('libraryState'), '==', LIBRARY_STATES.CLASSIFIED])
  assert.deepEqual(normal.orderBy, [[metaPath('updatedAt'), 'desc']])
  assert.ok(normal.limit > 0)

  const archived = buildDocumentListQuery(
    lessonPlans, { curriculum: 'cbc' }, { createdBy: UID, includeArchived: true },
  )
  assert.deepEqual(filterFor(archived, 'libraryState'), [metaPath('libraryState'), '==', LIBRARY_STATES.ARCHIVED])
  assert.notEqual(normal.key, archived.key)
})

test('an unsupported sort falls back rather than emitting an unindexed orderBy', () => {
  // A sort with no composite index behind it fails as FAILED_PRECONDITION in
  // the teacher's browser, which is the one place this must never surface.
  assert.deepEqual(
    buildDocumentListQuery(lessonPlans, {}, { createdBy: UID, sort: 'nonsense' }).orderBy,
    [[metaPath('updatedAt'), 'desc']],
  )
})

test('the Needs-sorting list is the same single equality the badge counts', () => {
  const list = buildNeedsSortingQuery(lessonPlans, { createdBy: UID })
  assert.deepEqual(
    filterFor(list, 'classificationState'),
    [metaPath('classificationState'), '==', CLASSIFICATION_STATES.NEEDS_SORTING],
  )
  assert.deepEqual(
    filterFor(list, 'libraryState'),
    [metaPath('libraryState'), '==', LIBRARY_STATES.CLASSIFIED],
  )
})

/* ── Index shapes ──────────────────────────────────────────── */

test('query shapes cover every level of every studio, with no duplicates', () => {
  for (const studio of STUDIOS) {
    const shapes = enumerateQueryShapes(studio)
    assert.ok(shapes.length > 0, studio.id)
    const signatures = shapes.map(
      (s) => `${s.collection}|${s.equalityFields.join(',')}|${s.orderBy?.field || ''}|${s.orderBy?.direction || ''}`,
    )
    assert.equal(new Set(signatures).size, signatures.length, `${studio.id}: duplicate shape`)
    for (const shape of shapes) {
      assert.equal(shape.collection, studio.collection)
      assert.ok(
        shape.equalityFields.includes(studio.ownerField),
        `${studio.id}: shape is missing the collection's owner field`,
      )
      for (const field of ['studio', 'libraryState']) {
        assert.ok(
          shape.equalityFields.includes(metaPath(field)),
          `${studio.id}: shape is missing ${metaPath(field)}`,
        )
      }
      // Apart from the owner field, everything a library query touches lives
      // inside the one nested block.
      for (const field of shape.equalityFields) {
        assert.ok(
          field === studio.ownerField || field.startsWith(`${LIBRARY_META_FIELD}.`),
          `stray field path ${field}`,
        )
      }
    }
    // Every hierarchy prefix a folder view can ask for is represented.
    const flattened = shapes.map((s) => s.equalityFields.join(','))
    for (let depth = 1; depth <= studio.hierarchy.length; depth += 1) {
      const prefix = [
        studio.ownerField,
        ...['studio', 'libraryState', ...studio.hierarchy.slice(0, depth)].map(metaPath),
      ].join(',')
      assert.ok(flattened.includes(prefix), `${studio.id}: no shape for ${prefix}`)
    }
  }
})

if (failures) {
  console.error(`\n${failures} test(s) failed\n`)
  process.exit(1)
}
console.log('\nAll library/queries tests passed\n')
