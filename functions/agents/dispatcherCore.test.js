/**
 * Node test for functions/agents/dispatcherCore.js — the pure decision
 * logic behind the Content pipeline dispatcher (Aria → Cala → Reva →
 * awaiting_approval → Pubo). No firebase-admin / firebase-functions
 * dependency, so this runs under plain `node` with no stubbing required
 * (repo convention, same as aiOperationsCore.test.js).
 *
 * Run: node functions/agents/dispatcherCore.test.js
 */

const assert = require("node:assert");
const {
  PAUSED_CACHE_TTL_MS,
  EMPTY_DRAFT_MESSAGE,
  agentErrorMessage,
  breakerAlertContent,
  isPausedCacheExpired,
  buildPausedCache,
  shouldRunContentChain,
  resolveJobOwner,
  meteringFailureFields,
  runnerFailureFields,
  pausedJobFields,
  isEmptyAriaDraft,
  ariaSuccessFields,
  chainCompleteFields,
  approvalAuditEntries,
  shouldRunPubo,
  puboSuccessFields,
} = require("./dispatcherCore");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

// ── shouldRunContentChain (onCreate trigger guard) ─────────────────────────
const RUNNABLE_JOB = {department: "content", agentId: "aria", status: "queued"};
ok("content/aria/queued job runs", shouldRunContentChain(RUNNABLE_JOB) === true);
ok("non-content department is ignored",
    !shouldRunContentChain({...RUNNABLE_JOB, department: "growth"}));
ok("missing department is ignored",
    !shouldRunContentChain({agentId: "aria", status: "queued"}));
ok("non-aria root agent is ignored",
    !shouldRunContentChain({...RUNNABLE_JOB, agentId: "cala"}));
ok("already-running status is ignored (runner refuses to run twice)",
    !shouldRunContentChain({...RUNNABLE_JOB, status: "running"}));
ok("failed status is ignored", !shouldRunContentChain({...RUNNABLE_JOB, status: "failed"}));
ok("seed docs are ignored", !shouldRunContentChain({...RUNNABLE_JOB, seed: true}));
ok("seed must be exactly true to skip",
    shouldRunContentChain({...RUNNABLE_JOB, seed: false}) === true);

// ── resolveJobOwner (payload validation) ───────────────────────────────────
{
  const d = resolveJobOwner({createdBy: "uid_abc"});
  ok("valid createdBy resolves to owner", d.ok === true && d.ownerUid === "uid_abc");
}
{
  const d = resolveJobOwner({});
  ok("missing createdBy refuses to run", d.ok === false);
  ok("missing createdBy fails the job", d.fields.status === "failed");
  ok("missing createdBy names the reason",
      d.fields.error === "Job has no valid owner (createdBy) — refusing to run.");
}
{
  const d = resolveJobOwner({createdBy: 42});
  ok("non-string createdBy refuses to run", d.ok === false && d.fields.status === "failed");
}
{
  const d = resolveJobOwner({createdBy: ""});
  ok("empty createdBy refuses to run", d.ok === false);
}
{
  const d = resolveJobOwner({createdBy: "system"});
  ok("system owner refuses to run (no meterable account)", d.ok === false);
}

// ── meteringFailureFields (failure classification) ─────────────────────────
{
  const err = new Error("quota");
  err.code = "resource-exhausted";
  const f = meteringFailureFields(err);
  ok("resource-exhausted fails the job", f.status === "failed");
  ok("resource-exhausted gets the daily-limit message",
      f.error === "Daily AI limit reached for this account — agent job not run. " +
        "Please try again tomorrow.");
}
{
  const f = meteringFailureFields(new Error("firestore unavailable"));
  ok("other metering errors fail closed", f.status === "failed");
  ok("other metering errors keep the underlying message",
      f.error === "Metering check failed: firestore unavailable");
}
{
  const f = meteringFailureFields(new Error("x".repeat(1000)));
  ok("metering error message is capped at 300 chars",
      f.error === `Metering check failed: ${"x".repeat(300)}`);
}
{
  const f = meteringFailureFields("plain string failure");
  ok("non-Error metering failures stringify",
      f.error === "Metering check failed: plain string failure");
}

