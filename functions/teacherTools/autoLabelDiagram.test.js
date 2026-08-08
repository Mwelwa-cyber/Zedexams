/**
 * Node test for the autoLabelDiagram runner (Visual Studio v2, spec 1C):
 * happy path, one-silent-retry-then-graceful-fallback, the grounded flag
 * (a grounding FAILURE downgrades honestly, never kills the call), and the
 * image-input guard. autoLabelCore loads for real; the model call and the
 * KB lookup are stubbed via Module._load (same pattern as
 * reviseQuestionRunner.test.js).
 *
 * Run: node functions/teacherTools/autoLabelDiagram.test.js
 */

const assert = require("node:assert");
const Module = require("node:module");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

class HttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const calls = {claude: [], context: []};
let claudeImpl = async () => JSON.stringify({parts: []});
let contextImpl = async () => ({contextBlock: "OUTCOME: identify the organs"});

const origLoad = Module._load;
Module._load = function(request, ...rest) {
  if (request === "firebase-functions/v2/https") return {HttpsError};
  if (request === "../aiService") {
    return {
      callAnthropic: (apiKey, opts) => {
        calls.claude.push({apiKey, opts});
        return claudeImpl(apiKey, opts);
      },
    };
  }
  if (request === "./cbcKnowledge") {
    return {
      resolveCbcContext: (args) => {
        calls.context.push(args);
        return contextImpl(args);
      },
    };
  }
  return origLoad.call(this, request, ...rest);
};

const {runAutoLabelDiagram} = require("./autoLabelDiagram");
const png = `data:image/png;base64,${Buffer.from("fake-png").toString("base64")}`;

(async () => {
  // ── happy path ────────────────────────────────────────────────────────────
  claudeImpl = async () => JSON.stringify({parts: [
    {word: "Stomach", anchor: {x: 0.4, y: 0.5}, confidence: 0.9},
    {word: "Liver", anchor: {x: 0.3, y: 0.3}, confidence: 0.55},
  ]});
  let res = await runAutoLabelDiagram({
    dataUrl: png, subject: "Integrated Science", grade: "7",
    topic: "Digestive system", apiKey: "k", uid: "u1",
  });
  ok("happy path returns both proposals", res.parts.length === 2);
  ok("happy path is grounded", res.grounded === true && res.failed === false);
  ok("threshold travels with the response", res.lowConfidenceThreshold === 0.7);
  ok("one model call on a clean reply", calls.claude.length === 1);
  ok("vision content carries the image block",
      calls.claude[0].opts.messages[0].content.some((c) => c.type === "image"));
  ok("grounding block reached the prompt",
      calls.claude[0].opts.messages[0].content[0].text.includes("OUTCOME: identify the organs"));

  // ── one silent retry on a malformed shape ────────────────────────────────
  calls.claude.length = 0;
  let attempt = 0;
  claudeImpl = async () => {
    attempt += 1;
    if (attempt === 1) return "sorry, here are the labels: Stomach";
    return JSON.stringify({parts: [{word: "Leaf", anchor: {x: 0.5, y: 0.2}, confidence: 0.8}]});
  };
  res = await runAutoLabelDiagram({dataUrl: png, apiKey: "k", uid: "u1"});
  ok("malformed first reply retried once", calls.claude.length === 2);
  ok("retry result returned", res.parts.length === 1 && res.parts[0].word === "Leaf");
  ok("retry path is not a failure", res.failed === false);

  // ── graceful fallback after two malformed replies ────────────────────────
  calls.claude.length = 0;
  claudeImpl = async () => "still not json";
  res = await runAutoLabelDiagram({dataUrl: png, apiKey: "k", uid: "u1"});
  ok("two attempts, then stop", calls.claude.length === 2);
  ok("fallback is failed:true with no parts", res.failed === true && res.parts.length === 0);

  // ── grounding failure downgrades, never kills the call ───────────────────
  claudeImpl = async () => JSON.stringify({parts: []});
  contextImpl = async () => {
    throw new Error("KB unavailable");
  };
  res = await runAutoLabelDiagram({dataUrl: png, apiKey: "k", uid: "u1"});
  ok("grounding failure → grounded:false, call still ran", res.grounded === false && res.failed === false);
  contextImpl = async () => ({contextBlock: ""});
  res = await runAutoLabelDiagram({dataUrl: png, apiKey: "k", uid: "u1"});
  ok("empty context → grounded:false", res.grounded === false);

  // ── existing words filter proposals server-side ──────────────────────────
  claudeImpl = async () => JSON.stringify({parts: [
    {word: "Stomach", anchor: {x: 0.4, y: 0.5}, confidence: 0.9},
    {word: "Liver", anchor: {x: 0.3, y: 0.3}, confidence: 0.9},
  ]});
  res = await runAutoLabelDiagram({
    dataUrl: png, existingWords: ["stomach"], apiKey: "k", uid: "u1",
  });
  ok("already-labelled parts are filtered", res.parts.map((p) => p.word).join(",") === "Liver");

  // ── image guard ──────────────────────────────────────────────────────────
  let threw = null;
  try {
    await runAutoLabelDiagram({dataUrl: "https://x/y.png", apiKey: "k", uid: "u1"});
  } catch (err) {
    threw = err;
  }
  ok("non-data-URL image refused with invalid-argument",
      threw instanceof HttpsError && threw.code === "invalid-argument");

  Module._load = origLoad;
  console.log(`autoLabelDiagram.test: ${passed} assertions passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
