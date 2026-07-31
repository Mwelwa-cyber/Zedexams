/**
 * The single entry point every studio saves its library document through.
 *
 * Nothing decides anything here — `saveLibraryDocumentCore.js` builds the plan
 * (normalise, derive `classificationState`, validate the lifecycle, stamp the
 * server-owned fields) and this module performs it and invalidates the counts.
 * Keeping the decisions out of the Firestore layer is what makes them testable
 * without a Firebase mock, and keeping the invalidation HERE is what makes it
 * impossible for a studio to forget: there is one write path, and it refreshes
 * the folders on the way out.
 *
 * Studio migration is later steps (Lesson Plan Studio is step 3). This module
 * and its tests are the contract those steps build on.
 */

import { collection, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { requireStudio } from './studios.js'
import { buildSavePlan } from './saveLibraryDocumentCore.js'
import { invalidateLibraryPaths } from './invalidateLibraryPaths.js'
import { LIBRARY_META_FIELD, LIBRARY_META_FIELDS } from './queries.js'

export {
  LibrarySaveError,
  MissingDimensionsError,
  UnknownValueError,
  LIBRARY_SAVE_ERRORS,
} from './saveLibraryDocumentCore.js'

/**
 * Pull just the metadata block out of a stored document. Unknown keys are
 * dropped rather than carried, so a stray field on the document can never
 * travel into the invalidator as if it were part of the contract.
 */
function readMeta(snapshotData) {
  const stored = snapshotData?.[LIBRARY_META_FIELD]
  if (!stored || typeof stored !== 'object') return null
  const meta = {}
  for (const field of LIBRARY_META_FIELDS) {
    if (stored[field] !== undefined) meta[field] = stored[field]
  }
  return meta
}

/**
 * Create or update a library document.
 *
 * @param {object} args
 * @param {string} args.studioId                  a StudioId from the registry
 * @param {string|null} [args.docId]              null creates
 * @param {object} args.meta                      Partial<LibraryMeta> from the studio
 * @param {object} [args.payload]                 studio body — passed through untouched
 * @param {'working'|'classified'|'archived'} args.targetState
 * @param {string} args.uid                       the authenticated author
 * @param {object} [args.deps]                    injection seam for tests
 * @returns {Promise<{ id: string, meta: object, classificationState: string }>}
 */
export async function saveLibraryDocument({
  studioId,
  docId = null,
  meta = {},
  payload = null,
  targetState,
  uid,
  deps = {},
}) {
  const firestore = deps.db || db
  const now = deps.now || (() => new Date())
  const studio = requireStudio(studioId)

  // The stored metadata is read before the write for two reasons: the plan needs
  // to know whether this document was already archived, and the invalidator
  // needs the path the document is LEAVING. Skipped on create, where there is
  // no before.
  let existing = null
  let documentExists = false
  let existingCreatedAt
  if (docId) {
    const snap = await getDoc(doc(firestore, studio.collection, docId))
    documentExists = snap.exists()
    if (documentExists) {
      const data = snap.data()
      existing = readMeta(data)
      // A legacy document exists with no block at all. The plan needs both facts
      // — that the document is real, and that it has no block — to stamp the
      // identity fields on this first write instead of omitting them and being
      // refused by the rules.
      existingCreatedAt = data?.createdAt
    }
  }

  const plan = buildSavePlan({
    studioId,
    docId,
    meta,
    payload,
    targetState,
    uid,
    existing,
    documentExists,
    existingCreatedAt,
    timestamp: deps.timestamp || serverTimestamp(),
    currentYear: now().getFullYear(),
  })

  const ref = plan.docId
    ? doc(firestore, plan.collection, plan.docId)
    : doc(collection(firestore, plan.collection))

  if (plan.op === 'create') {
    await setDoc(ref, plan.fields)
  } else {
    // Named-field merge. Never `setDoc(ref, wholeDocument)` — a whole-document
    // rewrite here would drop whatever another writer changed in between, which
    // is the shape of data loss this codebase has already paid for once.
    await updateDoc(ref, plan.fields)
  }

  invalidateLibraryPaths(plan.before, plan.meta)

  return { id: ref.id, meta: plan.meta, classificationState: plan.classificationState }
}
