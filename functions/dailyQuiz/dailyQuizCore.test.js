/**
 * functions/dailyQuiz/dailyQuizCore.test.js  →  npm run test:daily-quiz-core
 *
 * The properties this suite exists to pin are the ones that fail SILENTLY:
 * a non-deterministic pick produces a perfectly normal-looking quiz that
 * happens to differ between two learners, and nothing errors. So the seed
 * tests assert equality between independently-built results rather than
 * against a recorded fixture — a fixture would still pass if both sides
 * drifted together.
 */

const assert = require("assert");
const {
  DAILY_QUIZ_QUESTION_COUNT,
  RELAXATION_ORDER,
  normalizeSubject,
  normalizeDifficulty,
  normalizeCandidate,
  seedFor,
  seedHex,
  makeRng,
  seededShuffle,
  daysBetween,
  planSubjectSlots,
  planDifficultySlots,
  recentlyServedIds,
  selectQuestions,
  buildQuizDoc,
  scoreAttempt,
  canEditQuiz,
  runwayFor,
  runwayLevel,
} = require("./dailyQuizCore");

let passed = 0;
function it(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (err) {
    console.error(`\n✗ ${name}\n  ${err.message}\n`);
    throw err;
  }
}

// ── A pool big enough to satisfy every rule ──────────────────────────
const SUBJECTS = ["Mathematics", "English", "Integrated Science", "Social Studies"];
function makePool({perSubject = 12} = {}) {
  const rows = [];
  for (const subject of SUBJECTS) {
    for (let i = 0; i < perSubject; i += 1) {
      rows.push({
        id: `${subject.replace(/\s+/g, "").toLowerCase()}_${String(i).padStart(3, "0")}`,
        subject,
        difficulty: ["easy", "medium", "hard"][i % 3],
        topic: `topic-${i % 4}`,
        grade: "7",
      });
    }
  }
  return rows;
}

// ── normalisation ────────────────────────────────────────────────────

it("normalizeSubject folds ids, slugs and labels onto one canonical label", () => {
  for (const v of ["mathematics", "Mathematics", "maths", "MATH"]) {
    assert.strictEqual(normalizeSubject(v), "Mathematics", `${v} should fold to Mathematics`);
  }
  for (const v of ["science", "integrated_science", "integrated-science", "Integrated Science"]) {
    assert.strictEqual(normalizeSubject(v), "Integrated Science");
  }
  for (const v of ["social-studies", "social_studies", "Social Studies"]) {
    assert.strictEqual(normalizeSubject(v), "Social Studies");
  }
});

it("normalizeSubject keeps an unknown subject rather than dropping it", () => {
  // A subject the alias table has not heard of is still a real pool. Dropping
  // it would shrink the quiz for no reason.
  assert.strictEqual(normalizeSubject("civic education"), "Civic Education");
  assert.strictEqual(normalizeSubject(""), "");
  assert.strictEqual(normalizeSubject(null), "");
});

it("normalizeDifficulty defaults untagged questions to medium, not to dropped", () => {
  assert.strictEqual(normalizeDifficulty(""), "medium");
  assert.strictEqual(normalizeDifficulty(undefined), "medium");
  assert.strictEqual(normalizeDifficulty("HARD"), "hard");
  assert.strictEqual(normalizeDifficulty("low"), "easy");
  assert.strictEqual(normalizeDifficulty("challenging"), "hard");
});

it("normalizeCandidate drops a row with no id or no subject", () => {
  assert.strictEqual(normalizeCandidate({subject: "Mathematics"}), null);
  assert.strictEqual(normalizeCandidate({id: "q1", subject: "  "}), null);
  assert.ok(normalizeCandidate({id: "q1", subject: "maths"}));
});

// ── the seed ─────────────────────────────────────────────────────────

it("seedFor is stable for the same grade+date and differs across both", () => {
  assert.strictEqual(seedFor("7", "2026-08-20"), seedFor("7", "2026-08-20"));
  assert.strictEqual(seedFor(7, "2026-08-20"), seedFor("7", "2026-08-20"), "number and string grade agree");
  assert.notStrictEqual(seedFor("7", "2026-08-20"), seedFor("7", "2026-08-21"));
  assert.notStrictEqual(seedFor("7", "2026-08-20"), seedFor("6", "2026-08-20"));
});

it("seedHex is 8 hex characters", () => {
  assert.match(seedHex(seedFor("7", "2026-08-20")), /^[0-9a-f]{8}$/);
});

it("makeRng is reproducible and stays inside [0,1)", () => {
  const a = makeRng(12345);
  const b = makeRng(12345);
  for (let i = 0; i < 200; i += 1) {
    const v = a();
    assert.strictEqual(v, b());
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
  }
});

