/**
 * Pure decision logic behind the scheduled agent crons (functions/agents/cron.js):
 * rollup payload shaping, per-agent status/notability decisions, the weekly
 * CBC-alignment audit accumulator, Dawn run staleness checks, and Echo's
 * draft-reply prompt.
 *
 * Constraints: no firebase-admin / firebase-functions / network imports, so it
 * runs under plain `node`. Server timestamps are opaque values injected by the
 * caller (`createdAt` / `finishedAt`); cron.js owns all Firestore, model,
 * email and scheduler I/O. The model runner for the audit (`runCala`) is
 * injected for the same reason.
 */

const {shouldAuditGeneration} = require("./auditScope");

// Sampling 20 recent aiGenerations gives us a trend signal without burning
// through budget.
const AUDIT_SAMPLE_SIZE = 20;

// A Dawn run that isn't done by ~25 min is stuck.
const DAWN_STALE_MS = 25 * 60 * 1000;

/**
 * Canonical error-message truncation for rollup/report fields. `max` is
 * explicit because different fields carry different caps (500 for rollup
 * errors, 300 for notify/suggestion errors, 200 for audit findings).
 */
function truncateErrorMessage(err, max) {
  return String(err && err.message || err).slice(0, max);
}

/**
 * The agentJobs doc a cron writes when its runner threw. `createdAt` is the
 * caller's server-timestamp sentinel; `status` defaults to "failed" (the
 * content gate deliberately logs its failures as "done" so they don't sit in
 * the approval queue).
 */
function buildFailureJob({agentId, department, runType, err, createdAt, runMs, status = "failed"}) {
  return {
    agentId,
    department,
    status,
    input: {runType},
    error: truncateErrorMessage(err, 500),
    createdBy: "system",
    createdAt,
    runMs,
  };
}

/**
 * The weekly CBC-alignment audit over sampled aiGenerations docs. `docs` are
 * snapshot-shaped ({id, data()}); `runCala` is injected so this stays
 * model-free under test.
 */
async function auditGenerations({docs, runCala}) {
  const findings = [];
  let aligned = 0;
  let drifted = 0;
  let errored = 0;
  let skipped = 0;

  for (const docSnap of docs) {
    const data = docSnap.data() || {};
    const inputs = data.inputs || {};
    const draft = data.output;
    if (!draft) {
      // Skip in-flight or failed generations.
      continue;
    }
    // Skip content Cala can't meaningfully align — non-curricular tools
    // (timetables, records of work) and subject-wide generations with no
    // topic (e.g. a whole-subject exam paper). Auditing these only ever
    // produced a bogus "Topic not found in verified CBC KB" finding.
    if (!shouldAuditGeneration({tool: data.tool, inputs})) {
      skipped += 1;
      continue;
    }
    // Synthesize a minimal agentJobs-shaped doc for runCala to consume.
    const fakeJob = {
      input: {
        grade: inputs.grade,
        subject: inputs.subject,
        topic: inputs.topic,
        subtopic: inputs.subtopic,
      },
      output: {aria: {draft}},
    };
    try {
      const result = await runCala({job: fakeJob});
      if (result.aligned) aligned += 1; else drifted += 1;
      if (!result.aligned) {
        findings.push({
          generationId: docSnap.id,
          tool: data.tool || null,
          gaps: result.gaps,
          drift: result.drift,
        });
      }
    } catch (err) {
      errored += 1;
      findings.push({
        generationId: docSnap.id,
        tool: data.tool || null,
        error: truncateErrorMessage(err, 200),
      });
    }
  }

  return {
    sampleSize: docs.length,
    audited: aligned + drifted,
    aligned,
    drifted,
    errored,
    skipped,
    findings: findings.slice(0, 50),
  };
}

function buildQuillRollup({report, runMs}) {
  return {
    agentId: "quill",
    department: "qaEng",
    status: report.ok ? "done" : "awaiting_approval",
    input: {runType: "nightly-smoke"},
    output: {quill: report},
    createdBy: "system",
    runMs,
  };
}

function buildCalaAuditRollup({summary, runMs}) {
  return {
    agentId: "cala",
    department: "qaEng",
    status: summary.drifted > 0 || summary.errored > 0 ? "awaiting_approval" : "done",
    input: {runType: "weekly-cbc-audit", sampleSize: summary.sampleSize},
    output: {cala: summary},
    createdBy: "system",
    runMs,
  };
}

function buildVigilRollup({report, runMs}) {
  return {
    agentId: "vigil",
    department: "qaEng",
    status: report.ok ? "done" : "awaiting_approval",
    input: {runType: "hourly-monitor"},
    output: {vigil: report},
    createdBy: "system",
    runMs,
  };
}

function buildTillRollup({summary, runMs}) {
  // Surface notable runs (recovered money or errors needing a human) at the
  // top of the dashboard; quiet "nothing to do" runs are just logged.
  const notable = summary.recovered.length > 0 || summary.errors.length > 0;
  return {
    agentId: "till",
    department: "revenue",
    status: notable ? "awaiting_approval" : "done",
    input: {runType: "hourly-reconcile"},
    output: {till: summary},
    createdBy: "system",
    runMs,
  };
}

function buildEchoRollup({summary, runMs}) {
  // Anything triaged (or errored) is something a human should glance at and
  // send; a quiet run with no new messages is just logged.
  const notable = summary.processed > 0 || summary.errors.length > 0;
  return {
    agentId: "echo",
    department: "support",
    status: notable ? "awaiting_approval" : "done",
    input: {runType: "support-triage"},
    output: {echo: summary},
    createdBy: "system",
    runMs,
  };
}

