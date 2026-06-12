/**
 * Provider-routing tests for runGenerateDiagram — above all the
 * Recraft → OpenAI (gpt-image-1) fallback added when the Recraft balance
 * ran dry mid starter-pack (2026-06) and the owner switched to ChatGPT.
 *
 * Plain `node` script (repo convention — no test runner). CI runs these
 * with a root-only `npm ci`, where functions/node_modules does NOT exist,
 * so the firebase deps are stubbed via Module._load before
 * generateDiagram.js is required. Everything else the module pulls in
 * (aiPromptPolicy, anthropicFetch, teacherPlans, kieClient, openaiClient)
 * is dependency-free.
 *
 * Run: node functions/teacherTools/generateDiagram.test.js
 */

const assert = require("node:assert");
const Module = require("node:module");

// ── Stub the firebase deps before the module under test loads ────────────
class FakeHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const savedFiles = [];
const firestoreFn = () => ({collection: () => ({add: async () => ({})})});
firestoreFn.FieldValue = {serverTimestamp: () => new Date(0)};
const adminStub = {
  storage: () => ({
    bucket: () => ({
      name: "test-bucket",
      file: (path) => ({
        save: async (buffer) => savedFiles.push({path, bytes: buffer.length}),
      }),
    }),
  }),
  firestore: firestoreFn,
};

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "firebase-admin") return adminStub;
  if (request === "firebase-functions/v2/https") {
    return {HttpsError: FakeHttpsError, onCall: () => () => {}};
  }
  if (request === "firebase-functions/params") {
    return {defineSecret: () => ({value: () => ""})};
  }
  return origLoad.call(this, request, ...rest);
};

const {runGenerateDiagram} = require("./generateDiagram");

// ── fetch stub: routes by endpoint, records every call ───────────────────
const calls = [];
let recraftResponse = null;
let openaiResponse = null;

const ok200 = (json) => ({
  ok: true, status: 200,
  json: async () => json,
  text: async () => JSON.stringify(json),
});
const fail = (status, body) => ({
  ok: false, status,
  json: async () => ({}),
  text: async () => body,
});

const FAKE_PNG = Buffer.from("fake-png-bytes");
const FAKE_PNG_B64 = FAKE_PNG.toString("base64");
const RECRAFT_CDN_URL = "https://cdn.recraft.fake/img.png";

global.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith("https://external.api.recraft.ai/")) {
    calls.push({provider: "recraft", body: JSON.parse(opts.body)});
    return recraftResponse();
  }
  if (u.startsWith("https://api.openai.com/")) {
    calls.push({provider: "openai", body: JSON.parse(opts.body)});
    return openaiResponse();
  }
  if (u === RECRAFT_CDN_URL) {
    calls.push({provider: "recraft-cdn"});
    return {ok: true, arrayBuffer: async () => Uint8Array.from(FAKE_PNG).buffer};
  }
  throw new Error(`Unexpected fetch: ${u}`);
};

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

async function main() {
  console.log("generateDiagram provider routing");

  // ── 1. Healthy Recraft serves line art, no fallback ────────────────────
  calls.length = 0;
  recraftResponse = () => ok200({data: [{url: RECRAFT_CDN_URL}]});
  openaiResponse = () => {
    throw new Error("OpenAI must not be called when Recraft is healthy");
  };
  let out = await runGenerateDiagram({
    uid: "t1", rawInputs: {prompt: "A labelled human ear"},
    recraftKey: "rk", openaiKey: "ok", kieKey: "",
  });
  ok("healthy Recraft → provider recraft", out.provider === "recraft");
  ok("healthy Recraft → model recraft-v3", out.model === "recraft-v3");
  ok("healthy Recraft → no OpenAI call", calls.every((c) => c.provider !== "openai"));
  ok("returns a tokened storage URL", /firebasestorage\.googleapis\.com/.test(out.url));

  // ── 2. Recraft out of credits → gpt-image-1 fallback, line-art prompt ──
  calls.length = 0;
  recraftResponse = () => fail(400, "{\"code\":\"not_enough_credits\"}");
  openaiResponse = () => ok200({data: [{b64_json: FAKE_PNG_B64}]});
  out = await runGenerateDiagram({
    uid: "t2", rawInputs: {prompt: "A labelled human ear"},
    recraftKey: "rk", openaiKey: "ok", kieKey: "",
  });
  ok("credits dry → provider openai", out.provider === "openai");
  ok("credits dry → model gpt-image-1", out.model === "gpt-image-1");
  const fallbackCall = calls.find((c) => c.provider === "openai");
  ok("fallback hit the OpenAI API once",
    Boolean(fallbackCall) && calls.filter((c) => c.provider === "openai").length === 1);
  ok("fallback keeps the B&W line-art guard",
    /black-and-white line art/i.test(fallbackCall.body.prompt));
  ok("fallback does NOT use the photoreal guard",
    !/photograph/i.test(fallbackCall.body.prompt));
  ok("fallback maps 1365x1024 → 1536x1024",
    fallbackCall.body.size === "1536x1024" && out.size === "1536x1024");
  ok("fallback stores the decoded PNG bytes", out.sizeBytes === FAKE_PNG.length);

  // ── 3. Recraft fails with no OpenAI key → original error surfaces ──────
  calls.length = 0;
  recraftResponse = () => fail(400, "{\"code\":\"not_enough_credits\"}");
  let threw = null;
  try {
    await runGenerateDiagram({
      uid: "t3", rawInputs: {prompt: "A labelled human ear"},
      recraftKey: "rk", openaiKey: "", kieKey: "",
    });
  } catch (err) {
    threw = err;
  }
  ok("no fallback key → rethrows the Recraft error",
    Boolean(threw) && /Recraft request failed \(400\)/.test(threw.message));

  // ── 4. Recraft key missing entirely → straight to gpt-image-1 ──────────
  calls.length = 0;
  recraftResponse = () => {
    throw new Error("Recraft must not be called without a key");
  };
  openaiResponse = () => ok200({data: [{b64_json: FAKE_PNG_B64}]});
  out = await runGenerateDiagram({
    uid: "t4", rawInputs: {prompt: "A labelled human ear"},
    recraftKey: "", openaiKey: "ok", kieKey: "",
  });
  ok("missing Recraft key → served by openai", out.provider === "openai");
  ok("missing Recraft key → no Recraft HTTP call",
    calls.every((c) => c.provider !== "recraft"));

  // ── 5. Explicit photoreal provider still gets the photo guard ──────────
  calls.length = 0;
  openaiResponse = () => ok200({data: [{b64_json: FAKE_PNG_B64}]});
  out = await runGenerateDiagram({
    uid: "t5", rawInputs: {prompt: "A maize plant", provider: "openai"},
    recraftKey: "rk", openaiKey: "ok", kieKey: "",
  });
  const photoCall = calls.find((c) => c.provider === "openai");
  ok("explicit openai → photoreal guard kept",
    /photograph/i.test(photoCall.body.prompt));
  ok("explicit openai → no Recraft call",
    calls.every((c) => c.provider !== "recraft"));

  // ── 6. No keys at all → clear failed-precondition ───────────────────────
  threw = null;
  try {
    await runGenerateDiagram({
      uid: "t6", rawInputs: {prompt: "A labelled human ear"},
      recraftKey: "", openaiKey: "", kieKey: "",
    });
  } catch (err) {
    threw = err;
  }
  ok("no keys → failed-precondition",
    Boolean(threw) && threw.code === "failed-precondition" &&
    /Recraft API key is not configured/.test(threw.message));

  console.log(`\ngenerateDiagram provider routing: ${passed} checks passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
