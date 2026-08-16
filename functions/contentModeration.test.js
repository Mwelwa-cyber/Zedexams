"use strict";

// Tests for functions/contentModeration.js non-network paths (AI-003).
// The network call (moderateText) and verdict logic (contentModerationCore) are
// covered elsewhere; this locks in the skip / enablement / fail-open behaviour
// that never touches fetch. Run: node functions/contentModeration.test.js

const assert = require("node:assert");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
}

// Reload the module with a given env so the env-gated getters re-read.
function freshModule(env = {}) {
  for (const k of ["LEARNER_MODERATION_ENABLED", "MODERATION_FAIL_CLOSED"]) delete process.env[k];
  Object.assign(process.env, env);
  delete require.cache[require.resolve("./contentModeration")];
  return require("./contentModeration");
}

(async function run() {
  // Default enablement + policy.
  {
    const m = freshModule({});
    ok("moderation enabled by default", m.moderationEnabled() === true);
    ok("fails open by default", m.failClosedOnError() === false);
    ok("block message is a non-empty string", typeof m.LEARNER_BLOCK_MESSAGE === "string" && m.LEARNER_BLOCK_MESSAGE.length > 20);
  }

  // Env toggles.
  {
    const m = freshModule({LEARNER_MODERATION_ENABLED: "false", MODERATION_FAIL_CLOSED: "true"});
    ok("moderation can be disabled by env", m.moderationEnabled() === false);
    ok("fail-closed can be enabled by env", m.failClosedOnError() === true);
  }

  // Skip paths (no fetch): empty text, missing key, disabled flag all → allowed+skipped.
  {
    const m = freshModule({});
    const emptyText = await m.checkLearnerText("sk-test", "   ");
    ok("empty text is skipped + allowed", emptyText.allowed && emptyText.skipped);
    const noKey = await m.checkLearnerText("", "some worrying text");
    ok("missing api key is skipped + allowed", noKey.allowed && noKey.skipped);

    const disabled = freshModule({LEARNER_MODERATION_ENABLED: "false"});
    const off = await disabled.checkLearnerText("sk-test", "some worrying text");
    ok("disabled flag skips (allowed)", off.allowed && off.skipped);
  }

  // Windowed screening covers content BEYOND the first 8000-char clamp (the
  // single-call path would miss it) — the AI-003 streaming-output fix.
  {
    const m = freshModule({});
    const realFetch = global.fetch;
    const calls = [];
    global.fetch = async (_url, opts) => {
      const body = JSON.parse(opts.body);
      calls.push(body.input);
      const flagged = body.input.includes("__BADWORD__");
      return {
        ok: true,
        json: async () => ({results: [{flagged, categories: flagged ? {sexual: true} : {}, category_scores: {}}]}),
      };
    };
    try {
      // Prohibited marker sits AFTER the first 8000-char window.
      const longText = "a".repeat(8200) + " __BADWORD__ ";
      const single = await m.checkLearnerText("sk-test", longText);
      ok("single checkLearnerText misses content past 8000 chars", single.blocked === false);
      calls.length = 0;
      const windowed = await m.checkLearnerTextWindowed("sk-test", longText);
      ok("windowed screening blocks content past the first window", windowed.blocked === true);
      ok("windowed made more than one moderation call", calls.length >= 2);
      // Short text still takes exactly one call.
      calls.length = 0;
      await m.checkLearnerTextWindowed("sk-test", "hello there");
      ok("short text windows to a single call", calls.length === 1);
    } finally {
      global.fetch = realFetch;
    }
  }

  // A provider failure must be OBSERVABLE, at the severity that reaches the
  // only watcher there is. The unit for the decision is
  // contentModerationCore.describeModerationDegradation; this pins that the
  // child-facing path actually EMITS it, because a correct record nobody
  // writes is the bug this closes rather than fixes.
  {
    const realFetch = global.fetch;
    const realError = console.error;
    const realWarn = console.warn;
    const errors = [];
    const warns = [];
    // Serialise object args rather than letting them stringify to
    // "[object Object]" — the blocked-content audit line passes its reason as
    // an object, and a capture that flattens it cannot tell the two log lines
    // apart.
    const render = (a) => a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ");
    console.error = (...a) => errors.push(render(a));
    console.warn = (...a) => warns.push(render(a));
    global.fetch = async () => { throw new Error("moderation HTTP 503"); };
    try {
      // Fail-OPEN: the learner's text was let through UNSCREENED.
      const open = freshModule({});
      const openOutcome = await open.checkLearnerText("sk-test", "some text", {label: "aiChat:input"});
      ok("fail-open still allows (behaviour unchanged)", openOutcome.allowed === true);
      ok("fail-open emits on console.error", errors.length === 1);
      ok("fail-open line is greppable", errors[0].includes("moderation_degraded"));
      ok("fail-open line says the text was unscreened", errors[0].includes('"unscreened":true'));
      ok("fail-open line carries the call-site label", errors[0].includes("aiChat:input"));
      ok("fail-open does NOT go to console.warn (invisible to functionErrorWatch)", warns.length === 0);

      // Fail-CLOSED: safety held, so this is a warning, not a child-safety event.
      errors.length = 0;
      warns.length = 0;
      const closed = freshModule({MODERATION_FAIL_CLOSED: "true"});
      const closedOutcome = await closed.checkLearnerText("sk-test", "some text", {label: "aiChat:input"});
      ok("fail-closed still blocks (behaviour unchanged)", closedOutcome.blocked === true);
      // Two warns, and both belong: the degradation record, plus the
      // pre-existing blocked-content audit line, which should log every block
      // including one caused by a service error.
      ok("fail-closed emits the degradation on console.warn",
        warns.some((w) => w.includes("moderation_degraded")));
      ok("the blocked-content audit line still fires alongside it",
        warns.some((w) => w.includes("blocked") && w.includes("service_error")));
      ok("fail-closed does NOT raise an ERROR", errors.length === 0);

      // CONTROL: a screen that RUNS must stay silent, or the signal is noise
      // and the alert it feeds gets muted by whoever reads it first.
      errors.length = 0;
      warns.length = 0;
      global.fetch = async () => ({
        ok: true,
        json: async () => ({results: [{flagged: false, categories: {}, category_scores: {}}]}),
      });
      const fine = freshModule({});
      await fine.checkLearnerText("sk-test", "what is photosynthesis");
      ok("a working screen emits nothing", errors.length === 0 && warns.length === 0);
    } finally {
      global.fetch = realFetch;
      console.error = realError;
      console.warn = realWarn;
    }
  }

  // Restore a clean env for any later test in a shared runner.
  freshModule({});

  console.log(`All contentModeration tests passed (${passed} assertions).`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
