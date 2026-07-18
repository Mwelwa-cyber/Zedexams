/**
 * functions/aiValidation/validationResult.js
 *
 * The ONE shared validation-result vocabulary every AI-response validator in
 * ZedExams speaks (Prompt 14 §6 "structured validation issues" + §31
 * "acceptance states"). Pure — no firebase-admin / firebase-functions imports —
 * so it runs under plain `node functions/aiValidation/validationResult.test.js`
 * (the same *Core.js split as aiOperationsCore.js).
 *
 * Two exported concepts:
 *
 *   1. ValidationIssue — {path, code, message, severity, repairable}. A single
 *      machine-readable problem with a JSON-path to where it lives. Validators
 *      never throw for content problems; they return issues so the pipeline can
 *      decide repair vs reject vs review (§27).
 *
 *   2. AcceptanceState — the lifecycle a response moves through
 *      (§31). Only `validated` / `validated_with_warnings` may be saved as a
 *      usable draft; everything else is quarantined. deriveAcceptanceState()
 *      turns a set of issues into the correct terminal state so no caller has
 *      to re-implement "does this have a critical issue?" ad hoc.
 *
 * This module deliberately does NOT know about any specific studio's schema —
 * it's the container the per-operation validators (assessment, lesson plan,
 * past-paper extraction, …) fill in.
 */

// ── Severity ────────────────────────────────────────────────────────────────
// Ordered least → most serious so worstSeverity() is a max over an index.
const SEVERITIES = ["info", "warning", "error", "critical"];
const SEVERITY_RANK = Object.fromEntries(SEVERITIES.map((s, i) => [s, i]));

function isSeverity(value) {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SEVERITY_RANK, value);
}

/**
 * Build one validation issue. Missing/invalid fields degrade to safe defaults
 * (unknown path, generic code, error severity, not repairable) rather than
 * producing a malformed issue — a validator bug must never crash the pipeline.
 *
 * @param {Object} spec
 * @param {string} spec.path      JSON-path to the offending value, e.g.
 *                                "sections[1].questions[4].marks".
 * @param {string} spec.code      Stable machine code, e.g. "INVALID_MARKS".
 * @param {string} spec.message   Human-readable, developer-facing message.
 * @param {("info"|"warning"|"error"|"critical")} [spec.severity="error"]
 * @param {boolean} [spec.repairable=false]  Whether a deterministic/AI repair
 *                                could plausibly fix it (§27).
 * @returns {{path:string,code:string,message:string,severity:string,repairable:boolean}}
 */
function issue({path, code, message, severity = "error", repairable = false} = {}) {
  return {
    path: typeof path === "string" && path ? path : "(root)",
    code: typeof code === "string" && code ? code : "VALIDATION_ERROR",
    message: typeof message === "string" ? message : String(message || ""),
    severity: isSeverity(severity) ? severity : "error",
    repairable: repairable === true,
  };
}

// Convenience constructors — the severity is the common axis callers vary.
const critical = (path, code, message, repairable = false) =>
  issue({path, code, message, severity: "critical", repairable});
const error = (path, code, message, repairable = false) =>
  issue({path, code, message, severity: "error", repairable});
const warning = (path, code, message, repairable = false) =>
  issue({path, code, message, severity: "warning", repairable});
const info = (path, code, message) =>
  issue({path, code, message, severity: "info", repairable: false});

/** Highest severity present in a list, or null for an empty list. */
function worstSeverity(issues = []) {
  let worst = -1;
  for (const it of issues) {
    const rank = SEVERITY_RANK[it && it.severity];
    if (rank != null && rank > worst) worst = rank;
  }
  return worst < 0 ? null : SEVERITIES[worst];
}

function countBySeverity(issues = []) {
  const counts = {info: 0, warning: 0, error: 0, critical: 0};
  for (const it of issues) {
    if (it && counts[it.severity] != null) counts[it.severity] += 1;
  }
  return counts;
}

