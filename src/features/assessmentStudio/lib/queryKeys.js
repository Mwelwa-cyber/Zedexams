/**
 * queryKeys.js — pagination-session query keys (Prompt 16 §6).
 *
 * A pagination session is identified by EVERY field that affects its result
 * set: the tenant scope (user / school / class / teacher), the curriculum
 * facets (curriculum / grade / subject / topic), the status + free-text
 * filters, the sort field + direction, and the page size. When any of those
 * change the key changes, and the hook that owns the key treats that as "this
 * is a different query" — it cancels the in-flight request, clears loaded
 * pages and cursors, and starts a fresh first page (Prompt 16 §6/§11/§14).
 *
 * Two keys with the same string are the SAME session; a Firestore cursor is
 * only ever reused within one key, because a cursor is valid only for the
 * exact query structure + ordering that produced it.
 *
 * Built on the same encoding as src/utils/cache/cacheKeys.js so a stray
 * `undefined` facet can never collide with an empty-string one and leak rows
 * between tenants.
 */

import { createCacheKey, normalizeSearchText, normalizeFilters } from '../../../utils/cache/cacheKeys.js'

// Field order: tenant/context first (so a prefix cut can invalidate "everything
// for this user+school"), granular + frequently-changing fields last. `page`
// is intentionally absent — a pagination *session* spans all its pages, so the
// per-page cursor (not a page number) distinguishes pages, not the key.
const PAGINATION_KEY_FIELDS = [
  'scope',
  'userId', 'schoolId', 'classId', 'teacherId',
  'curriculumId', 'curriculumVersion', 'gradeId', 'subjectId', 'topicId', 'subtopicId',
  'status', 'visibility',
  'filters',
  'search',
  'sortField', 'sortDirection',
  'pageSize',
  'schemaVersion',
]

function encodeField(name, fields) {
  if (name === 'filters') return normalizeFilters(fields.filters)
  if (name === 'search') return normalizeSearchText(fields.search)
  return fields[name]
}

/**
 * Build a stable pagination query key. `scope` is required (e.g.
 * `"question-bank"`, `"assessment-list"`, `"past-papers"`); every other field
 * is optional but MUST be supplied whenever it narrows the result set.
 *
 * @param {object} fields
 * @param {string} fields.scope
 * @returns {string}
 *
 * @example
 *   createPaginationKey({
 *     scope: 'question-bank', userId, schoolId, curriculumId, gradeId,
 *     subjectId, topicId, filters: { difficulty }, search: term,
 *     sortField: 'updatedAt', sortDirection: 'desc', pageSize: 25,
 *   })
 */
export function createPaginationKey(fields = {}) {
  if (!fields.scope) throw new Error('createPaginationKey requires a scope')
  const parts = ['page', ...PAGINATION_KEY_FIELDS.map((name) => encodeField(name, fields))]
  return createCacheKey(parts)
}
