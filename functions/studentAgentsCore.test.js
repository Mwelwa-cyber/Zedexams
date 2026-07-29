/**
 * Node test for functions/studentAgentsCore.js — the pure decision logic
 * behind the learner study-plan agent (generateStudyPlan). No firebase-admin /
 * firebase-functions dependency, so this runs under plain `node` with no
 * stubbing required (repo convention, same as aiOperationsCore.test.js).
 *
 * Run: node functions/studentAgentsCore.test.js
 */

const assert = require("node:assert");
const {
  DEFAULT_SUBJECTS,
  ALLOWED_TASK_ROUTES,
  cleanString,
  stripJsonFences,
  clampInt,
  cleanOptionalDate,
  toIsoDate,
  addDays,
  timestampMillis,
  isPlainObject,
  readTopicScore,
  summarizeResults,
  focusRows,
  routeForTask,
  makeFallbackPlan,
  safeRoute,
  normalizeTask,
  normalizePlan,
  parseAiPlan,
  buildPrompt,
} = require("./studentAgentsCore");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

// ── cleanString / stripJsonFences (carried helpers must not drift) ─────────
ok("cleanString trims + caps length", cleanString("  hello world  ", 5) === "hello");
ok("cleanString strips NUL characters", cleanString("a\u0000b") === "ab");
ok("cleanString strips trailing spaces before newlines", cleanString("a  \nb") === "a\nb");
ok("cleanString null/undefined → empty string", cleanString(null) === "" && cleanString(undefined) === "");
ok("cleanString stringifies non-strings", cleanString(42) === "42");
ok("stripJsonFences unwraps a ```json fence", stripJsonFences("```json\n{\"a\":1}\n```") === "{\"a\":1}");
ok("stripJsonFences leaves plain JSON untouched", stripJsonFences("{\"a\":1}") === "{\"a\":1}");
ok("stripJsonFences empty input → empty string", stripJsonFences("") === "");

// ── clampInt ────────────────────────────────────────────────────────────────
ok("clampInt parses numeric strings", clampInt("7", 3, 14, 5) === 7);
ok("clampInt clamps below min", clampInt(1, 3, 14, 5) === 3);
ok("clampInt clamps above max", clampInt(99, 3, 14, 5) === 14);
ok("clampInt non-numeric → fallback", clampInt("abc", 3, 14, 5) === 5);
ok("clampInt undefined → fallback", clampInt(undefined, 3, 14, 5) === 5);

// ── cleanOptionalDate ───────────────────────────────────────────────────────
ok("cleanOptionalDate keeps YYYY-MM-DD", /^\d{4}-\d{2}-\d{2}$/.test(cleanOptionalDate("2031-01-15")));
ok("cleanOptionalDate rejects prose", cleanOptionalDate("next friday") === "");
ok("cleanOptionalDate rejects partial date", cleanOptionalDate("2031-01") === "");
ok("cleanOptionalDate rejects null", cleanOptionalDate(null) === "");

// ── toIsoDate / addDays ─────────────────────────────────────────────────────
{
  const base = new Date(Date.UTC(2031, 0, 30));
  ok("toIsoDate slices to date part", toIsoDate(base) === "2031-01-30");
  ok("addDays crosses a month boundary in UTC", toIsoDate(addDays(base, 2)) === "2031-02-01");
  ok("addDays does not mutate its input", toIsoDate(base) === "2031-01-30");
  ok("addDays handles negative offsets", toIsoDate(addDays(base, -30)) === "2030-12-31");
}

// ── timestampMillis ─────────────────────────────────────────────────────────
ok("timestampMillis falsy → 0", timestampMillis(null) === 0 && timestampMillis(undefined) === 0);
ok("timestampMillis prefers toMillis()", timestampMillis({toMillis: () => 123}) === 123);
ok("timestampMillis falls back to toDate()", timestampMillis({toDate: () => new Date(456)}) === 456);
ok("timestampMillis parses date strings", timestampMillis("2031-01-15T00:00:00Z") === Date.UTC(2031, 0, 15));
ok("timestampMillis garbage → 0", timestampMillis("not a date") === 0);

// ── isPlainObject / readTopicScore ──────────────────────────────────────────
ok("isPlainObject accepts objects", isPlainObject({}) === true);
ok("isPlainObject rejects arrays and null", !isPlainObject([]) && !isPlainObject(null));
ok("readTopicScore non-object → zeros", readTopicScore("x").correct === 0 && readTopicScore("x").total === 0);
ok("readTopicScore reads numeric fields", readTopicScore({correct: 3, total: 5}).correct === 3);
ok("readTopicScore NaN fields → 0", readTopicScore({correct: "abc", total: "def"}).total === 0);

