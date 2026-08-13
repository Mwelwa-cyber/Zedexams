"use strict";

/**
 * learnerSafetyCore — the deterministic handling that runs before the model.
 *
 * Two failure directions, and both are real harm:
 *
 *   • A miss. A child says something that means they need a person, and the
 *     platform answers with a cheerful redirect to schoolwork.
 *   • A false positive. A child doing grade-5 comprehension gets a helpline
 *     because a passage mentioned killing time. That teaches them the app is
 *     broken and is how the feature gets switched off.
 *
 * So the false-positive block below is as long as the detection block, and
 * both are drawn from things a Zambian Grade 4–7 learner would plausibly type.
 *
 * Plain `node` script. Run: node functions/learnerSafety/learnerSafetyCore.test.js
 */

const assert = require("node:assert");
const {
  HELPLINE, screenLearnerMessage, redactForLogs, normalise,
} = require("./learnerSafetyCore");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const allows = (t) => assert.strictEqual(screenLearnerMessage(t).action, "allow", `should allow: ${t}`);
const responds = (t, category) => {
  const r = screenLearnerMessage(t);
  assert.strictEqual(r.action, "respond", `should intercept: ${t}`);
  assert.strictEqual(r.category, category, `wrong category for: ${t}`);
  return r;
};

console.log("screenLearnerMessage — distress");

test("intercepts self-harm disclosures, never sending them to the model", () => {
  for (const msg of [
    "i want to kill myself",
    "I want to die",
    "im thinking about killing myself",
    "i want to hurt myself",
    "I have been cutting myself",
    "do you think i should end my life",
    "i feel suicidal",
    "there is no point in living",
  ]) {
    const r = responds(msg, "distress");
    assert.ok(r.reply.includes(HELPLINE), "the reply must name a real helpline");
    assert.ok(/trust/i.test(r.reply), "the reply must point at a trusted adult");
  }
});

test("intercepts disclosures of harm by someone else", () => {
  for (const msg of [
    "my uncle is touching me",
    "my teacher hurts me",
    "my stepfather beats me",
    "i am being abused",
    "im afraid to go home",
  ]) {
    responds(msg, "distress");
  }
});

test("the distress reply never pretends to be a person or a counsellor", () => {
  // Play's AI content policy and plain decency: the app must not present
  // itself as a friend or a substitute for an adult.
  const {reply} = responds("i want to die", "distress");
  assert.ok(/computer program/i.test(reply));
  assert.ok(!/i understand how you feel|talk to me about it/i.test(reply));
});

console.log("\nscreenLearnerMessage — secrecy");

test("declines to keep secrets from parents and teachers", () => {
  for (const msg of [
    "dont tell my parents",
    "don't tell my mum about this",
    "can you keep this a secret",
    "this is our secret ok",
    "promise not to tell",
    "i want to do it without my parents knowing",
  ]) {
    const r = responds(msg, "secrecy");
    assert.ok(/can't keep secrets/i.test(r.reply));
  }
});

test("distress wins when a message is both", () => {
  // "don't tell my mum, he hurts me" is a disclosure wrapped in a request for
  // secrecy. The response that names help is the one that must win.
  const r = screenLearnerMessage("dont tell my mum but my uncle is touching me");
  assert.strictEqual(r.category, "distress");
});

console.log("\nscreenLearnerMessage — what must still get through");

test("ordinary schoolwork is never intercepted", () => {
  for (const msg of [
    "explain photosynthesis",
    "what is 3/4 + 1/2",
    "help me with my assessment on the respiratory system",
    "can you assess my essay",
    "what does democracy mean",
    "i am stuck on question 4",
    "my teacher said to revise fractions",
    "tell me about the Zambezi river",
  ]) {
    allows(msg);
  }
});

test("violent or morbid SUBJECT MATTER in schoolwork is not a crisis", () => {
  // History, literature and civics are full of this. A comprehension question
  // about a war is not a child in danger, and answering it with a helpline
  // teaches them the app is broken.
  for (const msg of [
    "why did people die in the first world war",
    "the character wanted to kill time before the exam",
    "what happens when cells die",
    "explain the death of Mwata Kazembe",
    "in the story the lion hurt the hunter",
    "what is the death rate in Zambia",
    "how many soldiers were killed",
  ]) {
    allows(msg);
  }
});

test("substrings inside ordinary words do not trip anything", () => {
  for (const msg of [
    "what is an assessment",
    "explain classification",
    "i live in Scunthorpe",
    "analyse the passage",
  ]) {
    allows(msg);
  }
});

test("empty and malformed input is allowed, not intercepted", () => {
  for (const msg of ["", "   ", null, undefined, 42, {}]) {
    assert.strictEqual(screenLearnerMessage(msg).action, "allow");
  }
});

test("light obfuscation does not evade detection", () => {
  // A child using markdown emphasis, or someone deliberately spacing it out.
  assert.strictEqual(screenLearnerMessage("i want to *kill myself*").category, "distress");
  assert.strictEqual(screenLearnerMessage("I  WANT   TO  DIE").category, "distress");
});

console.log("\nredactForLogs");

test("strips contact details from the logged copy", () => {
  const out = redactForLogs("call me on 0977123456 or email me at kid@example.com or see www.x.com");
  assert.ok(!out.includes("0977123456"), "phone survived");
  assert.ok(!out.includes("kid@example.com"), "email survived");
  // Anchored regex rather than a URL-substring check: assert the exact
  // hostname is gone AND the redaction marker took its place.
  assert.ok(!/\bwww\.x\.com\b/i.test(out), "link survived");
  assert.ok(out.includes("[link removed]"), "link redaction marker missing");
});

test("handles the international form and separators", () => {
  for (const raw of ["+260 97 712 3456", "+260977123456", "0977-123-456"]) {
    const out = redactForLogs(`reach me ${raw}`);
    assert.ok(/\[number removed\]/.test(out), `not redacted: ${raw}`);
  }
});

test("does not eat schoolwork numbers", () => {
  // Arithmetic answers, years, and short numbers must survive — the logs are
  // for debugging a study assistant.
  for (const msg of ["what is 3/4 + 1/2", "the year 1964", "answer is 42", "12 x 12 = 144"]) {
    assert.strictEqual(redactForLogs(msg), msg, `over-redacted: ${msg}`);
  }
});

test("redaction is applied to the log copy only, and returns a string", () => {
  assert.strictEqual(typeof redactForLogs(null), "string");
  assert.strictEqual(redactForLogs(null), "");
});

console.log("\nnormalise");

test("collapses whitespace and case without changing meaning", () => {
  assert.strictEqual(normalise("  Hello   WORLD  "), "hello world");
});

console.log(`\nlearnerSafetyCore: ${passed} passed`);
