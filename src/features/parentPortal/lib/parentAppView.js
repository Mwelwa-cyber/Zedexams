/**
 * parentAppView — how a guardian-facing screen words a gate id.
 *
 * Pure so it can be tested without a DOM. The rest of the parent app's
 * presentation helpers went with the app (2026-10); `describeFeature` stays
 * because the guardian pay link still names what the child asked for.
 */

/**
 * What a locked feature is called when a child asks for it.
 *
 * The gate ids come from the server's REQUESTABLE_GATES allow-list. An
 * id this build does not recognise falls back to a neutral phrase rather
 * than being printed raw — a parent should never be shown
 * "PAPER_CONTINUE" in a sentence about their child.
 */
const FEATURE_LABELS = {
  FULL_ACCESS: 'everything on ZedExams',
  PAPER_CONTINUE: 'to finish a past paper',
  PAPER_OPEN: 'to open more past papers',
  PAPER_OFFLINE: 'to save papers for offline',
  AUTO_MARKING: 'full marking and review',
  NOTES_OTHER_TERMS: 'notes for the other terms',
  LIVE_CHALLENGE: 'live challenges',
}

export function describeFeature(gateId) {
  return FEATURE_LABELS[gateId] || 'more of ZedExams'
}
