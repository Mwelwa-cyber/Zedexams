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
 * Since Phase 5 there is a FOURTH: the measured page layout. It is classified
 * separately rather than folded into the other two, because it blocks the
 * browser routes and not Word — see printPdfReadiness.js.
 *
 * Pure so it unit-tests without React or Firebase. The caller passes the
 * already-computed validation result, smart-warnings list, pagination result
 * and stats; this function only classifies and de-duplicates them.
 */

import { blockingLayoutIssues } from './printPdfReadiness.js'

// Status ranking, worst-first. `status` is the single field the Save / Export
// buttons key off: 'blocked' must be resolved before the paper is filed.
export const HEALTH_STATUS = {
  BLOCKED: 'blocked',     // ≥1 correctness blocker — no route out of the studio
  PRINT_BLOCKED: 'print-blocked', // the paper is correct; the browser layout is not
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
export function computePaperHealth({
  validation = {}, smartWarnings = [], stats = {}, pagination = null, report = null,
} = {}) {
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

  // §10's validation report contributes the defects that only a FINISHED paper
  // can have: the marks not adding up, a correct answer that is no longer
  // printed, a diagram a question asks for and does not have, a formula that
  // would print as its own source. Every question on the paper can be complete
  // and all four still be true, which is why they cannot come from
  // collectQuizIssues — it answers "is this question finished".
  //
  // The LAYOUT rows are deliberately excluded here and folded into
  // `printBlockers` below instead: they block the browser routes and not Word,
  // and merging them would grey out a .docx download that is very likely fine.
  const reportBlockers = asArray(report?.blockers)
    .filter((b) => b && b.check !== 'page-layout')
    .map((b) => ({ id: `report-${b.code}`, label: b.message }))
  blockers.push(...reportBlockers)

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
    ...asArray(report?.warnings)
      .map((w) => ({ id: `report-${w.code}`, label: w.message, severity: 'warn' })),
  ]

  // ── Printability, which is a THIRD classification and not a shade of the
  //    other two ────────────────────────────────────────────────────────────
  //
  // A blank trailing sheet, a question split across a page turn or a table
  // clipped at the right edge is not an advisory — a teacher meets it at the
  // photocopier — and it is not a correctness blocker either, because the paper
  // itself is finished and its Word export is very likely fine. It blocks the
  // browser routes and only those.
  //
  // This panel is where a teacher is SENT when an export is refused, so a
  // layout refusal that did not appear here left them looking at a page telling
  // them everything was fine while the Print button stayed grey. That is the
  // gap this closes: the reason is now listed where the teacher was already
  // being sent to read it.
  const printBlockers = blockingLayoutIssues(pagination)
    .map((i) => ({ id: i.code, label: i.message }))

  // "Not measured yet" is deliberately NOT a print blocker here. The gate still
  // refuses the export — see printPdfReadiness — but a panel that listed
  // "checking the page layout" as a problem to fix would be reporting our own
  // progress as the teacher's defect, and it clears itself within a second.
  const layoutPending = Boolean(pagination)
    && pagination.status !== 'ready'
    && pagination.status !== 'failed'
  const layoutUnverified = pagination?.status === 'failed'

  // The green-tick readiness checklist: the validation summary verbatim, plus
  // §10's named checks. Both are "what was verified", and a teacher about to run
  // forty copies wants to read the whole list rather than infer it from the
  // absence of complaints.
  const checks = [
    ...summary
      .filter(Boolean)
      .map((s, idx) => ({ id: s.id || `check-${idx}`, label: s.label, ok: Boolean(s.ok) })),
    ...asArray(report?.checks)
      .map((c) => ({ id: `report-${c.id}`, label: c.label, ok: Boolean(c.ok), detail: c.detail || '' })),
  ]

  const blockerCount = blockers.length
  const advisoryCount = advisories.length
  const passedCount = checks.filter((c) => c.ok).length

  let status = HEALTH_STATUS.READY
  // Ranked the way a teacher should read them: finish the paper, then fix how
  // it prints, then consider the suggestions. A paper with both an unfinished
  // question and a blank page is reported as unfinished, because finishing the
  // question is about to move every page boundary anyway.
  if (blockerCount > 0) status = HEALTH_STATUS.BLOCKED
  else if (printBlockers.length > 0) status = HEALTH_STATUS.PRINT_BLOCKED
  else if (advisoryCount > 0) status = HEALTH_STATUS.ATTENTION

  return {
    status,
    blockers,
    printBlockers,
    printBlockerCount: printBlockers.length,
    layoutPending,
    layoutUnverified,
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
  if (status === HEALTH_STATUS.PRINT_BLOCKED) {
    const n = health.printBlockerCount
    // Says which routes are shut, because the Word button beside it is still
    // enabled and a teacher reading "cannot export" while Word works would
    // reasonably conclude the panel is wrong.
    return `The paper is finished, but ${n === 1 ? 'a layout problem stops' : `${n} layout problems stop`} `
      + 'it printing correctly. Word is unaffected.'
  }
  if (status === HEALTH_STATUS.ATTENTION) {
    return `Ready to save — ${advisoryCount} suggestion${advisoryCount === 1 ? '' : 's'} worth a look first.`
  }
  return 'This paper passes every check — ready to save and export.'
}
