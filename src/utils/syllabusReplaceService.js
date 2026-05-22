/**
 * Syllabus-replace service — client wrappers for the Phase A upload flow,
 * the Phase B active-version helpers, and the Phase C
 * activateSyllabusVersion callable.
 *
 * The actual parse happens server-side (parseSyllabusUpload Storage
 * trigger), the active-version flip happens server-side (this module's
 * activateVersion callable), and everything else is read-only.
 *
 * Lives in src/utils/ next to adminCbcKbService.js (which still owns the
 * core topic CRUD); this module focuses on the bulk-replace pipeline.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import {
  getStorage,
  ref as storageRef,
  uploadBytesResumable,
} from 'firebase/storage'

import app, { db } from '../firebase/config'
import { getActiveKbVersion } from './adminCbcKbService'

const functions = getFunctions(app, 'us-central1')
const activateSyllabusVersionCallable = httpsCallable(
  functions, 'activateSyllabusVersion', { timeout: 540_000 },
)
const rollbackSyllabusVersionCallable = httpsCallable(
  functions, 'rollbackSyllabusVersion', { timeout: 60_000 },
)
const cleanupArchivedSyllabusDataCallable = httpsCallable(
  functions, 'cleanupArchivedSyllabusData', { timeout: 540_000 },
)
const invalidateKbCacheCallable = httpsCallable(
  functions, 'invalidateKbCache', { timeout: 30_000 },
)

// ── Version naming ───────────────────────────────────────────────────────

/**
 * Default version id for a brand-new upload pipeline. The admin can
 * override in the UI, but this is a sensible starting point that sorts
 * chronologically alongside the existing seed-version naming.
 */
export function suggestNextVersionId(date = new Date()) {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  return `cbc-kb-${yyyy}-${mm}-national`
}

/** Cheap shape check — keep the server validator authoritative. */
export function isPlausibleVersionId(v) {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]{2,79}$/.test(String(v || ''))
}

// ── Storage upload ───────────────────────────────────────────────────────

/**
 * Upload one .xlsx into syllabus-uploads/{version}/{filename}. The
 * Phase-A parseSyllabusUpload Storage trigger fires on finalize and
 * writes drafts + uploadStatus. The promise resolves when the upload
 * itself finishes — the UI should still subscribe to uploadStatus to
 * observe the parse step.
 *
 * Calls `onProgress({ bytesTransferred, totalBytes })` as the upload
 * progresses so the UI can render a percent.
 */
export function uploadSyllabusFile({ version, file, onProgress }) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('No file selected.'))
      return
    }
    if (!isPlausibleVersionId(version)) {
      reject(new Error('Invalid version id.'))
      return
    }
    const storage = getStorage(app)
    const path = `syllabus-uploads/${version}/${file.name}`
    const contentType =
      file.type ||
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    const task = uploadBytesResumable(
      storageRef(storage, path),
      file,
      { contentType, customMetadata: { uploadedBy: 'syllabus-replace-studio' } },
    )
    task.on(
      'state_changed',
      (snap) => {
        if (typeof onProgress === 'function') {
          onProgress({
            bytesTransferred: snap.bytesTransferred,
            totalBytes: snap.totalBytes,
          })
        }
      },
      (err) => reject(err),
      () => resolve({ path, filename: file.name }),
    )
  })
}

// ── Live subscriptions ──────────────────────────────────────────────────

/**
 * Subscribe to upload+parse status for every file uploaded under a given
 * version. Returns the unsubscribe function so the caller can clean up.
 * The Cloud Function writes one doc per filename with
 *   { filename, status: 'parsing'|'parsed'|'error', topicCount,
 *     pacingEntryCount, sheetsProcessed, warnings, error, updatedAt }.
 */
export function subscribeUploadStatus(version, callback) {
  if (!version) return () => undefined
  const col = collection(db, 'cbcKnowledgeBase', version, 'uploadStatus')
  return onSnapshot(
    col,
    (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      callback({ ok: true, rows })
    },
    (err) => callback({ ok: false, error: err }),
  )
}

/**
 * Subscribe to the draft topic count + per-subject breakdown for a
 * version. Re-aggregates on every change so the review pane updates
 * live as more files finish parsing.
 */
export function subscribeDraftSummary(version, callback) {
  if (!version) return () => undefined
  const col = collection(db, 'cbcKnowledgeBase', version, 'draftTopics')
  return onSnapshot(
    col,
    (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      const bySubject = new Map()
      const byGrade = new Map()
      let subtopicTotal = 0
      for (const r of rows) {
        const sj = r.subject || 'unknown'
        const gr = r.grade || 'unknown'
        bySubject.set(sj, (bySubject.get(sj) || 0) + 1)
        byGrade.set(gr, (byGrade.get(gr) || 0) + 1)
        subtopicTotal += Array.isArray(r.subtopics) ? r.subtopics.length : 0
      }
      callback({
        ok: true,
        topicCount: rows.length,
        subtopicCount: subtopicTotal,
        bySubject: Object.fromEntries(bySubject),
        byGrade: Object.fromEntries(byGrade),
        topics: rows,
      })
    },
    (err) => callback({ ok: false, error: err }),
  )
}

/**
 * One-shot list of draft topics for a version (used by the per-topic
 * review modal if the admin wants to inspect details).
 */
export async function listDraftTopics(version) {
  if (!version) return []
  try {
    const snap = await getDocs(query(
      collection(db, 'cbcKnowledgeBase', version, 'draftTopics'),
      orderBy('grade'),
    ))
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  } catch (err) {
    console.error('listDraftTopics failed', err)
    return []
  }
}

// ── Active-version metadata ─────────────────────────────────────────────