// ── summarizeResults ────────────────────────────────────────────────────────
{
  const {subjects, weakTopics} = summarizeResults([
    {subject: "Maths", percentage: 40, topicScores: {Fractions: {correct: 1, total: 4}}},
    {subject: "Maths", percentage: 60, topicScores: {Fractions: {correct: 3, total: 4}}},
    {subject: "English", percentage: 90},
    {subject: "", percentage: 70},
    {subject: "Science", percentage: "not-a-number", topicScores: "bad"},
    {subject: "Science", percentage: 50, topicScores: {Cells: {correct: 0, total: 0}}},
  ]);
  ok("subjects averaged per subject", subjects.find((s) => s.subject === "Maths").percentage === 50);
  ok("subjects counts attempts", subjects.find((s) => s.subject === "Maths").attempts === 2);
  ok("missing subject bucketed as General", subjects.some((s) => s.subject === "General"));
  ok("non-numeric percentage skipped for averages", subjects.find((s) => s.subject === "Science").attempts === 1);
  ok("subjects sorted weakest-first", subjects[0].percentage <= subjects[subjects.length - 1].percentage);
  ok("topic scores aggregate across results", weakTopics[0].correct === 4 && weakTopics[0].total === 8);
  ok("aggregated topic percentage rounded", weakTopics[0].percentage === 50);
  ok("zero-total topics excluded", !weakTopics.some((t) => t.topic === "Cells"));
}
{
  const many = Array.from({length: 12}, (_, i) => ({
    subject: "Maths",
    percentage: 50,
    topicScores: {[`Topic ${i}`]: {correct: i, total: 10}},
  }));
  ok("weakTopics capped at 8", summarizeResults(many).weakTopics.length === 8);
  ok("empty results → empty summary", summarizeResults([]).subjects.length === 0);
}

// ── focusRows ───────────────────────────────────────────────────────────────
{
  const weak = Array.from({length: 7}, (_, i) => ({topic: `T${i}`, subject: "Maths", percentage: 10 + i}));
  const rows = focusRows({weakTopics: weak, subjects: []});
  ok("weak topics win and cap at 5", rows.length === 5 && rows[0].label === "T0");
  ok("weak-topic reason says mastery", rows[0].reason === "10% mastery");

  const bySubject = focusRows({weakTopics: [], subjects: [{subject: "English", percentage: 65}]});
  ok("no weak topics → subject rows", bySubject[0].label === "English" && bySubject[0].reason === "65% average");

  const empty = focusRows({weakTopics: [], subjects: []});
  ok("no data → default subject list", empty.length === DEFAULT_SUBJECTS.length && empty[0].label === DEFAULT_SUBJECTS[0]);
}

// ── routeForTask / safeRoute ────────────────────────────────────────────────
ok("read task → /lessons", routeForTask("read", "Maths") === "/lessons");
ok("results task → /my-results", routeForTask("results", "Maths") === "/my-results");
ok("practice with subject → /quizzes", routeForTask("practice", "Maths") === "/quizzes");
ok("no subject → /dashboard", routeForTask("practice", "") === "/dashboard");
ok("safeRoute keeps an allowed route", safeRoute("/exams", "/dashboard") === "/exams");
ok("safeRoute rejects unlisted route", safeRoute("/admin", "/dashboard") === "/dashboard");
ok("safeRoute rejects external-looking //", safeRoute("//evil.example", "/dashboard") === "/dashboard");
ok("safeRoute rejects non-slash values", safeRoute("quizzes", "/dashboard") === "/dashboard");
ok("safeRoute empty → fallback", safeRoute("", "/dashboard") === "/dashboard");
ok("every fallback route is allowed", ALLOWED_TASK_ROUTES.has("/dashboard") && ALLOWED_TASK_ROUTES.has("/quizzes"));

// ── makeFallbackPlan ────────────────────────────────────────────────────────
{
  const plan = makeFallbackPlan({
    profile: {grade: 7},
    params: {days: 5, minutesPerDay: 45},
    weakTopics: [{topic: "Fractions", subject: "Maths", percentage: 25}],
    subjects: [],
  });
  ok("fallback plan has requested day count", plan.days.length === 5);
  ok("fallback plan is titled from the grade", plan.title === "Grade 7 study plan");
  ok("fallback plan marked generatedBy fallback", plan.generatedBy === "fallback");
  ok("day one is labelled Today", plan.days[0].label === "Today");
  ok("each day has three tasks", plan.days.every((d) => d.tasks.length === 3));
  ok("task minutes sum to minutesPerDay",
      plan.days[0].tasks.reduce((sum, t) => sum + t.minutes, 0) === 45);
  ok("day focus comes from the weak topic", plan.days[0].focus === "Fractions");
  ok("read task routed to /lessons", plan.days[0].tasks[0].route === "/lessons");
  ok("practice task routed to /quizzes", plan.days[0].tasks[1].route === "/quizzes");
  ok("day dates are consecutive ISO dates", plan.days.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date)));

  const noGrade = makeFallbackPlan({profile: {}, params: {days: 3, minutesPerDay: 15}, weakTopics: [], subjects: []});
  ok("missing grade → 'your grade' title", noGrade.title === "your grade study plan");
  ok("minute floors hold at the minimum budget",
      noGrade.days[0].tasks.every((t) => t.minutes >= 3));
}