// ── runnerFailureFields (failure classification per runner) ────────────────
{
  const f = runnerFailureFields("Aria", new Error("model timed out"));
  ok("runner failure sets status failed", f.status === "failed");
  ok("runner failure is attributed to the agent", f.error === "Aria: model timed out");
}
{
  const f = runnerFailureFields("Pubo", new Error("y".repeat(2000)));
  ok("runner error message is capped at 500 chars",
      f.error === `Pubo: ${"y".repeat(500)}`);
}
{
  const f = runnerFailureFields("Cala", "string throw");
  ok("non-Error runner throws stringify", f.error === "Cala: string throw");
}
{
  const f = runnerFailureFields("Reva", null);
  ok("null runner error still produces a labelled message", f.error === "Reva: null");
}

// ── pausedJobFields (status transition when an agent is paused) ────────────
{
  const f = pausedJobFields("aria");
  ok("aria paused fails the job", f.status === "failed");
  ok("aria paused names the kill-switch doc",
      f.error === "Aria is paused (agentControl/aria.paused = true).");
}
{
  const f = pausedJobFields("cala");
  ok("cala paused hands off to a human, not failed", f.status === "awaiting_approval");
  ok("cala paused says review manually", f.error === "Cala is paused — review manually.");
}
{
  const f = pausedJobFields("reva");
  ok("reva paused hands off to a human, not failed", f.status === "awaiting_approval");
  ok("reva paused says review manually", f.error === "Reva is paused — review manually.");
}
{
  const f = pausedJobFields("pubo");
  ok("pubo paused fails the approved job", f.status === "failed");
  ok("pubo paused tells the admin to publish manually",
      f.error === "Pubo is paused — admin must publish manually.");
}
{
  const a = pausedJobFields("aria");
  a.status = "mutated";
  ok("pausedJobFields returns a fresh object each call",
      pausedJobFields("aria").status === "failed");
}

// ── empty-draft short-circuit ───────────────────────────────────────────────
ok("null draft stops the chain", isEmptyAriaDraft({draft: null, generationId: "g1"}));
ok("missing draft stops the chain", isEmptyAriaDraft({generationId: "g1"}));
ok("present draft continues the chain", !isEmptyAriaDraft({draft: {title: "t"}}));
ok("empty-draft failure is attributed to Aria, not Cala",
    runnerFailureFields("Aria", new Error(EMPTY_DRAFT_MESSAGE)).error ===
      `Aria: ${EMPTY_DRAFT_MESSAGE}`);

// ── ariaSuccessFields / chainCompleteFields / puboSuccessFields ─────────────
{
  const out = {draft: {}, generationId: "gen_1"};
  const f = ariaSuccessFields(out);
  ok("aria success stores the output under output.aria", f["output.aria"] === out);
  ok("aria success reserves the aiGenerations ref",
      f.publishedRefs.length === 1 &&
      f.publishedRefs[0].collection === "aiGenerations" &&
      f.publishedRefs[0].docId === "gen_1");
}
{
  const out = {verdict: "pass"};
  const f = chainCompleteFields(out);
  ok("chain completion lands in awaiting_approval", f.status === "awaiting_approval");
  ok("chain completion records reva as the last agent", f.agentId === "reva");
  ok("chain completion stores reva output", f["output.reva"] === out);
}
{
  const out = {publishedId: "gen_1"};
  const f = puboSuccessFields(out);
  ok("pubo success sets status done", f.status === "done");
  ok("pubo success stores pubo output", f["output.pubo"] === out);
}

// ── approvalAuditEntries ────────────────────────────────────────────────────
{
  const entries = approvalAuditEntries({
    jobId: "job_1",
    before: {status: "awaiting_approval"},
    after: {status: "approved", reviewedBy: "admin_1", agentId: "reva", department: "content"},
  });
  ok("approve transition writes one audit entry", entries.length === 1);
  ok("approve entry action", entries[0].action === "agent.approve");
  ok("approve entry actor is the reviewer", entries[0].actorUid === "admin_1");
  ok("approve entry targets the job",
      entries[0].targetType === "agentJob" && entries[0].targetId === "job_1");
  ok("approve entry metadata carries agent + department",
      entries[0].metadata.agentId === "reva" && entries[0].metadata.department === "content");
}
{
  const entries = approvalAuditEntries({
    jobId: "job_2",
    before: {status: "awaiting_approval"},
    after: {status: "rejected", reviewNotes: "off-syllabus"},
  });
  ok("reject transition writes one audit entry", entries.length === 1);
  ok("reject entry action", entries[0].action === "agent.reject");
  ok("reject entry actor falls back to system when reviewedBy is missing",
      entries[0].actorUid === "system");
  ok("reject entry carries the reason", entries[0].metadata.reason === "off-syllabus");
  ok("reject entry metadata agentId falls back to null", entries[0].metadata.agentId === null);
}
ok("non-transition update writes no audit entry",
    approvalAuditEntries({
      jobId: "j",
      before: {status: "approved"},
      after: {status: "approved"},
    }).length === 0);
