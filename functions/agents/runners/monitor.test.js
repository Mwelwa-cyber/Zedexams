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
const {runStructuralChecks, extractPlainText, failureKey, isMendiEligible, makeAppJwt, normalizePem, resolveGithubToken, checkQuizzes, checkDailyQuiz, checkPlayBilling, dailyQuizCheckWindow} = require("./monitor");
const {lusakaDayString} = require("../../lusakaTime");

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

test("extractPlainText resolves a mathFraction node to its value", () => {
  // Regression: a fraction option (½) is stored as a leaf node carrying its
  // value in `attrs`, with no child text node. The old walker read only
  // `node.text`, flattening it to "" — so Vigil reported every maths option as
  // an empty option. Mirrors src/editor/richPlainText.js.
  const half = {type: "doc", content: [{type: "paragraph", content: [{type: "mathFraction", attrs: {num: "1", den: "2"}}]}]};
  assert.strictEqual(extractPlainText(half).trim(), "1/2");
});

test("extractPlainText resolves numberBase and verticalArithmetic nodes", () => {
  const base = {type: "doc", content: [{type: "paragraph", content: [{type: "numberBase", attrs: {number: "101", base: "2"}}]}]};
  assert.strictEqual(extractPlainText(base).trim(), "101_2");
  const vmath = {type: "doc", content: [{type: "paragraph", content: [{type: "verticalArithmetic", attrs: {operator: "+", lines: ["12", "34"], answer: "46"}}]}]};
  assert.ok(extractPlainText(vmath).includes("12 + 34 = 46"));
});

test("a maths MCQ with fraction options is NOT flagged as empty/duplicate", () => {
  // The user-reported false positive: maths quizzes whose options are distinct
  // fractions were reported as "has an empty option" because each fraction node
  // flattened to "". Now they flatten to distinct readable values.
  const frac = (num, den) =>
    `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"mathFraction","attrs":{"num":"${num}","den":"${den}"}}]}]}`;
  const problems = runStructuralChecks([
    {type: "mcq", text: "Which fraction is the largest?", options: [frac(1, 2), frac(1, 3), frac(1, 4), frac(3, 4)], correctAnswer: 3},
  ]);
  assert.strictEqual(problems.length, 0, JSON.stringify(problems));
});

test("a fraction-only question stem is NOT flagged as missing text", () => {
  const stem = "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"mathFraction\",\"attrs\":{\"num\":\"3\",\"den\":\"5\"}}]}]}";
  const problems = runStructuralChecks([
    {type: "mcq", text: stem, options: ["a", "b"], correctAnswer: 0},
  ]);
  assert.ok(!problems.some((p) => p.field === "text"), JSON.stringify(problems));
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

test("genuinely duplicate options are flagged", () => {
  const problems = runStructuralChecks([
    {type: "mcq", text: "Q", options: ["Lusaka", "Lusaka", "Ndola"], correctAnswer: 0},
  ]);
  assert.ok(problems.some((p) => /duplicate/i.test(p.message)));
});

test("options differing only in case are NOT flagged as duplicate", () => {
  // Regression for the Grade 7 English Language Mock (quiz q2WGapKWzsxvTklaw7mG):
  // a capitalisation question's options ("My"/"my") read differently but the old
  // lowercased key collapsed them into a false "duplicate options" warning.
  const problems = runStructuralChecks([
    {type: "mcq", text: "Choose the correctly capitalised sentence.", options: [
      "my name is john.",
      "My name is John.",
      "My Name Is John.",
      "my name is John.",
    ], correctAnswer: 1},
  ]);
  assert.ok(!problems.some((p) => /duplicate/i.test(p.message)), JSON.stringify(problems));
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
    {type: "mcq", text: richOption("Q"), options: [richOption("Lusaka"), richOption("Lusaka")], correctAnswer: 0},
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

test("makeAppJwt recovers a single-line PEM whose newlines were collapsed", () => {
  // Reproduces error:1E08010C:DECODER routines::unsupported: a secret store
  // that flattened the multi-line key onto one line with spaces in the body.
  const {privateKey, publicKey} = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: {type: "spki", format: "pem"},
    privateKeyEncoding: {type: "pkcs8", format: "pem"},
  });
  const collapsed = privateKey.replace(/\n/g, " ").trim();
  // Pre-fix, crypto.sign() on `collapsed` throws the DECODER error.
  assert.throws(() => crypto.sign("RSA-SHA256", Buffer.from("x"), collapsed));
  const jwt = makeAppJwt("77", collapsed);
  const [header, payload, signature] = jwt.split(".");
  const ok = crypto.verify(
      "RSA-SHA256",
      Buffer.from(`${header}.${payload}`),
      publicKey,
      Buffer.from(signature, "base64url"),
  );
  assert.strictEqual(ok, true);
});

test("normalizePem strips wrapping quotes and re-wraps the body", () => {
  const {privateKey} = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: {type: "pkcs8", format: "pem"},
  });
  const quoted = `"${privateKey.replace(/\n/g, "\\n")}"`;
  const out = normalizePem(quoted);
  assert.ok(!out.includes("\\n"), "no literal escape sequences remain");
  // The re-wrapped output parses as a real private key (the whole point).
  assert.doesNotThrow(() => crypto.createPrivateKey(out));
  // Base64 body lines wrap at 64 chars (marker lines start with dashes).
  const bodyLines = out.split("\n").filter((l) => l && !l.startsWith("---"));
  assert.ok(bodyLines.length > 0 && bodyLines.every((l) => l.length <= 64), "body wrapped at 64");
});

