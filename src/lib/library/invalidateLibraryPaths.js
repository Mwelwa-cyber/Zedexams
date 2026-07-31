/**
 * Count invalidation — "appears immediately", made mechanical.
 *
 * A folder count is an aggregate read with no listener behind it, so after a
 * mutation every count the document touched is wrong until something says so.
 * This module says so, and it is called from the shared save utility rather than
 * from each studio, because "remember to invalidate" is a rule every studio will
 * eventually forget once.
 *
 * The rule it implements: a metadata change invalidates BOTH the path the
 * document left and the path it arrived at. Grade 4 · Term 1 → Grade 5 · Term 2
 * refreshes two folder trees, not one — invalidating only the new path leaves
 * the old folder claiming a document it no longer holds, which looks exactly
 * like the stale folder records this architecture removed.
 *
 * Lifecycle transitions are path changes too: `working → classified` is a
 * document ENTERING the library (invalidate the after-paths), and
 * `classified → archived` is one leaving it (invalidate the before-paths).
 * That falls out of the same before/after treatment, because a working or
 * archived document contributes to no count and therefore yields no keys.
 *
 * The key-building half is pure and node-testable; only `invalidateLibraryPaths`
 * touches the cache.
 */

import { getStudio } from './studios.js'
import {
  CLASSIFICATION_STATES,
  LIBRARY_STATES,
  documentListKeyPrefix,
  folderCountKey,
  normalizePathFilters,
} from './queries.js'
import { invalidateKeys, invalidatePrefixes } from './libraryCountCache.js'

/**
 * Every count key a document contributes to.
 *
 * Only a `classified` document contributes: working autosaves and archived
 * documents are in no count, so they yield [] and a transition into or out of
 * those states naturally invalidates one side only.
 *
 * A path stops at its first null. A lesson plan with a grade but no term is
 * counted by the curriculum and grade folders and by nothing deeper — there is
 * no term folder that should be claiming it.
 *
 * Each key is emitted twice: once under the document's academic year and once
 * under the all-years view (`null`), because both are real views of the same
 * document and a year switcher that shows a stale total is the same bug.
 *
 * @param {import('./queries.js').LibraryMeta|null} meta
 * @returns {string[]}
 */
export function libraryCountKeysFor(meta) {
  if (!meta || meta.libraryState !== LIBRARY_STATES.CLASSIFIED) return []
  const studio = getStudio(meta.studio)
  if (!studio || !meta.createdBy) return []

  const path = normalizePathFilters(meta)
  const years = [meta.academicYear ?? null, null]
  const keys = new Set()

  for (const academicYear of years) {
    const walked = {}
    for (const dim of studio.hierarchy) {
      if (path[dim] == null) break
      walked[dim] = path[dim]
      keys.add(folderCountKey({
        createdBy: meta.createdBy, studio: studio.id, academicYear, path: { ...walked },
      }))
    }
    if (meta.classificationState === CLASSIFICATION_STATES.NEEDS_SORTING) {
      keys.add(folderCountKey({
        createdBy: meta.createdBy, studio: studio.id, academicYear, path: {}, bucket: 'unsorted',
      }))
    }
  }
  return [...keys]
}

/**
 * The list-cache prefixes a document's path covers — every hierarchy prefix,
 * outermost first. Prefixes rather than keys because a list key also carries
 * sort and page size, which the mutation knows nothing about.
 */
export function libraryListPrefixesFor(meta) {
  if (!meta || !meta.createdBy) return []
  const studio = getStudio(meta.studio)
  if (!studio) return []

  const path = normalizePathFilters(meta)
  const years = [meta.academicYear ?? null, null]
  const prefixes = new Set()

  for (const academicYear of years) {
    const walked = {}
    prefixes.add(documentListKeyPrefix({
      createdBy: meta.createdBy, studio: studio.id, academicYear, path: {},
    }))
    for (const dim of studio.hierarchy) {
      if (path[dim] == null) break
      walked[dim] = path[dim]
      prefixes.add(documentListKeyPrefix({
        createdBy: meta.createdBy, studio: studio.id, academicYear, path: { ...walked },
      }))
    }
  }
  return [...prefixes]
}

/**
 * The union of the keys `before` and `after` affect — the pure half, so a test
 * can assert "a grade move yields both trees" without a cache.
 *
 * @param {import('./queries.js').LibraryMeta|null} before  null on create
 * @param {import('./queries.js').LibraryMeta|null} after   null on delete
 * @returns {{ countKeys: string[], listPrefixes: string[] }}
 */
export function libraryPathKeys(before, after) {
  const countKeys = new Set([...libraryCountKeysFor(before), ...libraryCountKeysFor(after)])
  const listPrefixes = new Set([
    ...libraryListPrefixesFor(before),
    ...libraryListPrefixesFor(after),
  ])
  return { countKeys: [...countKeys], listPrefixes: [...listPrefixes] }
}

/**
 * Invalidate every count and list cache entry a mutation affected.
 *
 * Call with (null, after) on create, (before, after) on edit, and (before, null)
 * on delete. Returns what it dropped so a caller can log or assert on it.
 *
 * @param {import('./queries.js').LibraryMeta|null} before
 * @param {import('./queries.js').LibraryMeta|null} after
 */
export function invalidateLibraryPaths(before, after) {
  const { countKeys, listPrefixes } = libraryPathKeys(before, after)
  const counts = invalidateKeys(countKeys)
  const lists = invalidatePrefixes(listPrefixes)
  return { countKeys, listPrefixes, removed: counts + lists }
}
