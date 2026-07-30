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
const {runStructuralChecks, extractPlainText, failureKey, isMendiEligible, makeAppJwt, normalizePem, resolveGithubToken, checkQuizzes, checkDailyExams, checkPlayBilling, dailyExamCheckWindow} = require("./monitor");
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

// ── daily-exam self-heal check ───────────────────────────────────────

// Minimal Firestore query stub: every builder method chains, get() returns a
// snapshot whose emptiness is fixed up-front. `docs` defaults to clean
// daily-exam picks covering grades 4–7 (the per-grade coverage check needs
// every grade represented for a healthy day); pass explicit docs to model a
// bad (past-paper) pick or a grade gap.
function cleanPick(grade) {
  return {
    id: `quiz-clean-${grade}`,
    data: () => ({questionCount: 60, quizType: "daily_exam", grade}),
  };
}

function stubDb(scheduledCount, docs) {
  const snapDocs = docs ||
    Array.from({length: scheduledCount}, (_, i) => cleanPick(String(4 + i)));
  const chain = {
    where() { return chain; },
    limit() { return chain; },
    async get() { return {empty: scheduledCount === 0, size: scheduledCount, docs: snapDocs}; },
  };
  return {collection: () => chain};
}

test("lusakaDayString stays on the UTC date until 22:00 UTC, then rolls", () => {
  // 21:59 UTC = 23:59 Lusaka (same calendar day)…
  assert.strictEqual(lusakaDayString(new Date("2026-06-30T21:59:00Z")), "2026-06-30");
  // …22:00 UTC = 00:00 Lusaka NEXT day. Local-getter date maths in a UTC
  // container gets this wrong — the regression this helper exists to stop.
  assert.strictEqual(lusakaDayString(new Date("2026-06-30T22:00:00Z")), "2026-07-01");
});

test("dailyExamCheckWindow enforces only from 05:15 Lusaka", () => {
  // 03:10 UTC = 05:10 Lusaka → still inside the picker's grace window.
  assert.strictEqual(dailyExamCheckWindow(new Date("2026-07-01T03:10:00Z")).active, false);
  // 03:15 UTC = 05:15 Lusaka → enforcing, keyed to the Lusaka day.
  const w = dailyExamCheckWindow(new Date("2026-07-01T03:15:00Z"));
  assert.strictEqual(w.active, true);
  assert.strictEqual(w.today, "2026-07-01");
});

test("checkDailyExams passes when today's picks exist (picker NOT re-run)", async () => {
  let pickerRan = false;
  const res = await checkDailyExams(stubDb(4), {
    now: new Date("2026-07-01T08:00:00Z"),
    runPick: async () => { pickerRan = true; },
  });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.scheduled, 4);
  assert.strictEqual(res.failures.length, 0);
  assert.strictEqual(pickerRan, false);
});

test("checkDailyExams skips inside the grace window (no query verdict, no heal)", async () => {
  let pickerRan = false;
  const res = await checkDailyExams(stubDb(0), {
    now: new Date("2026-07-01T03:00:00Z"), // exactly 05:00 Lusaka — cron may still be running
    runPick: async () => { pickerRan = true; },
  });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.skipped, true);
  assert.strictEqual(pickerRan, false);
});

test("checkDailyExams self-heals an empty day and reports a warning", async () => {
  let pickedFor = null;
  const res = await checkDailyExams(stubDb(0), {
    now: new Date("2026-07-01T08:00:00Z"),
    runPick: async ({today}) => {
      pickedFor = today;
      return {date: today, grades: [
        {grade: "4", status: "promoted", quizId: "q4"},
        {grade: "5", status: "no_candidates"},
        {grade: "6", status: "promoted", quizId: "q6"},
        {grade: "7", status: "promoted", quizId: "q7"},
      ]};
    },
  });
  // Healed — but still a failure, so the missed 05:00 cron gets escalated.
  assert.strictEqual(pickedFor, "2026-07-01"); // heal pins the checked Lusaka day
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.healed, 3);
  assert.strictEqual(res.failures.length, 1);
  assert.strictEqual(res.failures[0].severity, "warning");
  assert.strictEqual(res.failures[0].check, "dailyExams");
  assert.strictEqual(failureKey(res.failures[0]), "dailyExams:2026-07-01");
  assert.ok(res.failures[0].message.includes("autoPickDailyExams"));
});

