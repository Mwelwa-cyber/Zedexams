/**
 * Node test for the deliver-the-product retry/fallback logic in
 * functions/teacherTools/anthropicClient.js.
 *
 * Teacher generators consume quota up front (assertAndIncrement runs before the
 * Claude call). Rather than refunding a burned credit when Anthropic hiccups,
 * callClaude now re-attempts across a model ladder so the teacher actually
 * receives the artifact they paid for. This covers the pure decision logic that
 * drives that behaviour — no network, dispatch is injected.
 *
 * Plain `node` script (repo convention).
 * Run: node functions/teacherTools/anthropicClient.test.js
 */

const assert = require("node:assert");
const Module = require("node:module");

// functions/ deps live in functions/node_modules, so stub the one external the
// module under test loads at import time (matches usageMeter.test.js).
class HttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "firebase-functions/v2/https") return {HttpsError};
  return origLoad.call(this, request, ...rest);
};

const {
  isDeliverableRetry,
  buildModelLadder,
  attemptWithFallback,
  DEFAULT_MODEL,
  FALLBACK_MODEL,
} = require("./anthropicClient");

Module._load = origLoad;

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

// A failure shaped like the HttpsErrors callClaude throws — only `.code` matters.
function err(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}

(async () => {
  // ── isDeliverableRetry ─────────────────────────────────────────────────
  console.log("anthropicClient (isDeliverableRetry)");
  ok("429/resource-exhausted → unavailable",
    isDeliverableRetry(err("resource-exhausted")) === "unavailable");
  ok("unavailable → unavailable",
    isDeliverableRetry(err("unavailable")) === "unavailable");
  ok("internal (bad shape) → shape",
    isDeliverableRetry(err("internal")) === "shape");
  ok("invalid-argument → null (never retried)",
    isDeliverableRetry(err("invalid-argument")) === null);
  ok("null error → null", isDeliverableRetry(null) === null);

  // ── buildModelLadder ───────────────────────────────────────────────────
  console.log("\nanthropicClient (buildModelLadder)");
  ok("primary then fallback",
    JSON.stringify(buildModelLadder("claude-sonnet-4-6")) ===
    JSON.stringify(["claude-sonnet-4-6", FALLBACK_MODEL]));
  ok("de-dupes when primary === fallback",
    JSON.stringify(buildModelLadder(FALLBACK_MODEL)) ===
    JSON.stringify([FALLBACK_MODEL]));
  ok("undefined → 2-rung ladder starting at the default model",
    buildModelLadder(undefined).length === 2 &&
    buildModelLadder(undefined)[0] === DEFAULT_MODEL);

  // ── attemptWithFallback ────────────────────────────────────────────────
  console.log("\nanthropicClient (attemptWithFallback)");

  // 1. Success first try — fallback is never touched.
  {
    const calls = [];
    const out = await attemptWithFallback({
      models: ["A", "B"],
      dispatch: (m) => {
        calls.push(m);
        return Promise.resolve({model: m, ok: true});
      },
    });
    ok("returns the first-attempt result", out.ok === true && out.model === "A");
    ok("does not touch the fallback on success", calls.join(",") === "A");
  }

  // 2. Unavailable on primary → straight to the fallback model (no re-roll).
  {
    const calls = [];
    const out = await attemptWithFallback({
      models: ["A", "B"],
      dispatch: (m) => {
        calls.push(m);
        if (m === "A") return Promise.reject(err("unavailable"));
        return Promise.resolve({model: m});
      },
    });
    ok("falls back to model B on unavailable", out.model === "B");
    ok("unavailable does NOT re-roll the primary", calls.join(",") === "A,B");
  }

  // 3. Shape error → one re-roll on the SAME model, then succeeds.
  {
    const calls = [];
    let n = 0;
    const out = await attemptWithFallback({
      models: ["A", "B"],
      dispatch: (m) => {
        calls.push(m);
        n += 1;
        if (n === 1) return Promise.reject(err("internal"));
        return Promise.resolve({model: m});
      },
    });
    ok("re-rolls a shape error then succeeds on the same model",
      out.model === "A");
    ok("the re-roll stays on the primary", calls.join(",") === "A,A");
  }

  // 4. Shape error persists on primary → moves to the fallback model.
  {
    const calls = [];
    const out = await attemptWithFallback({
      models: ["A", "B"],
      dispatch: (m) => {
        calls.push(m);
        if (m === "A") return Promise.reject(err("internal"));
        return Promise.resolve({model: m});
      },
    });
    ok("persistent shape error falls through to the fallback", out.model === "B");
    ok("primary is re-rolled exactly once before falling back",
      calls.join(",") === "A,A,B");
  }

  // 5. Non-retryable error → propagate immediately, no fallback.
  {
    const calls = [];
    let threw = null;
    try {
      await attemptWithFallback({
        models: ["A", "B"],
        dispatch: (m) => {
          calls.push(m);
          return Promise.reject(err("invalid-argument"));
        },
      });
    } catch (e) {
      threw = e;
    }
    ok("propagates a non-retryable error",
      threw && threw.code === "invalid-argument");
    ok("never tries the fallback on a non-retryable error",
      calls.join(",") === "A");
  }

  // 6. Stream already emitted tokens → must NOT retry (would double-send).
  {
    const calls = [];
    let threw = null;
    try {
      await attemptWithFallback({
        models: ["A", "B"],
        streamProgressed: () => true,
        dispatch: (m) => {
          calls.push(m);
          return Promise.reject(err("unavailable"));
        },
      });
    } catch (e) {
      threw = e;
    }
    ok("propagates when the stream already progressed",
      threw && threw.code === "unavailable");
    ok("does not re-stream after tokens were sent", calls.join(",") === "A");
  }

  // 7. Whole ladder exhausted → throws the last error seen.
  {
    let threw = null;
    try {
      await attemptWithFallback({
        models: ["A", "B"],
        dispatch: (m) =>
          Promise.reject(err(m === "A" ? "unavailable" : "internal")),
      });
    } catch (e) {
      threw = e;
    }
    ok("throws the last error after the ladder is exhausted",
      threw && threw.code === "internal");
  }

  console.log(`\nAll ${passed} assertions passed.`);
})().catch((e) => {
  console.error("\nTEST FAILURE:", e && e.message);
  process.exit(1);
});
