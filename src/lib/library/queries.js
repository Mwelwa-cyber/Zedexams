/**
 * Library query contracts — the canonical metadata block, and the query
 * DESCRIPTORS every folder view is built from.
 *
 * This module returns descriptions of queries, not queries: plain objects the
 * Firestore layer turns into `where(...)` constraints, and the plain-node suite
 * can assert on without a Firebase SDK. Two builders matter:
 *
 *   buildFolderCountQueries  one descriptor per candidate value at the next
 *                            hierarchy level, plus one Unsorted descriptor
 *   buildDocumentListQuery   the documents inside a fully-specified path
 *
 * WHY CANDIDATE ENUMERATION. Firestore cannot return distinct values — an
 * aggregate counts documents matching a filter, it does not discover which
 * values exist. So the library enumerates candidates from the taxonomy and
 * counts each, hiding the zero-count ones. That is not a workaround to be
 * replaced later; it is the only shape this query can take.
 *
 * WHY THE UNSORTED BUCKET IS ONE EQUALITY. A document missing three required
 * fields must count once, not three times, and an OR across dimensions is
 * index-fragile. `classificationState` carries the predicate instead, so the
 * badge is `libraryState == 'classified' && classificationState ==
 * 'needs_sorting'` — one count, derived on every write, rebuildable at any time
 * from the document plus the registry. It is derived metadata, not folder state.
 *
 * Pure — no React, no Firebase.
 */

import { createCacheKey, createCacheKeyPrefix } from '../../utils/cache/cacheKeys.js'
import {
  CURRICULA,
  TERMS,
  gradesForCurriculum,
  normalizeCurriculum,
  normalizeGrade,
  normalizeSubject,
  normalizeTerm,
  subjectsForGrade,
  termLabel,
} from './taxonomy.js'
import { LIBRARY_DIMENSIONS } from './studios.js'

/* ── The canonical metadata block ────────────────────────────── */

/** Bumped when the shape below changes in a way the migration must notice. */
export const LIBRARY_META_VERSION = 1

/** Library lifecycle — distinct from `status`, which is editorial completeness. */
export const LIBRARY_STATES = Object.freeze({
  /** Autosave / AI generation in progress. In no folder, no count, no triage. */
  WORKING: 'working',
  /** Saved through the normal flow. This is what folders are made of. */
  CLASSIFIED: 'classified',
  /** Hidden unless the archive filter is on. */
  ARCHIVED: 'archived',
})

export const LIBRARY_STATE_VALUES = Object.freeze(Object.values(LIBRARY_STATES))

export const CLASSIFICATION_STATES = Object.freeze({
  COMPLETE: 'complete',
  NEEDS_SORTING: 'needs_sorting',
})

export const CLASSIFICATION_STATE_VALUES = Object.freeze(Object.values(CLASSIFICATION_STATES))

/** Editorial completeness of the CONTENT, orthogonal to `libraryState`. */
export const DOCUMENT_STATUSES = Object.freeze(['draft', 'final'])

/** Provenance of the metadata: the teacher set it, or the migration inferred it. */
export const META_SOURCES = Object.freeze(['user_set', 'migrated_inferred'])

/**
 * Ownership scope. `school` is declared now so the field exists before the
 * membership model does — but security rules accept only `personal` until then,
 * or clients could mint "school" documents no other teacher can safely reach.
 */
export const LIBRARY_SCOPES = Object.freeze(['personal', 'school'])

