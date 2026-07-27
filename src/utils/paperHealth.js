/**
 * paperHealth — one verdict for "is this paper ready to save / export?".
 *
 * The Assessment Studio grew three independent quality surfaces:
 *   1. collectQuizIssues()      — blocking structural checks (gates Save)
 *   2. computeSmartWarnings()   — advisory layout/quality warnings (banner)
 *   3. analyzeTiming()          — timing budget (folded into smart warnings)
 *      + the live paper stats (marks, pages, questions)
 *
 * Each surfaced its findings in a different place (a checklist modal, a
 * banner, a pill), so a teacher never saw the whole picture at once. This
 * module folds all of them into ONE structured "health" object that the
 * PaperHealthModal renders as a single pre-save/export gate.
 *
 * Pure + dependency-free so it unit-tests without React or Firebase. The
 * caller passes the already-computed validation result, smart-warnings list,
 * and stats; this function only classifies and de-duplicates them.
 */

// Status ranking, worst-first. `status` is the single field the Save / Export
// buttons key off: 'blocked' must be resolved before the paper is filed.
export const HEALTH_STATUS = {
  BLOCKED: 'blocked',     // ≥1 blocking issue — cannot save/export cleanly
  ATTENTION: 'attention', // no blockers, but advisories worth a look
  READY: 'ready',         // clean — safe to save/export/print
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

/**
 * Fold the studio's quality signals into a single health verdict.
 *
 * @param {object} input
 * @param {{issues?: Array<{id,label,severity,localId}>, summary?: Array<{label,ok}>}} input.validation
 *        Output of collectQuizIssues(). `severity` is 'error' | 'warn'.
 * @param {Array<{key,severity,message}>} input.smartWarnings
 *        Output of computeSmartWarnings(). `severity` is 'error' | 'warn' | 'info'.
 * @param {object} input.stats
 *        Live paper figures for the summary strip: { questionCount, totalMarks,
 *        printPdfPages, estimatedMinutes, duration, sectionCount }.
 *        printPdfPages is MEASURED (browser print/PDF), never estimated — 0 means
 *        "not measured yet", not "no pages".
 * @returns {{
 *   status: 'blocked'|'attention'|'ready',
 *   blockers: Array<{id,label}>,
 *   advisories: Array<{id,label,severity}>,
 *   checks: Array<{id,label,ok}>,
 *   blockerCount: number,
 *   advisoryCount: number,
 *   passedCount: number,
 *   checkCount: number,
 *   ready: boolean,
 *   stats: object,
 * }}
 */
export function computePaperHealth({ validation = {}, smartWarnings = [], stats = {} } = {}) {
  const issues = asArray(validation.issues)
  const summary = asArray(validation.summary)
  const smart = asArray(smartWarnings)

  // Blockers come ONLY from collectQuizIssues — it is the canonical gate the
  // studio already trusts for Save. computeSmartWarnings also emits a couple of
  // 'error' rows (missing subject, no questions) but those duplicate the
  // validation blockers, so we deliberately drop smart 'error' rows to avoid
  // listing the same problem twice.
  const blockers = issues
    .filter((i) => i && i.severity !== 'warn')
    .map((i) => ({ id: i.id, label: i.label }))

  // Advisories = the non-blocking 'warn' validation issues PLUS the advisory
  // ('warn' / 'info') smart warnings. Keyed ids stay stable so React lists and
  // tests can target them.
  const advisories = [
    ...issues
      .filter((i) => i && i.severity === 'warn')
      .map((i) => ({ id: i.id, label: i.label, severity: 'warn' })),
    ...smart
      .filter((w) => w && (w.severity === 'warn' || w.severity === 'info'))
      .map((w) => ({ id: w.key, label: w.message, severity: w.severity })),
  ]

  // The green-tick readiness checklist is the validation summary verbatim.
  const checks = summary
    .filter(Boolean)
    .map((s, idx) => ({ id: s.id || `check-${idx}`, label: s.label, ok: Boolean(s.ok) }))

  const blockerCount = blockers.length
  const advisoryCount = advisories.length
  const passedCount = checks.filter((c) => c.ok).length

  let status = HEALTH_STATUS.READY
  if (blockerCount > 0) status = HEALTH_STATUS.BLOCKED
  else if (advisoryCount > 0) status = HEALTH_STATUS.ATTENTION

  return {
    status,
    blockers,
    advisories,
    checks,
    blockerCount,
    advisoryCount,
    passedCount,
    checkCount: checks.length,
    ready: blockerCount === 0,
    stats: { ...stats },
  }
}

/**
 * One short human sentence describing the verdict — used for the modal
 * subheading, the gate button title, and screen-reader status.
 */
export function paperHealthHeadline(health) {
  if (!health) return ''
  const { status, blockerCount, advisoryCount } = health
  if (status === HEALTH_STATUS.BLOCKED) {
    return `${blockerCount} thing${blockerCount === 1 ? '' : 's'} to fix before this paper is ready.`
  }
  if (status === HEALTH_STATUS.ATTENTION) {
    return `Ready to save — ${advisoryCount} suggestion${advisoryCount === 1 ? '' : 's'} worth a look first.`
  }
  return 'This paper passes every check — ready to save and export.'
}