test("makeAppJwt throws a clear error on an unparseable key", () => {
  assert.throws(
      () => makeAppJwt("1", "not a key at all"),
      /GITHUB_APP_PRIVATE_KEY secret format/,
  );
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

// ── daily-quiz coverage check ────────────────────────────────────────

// Minimal Firestore query stub: every builder method chains, get() returns a
// snapshot of dailyQuizzes docs for the day. The live rollout is Grade 7
// only (DAILY_QUIZ_GRADES), so a healthy day is one document.
function quizDoc(grade, status = "ok") {
  return {
    id: `${grade}_2026-07-01`,
    data: () => ({grade, date: "2026-07-01", status, questionIds: ["a", "b", "c", "d", "e"]}),
  };
}

function stubDb(docs) {
  const snapDocs = docs || [];
  const chain = {
    where() { return chain; },
    limit() { return chain; },
    async get() { return {empty: snapDocs.length === 0, size: snapDocs.length, docs: snapDocs}; },
  };
  return {collection: () => chain};
}

test("dailyQuizCheckWindow enforces only from 01:00 Lusaka", () => {
  // 22:30 UTC = 00:30 Lusaka next day → still inside the cron's grace window.
  assert.strictEqual(dailyQuizCheckWindow(new Date("2026-06-30T22:30:00Z")).active, false);
  // 23:00 UTC = 01:00 Lusaka → enforcing, keyed to the Lusaka day.
  const w = dailyQuizCheckWindow(new Date("2026-06-30T23:00:00Z"));
  assert.strictEqual(w.active, true);
  assert.strictEqual(w.today, "2026-07-01");
});

test("checkDailyQuiz passes when today's quiz exists (nothing rebuilt)", async () => {
  let built = false;
  const res = await checkDailyQuiz(stubDb([quizDoc("7")]), {
    now: new Date("2026-07-01T08:00:00Z"),
    build: async () => { built = true; return {doc: {}}; },
  });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.scheduled, 1);
  assert.strictEqual(res.failures.length, 0);
  assert.strictEqual(built, false, "a healthy day must not trigger a rebuild");
});

test("checkDailyQuiz skips inside the grace window (no verdict, no build)", async () => {
  let built = false;
  const res = await checkDailyQuiz(stubDb([]), {
    now: new Date("2026-06-30T22:10:00Z"), // 00:10 Lusaka — the cron may still be running
    build: async () => { built = true; return {doc: {}}; },
  });
  assert.strictEqual(res.skipped, true);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.failures.length, 0);
  assert.strictEqual(built, false);
});