/**
 * @typedef {object} LibraryMeta
 * @property {string} createdBy            author uid. NOT `ownerId`: naming it
 *   for the author is what makes the future school model a non-breaking
 *   extension (personal access = createdBy == uid; school access = membership).
 * @property {string} studio               StudioId — stamped from the save call
 * @property {string|null} curriculum
 * @property {string|null} grade
 * @property {1|2|3|null} term
 * @property {string|null} subject
 * @property {number} academicYear
 * @property {string} title
 * @property {'draft'|'final'} status      content completion
 * @property {'working'|'classified'|'archived'} libraryState
 * @property {'complete'|'needs_sorting'} classificationState  DERIVED, never set by callers
 * @property {number} libraryMetaVersion
 * @property {'user_set'|'migrated_inferred'} metaSource
 * @property {string|null} [sourceDocumentId]
 * @property {unknown} [archivedAt]
 * @property {'personal'|'school'} scope
 * @property {string|null} schoolId
 * @property {unknown} createdAt
 * @property {unknown} updatedAt
 */

/**
 * The ONE document field the block occupies, and why it is a nested map rather
 * than the loose top-level fields the spec sketched.
 *
 * The spec's reason for wanting them top-level was indexability, and a nested
 * map is equally indexable — Firestore composite indexes take `libraryMeta.grade`
 * exactly as they take `grade`. What top-level names would have cost is not
 * theoretical: `grade`, `term`, `subject` and `status` are ALREADY taken, with
 * different vocabularies, on the two collections the library writes to.
 * `assessments.grade` is 'G4' (validated by `_validAssessmentGrade`),
 * `assessments.term` is the STRING 'Term 2', and `aiGenerations.status` is the
 * generation's operation state, pinned to 'complete' by firestore.rules. Writing
 * the library's own values into those names would either be rejected as a
 * permission error or silently corrupt what the exporters read.
 *
 * One map also means one entry in each collection's `keys().hasOnly(...)`
 * allowlist instead of nineteen.
 */
export const LIBRARY_META_FIELD = 'libraryMeta'

/** The field names INSIDE the block. */
export const LIBRARY_META_FIELDS = Object.freeze([
  'createdBy', 'studio', 'curriculum', 'grade', 'term', 'subject',
  'academicYear', 'title', 'status',
  'libraryState', 'classificationState',
  'libraryMetaVersion', 'metaSource', 'sourceDocumentId', 'archivedAt',
  'scope', 'schoolId', 'createdAt', 'updatedAt',
])

/** The query/index path for one field of the block. */
export function metaPath(field) {
  return `${LIBRARY_META_FIELD}.${field}`
}

/* ── Normalising a path ──────────────────────────────────────── */

const NORMALIZERS = {
  curriculum: normalizeCurriculum,
  grade: normalizeGrade,
  term: normalizeTerm,
  subject: normalizeSubject,
}

/**
 * Fold a partial path ({ grade: 'Grade 4', term: 'Term 2' }) onto canonical
 * values. Anything unreadable becomes null, which reads as "not filtered on"
 * — the same treatment an absent key gets.
 */
export function normalizePathFilters(pathFilters = {}) {
  const out = {}
  for (const dim of LIBRARY_DIMENSIONS) {
    const raw = pathFilters[dim]
    out[dim] = raw === undefined || raw === null || raw === '' ? null : NORMALIZERS[dim](raw)
  }
  return out
}

/**
 * The next hierarchy level to fan out on: the first dimension of the studio's
 * hierarchy the path has not pinned yet. Returns null at a leaf (every level
 * chosen — the caller wants documents, not folders).
 */
export function nextDimension(studioDef, pathFilters = {}) {
  const path = normalizePathFilters(pathFilters)
  return studioDef.hierarchy.find((dim) => path[dim] == null) || null
}

/* ── Candidate enumeration ───────────────────────────────────── */

/**
 * The candidate values to count at one level, as `{ value, label }`.
 *
 * Grades narrow to the curriculum when one is pinned (CBC has no Grade 7, the
 * previous syllabus has no ECE), and subjects narrow to the curriculum AND
 * grade via the syllabus catalogue. Neither list is written here.
 */
