/**
 * firestorePage.js — build a cursor-based `fetchPage` for a Firestore query.
 *
 * This is the only pagination module that touches `firebase/firestore`. It
 * turns a declarative query spec (collection ref + where filters + sort) into
 * the `fetchPage({ pageSize, cursor })` function that `usePaginatedQuery`
 * drives, applying the rules the pure `cursors.js` layer defines:
 *
 *   - a deterministic secondary sort on `documentId()` is always appended, so
 *     rows with equal primary-sort values keep a stable order across page
 *     boundaries (no dropped or duplicated rows — Prompt 16 §2/§3)
 *   - the page is over-fetched by one row (`overfetchLimit`) so end-of-results
 *     is exact, not the ambiguous "returned fewer than pageSize" (§7)
 *   - the cursor handed back is the last *document snapshot*, so the next
 *     page's `startAfter(snapshot)` resolves the multi-field ordering exactly,
 *     even after the cursor doc's own ordering value changed (§2/§19)
 *
 * Security-rule alignment (§24): the caller supplies the `where()` filters, so
 * every tenant-scoping predicate (schoolId / ownerId / status=='published')
 * travels with the query — pagination never widens the authorised set.
 */

import {
  collection, collectionGroup, query, orderBy, limit, startAfter, getDocs, documentId,
} from 'firebase/firestore'
import { overfetchLimit, splitOverfetch } from '../../../utils/pagination/cursors.js'

/**
 * @typedef {Object} FirestorePageSpec
 * @property {import('firebase/firestore').Firestore} db
 * @property {string} path collection (or collection-group) path, e.g. `"assessments"`
 * @property {boolean} [group] treat `path` as a collectionGroup id rather than a top-level collection
 * @property {import('firebase/firestore').QueryConstraint[]} [constraints] where() filters (tenant scope etc.)
 * @property {Array<{ field: string, direction?: 'asc'|'desc' }>} orderByFields primary ordering; documentId tiebreaker is appended automatically
 * @property {(docSnap: import('firebase/firestore').QueryDocumentSnapshot) => any} [mapDoc] row shaper (defaults to `{ id, ...data }`)
 * @property {'asc'|'desc'} [tiebreakDirection] direction for the appended documentId sort (defaults to the last primary sort's direction)
 */

function defaultMapDoc(docSnap) {
  return { id: docSnap.id, ...docSnap.data() }
}

/**
 * Build a `fetchPage` closure for a Firestore collection.
 * @param {FirestorePageSpec} spec
 * @returns {(args: { pageSize: number, cursor?: import('firebase/firestore').QueryDocumentSnapshot|null }) => Promise<{ items: any[], cursor: any, hasNextPage: boolean }>}
 */
export function createFirestorePageFetcher(spec) {
  const {
    db, path, group = false, constraints = [], orderByFields, mapDoc = defaultMapDoc, tiebreakDirection,
  } = spec

  if (!Array.isArray(orderByFields) || orderByFields.length === 0) {
    throw new Error('createFirestorePageFetcher requires at least one orderByFields entry (stable ordering is mandatory)')
  }

  const lastPrimary = orderByFields[orderByFields.length - 1]
  const tieDir = tiebreakDirection || lastPrimary.direction || 'asc'

  return async function fetchPage({ pageSize, cursor } = {}) {
    const colRef = group ? collectionGroup(db, path) : collection(db, path)

    const orderConstraints = orderByFields.map((o) => orderBy(o.field, o.direction || 'asc'))
    // Deterministic tiebreaker: __name__ (documentId). Guarantees a total order
    // so a cursor never straddles two rows with an equal primary value.
    orderConstraints.push(orderBy(documentId(), tieDir))

    const parts = [...constraints, ...orderConstraints]
    if (cursor) parts.push(startAfter(cursor))
    parts.push(limit(overfetchLimit(pageSize)))

    const snap = await getDocs(query(colRef, ...parts))
    const docs = snap.docs
    const { items: pageDocs, hasNextPage } = splitOverfetch(docs, pageSize)

    return {
      items: pageDocs.map(mapDoc),
      // The cursor is the last *shown* document's snapshot (not the sentinel).
      cursor: pageDocs.length ? pageDocs[pageDocs.length - 1] : (cursor ?? null),
      hasNextPage,
    }
  }
}