// ── normalizeTask ───────────────────────────────────────────────────────────
{
  const fb = {title: "FB", detail: "fb detail", minutes: 12, type: "practice", subject: "Maths", topic: "Algebra"};
  const t = normalizeTask({title: "Do sums", minutes: 999, route: "/nowhere"}, fb);
  ok("normalizeTask keeps AI title", t.title === "Do sums");
  ok("normalizeTask clamps minutes to 180", t.minutes === 180);
  ok("normalizeTask replaces bad route with type default", t.route === "/quizzes");
  ok("normalizeTask fills gaps from fallback task", t.detail === "fb detail" && t.subject === "Maths");
  const empty = normalizeTask({}, {});
  ok("normalizeTask empty → practice defaults", empty.type === "practice" && empty.minutes === 10);
  const read = normalizeTask({type: "read"}, {});
  ok("normalizeTask read type routes to /lessons", read.route === "/lessons");
}

// ── normalizePlan ───────────────────────────────────────────────────────────
{
  const fallback = makeFallbackPlan({
    profile: {grade: 9},
    params: {days: 3, minutesPerDay: 30},
    weakTopics: [],
    subjects: [{subject: "Maths", percentage: 40}],
  });

  const fromNull = normalizePlan(null, fallback);
  ok("null AI plan → fallback content", fromNull.days.length === fallback.days.length);
  ok("normalizePlan always stamps generatedBy ai", fromNull.generatedBy === "ai");

  const tooMany = {
    days: Array.from({length: 20}, () => ({
      label: "Day", focus: "F",
      tasks: Array.from({length: 6}, () => ({title: "t", minutes: 10, type: "practice", subject: "Maths"})),
    })),
    focusAreas: Array.from({length: 9}, (_, i) => ({label: `L${i}`})),
  };
  const capped = normalizePlan(tooMany, fallback);
  ok("AI days capped at 14", capped.days.length === 14);
  ok("AI tasks capped at 4 per day", capped.days.every((d) => d.tasks.length === 4));
  ok("AI focusAreas capped at 5", capped.focusAreas.length === 5);

  const junkRoute = normalizePlan({
    days: [{label: "Today", tasks: [{title: "t", type: "practice", subject: "Maths", route: "https://evil"}]}],
  }, fallback);
  ok("AI route outside allowlist replaced", junkRoute.days[0].tasks[0].route === "/quizzes");

  const badDate = normalizePlan({
    days: [{label: "Today", date: "soonish", tasks: [{title: "t", type: "read"}]}],
  }, fallback);
  ok("invalid AI date falls back to fallback day date", badDate.days[0].date === fallback.days[0].date);

  const emptyDays = normalizePlan({days: [{label: "Today", tasks: []}]}, fallback);
  ok("days without tasks are dropped → fallback days", emptyDays.days === fallback.days);

  const blankFocus = normalizePlan({focusAreas: [{}, {}]}, fallback);
  ok("focusAreas backfill from fallback rows",
      blankFocus.focusAreas[0].label === fallback.focusAreas[0].label);
}

// ── parseAiPlan ─────────────────────────────────────────────────────────────
ok("parseAiPlan reads plain JSON", parseAiPlan("{\"title\":\"x\"}").title === "x");
ok("parseAiPlan reads fenced JSON", parseAiPlan("```json\n{\"title\":\"y\"}\n```").title === "y");
ok("parseAiPlan garbage → null", parseAiPlan("not json at all") === null);
ok("parseAiPlan empty → null", parseAiPlan("") === null);

// ── buildPrompt ─────────────────────────────────────────────────────────────
{
  const results = Array.from({length: 20}, (_, i) => ({
    quizTitle: `Quiz ${i}`,
    subject: "Maths",
    percentage: 50,
    completedAt: {toMillis: () => Date.UTC(2031, 0, 1)},
  }));
  const prompt = buildPrompt({
    profile: {grade: 8, displayName: "Learner", school: "School"},
    params: {days: 7, minutesPerDay: 45, examDate: "", note: ""},
    results,
    weakTopics: Array.from({length: 10}, (_, i) => ({topic: `T${i}`})),
    subjects: Array.from({length: 10}, (_, i) => ({subject: `S${i}`})),
  });
  ok("prompt demands JSON-only output", prompt.includes("Return ONLY valid JSON"));
  ok("prompt embeds the learner grade", prompt.includes("\"grade\":8"));
  ok("prompt caps recent results at 12", !prompt.includes("Quiz 12") && prompt.includes("Quiz 11"));
  ok("prompt caps weak topics at 6", !prompt.includes("T6") && prompt.includes("T5"));
  ok("prompt caps subject stats at 6", !prompt.includes("S6") && prompt.includes("S5"));
  ok("prompt renders completedAt as ISO date", prompt.includes("2031-01-01"));
  ok("prompt lists the allowed routes", prompt.includes("/ai-practice"));
  const noDate = buildPrompt({
    profile: {},
    params: {},
    results: [{quizTitle: "Q", subject: "Maths", percentage: 10, completedAt: "garbage"}],
    weakTopics: [],
    subjects: [],
  });
  ok("unparseable completedAt renders as empty date", noDate.includes("\"date\":\"\""));
}

console.log(`\nstudentAgentsCore tests passed (${passed})`);
