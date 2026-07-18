// Pure gating logic for AssessmentStudio's two paths to the durable library —
// the continuous autosave and the auto-save-on-download. Extracted from the
// component so the *decision* (whether to persist) can be unit-tested without
// React or Firebase; the studio owns the side effects.
//
// Every assessment type — tests and examinations alike — runs on the one
// AssessmentStudio, so this covers all of them.
//
// KEY DISTINCTION — two kinds of "dirty":
//   • draft-dirty   — edits not yet captured by the per-keystroke DEVICE draft
//                     autosave (localStorage + a cloud draft doc). Cleared ~1s
//                     after typing stops. Drives the "Saved locally" badge.
//   • library-dirty — edits not yet written to the durable LIBRARY copy.
//                     Cleared only by a real library write (persistAssessment).
//
// The download-save used to gate on the draft-dirty flag, which the device
// autosave clears a moment after typing — so a second download silently skipped
// the latest edits and the library copy went stale. These helpers gate on
// LIBRARY dirtiness so a download always writes the newest edits.

// Continuous autosave to the durable library. Files the paper — and keeps it
// updated as the teacher edits — without an explicit "Save to library" click,
// so their work is never stranded as a draft-only copy. Fires only when there
// is real content that changed since the last library write, and never while
// another save / export / import / AI generation owns the document.
export function shouldAutosaveToLibrary({
  uid,
  questionCount,
  libraryDirty,
  saving,
  exporting,
  editLoading,
  importing,
  generating,
}) {
  if (!uid) return false
  // Edit-mode hydration is still loading the saved paper — don't write a
  // half-loaded shape back over it.
  if (editLoading) return false
  // An explicit save / export / import / generation owns the write right now.
  if (saving || exporting || importing || generating) return false
  // Nothing has changed since the last library write.
  if (!libraryDirty) return false
  // Don't file an empty or title-only paper — wait until there's at least one
  // question worth keeping.
  if (!questionCount) return false
  return true
}

// Auto-save on download. Files the paper (when it passes the pre-publish
// checklist) before handing over the download, so a downloaded paper is never
// lost. Gated on LIBRARY dirtiness — never the device-draft flag — so edits
// made after the draft autosave settled still reach the library on download.
// A never-saved paper (no library doc yet) always saves.
export function shouldAutosaveOnDownload({ errorCount, libraryDirty, hasLibraryDoc }) {
  if (errorCount > 0) return false
  return Boolean(libraryDirty) || !hasLibraryDoc
}
