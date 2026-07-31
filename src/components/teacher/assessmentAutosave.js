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
//
// Both kinds of dirty answer "changed since when?" with the same yardstick:
// isUntouchedPaper below. See its comment for why that is an identity test
// against a baseline and not a content heuristic.

import { stableFingerprint } from '../../hooks/aiOperationLockCore.js'

/**
 * A stable signature of the whole paper — form + sections + parts.
 *
 * Key order does not matter (the fingerprint sorts keys), so two objects built
 * by different spreads of the same values agree. `undefined` and a missing key
 * are the same thing, which is what a React form does when a field is cleared.
 */
export function paperSignature({ form, sections, parts } = {}) {
  return stableFingerprint({
    form: form || {},
    sections: sections || [],
    parts: parts || [],
  })
}

/**
 * Has the teacher touched this paper yet?
 *
 * The studio puts things in the form before the teacher does anything:
 * makeDefaultForm's defaults, a deep link's ?grade/?subject/?term, and the
 * saved School Profile's branding (school name, default duration, cover
 * instructions). None of that is an edit, so none of it may arm an autosave.
 *
 * THE BUG THIS EXISTS FOR: the studio used to answer this question with a
 * content heuristic — "one empty starter question AND no title AND no school
 * name". Every teacher with a school name in their School Profile defeated it:
 * the seeding effect wrote schoolName onto an untouched paper, the heuristic
 * then read the paper as edited, and simply LOADING
 * /teacher/assessment-papers/new filed a phantom paper holding one blank
 * question (plus a device draft) roughly two seconds later — every time.
 *
 * So the test is identity against the baseline the machine established, and
 * every place the studio seeds the paper for the teacher re-arms that baseline.
 * A paper is untouched until it differs from what we ourselves put there.
 *
 * @param {{form:object,sections:Array,parts:Array}} current
 * @param {string|null} baselineSignature  paperSignature() of the baseline
 */
export function isUntouchedPaper(current, baselineSignature) {
  if (!baselineSignature) return false
  return paperSignature(current) === baselineSignature
}

// Continuous autosave to the durable library. Files the paper — and keeps it
// updated as the teacher edits — without an explicit "Save to library" click,
// so their work is never stranded as a draft-only copy. Fires only when there
// is real content that changed since the last library write, and never while
// another save / export / import / AI generation owns the document.
// `authoredQuestionCount` is the number of questions that have something in
// them — NOT the raw question count. The studio seeds a new paper with one
// blank starter question in local state, and the raw count includes it, so a
// paper nobody had typed into read as "has content" and was filed in the
// library. Counting is countAuthoredQuestions() in quizSections.js.
export function shouldAutosaveToLibrary({
  uid,
  authoredQuestionCount,
  libraryDirty,
  saving,
  exporting,
  editLoading,
  importing,
  generating,
  deleted,
}) {
  if (!uid) return false
  // The paper was deleted (here or in another tab). Never re-persist a deleted
  // assessment — that is exactly the resurrection bug this guard exists to stop.
  if (deleted) return false
  // Edit-mode hydration is still loading the saved paper — don't write a
  // half-loaded shape back over it.
  if (editLoading) return false
  // An explicit save / export / import / generation owns the write right now.
  if (saving || exporting || importing || generating) return false
  // Nothing has changed since the last library write.
  if (!libraryDirty) return false
  // Don't file an empty or title-only paper — wait until there's at least one
  // question worth keeping. A blank starter question is not one: the phantom
  // papers this gate now refuses each held exactly one, with no text, no
  // options and the default single mark.
  if (!authoredQuestionCount) return false
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
