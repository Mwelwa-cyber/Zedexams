/**
 * Unit tests for Vigil's deterministic monitoring logic.
 *
 * Plain Node assertions, no test runner (repo convention). Covers the pure,
 * secret-free parts of functions/agents/runners/monitor.js: the structural
 * quiz checks, the TipTap text flattener, and the de-dup failure key.
 *
 *   node functions/agents/runners/monitor.test.js
 */

const assert = require("node:assert");
const crypto = require("node:crypto");
const {runStructuralChecks, extractPlainText, failureKey, isMendiEligible, makeAppJwt, resolveGithubToken} = require("./monitor");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok — ${name}`);
}

// ── extractPlainText ─────────────────────────────────────────────────
test("extractPlainText handles a plain string", () => {
  assert.strictEqual(extractPlainText("Hello"), "Hello");
});

test("extractPlainText flattens a TipTap doc", () => {
  const doc = {
    type: "doc",
    content: [
      {type: "paragraph", content: [{type: "text", text: "What is"}, {type: "text", text: " 2+2?"}]},
    ],
  };
  assert.ok(extractPlainText(doc).includes("What is"));
  assert.ok(extractPlainText(doc).includes("2+2?"));
});

test("extractPlainText returns empty for nullish", () => {
  assert.strictEqual(extractPlainText(null).trim(), "");
  assert.strictEqual(extractPlainText(undefined).trim(), "");
});

test("extractPlainText decodes a JSON-encoded TipTap doc string", () => {
  // Options are sometimes persisted as a JSON string of a TipTap doc.
  const withText = "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Lusaka\"}]}]}";
  assert.strictEqual(extractPlainText(withText).trim(), "Lusaka");
});

test("extractPlainText flattens an EMPTY JSON-encoded TipTap doc to nothing", () => {
  // The real-world failure: a scanned-import option saved as an empty doc.
  const emptyDoc = "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"attrs\":{\"textAlign\":null}}]}";
  assert.strictEqual(extractPlainText(emptyDoc).trim(), "");
});

// ── runStructuralChecks ──────────────────────────────────────────────
test("a well-formed MCQ produces no problems", () => {
  const problems = runStructuralChecks([
    {type: "mcq", text: "Capital of Zambia?", options: ["Lusaka", "Ndola", "Kitwe"], correctAnswer: 0},
  ]);
  assert.strictEqual(problems.length, 0);
});

test("missing question text is flagged", () => {
  const problems = runStructuralChecks([
    {type: "mcq", text: "", options: ["a", "b"], correctAnswer: 0},
  ]);
  assert.ok(problems.some((p) => p.field === "text"));
});

test("fewer than two options is flagged", () => {
  const problems = runStructuralChecks([
    {type: "mcq", text: "Q", options: ["only one"], correctAnswer: 0},
  ]);
  assert.ok(problems.some((p) => p.field === "options"));
});

test("empty option is flagged", () => {
  const problems = runStructuralChecks([
    {type: "mcq", text: "Q", options: ["a", "  "], correctAnswer: 0},
  ]);
  assert.ok(problems.some((p) => p.field === "options" && /empty option/i.test(p.message)));
});

test("duplicate options are flagged (case-insensitive)", () => {
  const problems = runStructuralChecks([
    {type: "mcq", text: "Q", options: ["Lusaka", "lusaka", "Ndola"], correctAnswer: 0},
  ]);
  assert.ok(problems.some((p) => /duplicate/i.test(p.message)));
});

test("distinct rich-text (TipTap) options are NOT flagged as duplicates", () => {
  // Regression: options stored as TipTap doc objects (rich text) were compared
  // with String(o), which renders every doc as "[object Object]" — collapsing
  // distinct options into false "duplicate options" warnings (and false empty
  // options). See the false positive Vigil filed for quiz qP7RYG8v3loytqfyitf7.
  const richOption = (label) => ({
    type: "doc",
    content: [{type: "paragraph", content: [{type: "text", text: label}]}],
  });
  const problems = runStructuralChecks([
    {
      type: "mcq",
      text: richOption("Posters are usually decorated with bright colours to…"),
      options: [
        richOption("make them look more attractive."),
        richOption("make them look very expensive."),
        richOption("prevent people from seeing them."),
        richOption("prevent people from stealing them."),
      ],
      correctAnswer: 0,
    },
  ]);
  assert.strictEqual(problems.length, 0, JSON.stringify(problems));
});

test("genuinely duplicate rich-text options are still flagged", () => {
  const richOption = (label) => ({
    type: "doc",
    content: [{type: "paragraph", content: [{type: "text", text: label}]}],
  });
  const problems = runStructuralChecks([
    {type: "mcq", text: richOption("Q"), options: [richOption("Lusaka"), richOption("lusaka")], correctAnswer: 0},
  ]);
  assert.ok(problems.some((p) => /duplicate/i.test(p.message)));
});

test("blank JSON-encoded-doc options are flagged EMPTY, not duplicate", () => {
  // Regression for quiz qP7RYG8v3loytqfyitf7 Q8 ("Which of the following is
  // not a carved item?"): a scanned import left all four options as the same
  // empty TipTap doc string. The raw JSON strings are identical, so the old
  // String(o) comparison mislabelled them as "duplicate options" when the real
  // problem is that every option is blank. After decoding, they flatten to ""
  // → caught as empty, and the (empty) duplicate keys are skipped.
  const emptyDoc = "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"attrs\":{\"textAlign\":null}}]}";
  const problems = runStructuralChecks([
    {type: "mcq", text: "Which of the following is not a carved item?", options: [emptyDoc, emptyDoc, emptyDoc, emptyDoc], correctAnswer: 3},
  ]);
  assert.ok(problems.some((p) => /empty option/i.test(p.message)), "should flag an empty option");
  assert.ok(!problems.some((p) => /duplicate/i.test(p.message)), "should NOT flag duplicates");
});

test("out-of-range correctAnswer is flagged", () => {
  const problems = runStructuralChecks([
    {type: "mcq", text: "Q", options: ["a", "b"], correctAnswer: 5},
  ]);
  assert.ok(problems.some((p) => p.field === "correctAnswer"));
});

test("missing correctAnswer is flagged", () => {
  const problems = runStructuralChecks([
    {type: "mcq", text: "Q", options: ["a", "b"]},
  ]);
  assert.ok(problems.some((p) => p.field === "correctAnswer"));
});

test("non-mcq questions skip option checks", () => {
  const problems = runStructuralChecks([
    {type: "short_answer", text: "Explain photosynthesis."},
  ]);
  assert.strictEqual(problems.length, 0);
});

// ── failureKey ───────────────────────────────────────────────────────
test("failureKey is stable for the same failure", () => {
  const f = {check: "quizzes", id: "abc:0:options", severity: "warning", message: "x"};
  assert.strictEqual(failureKey(f), "quizzes:abc:0:options");
  assert.strictEqual(failureKey(f), failureKey({...f, message: "different message"}));
});

test("failureKey differs across checks", () => {
  assert.notStrictEqual(
      failureKey({check: "pages", id: "/"}),
      failureKey({check: "images", id: "/"}),
  );
});

// ── Mendi routing ────────────────────────────────────────────────────
test("code/infra failures are Mendi-eligible", () => {
  assert.strictEqual(isMendiEligible({check: "pages"}), true);
  assert.strictEqual(isMendiEligible({check: "firebase"}), true);
});

test("content/data failures are NOT routed to Mendi", () => {
  assert.strictEqual(isMendiEligible({check: "images"}), false);
  assert.strictEqual(isMendiEligible({check: "quizzes"}), false);
  assert.strictEqual(isMendiEligible({}), false);
});

// ── GitHub App JWT minting ───────────────────────────────────────────
test("makeAppJwt produces a verifiable RS256 JWT", () => {
  const {privateKey, publicKey} = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: {type: "spki", format: "pem"},
    privateKeyEncoding: {type: "pkcs8", format: "pem"},
  });
  const jwt = makeAppJwt("123456", privateKey);
  const [header, payload, signature] = jwt.split(".");
  assert.ok(header && payload && signature, "JWT has three parts");

  // Signature verifies against the public key.
  const ok = crypto.verify(
      "RSA-SHA256",
      Buffer.from(`${header}.${payload}`),
      publicKey,
      Buffer.from(signature, "base64url"),
  );
  assert.strictEqual(ok, true);

  // Claims are well-formed: iss = app id, exp within GitHub's 10-min ceiling.
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  assert.strictEqual(claims.iss, "123456");
  assert.ok(claims.exp - claims.iat <= 600);
});

test("makeAppJwt normalises an escaped-newline PEM", () => {
  const {privateKey, publicKey} = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: {type: "spki", format: "pem"},
    privateKeyEncoding: {type: "pkcs8", format: "pem"},
  });
  // Simulate a Secret Manager value with literal \n sequences.
  const escaped = privateKey.replace(/\n/g, "\\n");
  const jwt = makeAppJwt("99", escaped);
  const [header, payload, signature] = jwt.split(".");
  const ok = crypto.verify(
      "RSA-SHA256",
      Buffer.from(`${header}.${payload}`),
      publicKey,
      Buffer.from(signature, "base64url"),
  );
  assert.strictEqual(ok, true);
});

// ── resolveGithubToken precedence ────────────────────────────────────
test("resolveGithubToken falls back to the PAT when no App creds", async () => {
  const token = await resolveGithubToken({pat: "ghp_test", repo: "o/r"});
  assert.strictEqual(token, "ghp_test");
});

test("resolveGithubToken returns null when nothing is configured", async () => {
  const token = await resolveGithubToken({repo: "o/r"});
  assert.strictEqual(token, null);
});

console.log(`\n✓ monitor.test.js — ${passed} checks passed`);