it("seededShuffle sorts by id first, so an unstable query order cannot leak in", () => {
  // THE failure this guards: Firestore returns docs in whatever order the
  // query produced. A stable seed over an unstable input is still unstable —
  // the seed fixes the permutation, not what it is applied to.
  const items = [{id: "c"}, {id: "a"}, {id: "b"}];
  const reordered = [{id: "b"}, {id: "c"}, {id: "a"}];
  const one = seededShuffle(items, makeRng(99)).map((i) => i.id);
  const two = seededShuffle(reordered, makeRng(99)).map((i) => i.id);
  assert.deepStrictEqual(one, two);
});

it("seededShuffle does not mutate its input", () => {
  const items = [{id: "c"}, {id: "a"}, {id: "b"}];
  const before = items.map((i) => i.id);
  seededShuffle(items, makeRng(7));
  assert.deepStrictEqual(items.map((i) => i.id), before);
});

// ── slot planning ────────────────────────────────────────────────────

it("Maths and English take a slot every day", () => {
  const slots = planSubjectSlots("2026-08-20", SUBJECTS);
  assert.strictEqual(slots.length, DAILY_QUIZ_QUESTION_COUNT);
  assert.ok(slots.includes("Mathematics"));
  assert.ok(slots.includes("English"));
});

it("the other three slots rotate by weekday", () => {
  const a = planSubjectSlots("2026-08-20", SUBJECTS);
  const b = planSubjectSlots("2026-08-21", SUBJECTS);
  assert.notDeepStrictEqual(a, b, "consecutive days should not have identical rotations");
});

it("a grade with only one subject still gets five slots", () => {
  // A three-slot hole would be a shorter quiz, which is worse than repeating
  // a subject the grade actually has content for.
  const slots = planSubjectSlots("2026-08-20", ["Mathematics"]);
  assert.strictEqual(slots.length, DAILY_QUIZ_QUESTION_COUNT);
  assert.ok(slots.every((s) => s === "Mathematics"));
});

it("no subjects at all yields no slots rather than throwing", () => {
  assert.deepStrictEqual(planSubjectSlots("2026-08-20", []), []);
});

it("the difficulty plan is 2 easy, 2 medium, 1 hard — rarest tier first", () => {
  const slots = planDifficultySlots();
  assert.strictEqual(slots.length, 5);
  assert.strictEqual(slots.filter((s) => s === "easy").length, 2);
  assert.strictEqual(slots.filter((s) => s === "medium").length, 2);
  assert.strictEqual(slots.filter((s) => s === "hard").length, 1);
  assert.strictEqual(slots[0], "hard", "the scarce tier is filled first");
});

// ── freshness ────────────────────────────────────────────────────────

it("recentlyServedIds collects only the last 30 days", () => {
  const ids = recentlyServedIds([
    {date: "2026-08-19", questionIds: ["a"]},
    {date: "2026-07-25", questionIds: ["b"]},   // 26 days — inside
    {date: "2026-06-01", questionIds: ["c"]},   // far outside
  ], "2026-08-20");
  assert.ok(ids.has("a"));
  assert.ok(ids.has("b"));
  assert.ok(!ids.has("c"));
});

it("recentlyServedIds ignores a future-dated doc", () => {
  const ids = recentlyServedIds([{date: "2026-09-01", questionIds: ["x"]}], "2026-08-20");
  assert.ok(!ids.has("x"));
});

it("daysBetween reads a malformed key as infinitely old rather than as today", () => {
  // Fail toward "not recent": a broken date must never make a question look
  // freshly served and get it excluded from every future quiz.
  assert.strictEqual(daysBetween("2026-08-20", "not-a-date"), Number.POSITIVE_INFINITY);
});

// ── selection: the determinism guarantees ────────────────────────────

it("two independent builds of the same grade+date pick the identical five", () => {
  // The cron and the self-heal. If this ever fails, two learners in one
  // grade sit different quizzes on a shared leaderboard.
  const a = selectQuestions({pool: makePool(), grade: "7", date: "2026-08-20"});
  const b = selectQuestions({pool: makePool(), grade: "7", date: "2026-08-20"});
  assert.deepStrictEqual(a.questionIds, b.questionIds);
  assert.strictEqual(a.status, "ok");
});

it("a shuffled pool produces the same five as an ordered one", () => {
  const ordered = makePool();
  const shuffled = [...ordered].reverse();
  const a = selectQuestions({pool: ordered, grade: "7", date: "2026-08-20"});
  const b = selectQuestions({pool: shuffled, grade: "7", date: "2026-08-20"});
  assert.deepStrictEqual(a.questionIds, b.questionIds);
});