test("checkDailyExams is critical when the re-run promotes nothing", async () => {
  const res = await checkDailyExams(stubDb(0), {
    now: new Date("2026-07-01T08:00:00Z"),
    runPick: async ({today}) => ({date: today, grades: [
      {grade: "4", status: "no_candidates"},
      {grade: "5", status: "error", message: "boom"},
    ]}),
  });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.healed, 0);
  assert.strictEqual(res.failures[0].severity, "critical");
  assert.ok(res.failures[0].message.includes("no_candidates"));
});

const badPick = {
  id: "quiz-bad",
  data: () => ({questionCount: 60, quizType: "daily_exam", publicAccess: true, linkedPaperId: "paper-1", grade: "7"}),
};

test("checkDailyExams re-runs the picker when today's pick is a past-paper public quiz", async () => {
  // The regression behind "Quiz not available" on /papers/:id/quiz: the
  // picker pinned a paper-linked public quiz as the daily exam, and the
  // daily_exam question-read block 403'd the public page all day. Vigil
  // must spot the bad pick and re-run the (now demote-and-repick) picker.
  let pickedFor = null;
  const db = stubDb(4, [cleanPick("4"), cleanPick("5"), cleanPick("6"), badPick]);
  const res = await checkDailyExams(db, {
    now: new Date("2026-07-01T08:00:00Z"),
    runPick: async ({today}) => {
      pickedFor = today;
      return {date: today, grades: [
        {grade: "4", status: "already_pinned", quizId: "quiz-clean-4"},
        {grade: "5", status: "already_pinned", quizId: "quiz-clean-5"},
        {grade: "6", status: "already_pinned", quizId: "quiz-clean-6"},
        {grade: "7", status: "promoted", quizId: "quiz-good", demotedBadPicks: ["quiz-bad"]},
      ]};
    },
  });
  assert.strictEqual(pickedFor, "2026-07-01");
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.healed, 1);
  assert.strictEqual(res.failures.length, 1);
  assert.strictEqual(res.failures[0].severity, "warning");
  assert.ok(res.failures[0].message.includes("quiz-bad"));
});

test("checkDailyExams heals a grade holding BOTH a legitimate and a past-paper pick", async () => {
  // setAsDailyExam pins without demoting, so a grade can carry two picks
  // for the same day. already_pinned from the demote-all picker means the
  // bad one was demoted and the legitimate one kept the slot — a heal,
  // not a suppressed gap.
  const db = stubDb(5, [cleanPick("4"), cleanPick("5"), cleanPick("6"), cleanPick("7"), badPick]);
  const res = await checkDailyExams(db, {
    now: new Date("2026-07-01T08:00:00Z"),
    runPick: async ({today}) => ({date: today, grades: [
      {grade: "4", status: "already_pinned", quizId: "quiz-clean-4"},
      {grade: "5", status: "already_pinned", quizId: "quiz-clean-5"},
      {grade: "6", status: "already_pinned", quizId: "quiz-clean-6"},
      {grade: "7", status: "already_pinned", quizId: "quiz-clean-7", demotedBadPicks: ["quiz-bad"]},
    ]}),
  });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.healed, 1);
  assert.strictEqual(res.failures.length, 1);
  assert.strictEqual(res.failures[0].severity, "warning");
  assert.ok(res.failures[0].message.includes("quiz-bad"));
});

