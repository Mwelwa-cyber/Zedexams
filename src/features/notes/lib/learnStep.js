// src/features/notes/lib/learnStep.js
//
// How far the learner got through a note's PACED Learn pass, per device.
//
// This is a different measurement from `noteProgress` (lib/progress.js),
// and the difference is the reason it exists: noteProgress records how
// far the page was SCROLLED, which is what a reading-progress record
// should be. Revise mode's "▶ Learn this properly" has to reopen the
// note at the first un-revealed SECTION — a reveal step, not a scroll
// percentage — and no scroll percentage can be converted into one
// (Revise renders the whole note at once, so scrolling it to the bottom
// would otherwise read as "the Learn pass is finished").
//
// localStorage, not Firestore, on purpose: it is a resume marker for the
// device in the learner's hand, it is written on every Continue tap, and
// losing it costs a learner one extra tap. Firestore would be a write
// per section per note per learner for that.
//
// Reads and writes are best-effort — Safari private mode and a full
// quota both throw on access, and a resume marker must never be able to
// stop a note from opening.

const KEY = (noteId) => `zedexams:note-learn-step:${noteId}`

/** The furthest reveal step reached in Learn mode (0 when unknown). */
export function readLearnStep(noteId) {
  if (!noteId) return 0
  try {
    const raw = window.localStorage.getItem(KEY(noteId))
    const n = Number.parseInt(raw ?? '', 10)
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

/** Record a reached step. Never moves backwards. */
export function writeLearnStep(noteId, step) {
  if (!noteId || !Number.isFinite(step) || step <= 0) return
  try {
    if (step > readLearnStep(noteId)) window.localStorage.setItem(KEY(noteId), String(step))
  } catch {
    // No resume marker is a tap, not a failure.
  }
}
