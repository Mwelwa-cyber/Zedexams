/**
 * paperBlueprint tests.
 *
 * The blueprint is what makes the Phase 3 acceptance criteria true BY
 * CONSTRUCTION rather than by asking the model nicely:
 *
 *   • every item is tagged with topic, outcome, Bloom level and difficulty
 *   • the marks always sum to the header total
 *   • topics are interleaved, not clustered
 *   • the band's ceiling is respected
 *
 * Run: node functions/teacherTools/paperBlueprint.test.js
 */

const assert = require("node:assert/strict");
const {
  buildPaperBlueprint, validateBlueprint, renderBlueprintDirective,
  splitEvenly, allocateByWeight, parseCountHint, parseMarksHint,
} = require("./paperBlueprint");
const {ASSESSMENT_BAND_SEED} = require("./assessmentBandsCore");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (err) {
    console.error(`✗ ${name}\n  ${err.message}`);
    process.exitCode = 1;
  }
}

const SECTIONS = [
  {
    name: "SECTION A", heading: "SECTION A: SHORT QUESTIONS",
    instructions: "Answer ALL questions.",
    questionTypes: ["multiple_choice", "short_answer"],
    questionCountHint: "6-10", marksShare: 50, marksPerQuestionHint: "1-2 marks each",
  },
  {
    name: "SECTION B", heading: "SECTION B: WRITTEN QUESTIONS",
    instructions: "Show your working.",
    questionTypes: ["short_answer", "calculation", "structured"],
    questionCountHint: "3-5", marksShare: 50, marksPerQuestionHint: "2-5 marks each",
  },
];

function blueprint(overrides = {}) {
  return buildPaperBlueprint({
    grade: "G7", gradeLabel: "Grade 7", subject: "integrated_science",
    assessmentType: "end_of_term", totalMarks: 40, durationMinutes: 90,
    topics: ["Human Body", "Plants", "Weather"],
    subtopics: [],
    activityTypes: [],
    band: ASSESSMENT_BAND_SEED.upper_primary,
    paperStructure: SECTIONS,
    outcomesByTopic: {},
    competencies: [],
    ...overrides,
  });
}

/* ── the marks invariant ────────────────────────────────────────────────── */

test("item marks sum EXACTLY to the paper total", () => {
  // "marks in the header always equal the sum of question marks" — an
  // invariant, not a hope, so the model can never produce a paper that fails it.
  for (const total of [5, 13, 20, 37, 40, 63, 100]) {
    const bp = blueprint({totalMarks: total});
    const items = bp.sections.flatMap((s) => s.items);
    const sum = items.reduce((n, i) => n + i.marks, 0);
    assert.equal(sum, total, `total ${total}`);
    assert.equal(bp.totalMarks, total, `blueprint.totalMarks for ${total}`);
    assert.deepEqual(validateBlueprint(bp), [], `blueprint invalid at ${total}`);
  }
});

test("every item carries at least one mark", () => {
  const bp = blueprint({totalMarks: 7});
  for (const item of bp.sections.flatMap((s) => s.items)) {
    assert.ok(item.marks >= 1, `item ${item.id} has ${item.marks} marks`);
  }
});

test("section marks sum to the paper total too", () => {
  const bp = blueprint({totalMarks: 55});
  assert.equal(bp.sections.reduce((n, s) => n + s.marks, 0), 55);
});

/* ── every item is tagged ───────────────────────────────────────────────── */

test("every item is tagged with topic, thinking level and difficulty up front", () => {
  const bp = blueprint();
  for (const item of bp.sections.flatMap((s) => s.items)) {
    assert.ok(item.topic, `${item.id} has no topic`);
    assert.ok(item.bloomLevel, `${item.id} has no bloomLevel`);
    assert.ok(item.difficulty, `${item.id} has no difficulty`);
    assert.ok(item.activityType, `${item.id} has no activityType`);
    assert.ok(item.renderType, `${item.id} has no renderType`);
    assert.equal(typeof item.figureRequired, "boolean");
  }
});

test("a learning outcome is attached when the curriculum has one, never invented", () => {
  const withOutcomes = blueprint({
    outcomesByTopic: {"Human Body": ["Name the parts of the human body"]},
  });
  const bodyItems = withOutcomes.sections
      .flatMap((s) => s.items).filter((i) => i.topic === "Human Body");
  assert.ok(bodyItems.length > 0);
  for (const item of bodyItems) {
    assert.equal(item.learningOutcome, "Name the parts of the human body");
  }
  // A topic the module has no outcomes for carries an EMPTY outcome rather than
  // a plausible-sounding fabrication.
  const plantItems = withOutcomes.sections
      .flatMap((s) => s.items).filter((i) => i.topic === "Plants");
  for (const item of plantItems) assert.equal(item.learningOutcome, "");
});

test("numbering is continuous from 1 across sections", () => {
  const bp = blueprint();
  const numbers = bp.sections.flatMap((s) => s.items).map((i) => i.number);
  assert.deepEqual(numbers, numbers.map((_, i) => i + 1));
});