test("checkDailyExams escalates a demoted bad pick that could NOT be replaced", async () => {
  // runAutoPick catches failures per grade: a demote-only outcome
  // (no_candidates / error) leaves that grade with no daily exam. It must
  // be critical, not a "healed" warning.
  const db = stubDb(4, [cleanPick("4"), cleanPick("5"), cleanPick("6"), badPick]);
  const res = await checkDailyExams(db, {
    now: new Date("2026-07-01T08:00:00Z"),
    runPick: async ({today}) => ({date: today, grades: [
      {grade: "4", status: "already_pinned", quizId: "quiz-clean-4"},
      {grade: "5", status: "already_pinned", quizId: "quiz-clean-5"},
      {grade: "6", status: "already_pinned", quizId: "quiz-clean-6"},
      {grade: "7", status: "no_candidates", demotedBadPicks: ["quiz-bad"]},
    ]}),
  });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.healed, 0);
  assert.strictEqual(res.failures.length, 2);
  assert.strictEqual(res.failures[1].severity, "critical");
  assert.strictEqual(failureKey(res.failures[1]), "dailyExams:2026-07-01:gradeGap");
  assert.ok(res.failures[1].message.includes("7"));
  assert.ok(res.failures[1].message.includes("no_candidates"));
});

test("checkDailyExams keeps flagging a gradeless day on LATER runs (no bad pick in sight)", async () => {
  // The hour after a demote-only heal, the bad pick is gone from the
  // snapshot and the other grades' picks make it non-empty. The per-grade
  // coverage check must still surface the hole every run until an exam is
  // pinned — this is the failure that previously vanished after one run.
  const db = stubDb(3, [cleanPick("4"), cleanPick("5"), cleanPick("6")]);
  const res = await checkDailyExams(db, {
    now: new Date("2026-07-01T09:00:00Z"),
    runPick: async ({today}) => ({date: today, grades: [
      {grade: "4", status: "already_pinned", quizId: "quiz-clean-4"},
      {grade: "5", status: "already_pinned", quizId: "quiz-clean-5"},
      {grade: "6", status: "already_pinned", quizId: "quiz-clean-6"},
      {grade: "7", status: "no_candidates"},
    ]}),
  });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.healed, 0);
  assert.strictEqual(res.failures.length, 1);
  assert.strictEqual(res.failures[0].severity, "critical");
  assert.strictEqual(failureKey(res.failures[0]), "dailyExams:2026-07-01:gradeGap");
  assert.ok(res.failures[0].message.includes("7"));
});

test("checkDailyExams restores a missing grade and reports a warning", async () => {
  const db = stubDb(3, [cleanPick("4"), cleanPick("5"), cleanPick("6")]);
  const res = await checkDailyExams(db, {
    now: new Date("2026-07-01T09:00:00Z"),
    runPick: async ({today}) => ({date: today, grades: [
      {grade: "4", status: "already_pinned", quizId: "quiz-clean-4"},
      {grade: "5", status: "already_pinned", quizId: "quiz-clean-5"},
      {grade: "6", status: "already_pinned", quizId: "quiz-clean-6"},
      {grade: "7", status: "promoted", quizId: "quiz-new-7"},
    ]}),
  });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.healed, 1);
  assert.strictEqual(res.failures.length, 1);
  assert.strictEqual(res.failures[0].severity, "warning");
  assert.strictEqual(failureKey(res.failures[0]), "dailyExams:2026-07-01:gradeGapHealed");
  assert.ok(res.failures[0].message.includes("7"));
});

test("checkDailyExams leaves clean full-coverage picks alone (picker NOT re-run)", async () => {
  let pickerRan = false;
  const res = await checkDailyExams(stubDb(4), {
    now: new Date("2026-07-01T08:00:00Z"),
    runPick: async () => { pickerRan = true; },
  });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(pickerRan, false);
});

test("checkDailyExams never throws — a query error becomes a critical failure", async () => {
  const db = {collection: () => { throw new Error("firestore down"); }};
  const res = await checkDailyExams(db, {now: new Date("2026-07-01T08:00:00Z")});
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.failures[0].severity, "critical");
  assert.ok(res.failures[0].message.includes("firestore down"));
});

test("dailyExams failures are NOT routed to Mendi (ops/data, not code)", () => {
  assert.strictEqual(isMendiEligible({check: "dailyExams"}), false);
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
