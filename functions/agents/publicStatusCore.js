/**
 * publicStatusCore — pure mapping from a Vigil hourly-monitor report to the
 * public `publicStatus/current` document the /status page renders.
 *
 * WHY: the public status page used to run three shallow in-browser probes
 * (a logo HEAD, one `scores` read, a no-cors Auth ping) and reported "All
 * systems operational" whenever those passed — completely disconnected from
 * Vigil, the real backend monitor that already probes pages / Firestore /
 * Storage / images / quizzes / daily-exams / Play billing hourly. So the app
 * could be failing end-to-end while the page stayed green. This module turns
 * Vigil's real results into an honest, component-level public status.
 *
 * Design points the launch-blocker requires:
 *   • richer states than ok/down: operational / degraded / partial_outage /
 *     major_outage / maintenance / unknown;
 *   • per-component streaks so a flap doesn't yo-yo the page — a component is
 *     shown down on the FIRST failure (never hide a real failure) but only
 *     returns to operational after RECOVERY_THRESHOLD consecutive successes;
 *   • carries generatedAt so the CLIENT can down-grade a STALE doc to unknown
 *     (see src/utils/systemStatus.js) rather than showing operational when the
 *     monitor hasn't run recently.
 *
 * Pure (no firebase-admin) so it unit-tests under plain node.
 */

const SCHEMA_VERSION = 2;

// Show a real failure immediately; require two clean checks before declaring
// recovery, so the page doesn't flap back to green on a single lucky probe.
const FAILURE_THRESHOLD = 1;
const RECOVERY_THRESHOLD = 2;

// The public components, in display order, mapped from Vigil's check keys.
// `core` components (the website + the data/auth platform) escalate an outage
// to "major"; the rest escalate to "partial".
const COMPONENTS = [
  {key: "pages", label: "Website", core: true},
  {key: "firebase", label: "Database & storage", core: true},
  {key: "quizzes", label: "Quiz content", core: false},
  {key: "images", label: "Images & diagrams", core: false},
  {key: "dailyExams", label: "Daily exams", core: false},
  {key: "playBilling", label: "Payments (Android billing)", core: false},
];

const STATUS = {
  OPERATIONAL: "operational",
  DEGRADED: "degraded",
  PARTIAL_OUTAGE: "partial_outage",
  MAJOR_OUTAGE: "major_outage",
  MAINTENANCE: "maintenance",
  UNKNOWN: "unknown",
};

/** Worst severity among a report's failures for one check key. */
function worstSeverityFor(report, key) {
  let worst = null;
  for (const f of report.failures || []) {
    if (f.check !== key) continue;
    if (f.severity === "critical") return "critical";
    if (f.severity === "warning") worst = worst || "warning";
  }
  return worst;
}

/** Raw component status from this run alone (before streak smoothing). */
function rawComponentStatus(report, comp) {
  const check = (report.checks || {})[comp.key];
  const ok = check ? check.ok !== false : false;
  if (ok) return STATUS.OPERATIONAL;
  const sev = worstSeverityFor(report, comp.key);
  if (sev === "critical") return comp.core ? STATUS.MAJOR_OUTAGE : STATUS.PARTIAL_OUTAGE;
  // A warning (or a not-ok check with no explicit failure) is degraded.
  return STATUS.DEGRADED;
}

const isDown = (s) => s !== STATUS.OPERATIONAL;

/**
 * Build the public status doc from a Vigil report + the previous public doc
 * (for streaks). `nowMs` is injected (Date.now() is unavailable in some
 * runtimes / must be deterministic in tests).
 */
function buildPublicStatus(report, prev, {nowMs} = {}) {
  const now = Number.isFinite(nowMs) ? nowMs : 0;
  const prevComponents = (prev && prev.components) || {};
  const components = {};

  for (const comp of COMPONENTS) {
    const raw = rawComponentStatus(report, comp);
    const previous = prevComponents[comp.key] || {};
    const prevOkStreak = Number.isFinite(previous.consecutiveOk) ? previous.consecutiveOk : 0;
    const prevFailStreak = Number.isFinite(previous.consecutiveFail) ? previous.consecutiveFail : 0;

    let consecutiveOk;
    let consecutiveFail;
    if (raw === STATUS.OPERATIONAL) {
      consecutiveOk = prevOkStreak + 1;
      consecutiveFail = 0;
    } else {
      consecutiveOk = 0;
      consecutiveFail = prevFailStreak + 1;
    }

    // Displayed status:
    //  • a real failure shows immediately (consecutiveFail >= FAILURE_THRESHOLD);
    //  • a recovery only shows operational after RECOVERY_THRESHOLD clean runs —
    //    until then a just-recovered component reads "degraded" (recovering),
    //    so we never flip to all-clear on the first lucky check.
    let display;
    if (raw !== STATUS.OPERATIONAL) {
      display = consecutiveFail >= FAILURE_THRESHOLD ? raw : STATUS.OPERATIONAL;
    } else if (prevFailStreak > 0 && consecutiveOk < RECOVERY_THRESHOLD) {
      display = STATUS.DEGRADED; // recovering, not yet confirmed
    } else {
      display = STATUS.OPERATIONAL;
    }

    components[comp.key] = {
      label: comp.label,
      core: comp.core,
      status: display,
      raw,
      consecutiveOk,
      consecutiveFail,
      lastOkAt: raw === STATUS.OPERATIONAL ? now : (previous.lastOkAt ?? null),
      lastFailureAt: raw !== STATUS.OPERATIONAL ? now : (previous.lastFailureAt ?? null),
      recovering: raw === STATUS.OPERATIONAL && prevFailStreak > 0 && consecutiveOk < RECOVERY_THRESHOLD,
    };
  }

  const overall = overallFrom(components);

  return {
    schemaVersion: SCHEMA_VERSION,
    overall,
    components,
    ok: overall === STATUS.OPERATIONAL,
    generatedAt: now,
    ranAt: report.ranAt || null,
    counts: report.counts || null,
  };
}

/** Overall status = the worst confirmed component status. */
function overallFrom(components) {
  const values = Object.values(components).map((c) => c.status);
  if (values.includes(STATUS.MAJOR_OUTAGE)) return STATUS.MAJOR_OUTAGE;
  if (values.includes(STATUS.PARTIAL_OUTAGE)) return STATUS.PARTIAL_OUTAGE;
  if (values.some(isDown)) return STATUS.DEGRADED;
  return STATUS.OPERATIONAL;
}

module.exports = {
  buildPublicStatus,
  overallFrom,
  rawComponentStatus,
  COMPONENTS,
  STATUS,
  SCHEMA_VERSION,
  FAILURE_THRESHOLD,
  RECOVERY_THRESHOLD,
};