/**
 * Read the active-version pointer doc itself (not just the version
 * string — also previousVersion, usePrivateCurriculum, cacheBust). For
 * the admin UI's "Currently active" panel.
 */
export async function getActiveVersionMeta() {
  try {
    const snap = await getDoc(doc(db, 'cbcKnowledgeBase', '_meta'))
    if (!snap.exists()) {
      const fallback = await getActiveKbVersion()
      return {
        version: fallback,
        previousVersion: null,
        usePrivateCurriculum: true,
        cacheBust: 0,
        exists: false,
      }
    }
    const data = snap.data() || {}
    return {
      version: data.version || (await getActiveKbVersion()),
      previousVersion: data.previousVersion || null,
      usePrivateCurriculum: data.usePrivateCurriculum !== false,
      cacheBust: Number(data.cacheBust) || 0,
      activatedBy: data.activatedBy || null,
      activatedAt: data.activatedAt || null,
      exists: true,
    }
  } catch (err) {
    console.error('getActiveVersionMeta failed', err)
    return {
      version: 'cbc-kb-2026-04-seed',
      previousVersion: null,
      usePrivateCurriculum: true,
      cacheBust: 0,
      exists: false,
      error: String(err?.message || err),
    }
  }
}

// ── Callable wrappers ───────────────────────────────────────────────────

/**
 * Activate a version. Atomically promotes draftTopics → topics and flips
 * the pointer. `expectedPreviousVersion` protects against two admins
 * racing — pass the version that was active when the admin clicked the
 * button; the server refuses if someone else activated in the meantime.
 */
export async function activateVersion({ version, expectedPreviousVersion }) {
  try {
    const result = await activateSyllabusVersionCallable({
      version, expectedPreviousVersion,
    })
    return { ok: true, ...result.data }
  } catch (err) {
    console.error('activateVersion failed', err)
    return {
      ok: false,
      code: err?.code || null,
      error: err?.message || 'Activate failed.',
    }
  }
}

/**
 * One-click rollback to whatever version was active before the most
 * recent activate. Flips the pointer, restores RAG fallback, bumps
 * cacheBust. No data movement — the previous version's topics/* docs
 * were left in place by activateSyllabusVersion exactly for this case.
 * `expectedCurrentVersion` protects against admin races (server checks).
 */
export async function rollbackVersion({ expectedCurrentVersion } = {}) {
  try {
    const result = await rollbackSyllabusVersionCallable({
      expectedCurrentVersion,
    })
    return { ok: true, ...result.data }
  } catch (err) {
    console.error('rollbackVersion failed', err)
    return {
      ok: false,
      code: err?.code || null,
      error: err?.message || 'Rollback failed.',
    }
  }
}

// ── Phase E cleanup wrappers ────────────────────────────────────────────

/**
 * Read-only audit of the data Phase E can delete. Returns counts for
 * curriculum/*, rag_chunks/*, and every cbcKnowledgeBase/{version}/topics/*.
 * Safe to call at any time.
 */
export async function auditArchivedData() {
  try {
    const result = await cleanupArchivedSyllabusDataCallable({ mode: 'audit' })
    return { ok: true, ...result.data }
  } catch (err) {
    console.error('auditArchivedData failed', err)
    return {
      ok: false, code: err?.code || null,
      error: err?.message || 'Audit failed.',
    }
  }
}

/**
 * DESTRUCTIVE. Deletes curriculum/* and rag_chunks/* (the pre-Phase-A
 * RAG layer). Server refuses if _meta.usePrivateCurriculum is still
 * true — the RAG path must be off before the data is removable.
 */
export async function deleteArchivedRag() {
  try {
    const result = await cleanupArchivedSyllabusDataCallable({
      mode: 'delete-rag',
    })
    return { ok: true, ...result.data }
  } catch (err) {
    console.error('deleteArchivedRag failed', err)
    return {
      ok: false, code: err?.code || null,
      error: err?.message || 'Delete failed.',
    }
  }
}

/**
 * DESTRUCTIVE. Deletes cbcKnowledgeBase/{version}/topics/* recursively
 * (lessons subcollections included). Server refuses if version equals
 * active.version or active.previousVersion. `confirmVersion` must
 * exactly equal `version` — server enforces this as a deliberate-typo
 * guard.
 */
export async function deleteOldVersion({ version, confirmVersion }) {
  try {
    const result = await cleanupArchivedSyllabusDataCallable({
      mode: 'delete-version', version, confirmVersion,
    })
    return { ok: true, ...result.data }
  } catch (err) {
    console.error('deleteOldVersion failed', err)
    return {
      ok: false, code: err?.code || null,
      error: err?.message || 'Delete failed.',
    }
  }
}

/** Bump the active-state cache so studios refresh within ~10 s. */
export async function invalidateKbCache() {
  try {
    const result = await invalidateKbCacheCallable({})
    return { ok: true, ...result.data }
  } catch (err) {
    console.error('invalidateKbCache failed', err)
    return {
      ok: false,
      code: err?.code || null,
      error: err?.message || 'Cache invalidation failed.',
    }
  }
}

// ── Misc helpers (UI convenience) ───────────────────────────────────────

export function formatSubject(key) {
  if (!key || typeof key !== 'string') return '—'
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function timestampToDate(value) {
  if (!value) return null
  if (typeof value.toDate === 'function') return value.toDate()
  if (typeof value === 'string') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

// Marker for the firebase rules / docs to keep in sync. Treat this as a
// documentation pointer rather than runtime state — the server is the
// authoritative source.
export const SYLLABUS_UPLOAD_STORAGE_PREFIX = 'syllabus-uploads/'

// Re-export for callers that want a single import surface.
export { getActiveKbVersion, serverTimestamp }
