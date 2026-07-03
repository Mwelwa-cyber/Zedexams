/**
 * draftCloudSync — the cloud (cross-device) layer of the Universal Draft
 * Manager. Generalises useAssessmentDraft.js's Firestore mirror.
 *
 * Collection shape: `drafts/{uid}/items/{draftId}` — one doc per in-progress
 * draft (NOT a per-user singleton, so a teacher can have many concurrent
 * drafts across studios). Mirrors the existing owner-scoped
 * `questionBankFavourites/{uid}/items/{favId}` pattern.
 *
 * The whole payload is stored as a single JSON string (`data`) to dodge
 * Firestore's no-nested-arrays rule (tables, matching answers, etc.). Writes
 * go through a transaction guarded on `savedAt`, so a stale draft can't
 * overwrite a fresher one — this also defuses the offline-replay hazard: unlike
 * a queued setDoc, a transaction needs connectivity, so a stale draft can't be
 * silently replayed over a newer one when a device comes back online.
 *
 * Every function is best-effort: any failure (offline, rules, quota) is
 * swallowed so the local store remains the source of truth.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  deleteDoc,
  serverTimestamp,
  runTransaction,
} from 'firebase/firestore'
import { db } from '../../firebase/config'
import { REMOTE_MAX_CHARS, isLiveDraft, pickFreshestDraft } from './draftCore.js'

function draftDocRef(uid, draftId) {
  return doc(db, 'drafts', uid, 'items', draftId)
}

/**
 * Mirror a draft to Firestore. Returns:
 *   'synced'      — written to the cloud
 *   'too-large'   — over REMOTE_MAX_CHARS, kept local-only (surfaced in the UI)
 *   'skipped'     — a newer remote draft already won the transaction
 *   'error'       — offline / rules / quota (non-fatal; local still holds it)
 */
export async function saveDraftRemote({ uid, studioId, draftId, payload, versions }) {
  if (!uid || !draftId || !payload) return 'error'
  const data = JSON.stringify(payload)
  // The version ring competes for the same 1 MiB doc budget; drop it first when
  // near the cap so the payload itself still syncs.
  let versionsStr = ''
  try {
    versionsStr = versions && versions.length ? JSON.stringify(versions) : ''
  } catch {
    versionsStr = ''
  }
  if (data.length > REMOTE_MAX_CHARS) return 'too-large'
  if (data.length + versionsStr.length > REMOTE_MAX_CHARS) versionsStr = ''

  try {
    const ref = draftDocRef(uid, draftId)
    let outcome = 'synced'
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref)
      const storedSavedAt = snap.exists() ? Number(snap.data()?.savedAt) || 0 : 0
      if (storedSavedAt > (payload.savedAt || 0)) {
        outcome = 'skipped' // a newer draft already won
        return
      }
      const docData = {
        studioId,
        data,
        savedAt: payload.savedAt || Date.now(),
        schemaVersion: payload.schemaVersion ?? 1,
        updatedAt: serverTimestamp(),
      }
      if (versionsStr) docData.versions = versionsStr
      tx.set(ref, docData)
    })
    return outcome
  } catch {
    return 'error'
  }
}

export async function loadDraftRemote({ uid, studioId, draftId, descriptor }) {
  if (!uid || !draftId) return null
  try {
    const snap = await getDoc(draftDocRef(uid, draftId))
    if (!snap.exists()) return null
    const raw = snap.data()
    if (!raw?.data) return null
    const payload = JSON.parse(raw.data)
    if (descriptor && !isLiveDraft(payload, descriptor)) return null
    let versions = []
    if (raw.versions) {
      try { versions = JSON.parse(raw.versions) } catch { versions = [] }
    }
    return { payload, versions, studioId: raw.studioId || studioId }
  } catch {
    return null
  }
}

export async function deleteDraftRemote({ uid, draftId }) {
  if (!uid || !draftId) return
  try {
    await deleteDoc(draftDocRef(uid, draftId))
  } catch {
    // Non-fatal — a stale remote draft is overwritten on the next save.
  }
}

/**
 * Load the freshest draft across this device (`local`, already read by the
 * caller) and the cloud. The studio uses `source` to tailor the restore copy
 * ("recovered from another device").
 */
export async function loadDraftMerged({ uid, studioId, draftId, descriptor, local }) {
  const remoteRecord = await loadDraftRemote({ uid, studioId, draftId, descriptor })
  const remote = remoteRecord?.payload || null
  const { draft, source } = pickFreshestDraft(local, remote)
  return { draft, source, remoteVersions: remoteRecord?.versions || [] }
}

/** List every cloud draft a teacher owns (powers the future Recovery Centre). */
export async function listDraftsRemote({ uid }) {
  if (!uid) return []
  try {
    const snap = await getDocs(collection(db, 'drafts', uid, 'items'))
    return snap.docs.map((d) => {
      const raw = d.data()
      let payload = null
      try { payload = raw?.data ? JSON.parse(raw.data) : null } catch { payload = null }
      return { draftId: d.id, studioId: raw?.studioId, savedAt: raw?.savedAt, payload }
    })
  } catch {
    return []
  }
}
