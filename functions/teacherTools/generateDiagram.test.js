/**
 * Provider-routing tests for runGenerateDiagram.
 *
 * Recraft was decommissioned (2026-06) and its API key removed: every B&W
 * line-art ("line_art") request is now served directly by gpt-image-1 with the
 * line-art prompt. The legacy provider value "recraft" is accepted as an alias
 * for "line_art". Explicit `openai` (photoreal) and `kie` (colour) requests are
 * served by gpt-image-1 too (Kie disabled), each keeping its own prompt guard.
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
let openaiResponse = null;

const ok200 = (json) => ({
  ok: true, status: 200,
  json: async () => json,
  text: async () => JSON.stringify(json),
});

const FAKE_PNG = Buffer.from("fake-png-bytes");
const FAKE_PNG_B64 = FAKE_PNG.toString("base64");

global.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith("https://external.api.recraft.ai/")) {
    // The Recraft endpoint is dead code now — a call here is a regression.
    calls.push({provider: "recraft", body: JSON.parse(opts.body)});
    throw new Error("Recraft must never be called — it was removed");
  }
  if (u.startsWith("https://api.openai.com/")) {
    calls.push({provider: "openai", body: JSON.parse(opts.body)});
    return openaiResponse();
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

  // ── 1. A line-art request is served by gpt-image-1, and the Recraft endpoint
  //       is NEVER called ──────────────────────────────────────────────────
  calls.length = 0;
  openaiResponse = () => ok200({data: [{b64_json: FAKE_PNG_B64}]});
  let out = await runGenerateDiagram({
    uid: "t1", rawInputs: {prompt: "A labelled human ear"},
    openaiKey: "ok", kieKey: "",
  });
  ok("line-art request → provider openai", out.provider === "openai");
  ok("line-art request → model gpt-image-1", out.model === "gpt-image-1");
  ok("line-art request → no Recraft HTTP call",
    calls.every((c) => c.provider !== "recraft"));
  ok("returns a tokened storage URL", /firebasestorage\.googleapis\.com/.test(out.url));

  // ── 2. The OpenAI line-art path keeps the B&W guard + size mapping ─────────
  calls.length = 0;
  openaiResponse = () => ok200({data: [{b64_json: FAKE_PNG_B64}]});
  out = await runGenerateDiagram({
    uid: "t2", rawInputs: {prompt: "A labelled human ear"},
    openaiKey: "ok", kieKey: "",
  });
  const lineArtCall = calls.find((c) => c.provider === "openai");
  ok("line-art keeps the B&W line-art guard",
    /black-and-white line art/i.test(lineArtCall.body.prompt));
  ok("line-art does NOT use the photoreal guard",
    !/photograph/i.test(lineArtCall.body.prompt));
  ok("line-art maps 1365x1024 → 1536x1024",
    lineArtCall.body.size === "1536x1024" && out.size === "1536x1024");
  ok("line-art stores the decoded PNG bytes", out.sizeBytes === FAKE_PNG.length);

  // ── 3. Line-art request with no OpenAI key → clear config error ────────────
  calls.length = 0;
  let threw = null;
  try {
    await runGenerateDiagram({
      uid: "t3", rawInputs: {prompt: "A labelled human ear"},
      openaiKey: "", kieKey: "",
    });
  } catch (err) {
    threw = err;
  }
  ok("no OpenAI key → failed-precondition config error",
    Boolean(threw) && threw.code === "failed-precondition" &&
    /Image generation is not configured/.test(threw.message));

  // ── 4. A line-art request goes straight to gpt-image-1 ─────────────────────
  calls.length = 0;
  openaiResponse = () => ok200({data: [{b64_json: FAKE_PNG_B64}]});
  out = await runGenerateDiagram({
    uid: "t4", rawInputs: {prompt: "A labelled human ear"},
    openaiKey: "ok", kieKey: "",
  });
  ok("line-art → served by openai", out.provider === "openai");
  ok("line-art → no Recraft HTTP call",
    calls.every((c) => c.provider !== "recraft"));

  // ── 5. Explicit photoreal provider still gets the photo guard ──────────
  calls.length = 0;
  openaiResponse = () => ok200({data: [{b64_json: FAKE_PNG_B64}]});
  out = await runGenerateDiagram({
    uid: "t5", rawInputs: {prompt: "A maize plant", provider: "openai"},
    openaiKey: "ok", kieKey: "",
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
      openaiKey: "", kieKey: "",
    });
  } catch (err) {
    threw = err;
  }
  ok("no keys → failed-precondition",
    Boolean(threw) && threw.code === "failed-precondition" &&
    /Image generation is not configured/.test(threw.message));

  // ── 7. A line-art request is served by OpenAI exactly once ────────────────
  calls.length = 0;
  openaiResponse = () => ok200({data: [{b64_json: FAKE_PNG_B64}]});
  out = await runGenerateDiagram({
    uid: "t7", rawInputs: {prompt: "A labelled human ear"},
    openaiKey: "ok", kieKey: "",
  });
  ok("line-art → provider openai", out.provider === "openai");
  ok("line-art → OpenAI produced the PNG", out.sizeBytes === FAKE_PNG.length);
  ok("line-art → OpenAI called exactly once",
    calls.filter((c) => c.provider === "openai").length === 1);

  // ── 8. OpenAI hangs → a clean deadline error, never bare internal ─────────
  calls.length = 0;
  openaiResponse = () => {
    const e = new Error("aborted");
    e.name = "AbortError";
    throw e;
  };
  threw = null;
  try {
    await runGenerateDiagram({
      uid: "t8", rawInputs: {prompt: "A labelled human ear"},
      openaiKey: "ok", kieKey: "",
    });
  } catch (err) {
    threw = err;
  }
  ok("openai times out → deadline-exceeded (not bare internal)",
    Boolean(threw) && threw.code === "deadline-exceeded");

  // ── 9. Kie disabled: a colour request is served by gpt-image-1 with the
  //       colour-illustration guard, and Kie is never called ─────────────────
  calls.length = 0;
  openaiResponse = () => ok200({data: [{b64_json: FAKE_PNG_B64}]});
  out = await runGenerateDiagram({
    uid: "t9", rawInputs: {prompt: "A market scene", provider: "kie"},
    openaiKey: "ok", kieKey: "kk",
  });
  ok("kie request → provider openai", out.provider === "openai");
  const colourCall = calls.find((c) => c.provider === "openai");
  ok("kie keeps the colour-illustration guard",
    /colourful flat illustration/i.test(colourCall.body.prompt));
  ok("kie does NOT use the line-art guard",
    !/black-and-white line art/i.test(colourCall.body.prompt));
  ok("kie does NOT use the photoreal guard",
    !/photograph/i.test(colourCall.body.prompt));

  // ── 10. Kie disabled with no OpenAI key → clear config error ──────────────
  threw = null;
  try {
    await runGenerateDiagram({
      uid: "t10", rawInputs: {prompt: "A market scene", provider: "kie"},
      openaiKey: "", kieKey: "kk",
    });
  } catch (err) {
    threw = err;
  }
  ok("kie + no OpenAI key → failed-precondition config error",
    Boolean(threw) && threw.code === "failed-precondition" &&
    /Image generation is not configured/.test(threw.message));

  // ── 11. Legacy 'recraft' provider value is aliased to 'line_art' ───────────
  calls.length = 0;
  openaiResponse = () => ok200({data: [{b64_json: FAKE_PNG_B64}]});
  out = await runGenerateDiagram({
    uid: "t11", rawInputs: {prompt: "A labelled human ear", provider: "recraft"},
    openaiKey: "ok", kieKey: "",
  });
  ok("legacy recraft → served by openai", out.provider === "openai");
  const legacyCall = calls.find((c) => c.provider === "openai");
  ok("legacy recraft → keeps the B&W line-art guard",
    /black-and-white line art/i.test(legacyCall.body.prompt));

  // ── 12. Explicit 'line_art' provider value keeps the B&W guard ─────────────
  calls.length = 0;
  openaiResponse = () => ok200({data: [{b64_json: FAKE_PNG_B64}]});
  out = await runGenerateDiagram({
    uid: "t12", rawInputs: {prompt: "A labelled human ear", provider: "line_art"},
    openaiKey: "ok", kieKey: "",
  });
  ok("line_art → served by openai", out.provider === "openai");
  const lineArtProviderCall = calls.find((c) => c.provider === "openai");
  ok("line_art → keeps the B&W line-art guard",
    /black-and-white line art/i.test(lineArtProviderCall.body.prompt));

  console.log(`\ngenerateDiagram provider routing: ${passed} checks passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
