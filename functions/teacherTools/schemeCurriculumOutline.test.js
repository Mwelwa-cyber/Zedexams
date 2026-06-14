/**
 * Unit tests for the scheme-of-work curriculum outline (pure helpers).
 * Plain node: `node functions/teacherTools/schemeCurriculumOutline.test.js`
 */

const assert = require("node:assert/strict");
const {
  mapTopicSource,
  normalizeSource,
  subtopicName,
  buildOutlineFromTopics,
  renderOutlineBlock,
} = require("./schemeCurriculumOutline");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL  ${name}\n      ${err.message}`);
  }
}

const TOPICS = [
  {
    grade: "G4", subject: "integrated_science", topic: "4.1 THE HUMAN BODY",
    subtopics: [
      {name: "The Respiratory System", specificCompetence: "Describe breathing"},
      "The Circulatory System",
    ],
    specificOutcomes: ["Demonstrate understanding of the respiratory system"],
    keyCompetencies: ["Investigation"],
    suggestedMaterials: ["Charts", "Models"],
    _source: "syllabi_studio",
  },
  {
    grade: "G4", subject: "integrated_science", topic: "4.2 NUTRITION",
    subtopics: ["Food groups"],
    specificOutcomes: [],
    _source: "seed",
  },
  // Different grade — must be excluded.
  {
    grade: "G5", subject: "integrated_science", topic: "5.1 MATTER",
    subtopics: ["Solids"], _source: "syllabi_studio",
  },
  // Different subject — must be excluded.
  {
    grade: "G4", subject: "mathematics", topic: "4.1 SETS",
    subtopics: ["Union"], _source: "syllabi_studio",
  },
];

test("mapTopicSource collapses curriculum layers to syllabi_studio", () => {
  assert.equal(mapTopicSource("syllabi_studio"), "syllabi_studio");
  assert.equal(mapTopicSource("seed"), "syllabi_studio");
  assert.equal(mapTopicSource("firestore"), "syllabi_studio");
  assert.equal(mapTopicSource("private_curriculum"), "uploaded_module");
  assert.equal(mapTopicSource(undefined), "syllabi_studio");
});

test("normalizeSource maps synonyms + rejects junk", () => {
  assert.equal(normalizeSource("syllabi_studio"), "syllabi_studio");
  assert.equal(normalizeSource("Syllabus"), "syllabi_studio");
  assert.equal(normalizeSource("MODULE"), "uploaded_module");
  assert.equal(normalizeSource("ai"), "ai_inferred");
  assert.equal(normalizeSource("teacher"), "teacher");
  assert.equal(normalizeSource("something else"), "");
  assert.equal(normalizeSource(undefined), "");
});

test("subtopicName flattens strings and objects", () => {
  assert.equal(subtopicName("Plain"), "Plain");
  assert.equal(subtopicName({name: " Object name "}), "Object name");
  assert.equal(subtopicName(null), "");
});

test("buildOutlineFromTopics filters by grade+subject and counts", () => {
  const out = buildOutlineFromTopics(TOPICS, {
    grade: "G4", subject: "integrated_science",
  });
  assert.equal(out.topicCount, 2);
  assert.equal(out.subtopicCount, 3); // 2 + 1
  assert.deepEqual(out.topics[0].subtopics, [
    "The Respiratory System", "The Circulatory System",
  ]);
  assert.equal(out.topics[0].source, "syllabi_studio");
  assert.equal(out.topics[1].source, "syllabi_studio"); // seed → syllabi_studio
});

test("buildOutlineFromTopics tolerates 'G4' vs '4' via normalizeGrade", () => {
  const out = buildOutlineFromTopics(TOPICS, {
    grade: "4",
    subject: "integrated_science",
    normalizeGrade: (g) => (/^\d+$/.test(String(g)) ? `G${g}` : String(g)),
  });
  assert.equal(out.topicCount, 2);
});

test("buildOutlineFromTopics returns empty when no match", () => {
  const out = buildOutlineFromTopics(TOPICS, {
    grade: "G9", subject: "home_economics",
  });
  assert.equal(out.topicCount, 0);
  assert.equal(out.subtopicCount, 0);
  assert.deepEqual(out.topics, []);
});

test("renderOutlineBlock emits an authoritative block with topics", () => {
  const out = buildOutlineFromTopics(TOPICS, {
    grade: "G4", subject: "integrated_science",
  });
  const block = renderOutlineBlock(out, {
    grade: "G4", subjectLabel: "Integrated Science", term: 1,
  });
  assert.match(block, /<curriculum_outline>/);
  assert.match(block, /4\.1 THE HUMAN BODY/);
  assert.match(block, /The Respiratory System/);
  assert.match(block, /source: syllabi_studio/);
  assert.match(block, /<\/curriculum_outline>/);
});

test("renderOutlineBlock is empty for an empty outline", () => {
  assert.equal(renderOutlineBlock({topics: []}, {grade: "G4"}), "");
});

console.log(`\n─── ${passed + failed} tests · ${passed} passed · ${failed} failed ───`);
if (failed > 0) process.exit(1);