ok("unrelated status change writes no audit entry",
    approvalAuditEntries({
      jobId: "j",
      before: {status: "queued"},
      after: {status: "running"},
    }).length === 0);

// ── shouldRunPubo (onUpdate trigger guard) ─────────────────────────────────
const APPROVABLE = {status: "approved", department: "content"};
ok("fresh approval of a content job runs Pubo",
    shouldRunPubo({status: "awaiting_approval"}, APPROVABLE) === true);
ok("already-approved before-state does not re-run Pubo (duplicate delivery)",
    !shouldRunPubo({status: "approved"}, APPROVABLE));
ok("rejected transition never runs Pubo",
    !shouldRunPubo({status: "awaiting_approval"}, {status: "rejected", department: "content"}));
ok("non-approved after-state does not run Pubo",
    !shouldRunPubo({status: "queued"}, {status: "running", department: "content"}));
ok("non-content department does not run Pubo",
    !shouldRunPubo({status: "awaiting_approval"}, {...APPROVABLE, department: "growth"}));
ok("scheduled rollups (input.runType) never invoke Pubo",
    !shouldRunPubo({status: "awaiting_approval"},
        {...APPROVABLE, input: {runType: "weekly"}}));
ok("a job with input but no runType still runs Pubo",
    shouldRunPubo({status: "awaiting_approval"},
        {...APPROVABLE, input: {topic: "Cells"}}) === true);
ok("seed docs never invoke Pubo",
    !shouldRunPubo({status: "awaiting_approval"}, {...APPROVABLE, seed: true}));

// ── agentErrorMessage / breakerAlertContent ────────────────────────────────
ok("Error → its message", agentErrorMessage(new Error("boom")) === "boom");
ok("string error passes through", agentErrorMessage("plain") === "plain");
ok("null error → empty string", agentErrorMessage(null) === "");
ok("Error with empty message falls back to stringifying the Error",
    agentErrorMessage(new Error("")) === "Error");
{
  const alert = breakerAlertContent({
    agentId: "cala",
    errorMessage: "z".repeat(1000),
    failuresInWindow: 3,
  });
  ok("breaker alert is critical", alert.severity === "critical");
  ok("breaker alert names the agent",
      alert.title === "Agent \"cala\" auto-paused by circuit breaker");
  ok("breaker alert reports the failure count",
      alert.lines[0].includes("cala hit 3 failures"));
  ok("breaker alert truncates the error to 300 chars",
      alert.lines[1] === `Last error: ${"z".repeat(300)}`);
  ok("breaker alert points at the kill-switch doc",
      alert.lines[2].includes("agentControl/cala.paused"));
}

// ── paused cache decisions ─────────────────────────────────────────────────
{
  const cache = buildPausedCache(["aria", "pubo"], 10_000);
  ok("cache expires exactly TTL after build", cache.expiresAt === 10_000 + PAUSED_CACHE_TTL_MS);
  ok("cache membership is a Set of the paused ids",
      cache.paused.has("aria") && cache.paused.has("pubo") && !cache.paused.has("cala"));
  ok("cache is fresh before expiry", !isPausedCacheExpired(cache, cache.expiresAt - 1));
  ok("cache is expired at expiry (>= boundary)", isPausedCacheExpired(cache, cache.expiresAt));
  ok("cache is expired after expiry", isPausedCacheExpired(cache, cache.expiresAt + 1));
}
{
  const cache = buildPausedCache([], 0);
  ok("empty query yields an empty paused set", cache.paused.size === 0);
}
ok("the initial {expiresAt: 0} cache is expired immediately",
    isPausedCacheExpired({expiresAt: 0, paused: new Set()}, 1));

console.log(`\ndispatcherCore.test.js: ${passed} assertions passed`);
