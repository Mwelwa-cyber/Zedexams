/**
 * assessmentPlanning tests — one plan, and a plan from a browser is not trusted.
 *
 * Two things must hold for §3.1 to be honest:
 *
 *   1. The blueprint the CONFIRMATION screen shows and the blueprint the
 *      GENERATOR is bound by are produced by the same code from the same inputs.
 *      Tested by building both through the shared entry point and comparing.
 *   2. A blueprint arriving from a client is re-checked before it constrains
 *      anything. A teacher who nudged the difficulty spread gets their plan; a
 *      payload that puts an essay on a Nursery paper, changes the marks, or
 *      claims a different subject does not.
 *
 * Plain `node` script. firebase-admin and the Firestore-backed resolvers are
 * stubbed via Module._load before the module under test loads (same pattern as
 * generateAssessment.test.js).
 *
 * Run: node functions/teacherTools/assessmentPlanning.test.js
 */

const assert = require("node:assert");
const Module = require("node:module");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

// ── Stubs ────────────────────────────────────────────────────────────────
const COVERED = {
  topics: ["Fractions", "Decimals", "Shapes"],
  outcomesByTopic: {
    Fractions: ["Add fractions with the same denominator"],
    Decimals: ["Read and write decimals to two places"],
  },
  competencies: ["Number sense", "Measurement"],
  count: 3,
};
let coverageResult = COVERED;
let formatContextResult = {
  formatBlock: "",
  formatProfileId: "test",
  formatSource: "seed",
  paperStructure: [],
};

const originalLoad = Module._load;
Module._load = function stubbedLoad(request, parent, isMain) {
  if (request === "firebase-admin") {
    return {firestore: () => ({collection: () => ({get: async () => ({forEach: () => {}})})})};
  }
  if (request === "./cbcKnowledge") {
    return {
      resolveGradeSubjectCoverage: async () => coverageResult,
      resolveCbcContext: async () => ({}),
      classifySubjectForGrade: () => "unknown",
    };
  }
  if (request === "./assessmentFormats") {
    const real = originalLoad.call(this, request, parent, isMain);
    return {...real, resolveAssessmentFormatContext: async () => formatContextResult};
  }
  return originalLoad.call(this, request, parent, isMain);
};

const planning = require("./assessmentPlanning");
const {ASSESSMENT_BAND_SEED} = require("./assessmentBandsCore");
const {BLUEPRINT_VERSION} = require("./paperBlueprint");

Module._load = originalLoad;

const {
  planPaper, buildBlueprintForRequest, acceptClientBlueprint,
  resolvePermittedActivities, splitTopicList, blueprintItems,
} = planning;

// ASSESSMENT_BAND_SEED is keyed by band id (the published defaults the resolver
// falls back to when the Firestore collection is empty, which it is here).
const EARLY_CHILDHOOD = ASSESSMENT_BAND_SEED.early_childhood;
const SENIOR_SECONDARY = ASSESSMENT_BAND_SEED.senior_secondary;

function inputs(over = {}) {
  return {
    grade: "G4",
    subject: "mathematics",
    framework: "2023",
    assessmentType: "topic_test",
    totalMarks: 20,
    durationMinutes: 40,
    topic: "Fractions; Decimals",
    subtopic: "",
    questionTypes: ["multiple_choice", "short_answer"],
    requestedBandTypes: ["multiple_choice", "short_answer"],
    difficultyMix: null,
    ...over,
  };
}

/* ── splitTopicList ─────────────────────────────────────────────────────── */

console.log("\n— topic list —");
ok("the studio's joined topic string splits on semicolons and newlines",
    JSON.stringify(splitTopicList("Fractions; Decimals\nShapes")) ===
    JSON.stringify(["Fractions", "Decimals", "Shapes"]));
ok("duplicates and blanks are dropped, case-insensitively",
    JSON.stringify(splitTopicList("Fractions;; fractions ;Shapes")) ===
    JSON.stringify(["Fractions", "Shapes"]));
ok("nothing in, nothing out", splitTopicList("").length === 0 &&
    splitTopicList(null).length === 0);

/* ── the band ceiling ───────────────────────────────────────────────────── */

