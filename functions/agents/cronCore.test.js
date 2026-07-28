/**
 * Node test for functions/agents/cronCore.js — the pure decision logic behind
 * the scheduled agent crons. No firebase-admin / firebase-functions
 * dependency, so this runs under plain `node` from the repo root with only
 * the root node_modules present.
 *
 * Run: node functions/agents/cronCore.test.js
 */

const assert = require("node:assert");
const {
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
  dawnRunStartMs,
  isDawnRunStale,
  dawnRecipient,
  buildDawnDoneUpdate,
  ECHO_DRAFT_SYSTEM_PROMPT,
  buildEchoDraftUserContent,
} = require("./cronCore");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

const TS = {sentinel: "server-timestamp"}; // opaque injected timestamp value

// ── constants ───────────────────────────────────────────────────────────────
ok("audit samples 20 recent generations", AUDIT_SAMPLE_SIZE === 20);
ok("a Dawn run is stuck after 25 minutes", DAWN_STALE_MS === 25 * 60 * 1000);

// ── truncateErrorMessage ────────────────────────────────────────────────────
ok("uses the Error message", truncateErrorMessage(new Error("boom"), 500) === "boom");
ok("stringifies a non-Error", truncateErrorMessage("plain failure", 500) === "plain failure");
ok("stringifies a message-less throw", truncateErrorMessage(42, 500) === "42");
ok("survives null", truncateErrorMessage(null, 500) === "null");
ok("truncates to the given cap", truncateErrorMessage(new Error("x".repeat(600)), 500).length === 500);
ok("respects a smaller cap", truncateErrorMessage(new Error("abcdef"), 3) === "abc");

// ── buildFailureJob ─────────────────────────────────────────────────────────
{
  const job = buildFailureJob({
    agentId: "quill",
    department: "qaEng",
    runType: "nightly-smoke",
    err: new Error("db down"),
    createdAt: TS,
    runMs: 123,
  });
  ok("failure job carries the agent identity", job.agentId === "quill" && job.department === "qaEng");
  ok("failure job defaults to status failed", job.status === "failed");
  ok("failure job nests runType under input", job.input.runType === "nightly-smoke");
  ok("failure job records the error message", job.error === "db down");
  ok("failure job is system-created", job.createdBy === "system");
  ok("failure job passes the timestamp sentinel through", job.createdAt === TS);
  ok("failure job carries runMs", job.runMs === 123);
}
{
  const job = buildFailureJob({
    agentId: "pubo",
    department: "content",
    runType: "content-auto-publish",
    status: "done",
    err: new Error("m".repeat(700)),
    createdAt: TS,
    runMs: 1,
  });
  ok("content gate failure logs as done, not failed", job.status === "done");
  ok("failure error is capped at 500 chars", job.error.length === 500);
}

// ── auditGenerations ────────────────────────────────────────────────────────
function makeDoc(id, data) {
  return {id, data: () => data};
}