/* ── interleaving + coverage ────────────────────────────────────────────── */

test("topics rotate rather than clustering", () => {
  // The deterministic version of "MIX THE TOPICS": consecutive items come from
  // different topics by construction, so no post-hoc re-order is needed.
  const bp = blueprint();
  const topics = bp.sections.flatMap((s) => s.items).map((i) => i.topic);
  let adjacentRepeats = 0;
  for (let i = 1; i < topics.length; i += 1) {
    if (topics[i] === topics[i - 1]) adjacentRepeats += 1;
  }
  // Section boundaries can repeat a topic; anything beyond that is clustering.
  assert.ok(adjacentRepeats <= 1, `${adjacentRepeats} adjacent repeats`);
});

test("every chosen topic is covered when there are enough questions", () => {
  const bp = blueprint();
  for (const topic of ["Human Body", "Plants", "Weather"]) {
    assert.ok(bp.coverage.topics[topic] > 0, `${topic} uncovered`);
  }
  assert.deepEqual(bp.coverage.uncoveredTopics, []);
});

test("more topics than questions is reported, not silently dropped", () => {
  const bp = buildPaperBlueprint({
    grade: "ECE_N", subject: "numeracy", assessmentType: "topic_test",
    totalMarks: 5, durationMinutes: 15,
    topics: ["A", "B", "C", "D", "E", "F", "G", "H"],
    band: ASSESSMENT_BAND_SEED.early_childhood,
    paperStructure: [],
  });
  assert.ok(bp.coverage.uncoveredTopics.length > 0);
  assert.ok(bp.warnings.some((w) => /not covered/i.test(w)));
});

test("the difficulty and thinking mixes follow the band", () => {
  const bp = blueprint({totalMarks: 60});
  const items = bp.sections.flatMap((s) => s.items);
  const tiers = bp.coverage.difficulty;
  assert.equal(Object.values(tiers).reduce((a, b) => a + b, 0), items.length);
  // Upper primary is 30/40/20/10, so recall must not dominate the paper.
  assert.ok(tiers.recall < items.length, "every item is recall");
  assert.ok((tiers.analysis || 0) > 0, "no analysis tier at all");
  const bloom = bp.coverage.bloom;
  assert.ok(Object.keys(bloom).length >= 2, "only one Bloom level used");
});

test("a teacher override replaces the band's difficulty mix", () => {
  const bp = blueprint({
    totalMarks: 40,
    difficultyMix: {recall: 1, understanding: 0, analysis: 0, challenge: 0},
  });
  assert.equal(bp.coverage.difficulty.recall, bp.itemCount);
  assert.equal(bp.coverage.difficulty.analysis, undefined);
});

/* ── the band is the ceiling ────────────────────────────────────────────── */

test("only activities the band permits appear in the blueprint", () => {
  const bp = buildPaperBlueprint({
    grade: "ECE_N", subject: "numeracy", assessmentType: "topic_test",
    totalMarks: 10, durationMinutes: 15,
    topics: ["Counting to ten"],
    // A stale client asking for an essay at Nursery.
    activityTypes: ["essay", "counting", "tracing"],
    band: ASSESSMENT_BAND_SEED.early_childhood,
    paperStructure: SECTIONS,
  });
  const used = new Set(bp.sections.flatMap((s) => s.items).map((i) => i.activityType));
  assert.ok(!used.has("essay"), "an essay reached a Nursery blueprint");
  for (const activity of used) {
    assert.ok(ASSESSMENT_BAND_SEED.early_childhood.questionTypes.includes(activity),
        `${activity} is not permitted at this level`);
  }
});

test("a band that does not use sections gets one plain run of questions", () => {
  // Printing "SECTION A" on a Nursery worksheet would be theatre.
  const bp = buildPaperBlueprint({
    grade: "ECE_N", subject: "numeracy", assessmentType: "topic_test",
    totalMarks: 10, durationMinutes: 15, topics: ["Counting"],
    band: ASSESSMENT_BAND_SEED.early_childhood, paperStructure: SECTIONS,
  });
  assert.equal(bp.sections.length, 1);
  assert.equal(bp.sections[0].name, "");
});

test("Early Childhood requires a figure on every single item", () => {
  const bp = buildPaperBlueprint({
    grade: "ECE_N", subject: "numeracy", assessmentType: "topic_test",
    totalMarks: 10, durationMinutes: 15, topics: ["Counting"],
    band: ASSESSMENT_BAND_SEED.early_childhood, paperStructure: [],
  });
  const items = bp.sections.flatMap((s) => s.items);
  assert.ok(items.every((i) => i.figureRequired),
      "a Nursery item can be answered without a picture");
  assert.equal(bp.coverage.figuresRequired, items.length);
});

