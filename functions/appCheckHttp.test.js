/**
 * functions/appCheckHttp.js — the HTTP App Check soft-verify gate.
 *
 * Two things are under test, and the second is the one that closes
 * SECURITY_ENDPOINT_AUDIT.md §4.2:
 *
 *  1. The gate's DECISIONS. "Observe-only" is the default and must stay the
 *     default: this endpoint set is mid-rollout, and a gate that quietly began
 *     rejecting unattested clients would look exactly like a working feature
 *     while locking out every browser whose attestation has not propagated.
 *     The interesting cases are the ones where a failure could be mistaken for
 *     a pass — a token that FAILS verification, and a telemetry write that
 *     throws — because both must leave the verification verdict unchanged.
 *
 *  2. That apiTextToSpeech actually PARTICIPATES. Importing a gate is not the
 *     same as calling it, so the last check reads tts.js and asserts the call
 *     is really there, with a control proving the scan can fail. Studio voices
 *     are ~$160/1M chars; "we added App Check to the priciest surface" is a
 *     claim worth being able to check mechanically.
 */
"use strict";

const assert = require("node:assert");
const Module = require("node:module");
const {readFileSync} = require("node:fs");
const path = require("node:path");

let passed = 0;
function ok(label, cond) {
  assert.ok(cond, label);
  console.log("  ok  " + label);
  passed++;
}

// ── Stubs ────────────────────────────────────────────────────────────
// firebase-admin is never initialised in a unit test, so admin.appCheck() and
// admin.firestore() are injected. Everything the writer touches is recorded so
// a test can assert on what it DID rather than only on what it returned.
const state = {
  verifyResult: null, // set to a claims object to make verification succeed
  verifyThrows: false,
  healthWrites: [],
  healthWriteThrows: false,
};

class FakeHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const fakeAdmin = {
  appCheck: () => ({
    verifyToken: async () => {
      if (state.verifyThrows) throw new Error("invalid token");
      if (!state.verifyResult) throw new Error("invalid token");
      return state.verifyResult;
    },
  }),
  firestore: Object.assign(
      () => ({
        collection: () => ({
          doc: () => ({
            collection: () => ({
              doc: () => ({
                set: async (update) => {
                  if (state.healthWriteThrows) throw new Error("firestore down");
                  state.healthWrites.push(update);
                },
              }),
            }),
          }),
        }),
      }),
      {
        FieldValue: {
          increment: (n) => ({__inc: n}),
          serverTimestamp: () => ({__ts: true}),
        },
      },
  ),
};

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "firebase-admin") return fakeAdmin;
  if (request === "firebase-functions/v2/https") return {HttpsError: FakeHttpsError};
  return origLoad.call(this, request, ...rest);
};

// Load appCheckHttp under a given env. Enforcement is resolved once at module
// load (every consumer of resolveAppCheckEnforcement does this), so changing it
// means re-requiring — which is the honest way to test it.
function loadWithEnv(env) {
  const saved = {
    APPCHECK_ENFORCE: process.env.APPCHECK_ENFORCE,
    APPCHECK_ENFORCE_LABELS: process.env.APPCHECK_ENFORCE_LABELS,
    APPCHECK_HEALTH_SAMPLE_RATE: process.env.APPCHECK_HEALTH_SAMPLE_RATE,
  };
  delete process.env.APPCHECK_ENFORCE;
  delete process.env.APPCHECK_ENFORCE_LABELS;
  // Sample every request so the telemetry assertions are deterministic rather
  // than dependent on the sampler drawing us in.
  process.env.APPCHECK_HEALTH_SAMPLE_RATE = "1";
  Object.assign(process.env, env);
  delete require.cache[require.resolve("./appCheckHttp")];
  delete require.cache[require.resolve("./appCheckEnforcement")];
  const mod = require("./appCheckHttp");
  return {
    mod,
    restore: () => {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    },
  };
}

const reqWith = (token) => ({get: (h) => (h === "X-Firebase-AppCheck" ? token : "")});

