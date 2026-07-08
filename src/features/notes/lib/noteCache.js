// src/features/notes/lib/noteCache.js
//
// Helpers for reading notes offline. The reader routes note loads through the
// shared offline content cache (src/offline), which persists to IndexedDB via
// structured clone. Firestore Timestamp instances DON'T survive that round trip
// with their `.toDate()` method intact, so a cached note would render blank
// dates. serializeNoteForCache normalises those to plain millisecond numbers —
// which formatDate() already accepts — so a note reads identically whether it
// came fresh from Firestore or from the offline cache.

import { NOTE_FORMAT } from '../../../config/curriculum'

// Note fields that hold a publish/update/create timestamp.
const TIMESTAMP_FIELDS = ['publishedAt', 'updatedAt', 'createdAt']

/** True for a Firestore Timestamp-like value (has toMillis()/toDate() or seconds). */
function isTimestampLike(v) {
  return !!v && typeof v === 'object' && (
    typeof v.toMillis === 'function' ||
    typeof v.toDate === 'function' ||
    typeof v.seconds === 'number'
  )
}

/** Convert a Firestore Timestamp-like value to epoch millis, else return as-is. */
function toMillis(v) {
  if (!isTimestampLike(v)) return v
  if (typeof v.toMillis === 'function') return v.toMillis()
  if (typeof v.toDate === 'function') return v.toDate().getTime()
  // Fallback for a plain {seconds, nanoseconds} that already lost its methods.
  return v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6)
}

/**
 * Normalise a note into a plain, structured-clone-safe object for the offline
 * cache: Firestore Timestamps → millis numbers. Returns the value unchanged for
 * null (a missing note) so callers can cache "not found" transparently.
 */
export function serializeNoteForCache(note) {
  if (!note || typeof note !== 'object') return note
  const out = { ...note }
  for (const field of TIMESTAMP_FIELDS) {
    if (field in out) out[field] = toMillis(out[field])
  }
  return out
}

// Note formats whose content lives inside the note document itself, so pinning
// the doc genuinely makes the note readable offline. FILE notes are an external
// PDF (only the URL is in the doc), so pinning wouldn't cache the bytes — they
// get a direct download instead.
const PINNABLE_FORMATS = new Set([
  NOTE_FORMAT.STUDY,
  NOTE_FORMAT.VISUAL,
  NOTE_FORMAT.RICH_TEXT,
])

/**
 * True when a note's content is self-contained and worth pinning for offline
 * reading. A note with no explicit format is a legacy rich-text note, which is
 * also self-contained.
 */
export function isPinnableNote(note) {
  if (!note) return false
  if (note.noteFormat === NOTE_FORMAT.FILE) return false
  if (!note.noteFormat) return true // legacy rich_text
  return PINNABLE_FORMATS.has(note.noteFormat)
}