test("the item cap for the band is respected", () => {
  const bp = buildPaperBlueprint({
    grade: "ECE_N", subject: "numeracy", assessmentType: "final_exam",
    totalMarks: 20, durationMinutes: 20, topics: ["Counting"],
    band: ASSESSMENT_BAND_SEED.early_childhood, paperStructure: [],
  });
  assert.ok(bp.itemCount <= ASSESSMENT_BAND_SEED.early_childhood.structure.maxItems);
});

/* ── duration ───────────────────────────────────────────────────────────── */

test("an unanswerable paper is flagged before it is generated", () => {
  const bp = blueprint({totalMarks: 100, durationMinutes: 20});
  assert.ok(bp.estimatedMinutes > 20);
  assert.ok(bp.warnings.some((w) => /minutes are allowed/.test(w)),
      "no duration warning on a 100-mark paper in 20 minutes");
});

test("a realistic paper carries no duration warning", () => {
  const bp = blueprint({totalMarks: 40, durationMinutes: 90});
  assert.ok(!bp.warnings.some((w) => /minutes are allowed/.test(w)));
});

/* ── validation refuses a broken blueprint ──────────────────────────────── */

test("validateBlueprint catches the ways a blueprint can be wrong", () => {
  assert.deepEqual(validateBlueprint(null), ["blueprint is not an object"]);
  const bp = blueprint();
  assert.ok(validateBlueprint({...bp, version: "nope"}).length > 0, "bad version");
  assert.ok(validateBlueprint({...bp, sections: []}).length > 0, "no sections");
  // The marks invariant is what a tampered client blueprint would break.
  const tampered = JSON.parse(JSON.stringify(bp));
  tampered.sections[0].items[0].marks += 5;
  assert.ok(validateBlueprint(tampered).some((p) => /sum to/.test(p)),
      "a marks mismatch was not caught");
  const renumbered = JSON.parse(JSON.stringify(bp));
  renumbered.sections[0].items[0].number = 99;
  assert.ok(validateBlueprint(renumbered).some((p) => /numbering/.test(p)));
});

/* ── the prompt directive ───────────────────────────────────────────────── */

test("the directive states every slot the model must fill", () => {
  const bp = blueprint({
    totalMarks: 20,
    outcomesByTopic: {"Human Body": ["Name the parts of the human body"]},
  });
  const text = renderBlueprintDirective(bp);
  assert.match(text, /PAPER BLUEPRINT/);
  assert.match(text, /Fill EVERY slot/);
  // Each slot names its marks, task, thinking level and topic.
  const first = bp.sections[0].items[0];
  assert.ok(text.includes(`Q${first.number}`));
  assert.ok(text.includes(`topic: ${first.topic}`));
  assert.ok(text.includes(`thinking: ${first.bloomLevel}`));
  assert.ok(text.includes(`difficulty: ${first.difficulty}`));
  assert.ok(text.includes("outcome: Name the parts of the human body"));
  // Every item appears — a slot the model is not told about is a slot it will
  // invent.
  for (const item of bp.sections.flatMap((s) => s.items)) {
    assert.ok(text.includes(`Q${item.number} `), `Q${item.number} missing`);
  }
});

test("no blueprint renders no directive", () => {
  assert.equal(renderBlueprintDirective(null), "");
});

/* ── helpers ────────────────────────────────────────────────────────────── */

test("splitEvenly always sums to the total", () => {
  for (const [total, count] of [[10, 3], [7, 7], [1, 1], [100, 7], [5, 2]]) {
    const parts = splitEvenly(total, count);
    assert.equal(parts.length, count);
    assert.equal(parts.reduce((a, b) => a + b, 0), total, `${total}/${count}`);
  }
  assert.deepEqual(splitEvenly(10, 0), []);
});

test("allocateByWeight always sums to the count", () => {
  const weights = {recall: 0.3, understanding: 0.4, analysis: 0.2, challenge: 0.1};
  for (const count of [1, 3, 7, 10, 23]) {
    const out = allocateByWeight(count, weights);
    assert.equal(Object.values(out).reduce((a, b) => a + b, 0), count, `count ${count}`);
  }
  assert.deepEqual(allocateByWeight(0, weights), {});
  assert.deepEqual(allocateByWeight(5, {}), {});
});

test("a zero-weight tier gets no items at all", () => {
  const out = allocateByWeight(10, {recall: 0.6, understanding: 0.4, analysis: 0});
  assert.equal(out.analysis, undefined);
  assert.equal(out.recall + out.understanding, 10);
});

test("the format hints parse", () => {
  assert.deepEqual(parseCountHint("6-10"), {min: 6, max: 10});
  assert.deepEqual(parseCountHint("8"), {min: 8, max: 8});
  assert.equal(parseCountHint("plenty"), null);
  assert.equal(parseMarksHint("1-2 marks each"), 1.5);
  assert.equal(parseMarksHint("3 marks"), 3);
  assert.equal(parseMarksHint(""), null);
});

console.log(`\n✓ paper blueprint — ${passed} tests passed`);
