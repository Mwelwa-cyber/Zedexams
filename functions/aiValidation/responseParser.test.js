/**
 * Node test for functions/aiValidation/responseParser.js — the hardened
 * AI-response parser. No firebase deps.
 *
 * Run: node functions/aiValidation/responseParser.test.js
 */

const assert = require("node:assert");
const {
  stripToJson, scanBrackets, recoverTruncatedJson, looksLikeRefusal,
  parseAiJsonResponse,
} = require("./responseParser");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}
const codes = (r) => r.issues.map((i) => i.code);

// ── stripToJson ──────────────────────────────────────────────────────────────
ok("strips ```json fence", stripToJson('```json\n{"a":1}\n```') === '{"a":1}');
ok("strips bare ``` fence", stripToJson('```\n{"a":1}\n```') === '{"a":1}');
ok("trims leading prose", stripToJson('Here is your paper:\n{"a":1}') === '{"a":1}');
ok("trims trailing commentary", stripToJson('{"a":1}\nHope that helps!') === '{"a":1}');
ok("handles a bare array", stripToJson('[1,2,3]') === '[1,2,3]');
ok("empty → empty", stripToJson("   ") === "");

// ── scanBrackets ─────────────────────────────────────────────────────────────
ok("balanced object", scanBrackets('{"a":[1,2]}').balanced === true);
ok("unclosed object → not balanced", scanBrackets('{"a":[1,2]').balanced === false);
ok("unclosed array → not balanced", scanBrackets('{"a":[1,2}').balanced === false);
ok("braces inside strings ignored", scanBrackets('{"a":"}]{"}').balanced === true);
ok("open count reported", scanBrackets('{{').openBraces === 2);

// ── recoverTruncatedJson ─────────────────────────────────────────────────────
const cut = '{"sections":[{"q":"one"},{"q":"two"},{"q":"thr';
const rec = recoverTruncatedJson(cut);
ok("recovers complete elements from a cut array", rec && Array.isArray(rec.sections) && rec.sections.length === 2);
ok("recovered elements are intact", rec.sections[0].q === "one" && rec.sections[1].q === "two");
ok("garbage recovers to null", recoverTruncatedJson("not json at all") === null);

// ── looksLikeRefusal ─────────────────────────────────────────────────────────
ok("detects 'I'm sorry' refusal", looksLikeRefusal("I'm sorry, but I can't help with that."));
ok("detects 'I cannot generate' refusal", looksLikeRefusal("I cannot generate that content."));
ok("does NOT flag JSON as refusal", !looksLikeRefusal('{"answer":"I cannot swim is the sentence"}'));
ok("does NOT flag normal content", !looksLikeRefusal('{"a":1}'));

// ── parseAiJsonResponse: happy paths ─────────────────────────────────────────
let r = parseAiJsonResponse({raw: '{"a":1}', stopReason: "end_turn"});
ok("clean object parses ok", r.ok && r.status === "parsed" && r.value.a === 1 && !r.truncated);
r = parseAiJsonResponse({raw: '```json\n{"a":1}\n```', stopReason: "stop"});
ok("fenced clean object parses ok", r.ok && r.value.a === 1);

// ── structured-output fast path ──────────────────────────────────────────────
r = parseAiJsonResponse({parsed: {a: 1}, stopReason: "tool_use"});
ok("pre-parsed object accepted", r.ok && r.value.a === 1 && !r.truncated);
r = parseAiJsonResponse({parsed: "hello"});
ok("pre-parsed non-object rejected", !r.ok && r.status === "rejected" && codes(r).includes("NOT_AN_OBJECT"));
r = parseAiJsonResponse({parsed: {sections: [1]}, stopReason: "max_tokens"});
ok("pre-parsed + max_tokens stop → truncated + requires_review", r.truncated && r.status === "requires_review" && codes(r).includes("TRUNCATED_STOP_REASON"));

// ── empty / refusal / no-json ────────────────────────────────────────────────
r = parseAiJsonResponse({raw: ""});
ok("empty → failed + EMPTY_RESPONSE", !r.ok && r.status === "failed" && codes(r).includes("EMPTY_RESPONSE"));
r = parseAiJsonResponse({raw: "I'm sorry, I can't help with that."});
ok("refusal → rejected + PROVIDER_REFUSAL", !r.ok && r.refusal && r.status === "rejected" && codes(r).includes("PROVIDER_REFUSAL"));
r = parseAiJsonResponse({raw: "just some prose, no braces"});
ok("no json → failed + NO_JSON_FOUND", !r.ok && codes(r).includes("NO_JSON_FOUND"));

// ── truncation ───────────────────────────────────────────────────────────────
r = parseAiJsonResponse({raw: '{"a":1}', stopReason: "max_tokens"});
ok("valid JSON but max_tokens stop → truncated", r.truncated && r.status === "requires_review" && codes(r).includes("TRUNCATED_STOP_REASON") && !r.ok);
r = parseAiJsonResponse({raw: '{"sections":[{"q":1},{"q":2}', stopReason: "max_tokens"});
ok("unrecoverable-without-flag truncated JSON → requires_review not silent-complete",
    !r.ok && r.truncated && (codes(r).includes("TRUNCATED_JSON")));
r = parseAiJsonResponse({raw: '{"sections":[{"q":1},{"q":2},{"q":', stopReason: "max_tokens", allowTruncationRecovery: true});
ok("with recovery flag → recovers but STILL flags truncated (never trusts silently)",
    r.recovered && r.truncated && !r.ok && r.value.sections.length === 2 && codes(r).includes("TRUNCATION_RECOVERED"));

// ── invalid (non-truncation) JSON ────────────────────────────────────────────
r = parseAiJsonResponse({raw: '{"a": 1, "a": }'});
ok("malformed JSON → failed + INVALID_JSON", !r.ok && r.status === "failed" && codes(r).includes("INVALID_JSON"));

// ── declared-count shortfall (§10) ───────────────────────────────────────────
r = parseAiJsonResponse({
  raw: '{"questions":[{"n":1},{"n":2}]}',
  declaredCount: 5,
  countItems: (v) => (v.questions ? v.questions.length : 0),
});
ok("declared 5 got 2 → shortfall flagged + truncated", r.truncated && !r.ok && codes(r).includes("DECLARED_COUNT_SHORTFALL"));
r = parseAiJsonResponse({
  raw: '{"questions":[{"n":1},{"n":2},{"n":3}]}',
  declaredCount: 3,
  countItems: (v) => v.questions.length,
});
ok("declared 3 got 3 → no shortfall", r.ok && !r.truncated);

// ── size guard (§26) ─────────────────────────────────────────────────────────
r = parseAiJsonResponse({raw: '{"a":1}', maxBytes: 3});
ok("oversize → rejected + RESPONSE_TOO_LARGE", !r.ok && r.status === "rejected" && codes(r).includes("RESPONSE_TOO_LARGE"));

console.log(`\n${passed} assertions passed.`);
