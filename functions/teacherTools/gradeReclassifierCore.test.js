/**
 * Tests for the pure grade-reclassifier core (no firebase/fs deps).
 *
 * Run: node functions/teacherTools/gradeReclassifierCore.test.js
 */

const {
  normalizeGradeValue, normalizeTopicKey, buildGradeIndex, lookupGrade, decideGrade,
} = require("./gradeReclassifierCore");

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`);
  else { failures += 1; console.error(`  ✗ ${msg}`); }
}

console.log("normalizeGradeValue");
{
  assert(normalizeGradeValue("G4") === "4", "'G4' → '4'");
  assert(normalizeGradeValue("Grade 7") === "7", "'Grade 7' → '7'");
  assert(normalizeGradeValue(5) === "5", "number 5 → '5'");
  assert(normalizeGradeValue("7") === "7", "'7' stays '7'");
}

console.log("\nnormalizeTopicKey");
{
  assert(normalizeTopicKey("Mathematics", "Numbers to 10,000") === "mathematics|numbers to 10 000", "collapses case + punctuation");
  assert(normalizeTopicKey("integrated_science", "Living Things") === "integrated_science|living things", "already-canonical subject");
}

const TOPICS = [
  {subject: "mathematics", grade: "G4", topic: "Numbers to 10 000"},
  {subject: "mathematics", grade: "G6", topic: "Fractions"},
  {subject: "mathematics", grade: "G5", topic: "Fractions"}, // spans grades
  {subject: "integrated_science", grade: "G7", topic: "Photosynthesis"},
];

console.log("\nbuildGradeIndex + lookupGrade");
{
  const idx = buildGradeIndex(TOPICS);
  assert(lookupGrade(idx, "Mathematics", "Numbers to 10,000").grade === "4", "unique syllabus match → grade 4 (case/punct-insensitive)");
  assert(lookupGrade(idx, "integrated science", "photosynthesis").grade === "7", "subject normalised on lookup");
  const amb = lookupGrade(idx, "mathematics", "Fractions");
  assert(amb.grade === null && amb.ambiguous === true, "topic spanning grades → ambiguous, no grade");
  assert(lookupGrade(idx, "mathematics", "Trigonometry").grade === null, "unmatched topic → null");
  assert(lookupGrade(idx, "mathematics", "").grade === null, "empty topic → null");
}

console.log("\ndecideGrade — precedence syllabus > ai > unchanged");
{
  assert(decideGrade({storedGrade: "7", lookup: {grade: "4"}, aiGrade: "6"}).method === "syllabus", "unique syllabus wins");
  assert(decideGrade({storedGrade: "7", lookup: {grade: "4"}}).grade === "4", "and uses the syllabus grade");
  const ai = decideGrade({storedGrade: "G7", lookup: {grade: null}, aiGrade: "5"});
  assert(ai.method === "ai" && ai.grade === "5", "no syllabus match → AI grade");
  const keep = decideGrade({storedGrade: "Grade 7", lookup: {grade: null}});
  assert(keep.method === "unchanged" && keep.grade === "7", "no syllabus + no AI → keep stored (normalised)");
  const badAi = decideGrade({storedGrade: "7", lookup: {grade: null}, aiGrade: "12"});
  assert(badAi.method === "unchanged", "out-of-range AI grade is ignored → keep stored");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nAll gradeReclassifierCore tests passed.");
