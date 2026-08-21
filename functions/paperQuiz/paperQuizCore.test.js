/**
 * The past-paper quiz's server decisions, and the shared marking rules.
 *
 * Two properties carry most of the weight here and both fail silently:
 *
 *   • §1's "only one thing ends an exam early". Every crash, refresh, rotate
 *     and battery death arrives at the server as `startAttempt` on a paper
 *     that already has a live attempt, so `decideStart` is driven with each of
 *     them and asserted to RESUME. A regression here does not throw — it
 *     quietly mints a second attempt and the learner's forty minutes are gone.
 *
 *   • §5.1's "the client physically cannot show the answer early". The strip
 *     is asserted against the answer-key resolver's OWN list of shapes, so a
 *     resolver that learns a sixth way to store a key fails this test until
 *     the strip learns it too. A denylist that has fallen behind looks exactly
 *     like one that is complete.
 *
 * Run: node functions/paperQuiz/paperQuizCore.test.js  (test:paper-quiz-server)
 */
const assert = require("node:assert/strict");

const core = require("./paperQuizCore");

let passed = 0;
function test(name, fn) {
  try {
    const out = fn();
    if (out && typeof out.then === "function") throw new Error("use testAsync");
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`);
    process.exitCode = 1;
  }
}
const asyncTests = [];
function testAsync(name, fn) {
  asyncTests.push([name, fn]);
}

// ── identity ─────────────────────────────────────────────────────────────
console.log("\nidentity");

test("ids are derived, not random", () => {
  assert.equal(core.attemptDocId({uid: "u", paperId: "p", startedAtMs: 12}), "u_p_12");
  assert.equal(core.practiceProgressId("u", "p"), "u_p");
  assert.equal(core.topicStatId("u", "eng.tense"), "u_eng.tense");
});

// The duration ladder itself moved to functions/shared/paperQuiz/examSpec.js
// (the browser has to resolve the identical number for the cover) and is
// covered by examSpec.test.js — `test:paper-exam-spec`.

// ── §1: only one thing ends an exam early ────────────────────────────────
console.log("\nresume (§1 — only one thing ends an exam early)");

const LIVE = {attemptId: "a1", status: "in_progress", mode: "exam", startedAtMs: 1000, expiresAtMs: 100_000};

test("every accident resumes: refresh, crash, rotate, battery, phone call", () => {
  // They are indistinguishable at the server — each one arrives as
  // startAttempt on a paper that already has a live attempt. All must resume.
  [5000, 50_000, 99_999].forEach((nowMs) => {
    const d = core.decideStart({existing: LIVE, nowMs, mode: "exam"});
    assert.equal(d.action, "resume", `resumes at ${nowMs}`);
    assert.equal(d.attempt.attemptId, "a1");
  });
});

test("a window that passed with no submission EXPIRES rather than restarting", () => {
  // Deleting would lose the answers; leaving it in_progress would block the
  // paper for good.
  const d = core.decideStart({existing: LIVE, nowMs: 200_000, mode: "exam"});
  assert.equal(d.action, "expire");
  assert.equal(d.finalize.attemptId, "a1");
});

test("a finished attempt lets a fresh one start", () => {
  ["submitted", "expired", "abandoned"].forEach((status) => {
    assert.equal(core.decideStart({existing: {...LIVE, status}, nowMs: 5000, mode: "exam"}).action, "create");
  });
  assert.equal(core.decideStart({existing: null, nowMs: 1, mode: "exam"}).action, "create");
});

test("switching to practice finalises the exam rather than continuing it underneath", () => {
  const d = core.decideStart({existing: LIVE, nowMs: 5000, mode: "practice"});
  assert.equal(d.action, "finalize_other");
  assert.equal(d.finalize.attemptId, "a1", "the exam's answers are never discarded");
});

test("the terminal statuses are exactly the three that mean over", () => {
  assert.deepEqual([...core.TERMINAL_STATUSES].sort(), ["abandoned", "expired", "submitted"]);
  assert.equal(core.TERMINAL_STATUSES.includes("in_progress"), false);
});

// ── the attempt document ─────────────────────────────────────────────────
console.log("\nthe attempt document");

test("an exam gets an expiry; practice gets null, not a far-future number", () => {
  // A number would make every "is this still running" check somewhere
  // silently mean "for the next century".
  const exam = core.buildAttempt({uid: "u", paperId: "p", quizId: "q", mode: "exam", nowMs: 1000, durationMinutes: 90, questionCount: 60});
  assert.equal(exam.expiresAtMs, 1000 + 90 * 60_000);
  assert.equal(exam.durationMinutes, 90);
  const practice = core.buildAttempt({uid: "u", paperId: "p", quizId: "q", mode: "practice", nowMs: 1000, durationMinutes: 90, questionCount: 60});
  assert.equal(practice.expiresAtMs, null);
  assert.equal(practice.durationMinutes, null);
});

test("a new attempt starts unscored and in progress", () => {
  const a = core.buildAttempt({uid: "u", paperId: "p", quizId: "q", mode: "exam", nowMs: 1, durationMinutes: 90, questionCount: 60});
  assert.equal(a.status, "in_progress");
  assert.deepEqual(a.score, {right: 0, total: 60, percent: 0});
  assert.deepEqual(a.answers, {});
  assert.deepEqual(a.flags, []);
  assert.equal(a.submittedAtMs, null);
  assert.equal(a.learnerId, "u");
});

test("§5.5 — an offline start is flagged, and the flag is the only clock input taken from the client", () => {
  const a = core.buildAttempt({uid: "u", paperId: "p", quizId: "q", mode: "exam", nowMs: 1, durationMinutes: 90, questionCount: 1, unverifiedTiming: true});
  assert.equal(a.unverifiedTiming, true);
  // The expiry is still derived from the SERVER's nowMs, not from anything
  // the client said.
  assert.equal(a.expiresAtMs, 1 + 90 * 60_000);
  assert.equal(core.buildAttempt({uid: "u", paperId: "p", quizId: "q", mode: "exam", nowMs: 1, durationMinutes: 90, questionCount: 1}).unverifiedTiming, false);
});

test("the summary hands the client the server's own clock to correct against", () => {
  const s = core.attemptSummary({attemptId: "a", mode: "exam", status: "in_progress", startedAtMs: 1, expiresAtMs: 2}, {serverNowMs: 999});
  assert.equal(s.serverNowMs, 999);
  // Nothing about the key travels in a summary.
  assert.equal("questions" in s, false);
  assert.equal("score" in s, false);
});

// ── what a client may write ──────────────────────────────────────────────
console.log("\nwhat a client may write");

const QIDS = ["q1", "q2", "q3"];

test("only option indices for questions on this paper survive a patch", () => {
  const patch = core.sanitizeAnswerPatch({
    q1: 2, q2: null, q3: "B", nope: 1, q1x: 0, __proto__: 9,
  }, {questionIds: QIDS});
  assert.deepEqual(patch, {q1: 2, q2: null});
  assert.equal("nope" in patch, false, "a question not on this paper is dropped");
  assert.equal("q3" in patch, false, "a non-integer answer is dropped, not coerced");
});

test("a boolean or a score cannot be submitted as an answer", () => {
  // `{"q1": true}` marked as an answer is how a client marks its own paper.
  const patch = core.sanitizeAnswerPatch({q1: true, q2: 1.5, q3: -1}, {questionIds: QIDS});
  assert.deepEqual(patch, {});
});

test("deselecting is legitimate and survives as null", () => {
  assert.deepEqual(core.sanitizeAnswerPatch({q1: null}, {questionIds: QIDS}), {q1: null});
});

test("flags are ids on this paper, deduped and bounded", () => {
  assert.deepEqual(core.sanitizeFlags(["q1", "q1", "q9", "q2"], {questionIds: QIDS}), ["q1", "q2"]);
  assert.deepEqual(core.sanitizeFlags("not a list", {questionIds: QIDS}), []);
  assert.equal(core.sanitizeFlags(Array(900).fill("q1"), {questionIds: QIDS}).length, 1);
});

test("writability honours the same grace window the submit does", () => {
  const a = {status: "in_progress", mode: "exam", expiresAtMs: 100_000};
  assert.equal(core.attemptIsWritable(a, 99_000), true);
  assert.equal(core.attemptIsWritable(a, 100_000 + 20_000), true, "inside the grace window");
  assert.equal(core.attemptIsWritable(a, 100_000 + 20_001), false);
  assert.equal(core.attemptIsWritable({...a, status: "submitted"}, 1), false);
  // Practice has no clock, so it is writable whenever it is in progress.
  assert.equal(core.attemptIsWritable({status: "in_progress", mode: "practice"}, 9e15), true);
});

test("time used is capped at the paper's own duration", () => {
  // A submission landing inside the grace window a moment after expiry would
  // otherwise record 90m 07s on a 90-minute paper.
  const a = {startedAtMs: 0, durationMinutes: 90};
  assert.equal(core.timeUsedSeconds(a, 90 * 60_000 + 7000), 5400);
  assert.equal(core.timeUsedSeconds(a, 60_000), 60);
  assert.equal(core.timeUsedSeconds({}, 5), 0);
});

test("an abandoned attempt carries NO score (§4.2)", () => {
  // Marking it and filtering it out downstream is one forgotten filter away
  // from a voided paper appearing in a child's results.
  const a = core.buildAbandon({startedAtMs: 0, durationMinutes: 90}, 60_000);
  assert.equal(a.status, "abandoned");
  assert.equal(a.score, null);
  assert.deepEqual(a.bySection, []);
  assert.deepEqual(a.weakTopics, []);
  assert.equal(a.timeUsedSec, 60);
});

// ── the shared marking package (ESM) ─────────────────────────────────────

testAsync("§5.1 — every answer-key shape the resolver reads is stripped for an exam", async () => {
  const marking = await import("../shared/paperQuiz/marking.js");
  const answerKeySource = require("node:fs")
      .readFileSync(require("node:path").join(__dirname, "../shared/paperQuiz/answerKey.js"), "utf8");

  // Every `question.<field>` the resolver reads must be on the strip list.
  // This is what stops the denylist falling behind the resolver: a sixth
  // stored shape fails here until the strip learns it.
  const read = [...answerKeySource.matchAll(/question\?\.([A-Za-z]+)/g)].map((m) => m[1]);
  const keyFields = [...new Set(read)].filter((f) => /correct/i.test(f));
  assert.ok(keyFields.length >= 3, `found the key fields the resolver reads (${keyFields.join(", ")})`);
  keyFields.forEach((f) => {
    assert.ok(
        marking.EXAM_STRIPPED_FIELDS.includes(f),
        `the resolver reads question.${f} but stripForExam does not remove it — `
        + "an exam would ship its own answer key",
    );
  });
});

testAsync("stripForExam removes the key from the OPTIONS too", async () => {
  const marking = await import("../shared/paperQuiz/marking.js");
  const q = {
    id: "q1",
    text: "stem",
    correctAnswer: "B",
    correctAnswerIndex: 1,
    why: "because",
    distractors: {A: "no"},
    explanation: "legacy",
    options: [{text: "a", imageUrl: "u"}, {text: "an", isCorrect: true}],
  };
  const stripped = marking.stripForExam(q);
  marking.EXAM_STRIPPED_FIELDS.forEach((f) => {
    assert.equal(f in stripped, false, `${f} is gone`);
  });
  // Option-level isCorrect is the fifth shape and a top-level field list
  // cannot reach it.
  assert.equal("isCorrect" in stripped.options[1], false);
  // …but the learner can still answer the question.
  assert.equal(stripped.options[0].text, "a");
  assert.equal(stripped.options[0].imageUrl, "u");
  assert.equal(stripped.text, "stem");
  assert.equal(stripped.id, "q1");
});

testAsync("a stripped question resolves to NO answer at all", async () => {
  const [marking, key] = await Promise.all([
    import("../shared/paperQuiz/marking.js"),
    import("../shared/paperQuiz/answerKey.js"),
  ]);
  const q = {options: ["a", "an"], correctAnswer: "B"};
  assert.equal(key.correctIndexOf(q), 1, "the key resolves before stripping");
  assert.equal(key.correctIndexOf(marking.stripForExam(q)), null, "and not after");
});

testAsync("practice keeps the key (§5.4) but never an unapproved explanation", async () => {
  const marking = await import("../shared/paperQuiz/marking.js");
  const q = {options: ["a", "an"], correctAnswer: "B", why: "draft prose", distractors: {A: "x"}, example: "e"};
  const drafted = marking.forPractice({...q, explanationStatus: "ai_draft"});
  assert.equal(drafted.correctAnswer, "B", "practice reveals on tap, so it holds the key");
  assert.equal("why" in drafted, false, "an unapproved draft never travels");
  assert.equal("distractors" in drafted, false);
  assert.equal("example" in drafted, false);
  const approved = marking.forPractice({...q, explanationStatus: "approved"});
  assert.equal(approved.why, "draft prose");
});

testAsync("the gate strips on the SERVER, so a draft never reaches the wire", async () => {
  const gate = await import("../shared/paperQuiz/explanationGate.js");
  [undefined, "missing", "ai_draft", "rejected"].forEach((status) => {
    const out = gate.applyExplanationGate({why: "w", distractors: {A: "d"}, example: "e", explanationStatus: status});
    gate.COACHING_FIELDS.forEach((f) => assert.equal(f in out, false, `${f} stripped for ${status}`));
  });
  // A curriculum LINK is not generated prose and survives — the note it points
  // at was reviewed on its own terms.
  const linked = gate.applyExplanationGate({noteRef: "english/tenses", gameSlug: "word-builder", explanationStatus: "missing"});
  assert.equal(linked.noteRef, "english/tenses");
  assert.equal(linked.gameSlug, "word-builder");
  // Idempotent.
  const once = gate.applyExplanationGate({why: "w", explanationStatus: "missing"});
  assert.deepEqual(gate.applyExplanationGate(once), once);
});

testAsync("marking: a blank is blank, a bad index is blank, a void is right for everyone", async () => {
  const marking = await import("../shared/paperQuiz/marking.js");
  const questions = [
    {id: "q1", n: 1, section: "Grammar", topicId: "t.a", options: ["a", "an"], correctAnswer: "B"},
    {id: "q2", n: 2, section: "Grammar", topicId: "t.a", options: ["a", "an"], correctAnswer: "B"},
    {id: "q3", n: 3, section: "Spelling", topicId: "t.b", options: ["x", "y"], correctAnswer: "A"},
  ];
  const m = marking.markSubmission({
    questions,
    // q2 answered off the end of the options; q3 not answered at all.
    answers: {q1: 1, q2: 99},
    voidedQuestionIds: ["q3"],
  });
  assert.equal(m.rows[0].correct, true);
  assert.equal(m.rows[1].blank, true, "an out-of-range index is read as blank, never as an answer");
  assert.equal(m.rows[2].correct, true, "a voided question is credited to everyone");
  assert.equal(m.rows[2].voided, true);
  // Voiding does not change the denominator: two learners an hour apart must
  // be ranked out of the same total.
  assert.equal(m.total, 3);
  assert.equal(m.right, 2);
});

testAsync("§5.3 — a late submission is `expired` and SCORED, never refused", async () => {
  const marking = await import("../shared/paperQuiz/marking.js");
  assert.equal(marking.submissionStatus({expiresAtMs: 1000, receivedAtMs: 1000}), "submitted");
  assert.equal(marking.submissionStatus({expiresAtMs: 1000, receivedAtMs: 1000 + 20_000}), "submitted");
  assert.equal(marking.submissionStatus({expiresAtMs: 1000, receivedAtMs: 1000 + 20_001}), "expired");
  // A practice attempt has no expiry and is never expired by the clock.
  assert.equal(marking.submissionStatus({expiresAtMs: null, receivedAtMs: 9e12}), "submitted");
});

testAsync("an answer for a question no longer on the paper is dropped, not an error", async () => {
  const marking = await import("../shared/paperQuiz/marking.js");
  // A paper edited mid-attempt produces exactly this; refusing the whole
  // submission would punish the learner for an editorial act.
  assert.deepEqual(
      marking.pruneAnswers({q1: 0, gone: 3}, [{id: "q1"}]),
      {q1: 0},
  );
});

testAsync("topic stats count a blank as seen AND wrong", async () => {
  const marking = await import("../shared/paperQuiz/marking.js");
  // A mastery figure that only counts attempted questions reports a learner
  // who skips their weak topics as having no weak topics.
  const rows = [
    {topicId: "t.a", topic: "Articles", section: "Grammar", correct: true},
    {topicId: "t.a", topic: "Articles", section: "Grammar", correct: false, blank: true},
    {topicId: "t.b", topic: "Spelling", section: "Spelling", correct: false},
    {topicId: "t.c", correct: false, voided: true},
  ];
  const updates = marking.topicStatUpdates(rows, {subject: "english", grade: 7});
  const a = updates.find((u) => u.topicId === "t.a");
  assert.equal(a.seen, 2);
  assert.equal(a.wrong, 1);
  assert.equal(a.subject, "english");
  assert.equal(a.grade, 7);
  // A voided question teaches nothing about the learner.
  assert.equal(updates.find((u) => u.topicId === "t.c"), undefined);
});

testAsync("section rollup keeps paper order and names an unnamed paper once", async () => {
  const marking = await import("../shared/paperQuiz/marking.js");
  const rows = marking.markSubmission({
    questions: [{id: "a", options: ["x", "y"], correctAnswer: "A"}, {id: "b", options: ["x", "y"], correctAnswer: "A"}],
    answers: {a: 0},
  });
  assert.equal(rows.bySection.length, 1);
  assert.equal(rows.bySection[0].right, 1);
  assert.equal(rows.bySection[0].total, 2);
});

(async () => {
  for (const [name, fn] of asyncTests) {
    try {
      await fn();
      passed += 1;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      console.error(`  ✗ ${name}\n    ${err.message}`);
      process.exitCode = 1;
    }
  }
  if (process.exitCode) console.error("\n✗ paper-quiz server core FAILED");
  else console.log(`\n${passed} assertions passed\n`);
})();
