/**
 * The save decision, as pure logic: normalise → derive → validate → stamp →
 * plan the write. No Firestore, no auth, no clock — every one of those arrives
 * as an argument, so the whole contract tests under plain `node`.
 *
 * `saveLibraryDocument.js` is the thin shell that supplies them and performs the
 * write. The split is the repo's usual one (`*Core.js`), and it is what lets the
 * rules below be asserted directly rather than through a Firebase mock:
 *
 *   • `studio`, `createdBy` and `classificationState` are STAMPED, never read
 *     from the caller's meta. A studio that could name itself could file its
 *     documents into another studio's folders; a caller that could set
 *     `classificationState` could hide an unsorted document from triage.
 *   • Validation is by LIFECYCLE, not by document. A `working` save skips
 *     required-dimension checks entirely — an autosave or a half-finished AI
 *     generation must never fail on metadata the teacher has not reached yet —
 *     and `classified` is where the check lands, because that is the transition
 *     that puts the document in a folder.
 *   • An update produces NAMED FIELDS ONLY. This codebase has lost data to
 *     whole-document rewrites racing each other; the plan therefore carries the
 *     exact field map to merge, and never the document.
 */

import {
  normalizeCurriculum,
  normalizeGrade,
  normalizeSubject,
  normalizeTerm,
} from './taxonomy.js'
import { computeClassificationState, missingRequiredDimensions, requireStudio } from './studios.js'
import {
  CLASSIFICATION_STATES,
  DOCUMENT_STATUSES,
  LIBRARY_META_FIELD,
  LIBRARY_META_VERSION,
  LIBRARY_STATES,
  LIBRARY_STATE_VALUES,
  metaPath,
} from './queries.js'

/* ── Typed errors ────────────────────────────────────────────── */

export const LIBRARY_SAVE_ERRORS = Object.freeze({
  MISSING_DIMENSIONS: 'library/missing-dimensions',
  UNKNOWN_VALUE: 'library/unknown-value',
  INVALID_STATE: 'library/invalid-state',
  NOT_SIGNED_IN: 'library/not-signed-in',
  READ_ONLY_STUDIO: 'library/read-only-studio',
})

export class LibrarySaveError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'LibrarySaveError'
    this.code = code
    Object.assign(this, details)
  }
}

/**
 * Thrown when a document is asked to become `classified` without every field
 * its studio requires. Names each missing field, because "this document is not
 * ready" that does not say what is missing is a dead end for the teacher.
 */
export class MissingDimensionsError extends LibrarySaveError {
  constructor(studioId, missing) {
    const list = missing.join(', ')
    super(
      LIBRARY_SAVE_ERRORS.MISSING_DIMENSIONS,
      `This ${studioId} document needs ${list} before it can be filed in your library.`,
      { studioId, missing: [...missing] },
    )
    this.name = 'MissingDimensionsError'
  }
}

/** Thrown when a non-null value does not resolve to anything the taxonomy knows. */
export class UnknownValueError extends LibrarySaveError {
  constructor(field, value) {
    super(
      LIBRARY_SAVE_ERRORS.UNKNOWN_VALUE,
      `“${String(value)}” is not a ${field} ZedExams recognises.`,
      { field, value },
    )
    this.name = 'UnknownValueError'
  }
}

/* ── Normalisation ───────────────────────────────────────────── */

const DIMENSION_NORMALIZERS = {
  curriculum: normalizeCurriculum,
  grade: normalizeGrade,
  term: normalizeTerm,
  subject: normalizeSubject,
}

/**
 * Fold the four classification dimensions onto canonical values.
 *
 * Absent and explicit-null both pass through as null — "the teacher has not
 * said" is a legitimate state, and for a dimension the studio does not require
 * it is a permanently legitimate one. A value that was SUPPLIED and does not
 * resolve is different: that is a caller sending something we cannot file, and
 * it throws rather than being quietly nulled into the Unsorted pile.
 */
export function normalizeLibraryDimensions(meta = {}) {
  const out = {}
  for (const [dim, normalize] of Object.entries(DIMENSION_NORMALIZERS)) {
    const raw = meta[dim]
    if (raw === undefined || raw === null || raw === '') {
      out[dim] = null
      continue
    }
    const value = normalize(raw)
    if (value == null) throw new UnknownValueError(dim, raw)
    out[dim] = value
  }
  return out
}

/* ── The plan ────────────────────────────────────────────────── */

function assertLifecycle(targetState) {
  if (!LIBRARY_STATE_VALUES.includes(targetState)) {
    throw new LibrarySaveError(
      LIBRARY_SAVE_ERRORS.INVALID_STATE,
      `Unknown library state: ${String(targetState)}`,
      { targetState },
    )
  }
}

function resolveStatus(status) {
  return DOCUMENT_STATUSES.includes(status) ? status : 'draft'
}