it("different grades and different days get different quizzes", () => {
  const g7 = selectQuestions({pool: makePool(), grade: "7", date: "2026-08-20"});
  const g6 = selectQuestions({pool: makePool(), grade: "6", date: "2026-08-20"});
  const next = selectQuestions({pool: makePool(), grade: "7", date: "2026-08-21"});
  assert.notDeepStrictEqual(g7.questionIds, g6.questionIds);
  assert.notDeepStrictEqual(g7.questionIds, next.questionIds);
});

it("a full pool satisfies every rule, relaxing nothing", () => {
  const r = selectQuestions({pool: makePool(), grade: "7", date: "2026-08-20"});
  assert.deepStrictEqual(r.rulesRelaxed, []);
  assert.strictEqual(r.questionIds.length, 5);
  assert.strictEqual(new Set(r.questionIds).size, 5, "no question appears twice");
});

it("the pick honours the difficulty mix when the pool allows it", () => {
  const r = selectQuestions({pool: makePool(), grade: "7", date: "2026-08-20"});
  const tiers = r.picked.map((p) => p.difficulty);
  assert.strictEqual(tiers.filter((t) => t === "easy").length, 2);
  assert.strictEqual(tiers.filter((t) => t === "medium").length, 2);
  assert.strictEqual(tiers.filter((t) => t === "hard").length, 1);
});

it("recently-served questions are excluded", () => {
  const pool = makePool();
  const first = selectQuestions({pool, grade: "7", date: "2026-08-20"});
  const second = selectQuestions({
    pool,
    grade: "7",
    date: "2026-08-21",
    recentDocs: [{date: "2026-08-20", questionIds: first.questionIds}],
  });
  for (const id of second.questionIds) {
    assert.ok(!first.questionIds.includes(id), `${id} was served yesterday`);
  }
  assert.deepStrictEqual(second.rulesRelaxed, []);
});

// ── selection: the relaxation ladder ─────────────────────────────────

it("difficulty relaxes first, and says so", () => {
  // Every question is easy, so the hard and medium slots cannot be filled
  // as specified — but five questions still exist.
  const pool = makePool().map((r) => ({...r, difficulty: "easy"}));
  const r = selectQuestions({pool, grade: "7", date: "2026-08-20"});
  assert.strictEqual(r.status, "ok");
  assert.strictEqual(r.questionIds.length, 5);
  assert.deepStrictEqual(r.rulesRelaxed, ["difficulty"]);
});

it("subject rotation relaxes only after difficulty", () => {
  // One subject, mixed difficulty: the spread cannot hold, the mix can't
  // either once slots collide, so both bend — but freshness must not.
  const pool = makePool().filter((r) => r.subject === "Mathematics");
  const r = selectQuestions({pool, grade: "7", date: "2026-08-20"});
  assert.strictEqual(r.status, "ok");
  assert.ok(!r.rulesRelaxed.includes("freshness"), "freshness must be the last rung to bend");
});

it("freshness bends last, and only when nothing else is left", () => {
  const pool = makePool({perSubject: 2}); // 8 questions total
  const everythingServed = [{date: "2026-08-19", questionIds: pool.map((p) => p.id)}];
  const r = selectQuestions({
    pool, grade: "7", date: "2026-08-20", recentDocs: everythingServed,
  });
  assert.strictEqual(r.questionIds.length, 5);
  assert.ok(r.rulesRelaxed.includes("freshness"));
  assert.strictEqual(r.status, "ok", "a repeat is still a real quiz, not a thin one");
});

it("the ladder never reorders itself", () => {
  const pool = makePool({perSubject: 2});
  const r = selectQuestions({
    pool,
    grade: "7",
    date: "2026-08-20",
    recentDocs: [{date: "2026-08-19", questionIds: pool.map((p) => p.id)}],
  });
  // Whatever was relaxed must be a PREFIX of the declared order.
  assert.deepStrictEqual(r.rulesRelaxed, RELAXATION_ORDER.slice(0, r.rulesRelaxed.length));
});

// ── selection: thin ──────────────────────────────────────────────────

it("a pool that cannot yield five is thin, and is still deterministic", () => {
  const pool = makePool({perSubject: 1}).slice(0, 3);
  const a = selectQuestions({pool, grade: "7", date: "2026-08-20"});
  const b = selectQuestions({pool, grade: "7", date: "2026-08-20"});
  assert.strictEqual(a.status, "thin");
  assert.ok(a.questionIds.length < 5);
  assert.deepStrictEqual(a.questionIds, b.questionIds, "even a thin day must be reproducible");
});