test("checkDailyQuiz builds a missing day and reports the missed cron as a warning", async () => {
  // Not critical: getTodaysQuiz self-heals, so no learner was ever blocked.
  // Building here only saves the first learner the latency.
  const seen = [];
  const res = await checkDailyQuiz(stubDb([]), {
    now: new Date("2026-07-01T08:00:00Z"),
    build: async (_db, args) => { seen.push(args); return {doc: quizDoc(args.grade).data()}; },
  });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.healed, 1);
  assert.deepStrictEqual(seen.map((a) => a.grade), ["7"]);
  assert.strictEqual(seen[0].date, "2026-07-01");
  assert.strictEqual(seen[0].createdBy, "monitor");
  assert.strictEqual(res.failures.length, 1);
  assert.strictEqual(res.failures[0].check, "dailyQuiz");
  assert.strictEqual(res.failures[0].severity, "warning");
  assert.strictEqual(failureKey(res.failures[0]), "dailyQuiz:2026-07-01:cronMissed");
});

test("checkDailyQuiz escalates a build that keeps failing", async () => {
  // Every read retries the same failing build, so the learner sees an error
  // rather than a quiz. That IS learner-visible, so it is critical.
  const res = await checkDailyQuiz(stubDb([]), {
    now: new Date("2026-07-01T08:00:00Z"),
    build: async () => { throw new Error("bank read denied"); },
  });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.healed, 0);
  assert.strictEqual(res.failures.length, 1);
  assert.strictEqual(res.failures[0].severity, "critical");
  assert.strictEqual(failureKey(res.failures[0]), "dailyQuiz:2026-07-01:buildFailed");
});

test("checkDailyQuiz reports a THIN bank as critical — the thing it cannot heal", async () => {
  // The whole reason this check still exists once the read path self-heals.
  // Rebuilding a starved bank produces another starved document.
  let built = false;
  const res = await checkDailyQuiz(stubDb([quizDoc("7", "thin")]), {
    now: new Date("2026-07-01T08:00:00Z"),
    build: async () => { built = true; return {doc: {}}; },
  });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(built, false, "a thin day is not a missing day — do not rebuild it");
  assert.strictEqual(res.failures.length, 1);
  assert.strictEqual(res.failures[0].severity, "critical");
  assert.strictEqual(failureKey(res.failures[0]), "dailyQuiz:2026-07-01:thinBank");
  assert.ok(res.failures[0].message.includes("practice set"));
});

test("checkDailyQuiz keeps flagging a thin bank on every later run", async () => {
  // A stable id so the notification state doc de-dups it, but the failure
  // must recur while the gap persists rather than being reported once.
  const first = await checkDailyQuiz(stubDb([quizDoc("7", "thin")]), {
    now: new Date("2026-07-01T08:00:00Z"),
  });
  const second = await checkDailyQuiz(stubDb([quizDoc("7", "thin")]), {
    now: new Date("2026-07-01T11:00:00Z"),
  });
  assert.strictEqual(failureKey(first.failures[0]), failureKey(second.failures[0]));
  assert.strictEqual(second.ok, false);
});

test("checkDailyQuiz never throws — a query error becomes a critical failure", async () => {
  // A tool that cannot see a failure reporting silence is the bug, not the fix.
  const db = {collection: () => { throw new Error("firestore down"); }};
  const res = await checkDailyQuiz(db, {now: new Date("2026-07-01T08:00:00Z")});
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.failures[0].severity, "critical");
  assert.ok(res.failures[0].message.includes("firestore down"));
});

test("dailyQuiz failures are NOT routed to Mendi (ops/data, not code)", () => {
  assert.strictEqual(isMendiEligible({check: "dailyQuiz"}), false);
});


// ── checkPlayBilling ─────────────────────────────────────────────────
test("checkPlayBilling passes when the probe proves the wiring", async () => {
  const res = await checkPlayBilling({saJson: "x", probe: async () => ({ok: true})});
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.failures.length, 0);
});

test("checkPlayBilling escalates a config failure as critical with the stage + runbook", async () => {
  const res = await checkPlayBilling({saJson: "", probe: async () => ({
    ok: false, reason: "sa-json-missing", message: "GOOGLE_PLAY_SA_JSON is empty",
  })});
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.failures.length, 1);
  assert.strictEqual(res.failures[0].check, "playBilling");
  assert.strictEqual(res.failures[0].severity, "critical");
  assert.ok(res.failures[0].message.includes("sa-json-missing"));
  assert.ok(res.failures[0].message.includes("GOOGLE-PLAY-BILLING.md"));
});

test("checkPlayBilling treats a transient probe failure as a warning, not critical", async () => {
  const res = await checkPlayBilling({saJson: "x", probe: async () => ({
    ok: false, reason: "transient", message: "Play API error 503",
  })});
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.failures[0].severity, "warning");
});

