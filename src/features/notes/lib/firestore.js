// src/features/notes/lib/firestore.js
//
// All Firestore operations for notes live here. UI components and hooks
// call these — never the SDK directly.
//
// Notes are stored in the existing `lessons` collection alongside the
// older slide-built lessons (which carry `noteFormat: undefined` and a
// `slides[]` array). Field names here mirror the lessons schema:
//   createdBy (not authorId), grade as string '4'|'5'|'6', term/week as strings.

import {
  collection, doc, query, where, orderBy, limit as fsLimit,
  getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  serverTimestamp, onSnapshot,
} from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { NOTE_STATUS, NOTE_FORMAT, normalizeSubject } from '../../../config/curriculum'
import { buildNoteSearchText } from '../reader/readerCore'

const NOTES = 'lessons'

const toGrade  = (v) => v == null || v === '' ? null : String(v)
const toString = (v) => v == null || v === '' ? null : String(v)

// ─── reads ───────────────────────────────────────────────────────────

/** Get a single note by id. Returns { id, ...data } or null. */
export async function getNote(id) {
  if (!id) return null
  const snap = await getDoc(doc(db, NOTES, id))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

/**
 * Subscribe to a teacher's own notes (drafts + published) with optional filters.
 * `uid` is required — the Firestore security rule on the `lessons` collection
 * only allows non-admin teachers to list documents they own (createdBy) or that
 * are published. Omitting this filter would cause every query for a regular
 * teacher to fail with "Missing or insufficient permissions."
 * Returns an unsubscribe function. Pass an `onChange` callback that gets the array.
 */
export function subscribeAdminNotes({ uid, subject, grade, status } = {}, onChange, onError) {
  if (!uid) {
    console.error('[notes] subscribeAdminNotes: uid is required')
    onError?.(new Error('subscribeAdminNotes: uid is required'))
    return () => {}
  }
  const constraints = [
    // Always scope to the caller's own notes so the query satisfies the
    // Firestore security rule (`createdBy == request.auth.uid`).
    where('createdBy', '==', uid),
  ]
  if (subject) constraints.push(where('subject', '==', subject))
  if (grade)   constraints.push(where('grade', '==', String(grade)))
  if (status)  constraints.push(where('status', '==', status))
  constraints.push(orderBy('updatedAt', 'desc'))

  const q = query(collection(db, NOTES), ...constraints)
  return onSnapshot(
    q,
    (snap) => {
      const notes = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      onChange(notes)
    },
    (err) => {
      console.error('[notes] subscribeAdminNotes error:', err)
      onError?.(err)
    },
  )
}

/** Subscribe to published notes for a specific grade (used by the learner side).
 *
 * NOTE: must filter by `isPublished` (boolean), not `status`. The Firestore
 * rule for the lessons collection grants learner reads via
 * `resource.data.isPublished == true`, and Firestore requires the query
 * to include that exact field. publishNote / unpublishNote write both
 * fields in lock-step so they always agree.
 */
export function subscribeLearnerNotes({ grade, subject }, onChange, onError) {
  if (!grade) {
    onChange([])
    return () => {}
  }
  const constraints = [
    where('isPublished', '==', true),
    where('grade', '==', String(grade)),
  ]
  if (subject) constraints.push(where('subject', '==', subject))
  constraints.push(orderBy('publishedAt', 'desc'))

  const q = query(collection(db, NOTES), ...constraints)
  return onSnapshot(
    q,
    (snap) => onChange(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    (err) => {
      console.error('[notes] subscribeLearnerNotes error:', err)
      onError?.(err)
    },
  )
}

/**
 * One-shot fetch of published reading notes for a grade — used by global
 * search, which needs a single read rather than a live subscription. Bounded
 * by `limit` (default 200) since it feeds a client-side substring match.
 */
export async function fetchLearnerNotes({ grade, limit = 200 } = {}) {
  if (!grade) return []
  try {
    const snap = await getDocs(query(
      collection(db, NOTES),
      where('isPublished', '==', true),
      where('grade', '==', String(grade)),
      orderBy('publishedAt', 'desc'),
      fsLimit(limit),
    ))
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
  } catch (err) {
    console.error('[notes] fetchLearnerNotes error:', err)
    return []
  }
}

// ─── writes ──────────────────────────────────────────────────────────

/**
 * Create a new note in the lessons collection.
 * Required: title, subject, grade, createdBy.
 * Returns the new note id.
 */
export async function createNote(data) {
  const required = ['title', 'subject', 'grade', 'createdBy']
  for (const key of required) {
    if (data[key] == null || data[key] === '') {
      throw new Error(`createNote: missing required field "${key}"`)
    }
  }

  const noteFormat = data.noteFormat || NOTE_FORMAT.RICH_TEXT

  const payload = {
    title:        String(data.title).trim(),
    // Repair a stray curriculum slug ("mathematics") to its display label
    // ("Mathematics"). The note editor only offers labels today, so this is
    // defensive — it future-proofs against any importer that writes a slug.
    subject:      normalizeSubject(data.subject),
    grade:        toGrade(data.grade),
    noteFormat,
    content:      noteFormat === NOTE_FORMAT.RICH_TEXT ? (data.content || '') : '',
    excerpt:      data.excerpt || '',
    // Visual slide-notes carry their whole deck ({header, theme, slides[]})
    // and a link back to the aiGenerations draft they were generated from.
    deck:             noteFormat === NOTE_FORMAT.VISUAL ? (data.deck || null) : null,
    sourceGenerationId: noteFormat === NOTE_FORMAT.VISUAL ? (data.sourceGenerationId || null) : null,
    // Structured study notes store their block array (parallel to `deck`).
    blocks:           noteFormat === NOTE_FORMAT.STUDY ? (Array.isArray(data.blocks) ? data.blocks : []) : null,
    fileUrl:      noteFormat === NOTE_FORMAT.FILE ? (data.fileUrl || null) : null,
    fileName:     noteFormat === NOTE_FORMAT.FILE ? (data.fileName || null) : null,
    storagePath:  noteFormat === NOTE_FORMAT.FILE ? (data.storagePath || null) : null,
    fileSize:     noteFormat === NOTE_FORMAT.FILE ? (data.fileSize || null) : null,
    status:       data.status || NOTE_STATUS.DRAFT,
    isPublished:  false,
    publishedAt:  null,
    term:         toString(data.term),
    week:         toString(data.week),
    assetBatchId: data.assetBatchId || null,
    // Optional 16:9 cover illustration shown on the learner note card.
    coverImage:   data.coverImage || null,
    // Stable key for idempotent seed imports (skip a note that's already seeded).
    seedKey:      data.seedKey || null,
    // What the Notes hub searches this note by: title + subject +
    // headings + key points, lower-cased (readerCore.buildNoteSearchText).
    // Stamped here so the cross-subject search can reach INTO a note
    // without the hub loading every note's blocks. Notes written before
    // this field existed are searched on a value the hub recomputes with
    // the same function, so both are searched identically.
    searchText:   buildNoteSearchText(
      // The NORMALISED subject, matching the stored field — a raw slug
      // ("integrated-science") would not be found by anyone typing the
      // subject as they read it on the page.
      { title: data.title, subject: normalizeSubject(data.subject), topic: data.topic },
      noteFormat === NOTE_FORMAT.STUDY && Array.isArray(data.blocks) ? data.blocks : [],
    ),
    createdBy:    data.createdBy,
    createdAt:    serverTimestamp(),
    updatedAt:    serverTimestamp(),
  }

  const ref = await addDoc(collection(db, NOTES), payload)
  return ref.id
}

/**
 * Update an existing note. Pass only the fields you want to change.
 * Status changes go through publishNote / unpublishNote — don't update status here.
 */
export async function updateNote(id, patch) {
  if (!id) throw new Error('updateNote: id is required')
  if ('status' in patch) {
    throw new Error('updateNote: use publishNote/unpublishNote to change status')
  }

  const safe = { ...patch, updatedAt: serverTimestamp() }
  if ('subject' in safe) safe.subject = normalizeSubject(safe.subject)
  if ('grade' in safe) safe.grade = toGrade(safe.grade)
  if ('term'  in safe) safe.term  = toString(safe.term)
  if ('week'  in safe) safe.week  = toString(safe.week)
  if ('title' in safe && typeof safe.title === 'string') safe.title = safe.title.trim()

  // Editing a note edits BOTH views, so the search index has to move with
  // it. Recomputed only when an input to it changed, and from the note as
  // it will be AFTER the patch — a title-only edit still needs the
  // stored headings, so the existing doc supplies whatever the patch
  // does not.
  if ('title' in safe || 'subject' in safe || 'blocks' in safe || 'topic' in safe) {
    const existing = 'blocks' in safe && 'title' in safe && 'subject' in safe
      ? null
      : await getNote(id)
    safe.searchText = buildNoteSearchText(
      {
        title:   'title'   in safe ? safe.title   : existing?.title,
        subject: 'subject' in safe ? safe.subject : existing?.subject,
        topic:   'topic'   in safe ? safe.topic   : existing?.topic,
      },
      Array.isArray('blocks' in safe ? safe.blocks : existing?.blocks)
        ? ('blocks' in safe ? safe.blocks : existing.blocks)
        : [],
    )
  }

  await updateDoc(doc(db, NOTES, id), safe)
}

/** Mark a note as published, stamping publishedAt. */
export async function publishNote(id) {
  if (!id) throw new Error('publishNote: id is required')
  await updateDoc(doc(db, NOTES, id), {
    status:      NOTE_STATUS.PUBLISHED,
    isPublished: true,
    publishedAt: serverTimestamp(),
    updatedAt:   serverTimestamp(),
  })
}

/** Move a note back to draft state. */
export async function unpublishNote(id) {
  if (!id) throw new Error('unpublishNote: id is required')
  await updateDoc(doc(db, NOTES, id), {
    status:      NOTE_STATUS.DRAFT,
    isPublished: false,
    publishedAt: null,
    updatedAt:   serverTimestamp(),
  })
}

/** Delete a note. Caller is responsible for removing any attached file from Storage first. */
export async function deleteNote(id) {
  if (!id) throw new Error('deleteNote: id is required')
  await deleteDoc(doc(db, NOTES, id))
}
