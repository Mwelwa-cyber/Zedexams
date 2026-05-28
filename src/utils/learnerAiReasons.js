/**
 * Learner-AI refusal reason labels.
 *
 * Shared by:
 *   - src/components/admin/learnerAi/BatchGenerateTopicsForm.jsx
 *     (preflight chips + summary banner)
 *   - src/components/admin/learnerAi/LiveAgentStatusCards.jsx
 *     (translates raw `lastMessage` codes written by runners)
 *
 * Source codes come from two places that MUST stay in sync:
 *   - functions/agents/learnerAi/curriculumResolver.js  (refusal codes)
 *   - functions/teacherTools/preflightCurriculumRef.js  (wraps the resolver)
 *
 * Each entry has:
 *   short — 2-3 word chip text ("Missing syllabus ref")
 *   long  — full sentence shown in tooltip + banner
 *   fix   — optional next-step suggestion (route or action)
 */

export const PREFLIGHT_REASONS = Object.freeze({
  missing_required_inputs: {
    short: 'Missing fields',
    long: 'The KB row is missing grade, subject, or topic.',
    fix: 'Edit the topic in /admin/cbc-kb and fill the missing fields.',
  },
  no_curriculum_match: {
    short: 'No KB match',
    long: 'No matching topic or lesson module in the active curriculum.',
    fix: 'Add the topic in /admin/cbc-kb, or upload a syllabus at /admin/curriculum/replace.',
  },
  no_source_doc_ref: {
    short: 'No syllabus link',
    long: 'The lesson module is not linked to an approved syllabus (sourceDocId).',
    fix: 'Upload an approved syllabus at /admin/curriculum/replace, then click "Backfill syllabus links" above to attach it to this subtopic.',
  },
  source_doc_not_found: {
    short: 'Broken link',
    long: 'sourceDocId points to a missing approvedSyllabi document.',
    fix: 'Re-upload the syllabus or re-run the backfill so the link points at a live doc.',
  },
  source_doc_grade_mismatch: {
    short: 'Wrong grade',
    long: 'The linked approved-syllabus doc is for a different grade than this subtopic.',
    fix: 'Detach the wrong syllabus in /admin/cbc-kb and link a grade-matching one.',
  },
  source_doc_subject_mismatch: {
    short: 'Wrong subject',
    long: 'The linked approved-syllabus doc is for a different subject than this subtopic.',
    fix: 'Detach the wrong syllabus in /admin/cbc-kb and link a subject-matching one.',
  },
  no_cited_excerpts: {
    short: 'Empty module',
    long: 'The lesson module has no outcomes, summary, or competencies that could be cited.',
    fix: 'Open the module in /admin/cbc-kb and fill in outcomes + a content summary.',
  },
  permission_denied: {
    short: 'Not admin',
    long: 'Your session does not have the admin role required to run preflight.',
    fix: 'Sign in with an admin account.',
  },
  callable_error: {
    short: 'Preflight failed',
    long: 'The preflight callable threw an unrecognised error before returning.',
    fix: 'Open the chip tooltip to read the underlying error message, then check the browser console + Cloud Functions logs for preflightCurriculumRef.',
  },
  role_check_failed: {
    short: 'Role lookup failed',
    long: 'The server could not read your user role to authorise the preflight check.',
    fix: 'Usually a transient Firestore blip — wait a few seconds and reload. If it persists, check Cloud Functions logs for the preflightCurriculumRef invocation.',
  },
  preflight_internal_error: {
    short: 'Server crashed',
    long: 'The preflight function caught an unexpected error and returned a structured response instead of an HTTP 500.',
    fix: 'Check Cloud Functions logs for the preflightCurriculumRef invocation. The tooltip shows the underlying error message.',
  },
  unauthenticated: {
    short: 'Not signed in',
    long: 'The request reached the function without a valid auth token.',
    fix: 'Sign out and sign back in to refresh your Firebase ID token, then reload the page.',
  },
  deadline_exceeded: {
    short: 'Timed out',
    long: 'The preflight call exceeded the 20-second client timeout — usually a cold-start storm when 20+ subtopics fire at once.',
    fix: 'Reload the page; the second pass finds the function warm and almost always succeeds. If it persists, narrow the subject to fewer subtopics.',
  },
  service_unavailable: {
    short: 'Service down',
    long: 'Cloud Functions reported the preflight service as unavailable (HTTP 503).',
    fix: 'This is almost always transient. Wait 30 seconds and retry. Check the Firebase status page if it persists.',
  },
  function_not_found: {
    short: 'Not deployed',
    long: 'The preflightCurriculumRef Cloud Function is not deployed in this project.',
    fix: 'Re-run the deploy-firebase GitHub Action (or run firebase deploy --only functions:preflightCurriculumRef locally).',
  },
  failed_precondition: {
    short: 'Bad request',
    long: 'The function rejected the request shape before running (failed-precondition).',
    fix: 'Open the chip tooltip to read the underlying message — usually means a required input is missing.',
  },
  resource_exhausted: {
    short: 'Quota hit',
    long: 'Firebase quota or rate-limit was exceeded by the parallel preflight burst.',
    fix: 'Wait a minute and retry. If this persists, raise the Cloud Functions concurrency quota for this project.',
  },
  internal_error: {
    short: 'Server error',
    long: 'The function returned an HTTP 500 (internal). The underlying cause is in the Cloud Functions logs.',
    fix: 'Open Cloud Functions logs and filter on preflightCurriculumRef. The tooltip shows the SDK-level message.',
  },
  resolver_error: {
    short: 'Resolver crashed',
    long: 'The server-side curriculum resolver threw an exception. See the tooltip for the message.',
    fix: 'Check Cloud Functions logs for the preflightCurriculumRef invocation.',
  },
  unknown: {
    short: 'Unknown',
    long: 'The preflight returned an unrecognised reason code.',
    fix: 'Add the new reason code to src/utils/learnerAiReasons.js so admins see a friendly label.',
  },
})

