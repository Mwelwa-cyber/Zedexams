// src/features/notes/lib/noteCovers.js
//
// Curated cover illustrations for the learner note cards. Keyed by
// "<grade>|<subject>" → { "<unitCode>": "/public/path.webp" }, where the unit
// code is the "1.1" / "4.3" prefix at the start of a note title.
//
// LearnerNoteCard prefers an explicit Firestore note.coverImage; this registry
// is the fallback so the committed art renders on the live cards without a
// Firestore backfill. The images live in public/notes/covers/ and are guarded
// by scripts/test-grade7-sci-covers.mjs (file exists + title still matches).

const GRADE7_INTEGRATED_SCIENCE = {
  '1.1': '/notes/covers/g7-sci-1-1-cover.webp', // The Digestive System
  '2.1': '/notes/covers/g7-sci-2-1-cover.webp', // Diseases
  '2.2': '/notes/covers/g7-sci-2-2-cover.webp', // Fruits
  '3.1': '/notes/covers/g7-sci-3-1-cover.webp', // Separating Substances
  '3.2': '/notes/covers/g7-sci-3-2-cover.webp', // Water Supply Systems
  '4.1': '/notes/covers/g7-sci-4-1-cover.webp', // The Flower
  '4.2': '/notes/covers/g7-sci-4-2-cover.webp', // Pollination and Fertilisation
  '4.3': '/notes/covers/g7-sci-4-3-cover.webp', // Fruits and Seeds
  '4.4': '/notes/covers/g7-sci-4-4-cover.webp', // Seed Dispersal
  '4.5': '/notes/covers/g7-sci-4-5-cover.webp', // Propagation
  '5.1': '/notes/covers/g7-sci-5-1-cover.webp', // Energy
  '5.2': '/notes/covers/g7-sci-5-2-cover.webp', // Electric Current and Circuits
  '5.3': '/notes/covers/g7-sci-5-3-cover.webp', // Lightning
  '5.4': '/notes/covers/g7-sci-5-4-cover.webp', // The Solar System
  '5.5': '/notes/covers/g7-sci-5-5-cover.webp', // Metals and Non-metals
  '5.6': '/notes/covers/g7-sci-5-6-cover.webp', // Mining
}

const GRADE7_SOCIAL_STUDIES = {
  '1.1': '/notes/covers/g7-ss-1-1-cover.webp', // What is Democracy?
  '1.3': '/notes/covers/g7-ss-1-3-cover.webp', // What Government Does
  '1.4': '/notes/covers/g7-ss-1-4-cover.webp', // Government Ministries
  '1.5': '/notes/covers/g7-ss-1-5-cover.webp', // The Constitution
  '2.1': '/notes/covers/g7-ss-2-1-cover.webp', // The Continents
  '3.1': '/notes/covers/g7-ss-3-1-cover.webp', // Population Growth
}

// Registry of curated cover sets, keyed by "<grade>|<subject>".
export const NOTE_COVER_REGISTRY = {
  '7|Integrated Science': GRADE7_INTEGRATED_SCIENCE,
  '7|Social Studies': GRADE7_SOCIAL_STUDIES,
}

// The "1.1" / "4.3" unit code at the start of a note title.
const UNIT_CODE_RE = /^\s*(\d+\.\d+)/

/**
 * Resolve a curated cover image path for a note, or '' when none is registered.
 * Matches on the note's grade + subject + the unit code in its title.
 */
export function resolveNoteCover(note) {
  if (!note) return ''
  const set = NOTE_COVER_REGISTRY[`${note.grade}|${note.subject}`]
  if (!set) return ''
  const m = String(note.title || '').match(UNIT_CODE_RE)
  if (!m) return ''
  return set[m[1]] || ''
}
