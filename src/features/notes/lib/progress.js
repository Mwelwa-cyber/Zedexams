// src/features/notes/lib/progress.js
//
// Per-learner reading progress for notes. One document per learner+note in the
// `noteProgress` collection, keyed `{uid}_{noteId}` so a learner only ever
// addresses their own records (the Firestore rule also pins `uid` to the
// caller). UI talks to these helpers — never the SDK directly.
//
// Document shape:
//   { uid, noteId, grade, subject, title,
//     status: 'in-progress' | 'completed',
//     percent: 0..100,
//     startedAt?, lastOpenedAt?, completedAt?, updatedAt }

import {
  collection, doc, getDoc, setDoc, query, where, onSnapshot, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../../../firebase/config'

const COL = 'noteProgress'

export const NOTE_PROGRESS_STATUS = {
  NOT_STARTED: 'not-started',
  IN_PROGRESS: 'in-progress',
  COMPLETED:   'completed',
}

const idFor = (uid, noteId) => `${uid}_${noteId}`

// ─── reads ───────────────────────────────────────────────────────────

/**
 * Subscribe to all of a learner's progress records.
 * Calls onChange with a `{ [noteId]: progress }` map. Returns an unsubscribe.
 */
export function subscribeNoteProgress(uid, onChange, onError) {
  if (!uid) {
    onChange({})
    return () => {}
  }
  const q = query(collection(db, COL), where('uid', '==', uid))
  return onSnapshot(
    q,
    (snap) => {
      const map = {}
      snap.docs.forEach((d) => {
        const data = d.data()
        if (data?.noteId) map[data.noteId] = { id: d.id, ...data }
      })
      onChange(map)
    },
    (err) => {
      console.error('[notes] subscribeNoteProgress error:', err)
      onError?.(err)
    },
  )
}

/** Read a single progress record, or null. Best-effort: a denied/failed read
 * resolves to null (the reader treats it as a fresh open) rather than rejecting
 * — its caller in useRecordNoteProgress awaits this without a try/catch, so an
 * escaping rejection became "Missing or insufficient permissions" noise. */
export async function getNoteProgress(uid, noteId) {
  if (!uid || !noteId) return null
  try {
    const snap = await getDoc(doc(db, COL, idFor(uid, noteId)))
    return snap.exists() ? { id: snap.id, ...snap.data() } : null
  } catch (err) {
    console.warn('[notes] progress read skipped:', err?.code || err?.message || err)
    return null
  }
}

// ─── writes ──────────────────────────────────────────────────────────

/** Merge a patch onto a learner's progress record, always re-stamping the note metadata.
 *
 * Reading progress is best-effort telemetry — the callers in
 * useRecordNoteProgress fire these writes without awaiting. A failed write
 * (most often `permission-denied` from a listener firing after sign-out, or
 * a transient offline/network error) must therefore never escape as an
 * unhandled promise rejection: that was surfacing as "Missing or insufficient
 * permissions" client_errors on /notes/:id even though the reading experience
 * is unaffected. Swallow it here, logged but not thrown. */
async function writeNoteProgress(uid, note, patch) {
  if (!uid || !note?.id) return
  try {
    await setDoc(
      doc(db, COL, idFor(uid, note.id)),
      {
        uid,
        noteId: note.id,
        grade: note.grade != null ? String(note.grade) : null,
        subject: note.subject || null,
        title: note.title || null,
        ...patch,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    )
  } catch (err) {
    console.warn('[notes] progress write skipped:', err?.code || err?.message || err)
  }
}

/** Record that the learner opened the note. Never downgrades a completed note. */
export function recordNoteOpened(uid, note, { alreadyCompleted = false, isNew = false } = {}) {
  const patch = { lastOpenedAt: serverTimestamp() }
  if (isNew) patch.startedAt = serverTimestamp()
  if (!alreadyCompleted) patch.status = NOTE_PROGRESS_STATUS.IN_PROGRESS
  return writeNoteProgress(uid, note, patch)
}

/** Record the furthest read position (kept under the completion threshold). */
export function recordNotePercent(uid, note, percent) {
  return writeNoteProgress(uid, note, {
    percent: Math.max(0, Math.min(100, Math.round(percent))),
    status: NOTE_PROGRESS_STATUS.IN_PROGRESS,
  })
}

/** Mark the note completed (idempotent — completedAt is merged once). */
export function recordNoteCompleted(uid, note) {
  return writeNoteProgress(uid, note, {
    status: NOTE_PROGRESS_STATUS.COMPLETED,
    percent: 100,
    completedAt: serverTimestamp(),
  })
}