/**
 * Short chip-friendly label for a reason code. Falls back to the raw
 * code wrapped in brackets so unknown values are still visible.
 */
export function shortReason(code) {
  const entry = code && PREFLIGHT_REASONS[code]
  if (entry && entry.short) return entry.short
  return code ? `[${code}]` : 'unknown'
}

/**
 * Long human-readable label for tooltips + banners.
 *   summarizeReason('no_source_doc_ref') → 'The lesson module is not …'
 *   summarizeReason('callable_error', 'Network error') → 'The preflight … Network error'
 *
 * When `fallback` is provided AND the reason is one of the generic
 * passthroughs (callable_error / resolver_error / unknown), the fallback
 * is appended so the actual error message reaches the admin.
 */
// Reason codes that wrap an SDK / server-side error message. For these
// we append the raw `fallback` message (when available) so admins see
// what actually failed instead of just the generic family label.
const GENERIC_PASSTHROUGH_CODES = new Set([
  'callable_error',
  'resolver_error',
  'role_check_failed',
  'preflight_internal_error',
  'deadline_exceeded',
  'service_unavailable',
  'function_not_found',
  'failed_precondition',
  'resource_exhausted',
  'internal_error',
  'unauthenticated',
  'unknown',
])

export function summarizeReason(code, fallback) {
  const known = code && PREFLIGHT_REASONS[code]
  const entry = known || PREFLIGHT_REASONS.unknown
  const isGeneric = !known || GENERIC_PASSTHROUGH_CODES.has(code)
  if (isGeneric && fallback) return `${entry.long} — ${fallback}`
  return entry.long
}

/** Optional next-step suggestion. Empty string when the code has none. */
export function fixHint(code) {
  const entry = code && PREFLIGHT_REASONS[code]
  return (entry && entry.fix) || ''
}

/**
 * Distill a list of preflight results into the dominant reason + counts.
 * Used by the summary banner so admins see "Most failures are X — here's
 * how to fix it" instead of having to hover every chip.
 *
 * @param {Array<{ status: 'ok'|'loading'|'fail', reason?: string }>} results
 * @returns {{ total: number, blocked: number, byReason: Record<string, number>, dominant: string|null }}
 */
export function summarizePreflightResults(results) {
  const out = { total: 0, blocked: 0, byReason: {}, dominant: null }
  if (!Array.isArray(results)) return out
  out.total = results.length
  for (const r of results) {
    if (!r || r.status !== 'fail') continue
    out.blocked += 1
    const key = r.reason || 'unknown'
    out.byReason[key] = (out.byReason[key] || 0) + 1
  }
  let topKey = null
  let topCount = 0
  for (const [key, count] of Object.entries(out.byReason)) {
    if (count > topCount) { topKey = key; topCount = count }
  }
  out.dominant = topKey
  return out
}