export function dimensionCandidates(dimension, pathFilters = {}) {
  const path = normalizePathFilters(pathFilters)
  switch (dimension) {
    case 'curriculum':
      return CURRICULA.map((c) => ({ value: c.id, label: c.label }))
    case 'grade':
      return gradesForCurriculum(path.curriculum).map((g) => ({ value: g.id, label: g.label }))
    case 'term':
      return TERMS.map((t) => ({ value: t, label: termLabel(t) }))
    case 'subject':
      return subjectsForGrade(path.curriculum, path.grade)
        .map((s) => ({ value: s.id, label: s.label }))
    default:
      return []
  }
}

/**
 * Fixed small sets render every value (muted when empty, with a create
 * shortcut); dynamic sets render only what exists, so a teacher who teaches one
 * grade sees one grade rather than a wall of empty folders.
 */
export const FIXED_SET_DIMENSIONS = Object.freeze(['curriculum', 'term'])

export function isFixedSetDimension(dimension) {
  return FIXED_SET_DIMENSIONS.includes(dimension)
}

/* ── Cache keys ──────────────────────────────────────────────── */

const KEY_ROOT = 'library'

/**
 * The cache key for one count. Ordered coarse → fine so a whole subtree is a
 * clean prefix cut: invalidating `library:count:u1:lesson_plans:2026:cbc:` drops
 * every count beneath that curriculum and nothing else.
 */
export function folderCountKey({ createdBy, studio, academicYear, path = {}, bucket = null }) {
  return createCacheKey([
    KEY_ROOT, 'count', createdBy, studio, academicYear,
    path.curriculum, path.grade, path.term, path.subject,
    bucket,
  ])
}

/**
 * Prefix covering every key of one kind at or below a path. The path segments
 * stop at the first null, so the prefix for `{ curriculum }` also matches every
 * grade, term and subject beneath it.
 */
export function libraryKeyPrefix(kind, { createdBy, studio, academicYear, path = {} }) {
  const parts = [KEY_ROOT, kind, createdBy, studio, academicYear]
  for (const dim of LIBRARY_DIMENSIONS) {
    if (path[dim] == null) break
    parts.push(path[dim])
  }
  return createCacheKeyPrefix(parts)
}

/** Prefix covering every count at or below a path. */
export function folderCountKeyPrefix(scope) {
  return libraryKeyPrefix('count', scope)
}

/** Prefix covering every document list at or below a path. */
export function documentListKeyPrefix(scope) {
  return libraryKeyPrefix('list', scope)
}

/* ── Query builders ──────────────────────────────────────────── */

function requireOwner(createdBy) {
  // A library query with no author filter reads every teacher's documents. Fail
  // rather than emit one: rules would reject it, but only after the read was
  // attempted, and a descriptor that cannot be run is a bug we want at build time.
  if (!createdBy || typeof createdBy !== 'string') {
    throw new Error('[library/queries] createdBy is required — refusing to build an unscoped query')
  }
  return createdBy
}

function baseFilters({ studioDef, createdBy, academicYear, path, libraryState }) {
  const filters = [
    // The collection's OWN owner field, not `libraryMeta.createdBy`: Firestore
    // evaluates a list/count rule against the query, and these collections gate
    // reads on `ownerUid` / `createdBy`. See OWNER_FIELD in studios.js.
    [studioDef.ownerField, '==', createdBy],
    [metaPath('studio'), '==', studioDef.id],
    [metaPath('libraryState'), '==', libraryState],
  ]
  if (academicYear != null) filters.push([metaPath('academicYear'), '==', academicYear])
  for (const dim of LIBRARY_DIMENSIONS) {
    if (path[dim] != null) filters.push([metaPath(dim), '==', path[dim]])
  }
  return filters
}

/**
 * @typedef {object} CountQueryDescriptor
 * @property {'count'} kind
 * @property {string} key                 cache key
 * @property {string} collection
 * @property {Array<[string,string,unknown]>} filters
 * @property {string} dimension           the level being fanned out
 * @property {unknown} value              the candidate value (null for Unsorted)
 * @property {string} label
 * @property {'candidate'|'unsorted'} bucket
 * @property {boolean} fixedSet           render when empty, muted?
 */

