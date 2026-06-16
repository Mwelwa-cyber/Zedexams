/**
 * Tests for the visual safety-check pure helpers (prompt build + parse).
 * Plain-node assertion script.
 */
const assert = require("assert");
const {buildSafetyUserPrompt, parseSafetyResult} = require("./visualSafetyCore");

// --- buildSafetyUserPrompt ---
const prompt = buildSafetyUserPrompt({grade: 5, subject: "Integrated Science", topic: "Human respiratory system", style: "bw_test_diagram"});
assert.ok(/Grade: 5/.test(prompt), "prompt includes grade");
assert.ok(/Integrated Science/.test(prompt), "prompt includes subject");
assert.ok(/respiratory/.test(prompt), "prompt includes topic");
assert.ok(/bw_test_diagram/.test(prompt), "prompt includes style");
// Missing fields degrade to 'unspecified', never throw.
assert.ok(/unspecified/.test(buildSafetyUserPrompt({})), "empty context handled");

// --- parseSafetyResult ---
const ok = parseSafetyResult('{"verdict":"ok","issues":[],"summary":"Looks good."}');
assert.equal(ok.verdict, "ok");
assert.equal(ok.safetyStatus, "ok");
assert.deepEqual(ok.issues, []);

const review = parseSafetyResult('{"verdict":"review","issues":["Label \\"Tracea\\" is misspelled"],"summary":"Spelling issue."}');
assert.equal(review.verdict, "review");
assert.equal(review.safetyStatus, "flagged");
assert.equal(review.issues.length, 1);

// JSON wrapped in prose / code fences is still extracted.
const wrapped = parseSafetyResult('Here is the result:\n```json\n{"verdict":"ok","issues":[],"summary":"Fine."}\n```\nThanks');
assert.equal(wrapped.verdict, "ok");

// Garbage / empty → safe fallback that asks for human review (never "ok").
assert.equal(parseSafetyResult("not json at all").safetyStatus, "flagged");
assert.equal(parseSafetyResult("").safetyStatus, "flagged");
assert.equal(parseSafetyResult(null).safetyStatus, "flagged");

// Unknown verdict value defaults to review (fail safe).
assert.equal(parseSafetyResult('{"verdict":"maybe"}').verdict, "review");

// Issues are capped at 10.
const many = parseSafetyResult(JSON.stringify({verdict: "review", issues: Array.from({length: 20}, (_, i) => `issue ${i}`)}));
assert.equal(many.issues.length, 10);

console.log("✓ visual-safety tests passed");
