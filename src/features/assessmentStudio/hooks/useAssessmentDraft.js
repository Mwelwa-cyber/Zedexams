/**
 * Auto-save the assessment-studio draft so a refresh doesn't throw away
 * typed work. Mirror of useCreateQuizDraft but with a separate localStorage
 * namespace so admin quiz drafts and teacher assessment drafts don't collide.
 *
 * Two layers:
 *   - localStorage  — instant, offline-safe, per-device (the source of truth
 *                     while actively editing on one machine).
 *   - Firestore     — `assessmentDrafts/{uid}`, one doc per teacher, so an
 *                     unsaved paper follows them across devices. The whole
 *                     draft is stored as a single JSON string ('data') to
 *                     dodge Firestore's no-nested-arrays rule (tables,
 *                     matching answers, etc.). Best-effort: any failure
 *                     (offline, rules, quota) is swallowed and localStorage
 *                     remains the fallback.
 *
 * On load we read both and keep whichever has the newer `savedAt`, so the
 * last device you typed on wins (last-write-wins). Remote writes go through a
 * transaction guarded on `savedAt`, so a stale draft can't overwrite a fresher
 * one (e.g. a queued offline write replaying after another device saved).
 *
 * The pure helpers (strip/build/validate/merge) live in assessmentDraftCore.js
 * so they can be unit tested without pulling in Firebase.
 */

import { doc, getDoc, deleteDoc, serverTimestamp, runTransaction } from 'firebase/firestore'
import { db } from '../../../firebase/config'
import {
  REMOTE_MAX_CHARS,
  draftKey,
  buildDraftPayload,
  isLiveDraft,
  pickFreshestDraft,
} from '../lib/assessmentDraftCore.js'

export { pickFreshestDraft } from '../lib/assessmentDraftCore.js'

export function saveAssessmentDraft(userId, payload) {
  if (!userId || !payload) return
  try {
    localStorage.setItem(draftKey(userId), JSON.stringify(buildDraftPayload(payload)))
  } catch {
    // Quota exceeded or private-browsing restriction — ignore
  }
}

export function loadAssessmentDraft(userId) {
  if (!userId) return null
  try {
    const raw = localStorage.getItem(draftKey(userId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!isLiveDraft(parsed)) {
      if (parsed?.savedAt) localStorage.removeItem(draftKey(userId))
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function clearAssessmentDraft(userId) {
  if (!userId) return
  try {
    localStorage.removeItem(draftKey(userId))
  } catch {
    // Private-browsing restriction — nothing to clean up.
  }
}

/* ───────────────── Firestore mirror (cross-device) ───────────────── */

function remoteDraftRef(userId) {
  return doc(db, 'assessmentDrafts', userId)
}

// Mirror the draft to Firestore as a single JSON string. Best-effort — any
// failure leaves localStorage as the source of truth.
//
// Guarded by a transaction so a *newer* remote draft is almost never clobbered
// by an older one: a write only lands when its savedAt is at least the stored
// one (an exact-millisecond tie lets the later write win, which is harmless for
// a single-user draft). This also defuses the offline-replay hazard — unlike a
// queued setDoc, a transaction needs connectivity, so a stale draft can't be
// silently replayed over a fresher one when a device comes back online.
export async function saveAssessmentDraftRemote(userId, payload) {
  if (!userId || !payload) return
  try {
    const built = buildDraftPayload(payload)
    const data = JSON.stringify(built)
    if (data.length > REMOTE_MAX_CHARS) return
    const ref = remoteDraftRef(userId)
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref)
      const storedSavedAt = snap.exists() ? Number(snap.data()?.savedAt) || 0 : 0
      if (storedSavedAt > built.savedAt) return // a newer draft already won
      tx.set(ref, {
        data,
        savedAt: built.savedAt,
        updatedAt: serverTimestamp(),
      })
    })
  } catch {
    // Offline / rules / quota — non-fatal, localStorage still holds the draft.
  }
}

export async function loadAssessmentDraftRemote(userId) {
  if (!userId) return null
  try {
    const snap = await getDoc(remoteDraftRef(userId))
    if (!snap.exists()) return null
    const raw = snap.data()
    if (!raw?.data) return null
    const parsed = JSON.parse(raw.data)
    return isLiveDraft(parsed) ? parsed : null
  } catch {
    return null
  }
}

export async function clearAssessmentDraftRemote(userId) {
  if (!userId) return
  try {
    await deleteDoc(remoteDraftRef(userId))
  } catch {
    // Non-fatal — a stale remote draft is overwritten on the next save.
  }
}

/**
 * Load the freshest draft across this device (localStorage) and the cloud
 * (Firestore). The studio uses `source` to tailor the restore toast.
 */
export async function loadAssessmentDraftMerged(userId) {
  if (!userId) return { draft: null, source: null }
  const local = loadAssessmentDraft(userId)
  const remote = await loadAssessmentDraftRemote(userId)
  return pickFreshestDraft(local, remote)
}
