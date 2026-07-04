/**
 * Unit tests for schemeTermDivision (server) — term slicing of the outline.
 * Run: node functions/teacherTools/schemeTermDivision.test.js
 */

const {
  divideTopicsByTerm,
  topicsForTerm,
  sliceOutlineToTerm,
  estimateTopicWeeks,
} = require("./schemeTermDivision");

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${msg}`);
  }
}

const OUTLINE = {
  topicCount: 9,
  subtopicCount: 18,
  topics: [
    {topic: "4.1 THE HUMAN BODY", subtopics: ["Parts", "Senses", "Hygiene"], source: "syllabi_studio"},
    {topic: "4.2 PLANTS", subtopics: ["Roots", "Leaves"], source: "syllabi_studio"},
    {topic: "4.3 MATTER", subtopics: ["Solids", "Liquids"], source: "syllabi_studio"},
    {topic: "4.4 ENERGY", subtopics: ["Heat", "Light", "Sound", "Motion"], source: "syllabi_studio"},
    {topic: "4.5 FORCES", subtopics: ["Push", "Pull"], source: "syllabi_studio"},
    {topic: "4.6 ELECTRICITY", subtopics: ["Circuits", "Cells"], source: "syllabi_studio"},
    {topic: "4.7 EARTH", subtopics: ["Soil", "Rocks"], source: "syllabi_studio"},
    {topic: "4.8 WATER", subtopics: ["Cycle", "Sources"], source: "syllabi_studio"},
    {topic: "4.9 WEATHER", subtopics: ["Elements", "Seasons"], source: "syllabi_studio"},
  ],
};

console.log("divideTopicsByTerm — no restart");
{
  const {byTerm} = divideTopicsByTerm(OUTLINE.topics, {weeksByTerm: {1: 4, 2: 4, 3: 4}});
  assert(byTerm[1][0].topic === "4.1 THE HUMAN BODY", "Term 1 starts at the first topic");
  assert(byTerm[2].length > 0 && byTerm[2][0].topic !== "4.1 THE HUMAN BODY",
      "Term 2 does not restart at the first topic");
  const all = [...byTerm[1], ...byTerm[2], ...byTerm[3]].map((t) => t.topic);
  assert(new Set(all).size === all.length, "no topic repeats across terms");
}

console.log("sliceOutlineToTerm");
{
  const t1 = sliceOutlineToTerm(OUTLINE, 1, {weeksByTerm: {1: 4, 2: 4, 3: 4}});
  const t2 = sliceOutlineToTerm(OUTLINE, 2, {weeksByTerm: {1: 4, 2: 4, 3: 4}});
  assert(t1.topicCount > 0, "Term 1 slice has topics");
  assert(t1.topicCount < OUTLINE.topicCount, "Term 1 slice is smaller than the full outline");
  assert(t1.topics[0].topic === "4.1 THE HUMAN BODY", "Term 1 slice keeps the first topic");
  assert(t2.topics[0].topic !== "4.1 THE HUMAN BODY", "Term 2 slice does NOT include the first topic");
  // The union of the three slices equals the full outline (nothing dropped).
  const union = [1, 2, 3].flatMap((n) =>
    sliceOutlineToTerm(OUTLINE, n, {weeksByTerm: {1: 4, 2: 4, 3: 4}}).topics.map((t) => t.topic));
  assert(new Set(union).size === OUTLINE.topicCount, "the three slices cover every topic exactly once");
  assert(t1.subtopicCount === t1.topics.reduce((n, t) => n + t.subtopics.length, 0),
      "sliced subtopicCount recomputed");
}

console.log("sliceOutlineToTerm — empty / AI-inferred outline passes through");
{
  const empty = {topicCount: 0, subtopicCount: 0, topics: []};
  assert(sliceOutlineToTerm(empty, 2) === empty, "empty outline returned unchanged");
}

console.log("estimateTopicWeeks parity");
{
  assert(estimateTopicWeeks({subtopics: []}) === 1, "no sub-topics → 1 week");
  assert(estimateTopicWeeks({subtopics: ["a", "b", "c", "d"]}) === 2, "four sub-topics → 2 weeks");
}

console.log(failures === 0 ?
  "\nAll schemeTermDivision (server) tests passed." :
  `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