(async () => {
  console.log("appCheckHttp — HTTP App Check soft-verify gate");

  // 1. Observe-only is the DEFAULT. No token, no enforcement → no throw.
  {
    const {mod, restore} = loadWithEnv({});
    state.healthWrites = [];
    state.verifyResult = null;
    const out = await mod.softVerifyAppCheckHttp(reqWith(""), "apiTextToSpeech");
    ok("default: a missing token does NOT reject", out === null);
    ok("default: the outcome is still recorded", state.healthWrites.length === 1);
    restore();
  }

  // 2. A token that FAILS verification is not a pass — and still does not
  //    reject while observe-only. This is the case most likely to be misread.
  {
    const {mod, restore} = loadWithEnv({});
    state.healthWrites = [];
    state.verifyThrows = true;
    const out = await mod.softVerifyAppCheckHttp(reqWith("bad-token"), "apiTextToSpeech");
    ok("default: a token that fails verification returns unverified", out === null);
    state.verifyThrows = false;
    restore();
  }

  // 3. Enforcement by LABEL rejects an unattested caller.
  {
    const {mod, restore} = loadWithEnv({APPCHECK_ENFORCE_LABELS: "apiTextToSpeech"});
    state.verifyResult = null;
    let threw = null;
    try {
      await mod.softVerifyAppCheckHttp(reqWith(""), "apiTextToSpeech");
    } catch (e) {
      threw = e;
    }
    ok("enforced label: missing token throws permission-denied",
        threw && threw.code === "permission-denied");
    restore();
  }

  // 4. Enforcement is per-label, so a canary cannot take the others with it.
  {
    const {mod, restore} = loadWithEnv({APPCHECK_ENFORCE_LABELS: "apiTextToSpeech"});
    state.verifyResult = null;
    const out = await mod.softVerifyAppCheckHttp(reqWith(""), "apiAiChat");
    ok("enforced label: a DIFFERENT label is still observe-only", out === null);
    restore();
  }

  // 5. Enforced + a valid token → passes through, returns the claims.
  {
    const {mod, restore} = loadWithEnv({APPCHECK_ENFORCE_LABELS: "apiTextToSpeech"});
    state.verifyResult = {appId: "1:app"};
    const out = await mod.softVerifyAppCheckHttp(reqWith("good-token"), "apiTextToSpeech");
    ok("enforced label: a verified token is admitted", out && out.appId === "1:app");
    state.verifyResult = null;
    restore();
  }

  // 6. A telemetry failure must never change the verdict. The writer is
  //    best-effort by design; if a Firestore outage could reject traffic, the
  //    metrics would be load-bearing on the request path.
  {
    const {mod, restore} = loadWithEnv({});
    state.healthWriteThrows = true;
    let threw = null;
    let out;
    try {
      out = await mod.softVerifyAppCheckHttp(reqWith(""), "apiTextToSpeech");
    } catch (e) {
      threw = e;
    }
    ok("a health-write failure never fails verification", threw === null && out === null);
    state.healthWriteThrows = false;
    restore();
  }

  // 7. The audit item itself: apiTextToSpeech PARTICIPATES.
  {
    const ttsPath = path.join(__dirname, "tts.js");
    const src = readFileSync(ttsPath, "utf8");
    ok("tts.js calls the shared gate with its own label",
        /softVerifyAppCheckHttp\(\s*req\s*,\s*['"]apiTextToSpeech['"]\s*\)/.test(src));
    ok("tts.js imports it from the shared module, not a local copy",
        /require\(\s*['"]\.\/appCheckHttp['"]\s*\)/.test(src));

    // Control — the scan above must be able to fail, or it proves nothing.
    const mutated = src.replace(/softVerifyAppCheckHttp\(\s*req\s*,\s*['"]apiTextToSpeech['"]\s*\)/, "noop()");
    ok("control: the participation scan fails when the call is removed",
        !/softVerifyAppCheckHttp\(\s*req\s*,\s*['"]apiTextToSpeech['"]\s*\)/.test(mutated));
  }

  // 8. There is ONE writer. A second copy would be a second sampling decision
  //    and a second shard-picking rule for the same counters.
  {
    const indexSrc = readFileSync(path.join(__dirname, "index.js"), "utf8");
    ok("index.js no longer defines its own recordAppCheckHealth",
        !/^async function recordAppCheckHealth/m.test(indexSrc));
    ok("index.js no longer defines its own softVerifyAppCheckHttp",
        !/^async function softVerifyAppCheckHttp/m.test(indexSrc));
    ok("index.js takes both from the shared module",
        /require\(\s*"\.\/appCheckHttp"\s*\)/.test(indexSrc));
  }

  Module._load = origLoad;
  console.log("\n" + passed + " passed");
})().catch((err) => {
  Module._load = origLoad;
  console.error(err);
  process.exit(1);
});