/**
 * Build the write plan for one save.
 *
 * @param {object} args
 * @param {string} args.studioId
 * @param {string|null} args.docId                 null creates
 * @param {object} args.meta                       Partial<LibraryMeta> from the studio
 * @param {object} [args.payload]                  studio body, passed through untouched
 * @param {'working'|'classified'|'archived'} args.targetState
 * @param {string} args.uid                        authenticated author
 * @param {object} [args.existing]                 the stored meta, when updating
 * @param {unknown} args.timestamp                 server-timestamp sentinel
 * @param {number} [args.currentYear]              defaults academicYear
 * @returns {{
 *   op: 'create'|'update', collection: string, docId: string|null,
 *   fields: Record<string, unknown>, meta: object, before: object|null,
 *   classificationState: string,
 * }}
 */
export function buildSavePlan({
  studioId,
  docId = null,
  meta: metaInput = {},
  payload = null,
  targetState,
  uid,
  existing = null,
  timestamp,
  currentYear,
}) {
  const studio = requireStudio(studioId)
  assertLifecycle(targetState)

  if (!uid) {
    throw new LibrarySaveError(
      LIBRARY_SAVE_ERRORS.NOT_SIGNED_IN,
      'Sign in again to save to your library.',
    )
  }
  if (studio.readOnly) {
    // Syllabi are platform-owned. A teacher write here would create a document
    // in a folder whose contents nobody maintains.
    throw new LibrarySaveError(
      LIBRARY_SAVE_ERRORS.READ_ONLY_STUDIO,
      `${studio.label} are provided by ZedExams and cannot be saved from a studio.`,
      { studioId },
    )
  }

  const dimensions = normalizeLibraryDimensions(metaInput)

  // DERIVED, never supplied. A caller can pass classificationState; it is
  // discarded here, which is what the spoofing test pins.
  const classificationState = computeClassificationState(dimensions, studio)

  if (targetState === LIBRARY_STATES.CLASSIFIED
      && classificationState === CLASSIFICATION_STATES.NEEDS_SORTING) {
    throw new MissingDimensionsError(studio.id, missingRequiredDimensions(dimensions, studio))
  }

  const isCreate = !docId
  const academicYear = Number.isFinite(metaInput.academicYear)
    ? metaInput.academicYear
    : (existing?.academicYear ?? currentYear)

  const meta = {
    ...dimensions,
    // Stamped from the call, never from `meta`.
    studio: studio.id,
    academicYear,
    title: typeof metaInput.title === 'string' ? metaInput.title : (existing?.title ?? ''),
    status: resolveStatus(metaInput.status ?? existing?.status),
    libraryState: targetState,
    classificationState,
    libraryMetaVersion: LIBRARY_META_VERSION,
    metaSource: 'user_set',
    scope: 'personal',
    schoolId: null,
    updatedAt: timestamp,
  }

  if (metaInput.sourceDocumentId !== undefined) {
    meta.sourceDocumentId = metaInput.sourceDocumentId || null
  }

  // `archivedAt` is written only when the lifecycle actually crosses the
  // archive boundary, so a re-save of an archived document does not keep
  // moving the date it was archived on.
  const wasArchived = existing?.libraryState === LIBRARY_STATES.ARCHIVED
  if (targetState === LIBRARY_STATES.ARCHIVED && !wasArchived) {
    meta.archivedAt = timestamp
  } else if (targetState !== LIBRARY_STATES.ARCHIVED && wasArchived) {
    meta.archivedAt = null
  }

  if (isCreate) {
    meta.createdBy = uid
    meta.createdAt = timestamp
  }
  // On update `createdBy` and `createdAt` are absent from the field map — the
  // author of a document is not something a later save gets to restate.

  const payloadFields = payload && typeof payload === 'object' ? { ...payload } : {}
  // The payload is the studio's own body and never the metadata block: a
  // studio that could write `libraryMeta` directly could file itself anywhere.
  delete payloadFields[LIBRARY_META_FIELD]

  const fields = isCreate
    // The collection's own owner field is stamped alongside the block: every
    // library query filters on it (see OWNER_FIELD in studios.js), so a document
    // saved without it would be invisible to the folder it belongs in.
    ? { ...payloadFields, [studio.ownerField]: uid, [LIBRARY_META_FIELD]: meta }
    // An update addresses each metadata field by dot path, so Firestore merges
    // them into the stored map instead of replacing it — the same named-field
    // discipline the rest of this codebase writes with, one level down.
    : { ...payloadFields, ...Object.fromEntries(
      Object.entries(meta).map(([key, value]) => [metaPath(key), value]),
    ) }

  const after = {
    ...(existing || {}),
    ...meta,
    createdBy: isCreate ? uid : (existing?.createdBy ?? uid),
  }

  return {
    op: isCreate ? 'create' : 'update',
    collection: studio.collection,
    docId,
    fields,
    meta: after,
    before: existing ? { ...existing } : null,
    classificationState,
  }
}