(async () => {
  // Happy path: mixed aligned/drifted/skip/error sample.
  {
    const seenJobs = [];
    const runCala = async ({job}) => {
      seenJobs.push(job);
      if (job.input.topic === "Fractions") return {aligned: true};
      if (job.input.topic === "Cells") {
        return {aligned: false, gaps: ["missing outcome"], drift: "off-syllabus"};
      }
      throw new Error("kb lookup failed " + "z".repeat(300));
    };
    const docs = [
      makeDoc("g1", {tool: "worksheet", inputs: {grade: "5", subject: "maths", topic: "Fractions", subtopic: "Adding"}, output: {q: 1}}),
      makeDoc("g2", {tool: "notes", inputs: {grade: "8", subject: "science", topic: "Cells"}, output: {q: 2}}),
      makeDoc("g3", {tool: "quiz", inputs: {grade: "7", subject: "science", topic: "Energy"}, output: {q: 3}}),
      makeDoc("g4", {tool: "class_timetable", inputs: {topic: "Grade 5 timetable"}, output: {q: 4}}), // non-curricular → skipped
      makeDoc("g5", {tool: "worksheet", inputs: {grade: "6", subject: "maths"}, output: {q: 5}}), // no topic → skipped
      makeDoc("g6", {tool: "worksheet", inputs: {topic: "Fractions"}}), // no output → in-flight, ignored
      makeDoc("g7", null), // malformed doc data
    ];
    const summary = await auditGenerations({docs, runCala});
    ok("sampleSize is the whole sample", summary.sampleSize === 7);
    ok("audited counts only aligned+drifted", summary.audited === 2);
    ok("aligned counted", summary.aligned === 1);
    ok("drifted counted", summary.drifted === 1);
    ok("errored counted", summary.errored === 1);
    ok("non-curricular + topicless docs are skipped", summary.skipped === 2);
    ok("in-flight and malformed docs are ignored silently",
        summary.sampleSize - summary.audited - summary.errored - summary.skipped === 2);
    ok("drifted finding names the generation", summary.findings.some((f) => f.generationId === "g2"));
    ok("drifted finding carries gaps + drift",
        summary.findings.find((f) => f.generationId === "g2").gaps.length === 1 &&
        summary.findings.find((f) => f.generationId === "g2").drift === "off-syllabus");
    ok("error finding is capped at 200 chars",
        summary.findings.find((f) => f.generationId === "g3").error.length === 200);
    ok("aligned generations produce no finding", !summary.findings.some((f) => f.generationId === "g1"));
    ok("runCala only sees auditable docs", seenJobs.length === 3);
    ok("fakeJob carries the generation inputs",
        seenJobs[0].input.grade === "5" && seenJobs[0].input.subject === "maths" &&
        seenJobs[0].input.topic === "Fractions" && seenJobs[0].input.subtopic === "Adding");
    ok("fakeJob nests the draft under output.aria", seenJobs[0].output.aria.draft.q === 1);
  }

  // Findings are capped at 50 even when everything drifts.
  {
    const docs = [];
    for (let i = 0; i < 60; i++) {
      docs.push(makeDoc(`d${i}`, {tool: "worksheet", inputs: {topic: `T${i}`}, output: {}}));
    }
    const summary = await auditGenerations({docs, runCala: async () => ({aligned: false, gaps: [], drift: "d"})});
    ok("all drifted docs are counted", summary.drifted === 60);
    ok("findings list is capped at 50", summary.findings.length === 50);
  }

  // Empty sample.
  {
    const summary = await auditGenerations({docs: [], runCala: async () => {
      throw new Error("must not be called");
    }});
    ok("empty sample audits nothing", summary.sampleSize === 0 && summary.audited === 0 &&
        summary.findings.length === 0);
  }

  // ── rollup builders: identity + status decisions ──────────────────────────
  {
    const r = buildQuillRollup({report: {ok: true}, runMs: 9});
    ok("quill ok → done", r.status === "done");
    ok("quill rollup shape", r.agentId === "quill" && r.department === "qaEng" &&
        r.input.runType === "nightly-smoke" && r.output.quill.ok === true &&
        r.createdBy === "system" && r.runMs === 9);
    ok("quill not ok → awaiting_approval",
        buildQuillRollup({report: {ok: false}, runMs: 1}).status === "awaiting_approval");
  }
  {
    const clean = {sampleSize: 20, audited: 18, aligned: 18, drifted: 0, errored: 0, skipped: 2, findings: []};
    const r = buildCalaAuditRollup({summary: clean, runMs: 4});
    ok("cala clean audit → done", r.status === "done");
    ok("cala rollup carries sampleSize in input", r.input.sampleSize === 20 &&
        r.input.runType === "weekly-cbc-audit");
    ok("cala drifted → awaiting_approval",
        buildCalaAuditRollup({summary: {...clean, drifted: 1}, runMs: 4}).status === "awaiting_approval");
    ok("cala errored → awaiting_approval",
        buildCalaAuditRollup({summary: {...clean, errored: 1}, runMs: 4}).status === "awaiting_approval");
    ok("cala rollup nests summary under output.cala", r.output.cala === clean);
  }
  {
    ok("vigil ok → done", buildVigilRollup({report: {ok: true}, runMs: 1}).status === "done");
    const r = buildVigilRollup({report: {ok: false}, runMs: 2});
    ok("vigil failing → awaiting_approval", r.status === "awaiting_approval");
    ok("vigil rollup shape", r.agentId === "vigil" && r.department === "qaEng" &&
        r.input.runType === "hourly-monitor" && r.output.vigil.ok === false);
  }
  {
    const quiet = {recovered: [], errors: []};
    ok("till quiet run → done", buildTillRollup({summary: quiet, runMs: 1}).status === "done");
    ok("till recovered money → awaiting_approval",
        buildTillRollup({summary: {recovered: [{}], errors: []}, runMs: 1}).status === "awaiting_approval");
    ok("till errors → awaiting_approval",
        buildTillRollup({summary: {recovered: [], errors: [{}]}, runMs: 1}).status === "awaiting_approval");
    const r = buildTillRollup({summary: quiet, runMs: 7});
    ok("till rollup shape", r.agentId === "till" && r.department === "revenue" &&
        r.input.runType === "hourly-reconcile" && r.output.till === quiet && r.runMs === 7);
  }
  {
    ok("echo quiet run → done",
        buildEchoRollup({summary: {processed: 0, errors: []}, runMs: 1}).status === "done");
    ok("echo processed items → awaiting_approval",
        buildEchoRollup({summary: {processed: 3, errors: []}, runMs: 1}).status === "awaiting_approval");
    ok("echo errors → awaiting_approval",
        buildEchoRollup({summary: {processed: 0, errors: ["x"]}, runMs: 1}).status === "awaiting_approval");
    const r = buildEchoRollup({summary: {processed: 0, errors: []}, runMs: 5});
    ok("echo rollup shape", r.agentId === "echo" && r.department === "support" &&
        r.input.runType === "support-triage" && r.output.echo.processed === 0);
  }
  {
    ok("content gate quiet sweep is not notable",
        !isContentGateRunNotable({autoApproved: [], errors: []}));
    ok("content gate publish is notable",
        isContentGateRunNotable({autoApproved: ["job1"], errors: []}));
    ok("content gate error is notable",
        isContentGateRunNotable({autoApproved: [], errors: ["e"]}));
    const summary = {autoApproved: ["job1"], errors: []};
    const r = buildContentGateRollup({summary, createdAt: TS, runMs: 3});
    ok("content gate rollup is a done pubo job", r.agentId === "pubo" &&
        r.department === "content" && r.status === "done" &&
        r.input.runType === "content-auto-publish");
    ok("content gate rollup stamps its own createdAt sentinel", r.createdAt === TS);
    ok("content gate rollup nests summary under output.gate", r.output.gate === summary);
  }
  {
    const quiet = {backlog: [], errors: [], windowDays: 14};
    ok("compass empty week → done", buildCompassRollup({summary: quiet, runMs: 1}).status === "done");
    ok("compass backlog → awaiting_approval",
        buildCompassRollup({summary: {...quiet, backlog: [{}]}, runMs: 1}).status === "awaiting_approval");
    ok("compass errors → awaiting_approval",
        buildCompassRollup({summary: {...quiet, errors: [{}]}, runMs: 1}).status === "awaiting_approval");
    const r = buildCompassRollup({summary: quiet, runMs: 2});
    ok("compass rollup carries windowDays in input", r.input.windowDays === 14 &&
        r.input.runType === "weekly-product-signal");
    ok("compass rollup shape", r.agentId === "compass" && r.department === "content" &&
        r.output.compass === quiet);
  }
  {
    ok("anchor nothing at risk → done",
        buildAnchorRollup({summary: {atRisk: 0, errors: []}, runMs: 1}).status === "done");
    ok("anchor at-risk learners → awaiting_approval",
        buildAnchorRollup({summary: {atRisk: 5, errors: []}, runMs: 1}).status === "awaiting_approval");
    ok("anchor errors → awaiting_approval",
        buildAnchorRollup({summary: {atRisk: 0, errors: ["e"]}, runMs: 1}).status === "awaiting_approval");
    const r = buildAnchorRollup({summary: {atRisk: 0, errors: []}, runMs: 6});
    ok("anchor rollup shape", r.agentId === "anchor" && r.department === "growth" &&
        r.input.runType === "weekly-retention-scan" && r.output.anchor.atRisk === 0);
  }
  {
    ok("marshal healthy → done", buildMarshalRollup({report: {healthy: true}, runMs: 1}).status === "done");
    const r = buildMarshalRollup({report: {healthy: false}, runMs: 8});
    ok("marshal unhealthy → awaiting_approval", r.status === "awaiting_approval");
    ok("marshal rollup shape", r.agentId === "marshal" && r.department === "qaEng" &&
        r.input.runType === "hourly-supervisor" && r.output.marshal.healthy === false);
  }

  // ── Dawn helpers ──────────────────────────────────────────────────────────
  const NOW = 1_000_000_000;
  ok("dawn start reads a Firestore Timestamp", dawnRunStartMs({startedAt: {toMillis: () => 42}}, NOW) === 42);
  ok("dawn start falls back to now when startedAt is missing", dawnRunStartMs({}, NOW) === NOW);
  ok("dawn start falls back to now when startedAt is not a Timestamp",
      dawnRunStartMs({startedAt: "yesterday"}, NOW) === NOW);
  ok("a run exactly at the stale threshold is not yet stale",
      !isDawnRunStale({startedMs: NOW - DAWN_STALE_MS, now: NOW}));
  ok("a run past the stale threshold is stale",
      isDawnRunStale({startedMs: NOW - DAWN_STALE_MS - 1, now: NOW}));
  ok("a fresh run is not stale", !isDawnRunStale({startedMs: NOW, now: NOW}));

  ok("dawn recipient is trimmed", dawnRecipient({toEmail: "  a@b.c  "}) === "a@b.c");
  ok("missing recipient → empty string", dawnRecipient({}) === "");
  ok("null recipient → empty string", dawnRecipient({toEmail: null}) === "");

  {
    const upd = buildDawnDoneUpdate({
      subject: "Morning briefing",
      body: "b".repeat(150_000),
      briefing: {filename: "briefing.md"},
      to: "a@b.c",
      emailError: null,
      finishedAt: TS,
    });
    ok("done update marks the run done", upd.status === "done");
    ok("briefing body is capped at 100k", upd.briefing.length === 100_000);
    ok("source filename is recorded", upd.sourceFile === "briefing.md");
    ok("clean send records the recipient", upd.emailedTo === "a@b.c" && upd.emailError === null);
    ok("finishedAt sentinel passes through", upd.finishedAt === TS);
  }
  {
    const upd = buildDawnDoneUpdate({
      subject: "s",
      body: "short",
      briefing: {filename: "f.md"},
      to: "a@b.c",
      emailError: "smtp-not-configured",
      finishedAt: TS,
    });
    ok("a failed send never claims a recipient", upd.emailedTo === null &&
        upd.emailError === "smtp-not-configured");
  }
  {
    const upd = buildDawnDoneUpdate({
      subject: "s", body: "short", briefing: {filename: "f.md"},
      to: "", emailError: "no-recipient", finishedAt: TS,
    });
    ok("no recipient records null emailedTo", upd.emailedTo === null);
  }

  // ── Echo draft prompt ─────────────────────────────────────────────────────
  ok("echo system prompt is the on-brand support persona",
      ECHO_DRAFT_SYSTEM_PROMPT.includes("ZedExams") &&
      ECHO_DRAFT_SYSTEM_PROMPT.includes("The ZedExams Team"));
  {
    const content = buildEchoDraftUserContent({
      kind: "support",
      item: {data: {name: "Chanda", message: "My quiz will not load."}},
    });
    ok("draft content leads with the sender's name", content.startsWith("Name: Chanda\n"));
    ok("draft content carries category and message",
        content.includes("Category: support") && content.includes("My quiz will not load."));
  }
  {
    const content = buildEchoDraftUserContent({kind: "feedback", item: {data: {message: "Great app"}}});
    ok("no name → no Name line", content.startsWith("Category: feedback"));
  }
  {
    const content = buildEchoDraftUserContent({
      kind: "support",
      item: {data: {message: "m".repeat(2000)}},
    });
    ok("message body is capped at 1200 chars", content.endsWith("m".repeat(10)) &&
        content.length === "Category: support\nMessage:\n".length + 1200);
  }
  {
    const content = buildEchoDraftUserContent({kind: "support", item: {}});
    ok("missing data yields an empty message body", content === "Category: support\nMessage:\n");
  }

  console.log(`\ncronCore: all ${passed} assertions passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