console.log("\n— the band is the ceiling —");
{
  const {permitted} = resolvePermittedActivities({
    band: EARLY_CHILDHOOD, requestedBandTypes: ["essay"], questionTypes: ["essay"],
  });
  ok("an activity the level forbids does not survive", !permitted.includes("essay"));
  ok("…and the level's own activities are used instead, never the request's",
      permitted.length > 0 && permitted.every((a) => EARLY_CHILDHOOD.questionTypes.includes(a)));
}
{
  const {permitted, effectiveTypes} = resolvePermittedActivities({
    band: SENIOR_SECONDARY,
    requestedBandTypes: ["essay", "structured"],
    questionTypes: ["essay", "structured"],
  });
  ok("an activity the level permits survives", permitted.includes("essay"));
  ok("…and converts to a render type the schema knows",
      effectiveTypes.includes("essay"));
}
ok("no band means no opinion — the request stands",
    resolvePermittedActivities({
      band: null, requestedBandTypes: [], questionTypes: ["essay"],
    }).permitted.includes("essay"));

/* ── one plan, not two ──────────────────────────────────────────────────── */

console.log("\n— the plan the teacher sees is the plan the model gets —");
(async () => {
  const planned = await planPaper({inputs: inputs(), gradeLabel: "Grade 4"});
  ok("planning a real request succeeds", planned.ok && planned.blueprint);
  ok("the plan's marks equal the marks asked for",
      planned.blueprint.totalMarks === 20);
  ok("every slot is tagged with a topic and a thinking level",
      blueprintItems(planned.blueprint).every((i) => i.topic && i.bloomLevel));
  ok("the plan quotes a real outcome from the verified syllabus",
      blueprintItems(planned.blueprint).some((i) =>
        i.learningOutcome === "Add fractions with the same denominator"));

  // The generator resolves its own band + format profile alongside its CBC
  // context, then calls buildBlueprintForRequest. If that produced a DIFFERENT
  // plan from planPaper's, the teacher would confirm one paper and get another.
  const regenerated = buildBlueprintForRequest({
    inputs: inputs(),
    band: planned.band,
    paperStructure: planned.formatContext.paperStructure || [],
    coverage: COVERED,
    totalMarks: 20,
    gradeLabel: "Grade 4",
  });
  ok("the generator's blueprint is identical to the one the teacher confirmed",
      JSON.stringify(regenerated) === JSON.stringify(planned.blueprint));

  /* ── §3.5 refusal, at the plan step ─────────────────────────────────── */

  console.log("\n— no syllabus, no plan —");
  coverageResult = {topics: [], outcomesByTopic: {}, competencies: [], count: 0};
  const refused = await planPaper({inputs: inputs(), gradeLabel: "Grade 4"});
  ok("a grade+subject with no approved syllabus refuses to plan", !refused.ok);
  ok("…and says why, in a code the caller can act on",
      refused.refusal && refused.refusal.code === "NO_SYLLABUS_CONTENT");
  ok("…and produces no blueprint at all", refused.blueprint === null);
  coverageResult = COVERED;

  /* ── a blueprint from a browser is an input ─────────────────────────── */

  console.log("\n— a confirmed plan is re-checked, not trusted —");
  const good = await planPaper({inputs: inputs(), gradeLabel: "Grade 4"});
  const base = {candidate: good.blueprint, inputs: inputs(), band: good.band, expectedMarks: 20};

  ok("the plan the teacher confirmed is accepted",
      acceptClientBlueprint(base).accepted);

  ok("no plan at all is simply absent, not an error",
      acceptClientBlueprint({...base, candidate: null}).reason === "absent");

  ok("an unknown blueprint version is refused",
      acceptClientBlueprint({
        ...base, candidate: {...good.blueprint, version: "blueprint.v99"},
      }).reason === "version");

  ok("a plan whose marks no longer add up is refused",
      acceptClientBlueprint({...base, expectedMarks: 40}).reason === "marks");

  {
    // Marks tampered inside the plan: the header would print one number and the
    // questions would add to another.
    const tampered = JSON.parse(JSON.stringify(good.blueprint));
    tampered.sections[0].items[0].marks += 5;
    ok("a plan edited so its items no longer sum to its total is refused",
        acceptClientBlueprint({...base, candidate: tampered}).reason === "unsound");
  }

  {
    const wrongSubject = {...good.blueprint, subject: "english"};
    ok("a plan for a different subject is refused",
        acceptClientBlueprint({...base, candidate: wrongSubject}).reason ===
        "mismatch:subject");
  }
  {
    const wrongGrade = {...good.blueprint, grade: "G12"};
    ok("a plan for a different level is refused",
        acceptClientBlueprint({...base, candidate: wrongGrade}).reason ===
        "mismatch:grade");
  }
  {
    const wrongType = {...good.blueprint, assessmentType: "final_exam"};
    ok("a plan for a different assessment type is refused",
        acceptClientBlueprint({...base, candidate: wrongType}).reason ===
        "mismatch:assessmentType");
  }
  {
    // The one that matters most: a hand-edited payload must not be able to put
    // an activity on a paper that the level forbids.
    const smuggled = JSON.parse(JSON.stringify(good.blueprint));
    smuggled.sections[0].items[0].activityType = "essay";
    smuggled.sections[0].items[0].renderType = "essay";
    const verdict = acceptClientBlueprint({
      ...base, candidate: smuggled, band: EARLY_CHILDHOOD,
    });
    ok("a plan smuggling an activity the level forbids is refused",
        !verdict.accepted && verdict.reason === "activity:essay");
  }
  {
    // …and the same activity IS allowed where the band permits it, so the check
    // is the band's opinion rather than a blanket ban.
    const senior = JSON.parse(JSON.stringify(good.blueprint));
    senior.sections[0].items[0].activityType = "essay";
    senior.sections[0].items[0].renderType = "essay";
    ok("…while the same plan is accepted at a level that permits it",
        acceptClientBlueprint({...base, candidate: senior, band: SENIOR_SECONDARY}).accepted);
  }

  /* ── the teacher's adjustment survives ──────────────────────────────── */

  console.log("\n— the teacher's adjustment is honoured —");
  const harder = await planPaper({
    inputs: inputs({difficultyMix: {recall: 0.1, understanding: 0.2, analysis: 0.3, challenge: 0.4}}),
    gradeLabel: "Grade 4",
  });
  const hardCount = blueprintItems(harder.blueprint)
      .filter((i) => i.difficulty === "challenge").length;
  const normalCount = blueprintItems(good.blueprint)
      .filter((i) => i.difficulty === "challenge").length;
  ok("asking for a harder spread produces more demanding questions",
      hardCount > normalCount);
  ok("…and the marks still reconcile exactly",
      harder.blueprint.totalMarks === 20 &&
      blueprintItems(harder.blueprint).reduce((n, i) => n + i.marks, 0) === 20);
  ok("…and the adjusted plan is accepted back from the client",
      acceptClientBlueprint({
        candidate: harder.blueprint,
        inputs: inputs({difficultyMix: {challenge: 0.4}}),
        band: harder.band,
        expectedMarks: 20,
      }).accepted);

  /* ── the band still governs the plan ────────────────────────────────── */

  console.log("\n— a plan for the youngest learners —");
  const ece = await planPaper({
    inputs: inputs({
      grade: "ECE_N", totalMarks: 8, durationMinutes: 15,
      questionTypes: ["multiple_choice"], requestedBandTypes: ["picture_identification"],
    }),
    gradeLabel: "Nursery",
  });
  ok("a Nursery plan is built", ece.ok && ece.blueprint);
  ok("…with no essay anywhere in it",
      blueprintItems(ece.blueprint).every((i) => i.activityType !== "essay"));
  ok("…and every question needing something to look at",
      blueprintItems(ece.blueprint).every((i) => i.figureRequired));
  ok("…and the level's own version marker on it",
      ece.blueprint.version === BLUEPRINT_VERSION);

  ok("a level with no sections plans one plain run of questions",
      (await planPaper({inputs: inputs({grade: "G2"}), gradeLabel: "Grade 2"}))
          .blueprint.sections.length === 1);

  ok("a Grade 4 paper resolves to a real band, from the published defaults",
      good.band && ASSESSMENT_BAND_SEED[good.band.id]);

  console.log(`\n${passed} passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