function hasBlocking(issues = []) {
  return issues.some((it) => it && (it.severity === "error" || it.severity === "critical"));
}

// ── Acceptance states (§31) ─────────────────────────────────────────────────
// The lifecycle. `raw`/`parsing`/`parsed`/`validating`/`repairing` are
// transient; the rest are terminal. SAVEABLE_STATES is the allow-list the
// persistence layer checks before writing a usable draft (§32).
const ACCEPTANCE_STATES = [
  "raw",
  "parsing",
  "parsed",
  "validating",
  "repairing",
  "validated",
  "validated_with_warnings",
  "requires_review",
  "rejected",
  "failed",
];

const SAVEABLE_STATES = new Set(["validated", "validated_with_warnings"]);

/** True only for the two states that may become a usable teacher draft. */
function isSaveable(state) {
  return SAVEABLE_STATES.has(state);
}

/**
 * Reduce a set of issues to the correct terminal acceptance state (§27/§31).
 *
 *   critical present            → "rejected"   (fatal — never saved)
 *   error present               → "requires_review" if any error is repairable
 *                                 AND repair is allowed here; else "rejected".
 *                                 (Callers that run repair pass allowRepairReview:
 *                                 an un-repaired error blocks saving as final.)
 *   only warnings/info          → "validated_with_warnings"
 *   nothing                     → "validated"
 *
 * A `parseFailed` short-circuits to "failed" — there was no structured value to
 * validate at all (§5). This is intentionally conservative: when in doubt the
 * content is quarantined for a human, never auto-accepted.
 *
 * @param {Object} args
 * @param {Array} args.issues
 * @param {boolean} [args.parseFailed=false]
 * @param {boolean} [args.allowRepairReview=false]  When true, a repairable
 *        error yields "requires_review" instead of "rejected" — used by the
 *        pre-repair pass so the pipeline knows a fix is worth attempting.
 * @returns {string} one of ACCEPTANCE_STATES
 */
function deriveAcceptanceState({issues = [], parseFailed = false, allowRepairReview = false} = {}) {
  if (parseFailed) return "failed";
  const worst = worstSeverity(issues);
  if (worst === "critical") return "rejected";
  if (worst === "error") {
    if (allowRepairReview && issues.some((it) => it && it.severity === "error" && it.repairable)) {
      return "requires_review";
    }
    return "rejected";
  }
  if (worst === "warning") return "validated_with_warnings";
  return "validated";
}

/**
 * Assemble a full validation report from raw issues. This is what a validator
 * returns and what gets persisted to aiOperations/{id}/validation/report (§32),
 * separate from the learner-visible document.
 *
 * @param {Object} args
 * @param {Array} args.issues
 * @param {*} [args.value]        The normalised value (may be null when rejected).
 * @param {boolean} [args.parseFailed=false]
 * @param {boolean} [args.allowRepairReview=false]
 * @param {Object} [args.meta]    Free-form validator metadata (counts, versions).
 * @returns {{state:string, ok:boolean, saveable:boolean, issues:Array,
 *            counts:Object, worstSeverity:(string|null), value:*, meta:Object}}
 */
function buildReport({issues = [], value = null, parseFailed = false, allowRepairReview = false, meta = {}} = {}) {
  const state = deriveAcceptanceState({issues, parseFailed, allowRepairReview});
  return {
    state,
    ok: state === "validated",
    saveable: isSaveable(state),
    issues: issues.slice(),
    counts: countBySeverity(issues),
    worstSeverity: worstSeverity(issues),
    value: isSaveable(state) ? value : (state === "requires_review" ? value : null),
    meta,
  };
}

module.exports = {
  SEVERITIES,
  SEVERITY_RANK,
  ACCEPTANCE_STATES,
  SAVEABLE_STATES,
  isSeverity,
  issue,
  critical,
  error,
  warning,
  info,
  worstSeverity,
  countBySeverity,
  hasBlocking,
  isSaveable,
  deriveAcceptanceState,
  buildReport,
};
