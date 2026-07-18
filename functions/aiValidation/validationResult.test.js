/**
 * Node test for functions/aiValidation/validationResult.js — the shared
 * validation-issue + acceptance-state vocabulary. No firebase deps.
 *
 * Run: node functions/aiValidation/validationResult.test.js
 */

const assert = require("node:assert");
const {
  issue, critical, error, warning, info,
  worstSeverity, countBySeverity, hasBlocking,
  isSaveable, deriveAcceptanceState, buildReport,
  SAVEABLE_STATES, ACCEPTANCE_STATES,
} = require("./validationResult");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

// ── issue() ──────────────────────────────────────────────────────────────────
const i = issue({path: "a.b", code: "X", message: "m", severity: "error", repairable: true});
ok("issue keeps fields", i.path === "a.b" && i.code === "X" && i.message === "m" && i.severity === "error" && i.repairable === true);
ok("issue defaults blank path to (root)", issue({code: "X", message: "m"}).path === "(root)");
ok("issue defaults blank code", issue({}).code === "VALIDATION_ERROR");
ok("issue defaults severity to error", issue({}).severity === "error");
ok("issue coerces bad severity to error", issue({severity: "nope"}).severity === "error");
ok("issue repairable defaults false", issue({}).repairable === false);
ok("critical() sets critical", critical("p", "C", "m").severity === "critical");
ok("warning() sets warning", warning("p", "W", "m").severity === "warning");
ok("info() sets info + not repairable", info("p", "I", "m").severity === "info" && info("p", "I", "m").repairable === false);

// ── worstSeverity / counts / hasBlocking ─────────────────────────────────────
ok("worstSeverity empty → null", worstSeverity([]) === null);
ok("worstSeverity picks critical", worstSeverity([warning("p", "W", "m"), critical("p", "C", "m")]) === "critical");
ok("worstSeverity picks error over warning", worstSeverity([warning("p", "W", "m"), error("p", "E", "m")]) === "error");
ok("worstSeverity only warnings", worstSeverity([warning("p", "W", "m"), info("p", "I", "m")]) === "warning");
const counts = countBySeverity([info("p", "I", "m"), warning("p", "W", "m"), warning("p", "W", "m"), error("p", "E", "m")]);
ok("countBySeverity tallies", counts.info === 1 && counts.warning === 2 && counts.error === 1 && counts.critical === 0);
ok("hasBlocking true on error", hasBlocking([warning("p", "W", "m"), error("p", "E", "m")]) === true);
ok("hasBlocking true on critical", hasBlocking([critical("p", "C", "m")]) === true);
ok("hasBlocking false on warnings only", hasBlocking([warning("p", "W", "m"), info("p", "I", "m")]) === false);

// ── deriveAcceptanceState (§27/§31) ──────────────────────────────────────────
ok("no issues → validated", deriveAcceptanceState({issues: []}) === "validated");
ok("warnings only → validated_with_warnings", deriveAcceptanceState({issues: [warning("p", "W", "m")]}) === "validated_with_warnings");
ok("info only → validated_with_warnings? no, info is below warning → validated",
    deriveAcceptanceState({issues: [info("p", "I", "m")]}) === "validated");
ok("critical → rejected", deriveAcceptanceState({issues: [critical("p", "C", "m")]}) === "rejected");
ok("error (not repairable) → rejected", deriveAcceptanceState({issues: [error("p", "E", "m", false)]}) === "rejected");
ok("repairable error without allowRepairReview → rejected",
    deriveAcceptanceState({issues: [error("p", "E", "m", true)]}) === "rejected");
ok("repairable error WITH allowRepairReview → requires_review",
    deriveAcceptanceState({issues: [error("p", "E", "m", true)], allowRepairReview: true}) === "requires_review");
ok("non-repairable error with allowRepairReview → still rejected",
    deriveAcceptanceState({issues: [error("p", "E", "m", false)], allowRepairReview: true}) === "rejected");
ok("parseFailed short-circuits to failed even with allowRepairReview",
    deriveAcceptanceState({issues: [], parseFailed: true, allowRepairReview: true}) === "failed");
ok("critical wins even alongside repairable error",
    deriveAcceptanceState({issues: [error("p", "E", "m", true), critical("p", "C", "m")], allowRepairReview: true}) === "rejected");

// ── isSaveable / SAVEABLE_STATES ─────────────────────────────────────────────
ok("validated is saveable", isSaveable("validated"));
ok("validated_with_warnings is saveable", isSaveable("validated_with_warnings"));
ok("requires_review NOT saveable", !isSaveable("requires_review"));
ok("rejected NOT saveable", !isSaveable("rejected"));
ok("failed NOT saveable", !isSaveable("failed"));
ok("only two saveable states", SAVEABLE_STATES.size === 2);
ok("every acceptance state is a known string", ACCEPTANCE_STATES.every((s) => typeof s === "string"));

// ── buildReport ──────────────────────────────────────────────────────────────
const clean = buildReport({issues: [], value: {a: 1}});
ok("buildReport clean → ok + saveable + keeps value", clean.ok && clean.saveable && clean.value.a === 1 && clean.state === "validated");
const warned = buildReport({issues: [warning("p", "W", "m")], value: {a: 1}});
ok("buildReport warnings → not ok, saveable, keeps value", !warned.ok && warned.saveable && warned.value.a === 1);
const rejected = buildReport({issues: [critical("p", "C", "m")], value: {a: 1}});
ok("buildReport rejected → value nulled", rejected.state === "rejected" && rejected.value === null && !rejected.saveable);
const review = buildReport({issues: [error("p", "E", "m", true)], value: {a: 1}, allowRepairReview: true});
ok("buildReport requires_review keeps value for the repair pass", review.state === "requires_review" && review.value.a === 1 && !review.saveable);
ok("buildReport carries counts + worstSeverity + meta",
    warned.counts.warning === 1 && warned.worstSeverity === "warning" && typeof buildReport({meta: {v: 1}}).meta.v === "number");

console.log(`\n${passed} assertions passed.`);