/**
 * One count descriptor per candidate value at the next level, plus ONE Unsorted
 * descriptor. Every descriptor filters `libraryState == 'classified'`, so
 * working autosaves and archived documents can never inflate a folder count.
 *
 * The Unsorted descriptor is emitted at the FIRST level only. Needs-sorting is a
 * property of the document, not of a folder — surfacing it once at the top of
 * the studio is what makes "5 documents need sorting" one number instead of a
 * count repeated down every branch.
 *
 * @param {import('./studios.js').StudioDef} studioDef
 * @param {object} pathFilters                    partial { curriculum, grade, term, subject }
 * @param {object} options
 * @param {string} options.createdBy              author uid — required
 * @param {number|null} [options.academicYear]    null counts every year
 * @returns {CountQueryDescriptor[]}
 */
export function buildFolderCountQueries(studioDef, pathFilters = {}, options = {}) {
  const createdBy = requireOwner(options.createdBy)
  const academicYear = options.academicYear ?? null
  const path = normalizePathFilters(pathFilters)
  const dimension = nextDimension(studioDef, path)
  if (!dimension) return []

  const descriptors = dimensionCandidates(dimension, path).map((candidate) => {
    const candidatePath = { ...path, [dimension]: candidate.value }
    return {
      kind: 'count',
      key: folderCountKey({ createdBy, studio: studioDef.id, academicYear, path: candidatePath }),
      collection: studioDef.collection,
      filters: baseFilters({
        studioDef, createdBy, academicYear, path: candidatePath,
        libraryState: LIBRARY_STATES.CLASSIFIED,
      }),
      dimension,
      value: candidate.value,
      label: candidate.label,
      bucket: 'candidate',
      fixedSet: isFixedSetDimension(dimension),
    }
  })

  const atRoot = studioDef.hierarchy.every((dim) => path[dim] == null)
  if (atRoot) {
    descriptors.push({
      kind: 'count',
      key: folderCountKey({
        createdBy, studio: studioDef.id, academicYear, path: {}, bucket: 'unsorted',
      }),
      collection: studioDef.collection,
      // ONE equality. A document missing three required fields counts once.
      filters: [
        ...baseFilters({
          studioDef, createdBy, academicYear, path: {},
          libraryState: LIBRARY_STATES.CLASSIFIED,
        }),
        [metaPath('classificationState'), '==', CLASSIFICATION_STATES.NEEDS_SORTING],
      ],
      dimension: null,
      value: null,
      label: 'Needs sorting',
      bucket: 'unsorted',
      fixedSet: false,
    })
  }

  return descriptors
}

/**
 * @typedef {object} ListQueryDescriptor
 * @property {'list'} kind
 * @property {string} key
 * @property {string} collection
 * @property {Array<[string,string,unknown]>} filters
 * @property {Array<[string,'asc'|'desc']>} orderBy
 * @property {number} limit
 */

/**
 * Sort orders the library supports.
 *
 * Deliberately ONE. Every entry here multiplies the composite indexes the
 * collections need — eleven of the twelve studios share `aiGenerations`, so a
 * second sort adds ten indexes that every generation write then has to update,
 * for a control no screen offers yet. Adding a sort means adding its indexes in
 * the same change; `test:library-indexes` fails if they are missing, so the
 * failure mode is a red build rather than a FAILED_PRECONDITION in a teacher's
 * browser.
 */
const SORTS = {
  recent: [`${LIBRARY_META_FIELD}.updatedAt`, 'desc'],
}

export const DEFAULT_LIST_LIMIT = 60

/**
 * The documents inside a path.
 *
 * `includeArchived` swaps which single lifecycle value is matched rather than
 * widening to an `in` — archived documents are a separate view, not extra rows
 * in the normal one, and one equality keeps the index simple. Needs-sorting
 * documents ARE included: they are classified, just incompletely, and the
 * triage screen lists them from this same builder.
 */