it("an empty pool is thin rather than a crash", () => {
  const r = selectQuestions({pool: [], grade: "7", date: "2026-08-20"});
  assert.strictEqual(r.status, "thin");
  assert.deepStrictEqual(r.questionIds, []);
});

// ── the document ─────────────────────────────────────────────────────

it("buildQuizDoc records the seed, the relaxations and who built it", () => {
  const selection = selectQuestions({pool: makePool(), grade: "7", date: "2026-08-20"});
  const doc = buildQuizDoc({grade: "7", date: "2026-08-20", selection, createdBy: "selfheal"});
  assert.strictEqual(doc.grade, "7");
  assert.strictEqual(doc.date, "2026-08-20");
  assert.strictEqual(doc.createdBy, "selfheal");
  assert.strictEqual(doc.status, "ok");
  assert.match(doc.seed, /^[0-9a-f]{8}$/);
  assert.deepStrictEqual(doc.questionIds, selection.questionIds);
  assert.ok(Array.isArray(doc.rulesRelaxed));
});

it("the doc carries no answer key — only ids", () => {
  // The whole read path depends on this: correct answers never leave the
  // server, so they must never be written into a document either.
  const selection = selectQuestions({pool: makePool(), grade: "7", date: "2026-08-20"});
  const doc = buildQuizDoc({grade: "7", date: "2026-08-20", selection, createdBy: "cron"});
  const serialized = JSON.stringify(doc);
  assert.ok(!/correctAnswer|answerKey/i.test(serialized));
});

// ── scoring ──────────────────────────────────────────────────────────

it("10 a correct answer, +10 for all five", () => {
  assert.strictEqual(scoreAttempt({marks: [1, 1, 1, 1, 1]}).points, 60);
  assert.strictEqual(scoreAttempt({marks: [1, 1, 1, 1, 0]}).points, 40);
  assert.strictEqual(scoreAttempt({marks: [0, 0, 0, 0, 0]}).points, 0);
});

it("a voided question is credited to everyone, bonus included", () => {
  // Post-lock errors are paid out, never edited. A learner who got the other
  // four right must reach the all-five bonus.
  const r = scoreAttempt({marks: [1, 1, 1, 1, 0], voidedCount: 1});
  assert.strictEqual(r.credited, 5);
  assert.strictEqual(r.points, 60);
  assert.strictEqual(r.allCorrect, true);
});

it("credit never exceeds the question count", () => {
  const r = scoreAttempt({marks: [1, 1, 1, 1, 1], voidedCount: 2});
  assert.strictEqual(r.credited, 5);
  assert.strictEqual(r.points, 60);
});

// ── the edit lock ────────────────────────────────────────────────────

it("tomorrow's quiz is editable before 23:00", () => {
  const r = canEditQuiz({quizDate: "2026-08-21", today: "2026-08-20", nowHour: 20, hasAttempts: false});
  assert.strictEqual(r.allowed, true);
});

it("a swap after 23:00 is rejected", () => {
  const r = canEditQuiz({quizDate: "2026-08-21", today: "2026-08-20", nowHour: 23, hasAttempts: false});
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.reason, "past_cutoff");
});

it("today's quiz is never editable, whatever the clock says", () => {
  const r = canEditQuiz({quizDate: "2026-08-20", today: "2026-08-20", nowHour: 6, hasAttempts: false});
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.reason, "not_future");
});

it("one existing attempt freezes the document outright", () => {
  // The attempt lock outranks the clock: a child has answered, so changing a
  // question would rank learners against different quizzes.
  const r = canEditQuiz({quizDate: "2026-08-25", today: "2026-08-20", nowHour: 9, hasAttempts: true});
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.reason, "attempts_exist");
});

// ── bank health ──────────────────────────────────────────────────────

it("runway is eligible questions divided by five, floored", () => {
  assert.strictEqual(runwayFor(519), 103);
  assert.strictEqual(runwayFor(4), 0);
  assert.strictEqual(runwayFor(0), 0);
  assert.strictEqual(runwayFor(undefined), 0);
  assert.strictEqual(runwayFor(-5), 0, "a negative count is not negative runway");
});

it("runway below 30 days is critical", () => {
  assert.strictEqual(runwayLevel(19), "critical");
  assert.strictEqual(runwayLevel(29), "critical");
  assert.strictEqual(runwayLevel(30), "warn");
  assert.strictEqual(runwayLevel(103), "ok");
});

console.log(`✓ dailyQuizCore — ${passed} assertions passed`);
