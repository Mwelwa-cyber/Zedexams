/**
 * Unit tests for the coverage-guard discovery logic (aiEndpointDiscovery.js).
 * The guard is only as trustworthy as its parser, so this pins the parsing +
 * classification against synthetic index.js fixtures. Root-install-safe.
 * Run: node functions/aiEndpointDiscovery.test.js
 */

const assert = require("node:assert");
const {
  parseExports,
  buildRequireMap,
  kindFromSource,
  isProviderBacked,
  resolveKind,
  discoverEndpoints,
} = require("./aiEndpointDiscovery");

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok  ${name}`); }

console.log("aiEndpointDiscovery unit tests");

check("parseExports captures name + span up to the next export", () => {
  const src = [
    'exports.foo = onCall({',
    '  secrets: [anthropicApiKey],',
    '}, async () => {});',
    'exports.bar = require("./x").bar;',
  ].join("\n");
  const exps = parseExports(src);
  assert.equal(exps.length, 2);
  assert.equal(exps[0].name, "foo");
  assert.ok(exps[0].span.includes("anthropicApiKey"));
  assert.equal(exps[1].name, "bar");
  // foo's span must NOT bleed into bar's line.
  assert.ok(!exps[0].span.includes("exports.bar"));
});

check("buildRequireMap handles destructure, alias, whole-module + multiline", () => {
  const src = [
    'const { createA, createB } = require("./mod1");',
    'const { orig: aliasC } = require("./mod2");',
    'const Whole = require("./mod3");',
    'const {',
    '  createD,',
    '} = require("./mod4");',
  ].join("\n");
  const map = buildRequireMap(src);
  assert.equal(map.get("createA"), "./mod1");
  assert.equal(map.get("createB"), "./mod1");
  assert.equal(map.get("aliasC"), "./mod2");
  assert.equal(map.get("Whole"), "./mod3");
  assert.equal(map.get("createD"), "./mod4");
});

check("kindFromSource recognises each constructor", () => {
  assert.equal(kindFromSource("x = onCall({...})"), "callable");
  assert.equal(kindFromSource("x = onRequest({...})"), "http");
  assert.equal(kindFromSource("x = makeStreamingEndpoint({...})"), "http");
  assert.equal(kindFromSource("x = onSchedule('every day')"), "scheduled");
  assert.equal(kindFromSource("x = onDocumentWritten('p/{id}')"), "trigger");
  assert.equal(kindFromSource("x = onDocumentCreated('p/{id}')"), "trigger");
  assert.equal(kindFromSource("x = somethingElse()"), null);
});

check("isProviderBacked keys off provider secret vars only", () => {
  assert.equal(isProviderBacked("secrets: [anthropicApiKey]"), true);
  assert.equal(isProviderBacked("createX(openaiApiKey)"), true);
  assert.equal(isProviderBacked("createX(geminiApiKey, openaiApiKey)"), true);
  assert.equal(isProviderBacked("secrets: [emailSmtpUser]"), false);
  assert.equal(isProviderBacked("createX(googlePlaySaJson)"), false);
});

check("resolveKind follows a factory export to its definition file", () => {
  const requireMap = new Map([["createThing", "./thing"]]);
  const files = {"thing.js": "exports.createThing = () => onCall({}, () => {});"};
  const readFile = (rel) => files[rel] || null;
  const exp = {name: "thing", rhsFirstLine: "createThing(anthropicApiKey);", span: "exports.thing = createThing(anthropicApiKey);"};
  assert.equal(resolveKind(exp, requireMap, readFile), "callable");
});

check("resolveKind resolves a directory require to index.js", () => {
  const requireMap = new Map([["makeTrigger", "./agents/thing"]]);
  const files = {"agents/thing/index.js": "onDocumentWritten('p/{id}', () => {})"};
  const readFile = (rel) => files[rel] || null;
  const exp = {name: "t", rhsFirstLine: "makeTrigger(anthropicApiKey);", span: "exports.t = makeTrigger(anthropicApiKey);"};
  assert.equal(resolveKind(exp, requireMap, readFile), "trigger");
});

check("resolveKind returns unknown when the factory can't be resolved", () => {
  const exp = {name: "x", rhsFirstLine: "mysteryFactory(anthropicApiKey);", span: "exports.x = mysteryFactory(anthropicApiKey);"};
  assert.equal(resolveKind(exp, new Map(), () => null), "unknown");
});

check("discoverEndpoints tags an inline provider-backed callable", () => {
  const src = [
    'const { createGen } = require("./gen");',
    'exports.aiThing = onCall({',
    '  secrets: [anthropicApiKey],',
    '}, async () => {});',
    'exports.plainThing = onCall({}, async () => {});',
    'exports.genThing = createGen(openaiApiKey);',
    'exports.aTrigger = onDocumentWritten("p/{id}", () => {});',
  ].join("\n");
  const files = {"gen.js": "exports.createGen = () => onCall({}, () => {})"};
  const eps = discoverEndpoints({indexSrc: src, readFile: (r) => files[r] || null});

  const ai = eps.find((e) => e.name === "aiThing");
  assert.deepEqual({kind: ai.kind, pb: ai.providerBacked, ui: ai.userInvokable},
    {kind: "callable", pb: true, ui: true});

  const plain = eps.find((e) => e.name === "plainThing");
  assert.equal(plain.providerBacked, false); // no provider secret → ignored by the guard

  const gen = eps.find((e) => e.name === "genThing");
  assert.deepEqual({kind: gen.kind, pb: gen.providerBacked}, {kind: "callable", pb: true});

  const trig = eps.find((e) => e.name === "aTrigger");
  assert.deepEqual({kind: trig.kind, ui: trig.userInvokable}, {kind: "trigger", ui: false});
});

check("an unknown-kind provider-backed export stays user-invokable (fail closed)", () => {
  const src = "exports.mystery = weirdFactory(anthropicApiKey);";
  const eps = discoverEndpoints({indexSrc: src, readFile: () => null});
  const m = eps[0];
  assert.equal(m.kind, "unknown");
  assert.equal(m.providerBacked, true);
  assert.equal(m.userInvokable, true); // must be classified, not silently skipped
});

console.log(`\nAll ${passed} discovery unit tests passed.`);