export function buildDocumentListQuery(studioDef, pathFilters = {}, options = {}) {
  const createdBy = requireOwner(options.createdBy)
  const academicYear = options.year ?? options.academicYear ?? null
  const path = normalizePathFilters(pathFilters)
  const sortKey = options.sort && SORTS[options.sort] ? options.sort : 'recent'
  const libraryState = options.includeArchived
    ? LIBRARY_STATES.ARCHIVED
    : LIBRARY_STATES.CLASSIFIED

  return {
    kind: 'list',
    key: createCacheKey([
      KEY_ROOT, 'list', createdBy, studioDef.id, academicYear,
      path.curriculum, path.grade, path.term, path.subject,
      libraryState, sortKey, options.limit ?? DEFAULT_LIST_LIMIT,
    ]),
    collection: studioDef.collection,
    filters: baseFilters({ studioDef, createdBy, academicYear, path, libraryState }),
    orderBy: [SORTS[sortKey]],
    limit: options.limit ?? DEFAULT_LIST_LIMIT,
  }
}

/**
 * The Needs-sorting list for a studio — the triage screen's query, and the same
 * single equality the badge counts.
 */
export function buildNeedsSortingQuery(studioDef, options = {}) {
  const createdBy = requireOwner(options.createdBy)
  const academicYear = options.academicYear ?? null
  return {
    kind: 'list',
    key: createCacheKey([
      KEY_ROOT, 'needs-sorting', createdBy, studioDef.id, academicYear,
      options.limit ?? DEFAULT_LIST_LIMIT,
    ]),
    collection: studioDef.collection,
    filters: [
      ...baseFilters({
        studioDef, createdBy, academicYear, path: normalizePathFilters({}),
        libraryState: LIBRARY_STATES.CLASSIFIED,
      }),
      [metaPath('classificationState'), '==', CLASSIFICATION_STATES.NEEDS_SORTING],
    ],
    orderBy: [SORTS.recent],
    limit: options.limit ?? DEFAULT_LIST_LIMIT,
  }
}

/**
 * Every distinct (collection, equality fields, orderBy) combination the builders
 * can emit for a studio. This is what `firestore.indexes.json` is derived from —
 * the indexes follow the query contracts rather than being declared up front and
 * hoped to match.
 */
export function enumerateQueryShapes(studioDef) {
  const shapes = []
  const seen = new Set()
  const add = (equalityFields, orderByField, orderDir) => {
    const signature = `${studioDef.collection}|${equalityFields.join(',')}|${orderByField || ''}|${orderDir || ''}`
    if (seen.has(signature)) return
    seen.add(signature)
    shapes.push({
      collection: studioDef.collection,
      equalityFields: [...equalityFields],
      orderBy: orderByField ? { field: orderByField, direction: orderDir } : null,
    })
  }

  const base = [studioDef.ownerField, metaPath('studio'), metaPath('libraryState')]
  const year = metaPath('academicYear')
  const classification = metaPath('classificationState')
  // Counts: every hierarchy prefix, with and without the year filter.
  for (let depth = 1; depth <= studioDef.hierarchy.length; depth += 1) {
    const prefix = studioDef.hierarchy.slice(0, depth).map(metaPath)
    add([...base, ...prefix], null, null)
    add([...base, year, ...prefix], null, null)
  }
  // The Unsorted count + triage list.
  add([...base, classification], null, null)
  add([...base, year, classification], null, null)
  add([...base, classification], SORTS.recent[0], SORTS.recent[1])
  // Lists: a full path, and every prefix a filter-pill view can leave open.
  for (let depth = 0; depth <= studioDef.hierarchy.length; depth += 1) {
    const prefix = studioDef.hierarchy.slice(0, depth).map(metaPath)
    for (const [field, dir] of Object.values(SORTS)) {
      add([...base, ...prefix], field, dir)
      add([...base, year, ...prefix], field, dir)
    }
  }
  return shapes
}
