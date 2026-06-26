/**
 * Plain-node test for functions/teacherTools/lessonPlanDocx.js.
 *
 * Builds .docx buffers for v3, v2, and v1 sample plans (none with a
 * lessonDiagram, so no network is touched) and asserts each is a non-empty
 * Buffer whose first two bytes are the "PK" zip/docx signature.
 *
 * Run directly:  node functions/teacherTools/lessonPlanDocx.test.js
 */

const assert = require("assert");
const { generateLessonPlanDocxBuffer } = require("./lessonPlanDocx");
const { sanitizeXmlText } = require("./xmlText");

function assertValidDocx(buf, label) {
  assert.ok(Buffer.isBuffer(buf), `${label}: expected a Buffer`);
  assert.ok(buf.length > 1000, `${label}: expected length > 1000, got ${buf.length}`);
  assert.strictEqual(buf[0], 0x50, `${label}: first byte should be 0x50 ('P')`);
  assert.strictEqual(buf[1], 0x4b, `${label}: second byte should be 0x4b ('K')`);
}

const v3Plan = {
  schemaVersion: "3.0",
  header: {
    school: "Lusaka Primary",
    teacherName: "Mr. Banda",
    subject: "Integrated Science",
    topic: "States of Matter",
    class: "Grade 5",
    durationMinutes: 40,
  },
  generalCompetences: ["Critical thinking", "Communication"],
  specificCompetence: "Classify substances as solids, liquids, or gases.",
  lessonGoal: "Learners distinguish the three states of matter.",
  stages: [
    {
      name: "Introduction",
      durationMinutes: 5,
      teacherActivities: ["Show ice melting", "Ask probing questions"],
      learnerActivities: ["Observe the demonstration", "Respond to questions"],
      assessmentCriteria: ["Names the three states"],
    },
    {
      name: "Development",
      durationMinutes: 25,
      teacherActivities: ["Guide a sorting activity"],
      learnerActivities: ["Sort objects by state"],
      assessmentCriteria: ["Sorts correctly"],
    },
  ],
  remedialWork: "Re-teach with extra examples for learners who struggled.",
};

const v2Plan = {
  schemaVersion: "2.0",
  header: {
    school: "Ndola Basic",
    teacherName: "Mrs. Phiri",
    subject: "Mathematics",
    topic: "Fractions",
    class: "Grade 6",
    durationMinutes: 40,
  },
  lessonGoal: "Add fractions with like denominators by the end of the lesson.",
  broadCompetences: ["Numeracy"],
  lessonCompetencies: {
    competency1: "Compare fraction sizes",
    competency2: "Apply addition rules",
    competency3: "Produce a fraction wall",
  },
  lessonProgression: {
    engagement: {
      durationMinutes: 5,
      teacherActivities: ["Pose a sharing problem"],
      learnerActivities: ["Suggest solutions"],
      assessmentCriteria: ["Engages with the problem"],
    },
    exploration: {
      durationMinutes: 15,
      teacherActivities: ["Model fraction addition"],
      learnerActivities: ["Practice in pairs"],
    },
  },
  assessment: { formative: ["Exit ticket"] },
  differentiation: { forStruggling: ["Use manipulatives"], forAdvanced: ["Unlike denominators"] },
};

const v1Plan = {
  header: {
    school: "Kitwe Primary",
    teacherName: "Mr. Mwale",
    subject: "English",
    topic: "Nouns",
    class: "Grade 4",
    durationMinutes: 35,
  },
  specificOutcomes: ["Identify common and proper nouns."],
  keyCompetencies: ["Communication"],
  values: ["Respect"],
  prerequisiteKnowledge: ["Recognises words"],
  teachingLearningMaterials: ["Flashcards"],
  lessonDevelopment: {
    introduction: {
      durationMinutes: 5,
      teacherActivities: ["Greet and review"],
      pupilActivities: ["Respond"],
    },
    development: [
      {
        stepNumber: 1,
        title: "Define nouns",
        durationMinutes: 15,
        teacherActivities: ["Explain with examples"],
        pupilActivities: ["Give their own examples"],
      },
    ],
    conclusion: {
      durationMinutes: 5,
      teacherActivities: ["Summarise"],
      pupilActivities: ["Recap"],
    },
  },
  assessment: { formative: ["Oral questions"] },
  differentiation: { forStruggling: ["Pair work"], forAdvanced: ["Extra sentences"] },
};

async function main() {
  const v3 = await generateLessonPlanDocxBuffer(v3Plan, {});
  assertValidDocx(v3, "v3");

  const v2 = await generateLessonPlanDocxBuffer(v2Plan, {});
  assertValidDocx(v2, "v2");

  const v1 = await generateLessonPlanDocxBuffer(v1Plan, {});
  assertValidDocx(v1, "v1");

  // No lessonDiagram on any plan above, so this path touched no network.
  // Also confirm the attribution (free-plan watermark) path builds.
  const v3Attr = await generateLessonPlanDocxBuffer(v3Plan, { attribution: true });
  assertValidDocx(v3Attr, "v3+attribution");

  // Corrupt-download regression: a plan carrying characters XML 1.0 forbids
  // (control bytes + a lone surrogate from a truncated emoji) silently produced
  // a .docx Word refused to open ("unreadable content" on desktop, "can't open
  // files that contain alternate formats" on Android). sanitizeXmlText now
  // strips them at the run-text funnel; assert it strips and that the dirty
  // plan still packs a valid .docx. The illegal chars are built via fromCharCode
  // so this source stays free of raw control bytes / lone surrogates.
  const cc = (n) => String.fromCharCode(n);
  assert.strictEqual(
    sanitizeXmlText(`a${cc(0)}b${cc(8)}c${cc(31)}d${cc(0x0b)}e`),
    "abcde",
    "sanitizeXmlText strips control bytes",
  );
  assert.strictEqual(
    sanitizeXmlText(`lone${cc(0xd83e)}high`),
    "lonehigh",
    "sanitizeXmlText strips a lone surrogate",
  );
  assert.strictEqual(
    sanitizeXmlText(`emoji ${cc(0xd83e)}${cc(0xdd85)} stays`),
    `emoji ${cc(0xd83e)}${cc(0xdd85)} stays`,
    "sanitizeXmlText keeps a whole emoji",
  );
  const dirtyPlan = {
    ...v3Plan,
    header: { ...v3Plan.header, subject: `Mathematics${cc(0)}`, topic: `Exploring My World${cc(0xd83e)}` },
    remedialWork: `Re-teach${cc(31)} the strugglers.`,
  };
  const dirty = await generateLessonPlanDocxBuffer(dirtyPlan, {});
  assertValidDocx(dirty, "dirty-plan");

  console.log("lessonPlanDocx.test.js: OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
