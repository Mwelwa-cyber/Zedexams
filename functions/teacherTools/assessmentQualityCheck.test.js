/**
 * Node test for assessmentQualityCheck — the deterministic Assessment Quality
 * Checker + interleave re-order.
 * Run: node functions/teacherTools/assessmentQualityCheck.test.js
 */

const assert = require("node:assert");
const {
  checkAssessmentQuality,
  interleaveSections,
  sectionClustered,
  interleaveQuestions,
  questionCore,
  longestRun,
} = require("./assessmentQualityCheck");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("assessmentQualityCheck");

const TOPICS = ["Human Body", "Plants", "Weather", "Animals"];

// Build a section of questions, one per topic key in `topicSeq`.
function qs(topicSeq, bloomSeq) {
  return topicSeq.map((t, i) => ({
    number: i + 1,
    type: "short_answer",
    prompt: `Question about ${t} number ${i}`,
    marks: 1,
    topic: t,
    bloomLevel: (bloomSeq && bloomSeq[i]) || "remember",
  }));
}

function paper(sections, header = {}) {
  return {
    header: {grade: "G4", subject: "integrated_science", totalMarks: 0, ...header},
    sections,
  };
}

// ── longestRun / sectionClustered ─────────────────────────────────────────
{
  assert.strictEqual(longestRun(["a", "a", "a", "b"]), 3);
  assert.strictEqual(longestRun(["a", "b", "a", "b"]), 1);
  ok("longestRun counts consecutive identical topics", true);

  // Worksheet block: HHHH PPPP → clustered.
  const clustered = qs(["Human Body", "Human Body", "Human Body", "Human Body",
    "Plants", "Plants", "Plants", "Plants"]);
  ok("a topic-blocked section is clustered", sectionClustered(clustered));

  // Interleaved: H P W A H P W A → not clustered.
  const mixed = qs(["Human Body", "Plants", "Weather", "Animals",
    "Human Body", "Plants", "Weather", "Animals"]);
  ok("an interleaved section is not clustered", !sectionClustered(mixed));

  // Single-topic section can't be clustered (nothing to mix).
  const single = qs(["Human Body", "Human Body", "Human Body"]);
  ok("a single-topic section is never clustered", !sectionClustered(single));
}

// ── interleaveQuestions round-robins topics ───────────────────────────────
{
  const clustered = qs(["Human Body", "Human Body", "Human Body", "Human Body",
    "Plants", "Plants", "Plants", "Plants"]);
  const mixed = interleaveQuestions(clustered);
  const topics = mixed.map((q) => q.topic);
  ok("interleave produces H,P,H,P,… not a block",
    longestRun(topics) === 1);
  ok("interleave keeps every question", mixed.length === clustered.length);
  ok("interleave strips the number for clean renumbering",
    mixed.every((q) => q.number === undefined));
}

// ── checkAssessmentQuality: clustered paper ───────────────────────────────
{
  const clustered = paper([{
    title: "Questions",
    questions: qs(["Human Body", "Human Body", "Human Body", "Human Body",
      "Plants", "Plants", "Plants", "Plants"]),
  }], {totalMarks: 8});
  const report = checkAssessmentQuality(clustered, {grade: "G4", topics: TOPICS.slice(0, 2)});
  ok("clustered paper flags topic mixing", report.checks.topicMixing.ok === false);
  ok("clustered paper is marked clustered", report.clustered === true);
  ok("clustered paper reports topics tagged", report.topicsTagged === true);
  ok("clustered paper verdict is warn", report.verdict === "warn");
}

// ── checkAssessmentQuality: good paper passes ─────────────────────────────
{
  const good = paper([{
    title: "Questions",
    questions: qs(
      ["Human Body", "Plants", "Weather", "Animals",
        "Human Body", "Plants", "Weather", "Animals"],
      ["remember", "understand", "apply", "analyse",
        "remember", "understand", "apply", "remember"]),
  }], {totalMarks: 8});
  const report = checkAssessmentQuality(good, {grade: "G4", topics: TOPICS});
  ok("balanced paper passes topic mixing", report.checks.topicMixing.ok);
  ok("balanced paper passes Bloom variety", report.checks.bloomVariety.ok);
  ok("balanced paper covers all topics", report.checks.coverage.ok);
  ok("balanced paper has no duplicates", report.checks.noDuplicates.ok);
  ok("balanced paper verdict is pass", report.verdict === "pass");
}

// ── all-recall Bloom warning ──────────────────────────────────────────────
{
  const flat = paper([{
    title: "Questions",
    questions: qs(["Human Body", "Plants", "Weather", "Animals"],
      ["remember", "remember", "remember", "remember"]),
  }], {totalMarks: 4});
  const report = checkAssessmentQuality(flat, {grade: "G4", topics: TOPICS});
  ok("all-recall paper fails Bloom variety", !report.checks.bloomVariety.ok);
  ok("all-recall paper warns about recall",
    report.warnings.some((w) => /recall/i.test(w)));
}

// ── missing-topic coverage warning ────────────────────────────────────────
{
  const partial = paper([{
    title: "Questions",
    questions: qs(["Human Body", "Plants", "Human Body", "Plants"],
      ["remember", "understand", "apply", "analyse"]),
  }], {totalMarks: 4});
  const report = checkAssessmentQuality(partial, {grade: "G4", topics: TOPICS});
  ok("missing topics fail coverage", !report.checks.coverage.ok);
  ok("missing topics are named in a warning",
    report.warnings.some((w) => /Weather/.test(w) && /Animals/.test(w)));
}

// ── duplicate detection (reworded) ────────────────────────────────────────
{
  const core1 = questionCore("Name two bones.");
  const core2 = questionCore("State two bones.");
  const core3 = questionCore("Mention two bones.");
  ok("reworded command variants share a core",
    core1 === core2 && core2 === core3);
  ok("a different question has a different core",
    questionCore("Name two muscles.") !== core1);

  const dup = paper([{
    title: "Questions",
    questions: [
      {number: 1, type: "short_answer", prompt: "Name two bones.", marks: 1,
        topic: "Human Body", bloomLevel: "remember"},
      {number: 2, type: "short_answer", prompt: "State two bones.", marks: 1,
        topic: "Human Body", bloomLevel: "remember"},
    ],
  }], {totalMarks: 2});
  const report = checkAssessmentQuality(dup, {grade: "G4", topics: ["Human Body"]});
  ok("reworded duplicate is flagged", !report.checks.noDuplicates.ok);
}

// ── interleaveSections only touches clustered sections ────────────────────
{
  const sections = [
    {title: "A", questions: qs(["Human Body", "Human Body", "Human Body",
      "Plants", "Plants", "Plants"])},
    {title: "B", questions: qs(["Weather", "Animals", "Weather", "Animals"])},
  ];
  const out = interleaveSections(sections);
  ok("clustered section A is re-ordered",
    longestRun(out[0].questions.map((q) => q.topic)) === 1);
  ok("already-mixed section B is untouched (order preserved)",
    out[1].questions.map((q) => q.topic).join() ===
    sections[1].questions.map((q) => q.topic).join());
}

console.log(`\nassessmentQualityCheck: ${passed} checks passed`);
