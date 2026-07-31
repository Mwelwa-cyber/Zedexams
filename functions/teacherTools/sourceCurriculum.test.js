/**
 * Tests for the shared source-curriculum preservation gate used by the
 * TRANSFORMATION generators (reviseQuestion, suggestAnswer).
 *
 * Pure module (no firebase-functions), so this runs under plain `node`. It is
 * the single place the "a transformation must preserve — not default — its
 * source curriculum" rule is enforced, so the gate is tested directly here and
 * the callables' own tests prove they route through it.
 *
 * Run: node functions/teacherTools/sourceCurriculum.test.js
 */

const assert = require("node:assert");
const {
  normalizeCurriculum,
  checkSourceCurriculum,
  curriculumDirective,
  CURRICULUM_LABEL,
} = require("./sourceCurriculum");

let passed = 0;
function ok(label, cond) {
  assert.ok(cond, label);
  passed += 1;
  console.log(`  ✓ ${label}`);
}

console.log("normalizeCurriculum — accepts every repo spelling, else null");
{
  ok("cbc → cbc", normalizeCurriculum("cbc") === "cbc");
  ok("2023 → cbc", normalizeCurriculum("2023") === "cbc");
  ok("CBC (case) → cbc", normalizeCurriculum("CBC") === "cbc");
  ok("previous → previous", normalizeCurriculum("previous") === "previous");
  ok("obc → previous", normalizeCurriculum("obc") === "previous");
  ok("2013 → previous", normalizeCurriculum("2013") === "previous");
  ok("unknown → null", normalizeCurriculum("igcse") === null);
  ok("empty → null", normalizeCurriculum("") === null);
  ok("undefined → null", normalizeCurriculum(undefined) === null);
}

console.log("\ncheckSourceCurriculum — FAILS CLOSED (no default)");
{
  const bad = checkSourceCurriculum({subject: "history"});
  ok("missing curriculum → not ok", bad.ok === false);
  ok("missing curriculum → an error message", bad.errors.length >= 1 &&
    /curriculum/i.test(bad.errors.join(" ")));

  const noSubject = checkSourceCurriculum({curriculum: "cbc"});
  ok("missing subject → not ok", noSubject.ok === false);
  ok("missing subject → an error message", /subject/i.test(noSubject.errors.join(" ")));

  const unknown = checkSourceCurriculum({curriculum: "igcse", subject: "maths"});
  ok("unknown curriculum is NOT silently defaulted", unknown.ok === false && unknown.curriculum === null);
}

console.log("\ncheckSourceCurriculum — requireSubject:false (contextual-subject transformations)");
{
  // A lesson-section edit's subject is contextual, so the subject requirement
  // can be relaxed — but the CURRICULUM is ALWAYS strict.
  const noSubjectOk = checkSourceCurriculum({curriculum: "cbc"}, {requireSubject: false});
  ok("no subject is allowed when requireSubject:false", noSubjectOk.ok === true);
  const stillNeedsCurriculum = checkSourceCurriculum({subject: "history"}, {requireSubject: false});
  ok("curriculum is STILL required with requireSubject:false", stillNeedsCurriculum.ok === false);
}

console.log("\ncheckSourceCurriculum — passes with a valid source, normalising");
{
  const good = checkSourceCurriculum({curriculum: "2013", subject: " History "});
  ok("valid source → ok", good.ok === true && good.errors.length === 0);
  ok("curriculum normalised", good.curriculum === "previous");
  ok("subject trimmed", good.subject === "History");
}

console.log("\ncurriculumDirective — pins the model to the source, no cross-curriculum");
{
  const cbc = curriculumDirective({curriculum: "cbc", subject: "integrated_science"});
  ok("names the CBC syllabus", cbc.includes(CURRICULUM_LABEL.cbc));
  ok("names the subject (spaces, not underscores)", /integrated science/.test(cbc));
  ok("forbids other curricula explicitly", /do NOT introduce/i.test(cbc) &&
    /other curriculum/i.test(cbc));

  const prev = curriculumDirective({curriculum: "previous", subject: "history"});
  ok("previous syllabus names the 2013 label", prev.includes(CURRICULUM_LABEL.previous));
  ok("the two labels are distinct", CURRICULUM_LABEL.cbc !== CURRICULUM_LABEL.previous);
}

console.log(`\nAll sourceCurriculum tests passed (${passed} assertions).`);