/**
 * Only a run that actually published something (or errored) is worth logging.
 * A quiet sweep — disabled, or nothing clean to publish — writes nothing, so
 * the gate doesn't spam the dashboard every 30 minutes.
 */
function isContentGateRunNotable(summary) {
  return summary.autoApproved.length > 0 || summary.errors.length > 0;
}

// `createdAt` is the caller's server-timestamp sentinel (this rollup is a
// plain add, never coalesced, so it stamps its own timestamp).
function buildContentGateRollup({summary, createdAt, runMs}) {
  return {
    agentId: "pubo",
    department: "content",
    status: "done",
    input: {runType: "content-auto-publish"},
    output: {gate: summary},
    createdBy: "system",
    createdAt,
    runMs,
  };
}

function buildCompassRollup({summary, runMs}) {
  // A backlog (or an error) is something to act on; an empty week is just logged.
  const notable = summary.backlog.length > 0 || summary.errors.length > 0;
  return {
    agentId: "compass",
    department: "content",
    status: notable ? "awaiting_approval" : "done",
    input: {runType: "weekly-product-signal", windowDays: summary.windowDays},
    output: {compass: summary},
    createdBy: "system",
    runMs,
  };
}

function buildAnchorRollup({summary, runMs}) {
  const notable = summary.atRisk > 0 || summary.errors.length > 0;
  return {
    agentId: "anchor",
    department: "growth",
    status: notable ? "awaiting_approval" : "done",
    input: {runType: "weekly-retention-scan"},
    output: {anchor: summary},
    createdBy: "system",
    runMs,
  };
}

function buildMarshalRollup({report, runMs}) {
  return {
    agentId: "marshal",
    department: "qaEng",
    status: report.healthy ? "done" : "awaiting_approval",
    input: {runType: "hourly-supervisor"},
    output: {marshal: report},
    createdBy: "system",
    runMs,
  };
}

/**
 * Sift's rollup — the second place a server-error finding surfaces, after the
 * ops alert. It is deliberately `awaiting_approval` (an open card in
 * /admin/agents) whenever the run is not ok, INCLUDING when the log read
 * failed: "nothing is currently watching the backend" is exactly the condition
 * that must not be quiet, since not knowing was the whole of #2230.
 *
 * writeAgentRollup coalesces open cards per agent+runType, so an unresolved
 * problem holds ONE card that refreshes hourly rather than filing 24 a day.
 */
function buildSiftRollup({report, runMs}) {
  return {
    agentId: "sift",
    department: "qaEng",
    status: report.ok ? "done" : "awaiting_approval",
    input: {runType: "hourly-server-errors"},
    output: {sift: report},
    createdBy: "system",
    runMs,
  };
}

// A dawnRuns doc with no readable startedAt is treated as started "now" so it
// is never failed out on its first poll.
function dawnRunStartMs(run, now) {
  return run.startedAt?.toMillis ? run.startedAt.toMillis() : now;
}

function isDawnRunStale({startedMs, now}) {
  return now - startedMs > DAWN_STALE_MS;
}

function dawnRecipient(run) {
  return String(run.toEmail || "").trim();
}

/**
 * The dawnRuns completion payload. `emailedTo` records a recipient only when
 * the email actually went out; `finishedAt` is the caller's server-timestamp
 * sentinel. The briefing body is capped so the doc stays under Firestore's
 * document size limit.
 */
function buildDawnDoneUpdate({subject, body, briefing, to, emailError, finishedAt}) {
  return {
    status: "done",
    subject,
    briefing: body.slice(0, 100_000),
    sourceFile: briefing.filename,
    emailedTo: emailError ? null : (to || null),
    emailError,
    finishedAt,
  };
}

const ECHO_DRAFT_SYSTEM_PROMPT =
  "You are a warm, concise support agent for ZedExams, a CBC learning " +
  "platform for Zambian learners, teachers and parents. Draft a reply " +
  "(under 110 words) to the message below. Be specific to what they said, " +
  "acknowledge their point, never promise refunds or timelines you can't " +
  "be sure of, and sign off as 'The ZedExams Team'. Plain text only — no " +
  "subject line, no preamble.";

// The user turn for Echo's drafted reply; the message body is capped so a
// pasted essay can't blow the token budget.
function buildEchoDraftUserContent({kind, item}) {
  const data = item.data || {};
  const who = data.name ? `Name: ${data.name}\n` : "";
  return `${who}Category: ${kind}\nMessage:\n${String(data.message || "").slice(0, 1200)}`;
}

module.exports = {
  AUDIT_SAMPLE_SIZE,
  DAWN_STALE_MS,
  truncateErrorMessage,
  buildFailureJob,
  auditGenerations,
  buildQuillRollup,
  buildCalaAuditRollup,
  buildVigilRollup,
  buildTillRollup,
  buildEchoRollup,
  isContentGateRunNotable,
  buildContentGateRollup,
  buildCompassRollup,
  buildAnchorRollup,
  buildMarshalRollup,
  buildSiftRollup,
  dawnRunStartMs,
  isDawnRunStale,
  dawnRecipient,
  buildDawnDoneUpdate,
  ECHO_DRAFT_SYSTEM_PROMPT,
  buildEchoDraftUserContent,
};