test("checkPlayBilling never throws — a probe crash becomes a warning", async () => {
  const res = await checkPlayBilling({saJson: "x", probe: async () => { throw new Error("boom"); }});
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.failures[0].severity, "warning");
  assert.ok(res.failures[0].message.includes("boom"));
});

// ── checkQuizzes numbers a problem by its position in the WHOLE quiz ──
//
// The bug this guards: the questions read was capped below the size of a real
// past paper, so an arbitrary slice of the collection was sorted and problems
// were numbered within the slice. Quiz q2WGapKWzsxvTkIaw7mG (Grade 7 English
// Language Mock 2026, 60 questions) has one genuinely duplicated question at
// number 43; Vigil reported it as "Question 23", whose four options are
// perfectly distinct. The report was unactionable, so the fault stayed and was
// re-escalated by email every 24h.

/** Firestore hands back documents in id order, which is NOT `order` order. */
function stubQuizDb(quizzes) {
  const docs = quizzes.map((quiz) => ({
    id: quiz.id,
    data: () => ({title: quiz.title, isPublished: quiz.isPublished !== false}),
    ref: {
      collection: () => ({
        // Model the real limit: the driver returns at most n documents.
        limit: (n) => ({async get() {
          return {docs: quiz.questions.slice(0, n).map((q) => ({data: () => q}))};
        }}),
      }),
    },
  }));
  return {collection: () => ({orderBy: () => ({limit: () => ({async get() { return {docs}; }})})})};
}

/** One well-formed MCQ; `dupe` makes options 1 and 4 identical. */
function question(order, dupe) {
  return {
    order,
    type: "mcq",
    text: `<p>Question ${order}</p>`,
    options: dupe ?
      ["Many people called the old man Miyanda.", "B", "C", "Many people called the old man Miyanda."] :
      [`${order}-A`, `${order}-B`, `${order}-C`, `${order}-D`],
    correctAnswer: 0,
  };
}

const pending = [];
function testAsync(name, fn) {
  pending.push(fn().then(() => {
    passed += 1;
    console.log(`  ok — ${name}`);
  }));
}

testAsync("checkQuizzes numbers a duplicate by its real question number, not its position in a slice", async () => {
  // 60 questions arriving in reverse order — any id order that isn't `order`
  // order reproduces the bug; reversed is the clearest.
  const questions = Array.from({length: 60}, (_, i) => question(60 - i, 60 - i === 43));
  const res = await checkQuizzes(stubQuizDb([
    {id: "q2WGapKWzsxvTkIaw7mG", title: "Grade 7 English Language Mock 2026 — Quiz", questions},
  ]));
  assert.strictEqual(res.failures.length, 1);
  const {message} = res.failures[0];
  assert.ok(message.includes("Question 43 has duplicate options (1 and 4)"), message);
  // Under the old 30-question cap the reversed slice held orders 60…31, so the
  // same fault was numbered within that slice instead.
  assert.ok(!message.includes("Question 13"), message);
});

testAsync("checkQuizzes reports a quiz past the ceiling as unchecked rather than mis-numbered", async () => {
  const questions = Array.from({length: 201}, (_, i) => question(i + 1, i + 1 === 43));
  const res = await checkQuizzes(stubQuizDb([{id: "huge", title: "Huge quiz", questions}]));
  assert.strictEqual(res.failures.length, 1);
  assert.ok(res.failures[0].id.endsWith(":oversized"), res.failures[0].id);
  assert.ok(res.failures[0].message.includes("were not checked"), res.failures[0].message);
  // No question number is claimed, because none would be trustworthy.
  assert.ok(!/Question \d+/.test(res.failures[0].message), res.failures[0].message);
});

testAsync("checkQuizzes still reads a whole ordinary quiz and reports it clean", async () => {
  const questions = Array.from({length: 60}, (_, i) => question(60 - i, false));
  const res = await checkQuizzes(stubQuizDb([{id: "clean", title: "Clean quiz", questions}]));
  assert.strictEqual(res.failures.length, 0);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.checked, 1);
});

Promise.all(pending)
    .then(() => console.log(`\n✓ monitor.test.js — ${passed} checks passed`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
