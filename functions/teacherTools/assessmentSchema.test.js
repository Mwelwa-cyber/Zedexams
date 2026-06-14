/**
 * Node test for the Assessment Studio output schema validator, focused on the
 * normalisation that keeps generated papers clean: stripping option-letter
 * prefixes, "SECTION X:" labels, and a duplicated name/date header from the
 * cover instructions.
 *
 * Run: node functions/teacherTools/assessmentSchema.test.js
 */

const assert = require("node:assert");
const {validateAssessment} = require("./assessmentSchema");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("assessmentSchema — normalisation");

function build(overrides = {}) {
  return validateAssessment({
    header: {
      title: "End of Term Test",
      grade: "4",
      subject: "Integrated Science",
      topic: "The human body",
      ...overrides.header,
    },
    sections: overrides.sections || [
      {
        title: "SECTION A: Multiple Choice",
        questions: [
          {
            number: 1,
            type: "multiple_choice",
            prompt: "The system that helps us breathe is the …",
            options: [
              "A. digestive system",
              "B) circulatory system",
              "C: respiratory system",
              "D - nervous system",
            ],
            answer: "C. respiratory system",
            marks: 1,
          },
        ],
      },
    ],
  });
}

// ── option-letter prefixes ──────────────────────────────────────────────
{
  const {ok: valid, value} = build();
  ok("payload validates", valid);
  const opts = value.sections[0].questions[0].options;
  ok("strips 'A. ' prefix", opts[0] === "digestive system");
  ok("strips 'B) ' prefix", opts[1] === "circulatory system");
  ok("strips 'C: ' prefix", opts[2] === "respiratory system");
  ok("strips 'D - ' prefix", opts[3] === "nervous system");
}

// Real content that merely starts with a capital letter is left alone.
{
  const {value} = build({
    sections: [
      {
        title: "Questions",
        questions: [
          {
            number: 1,
            type: "multiple_choice",
            prompt: "Pick one",
            options: ["Arteries", "A car is faster", "Bring it", "D"],
            answer: "Arteries",
            marks: 1,
          },
        ],
      },
    ],
  });
  const opts = value.sections[0].questions[0].options;
  ok("leaves 'Arteries' untouched", opts[0] === "Arteries");
  ok("leaves 'A car is faster' untouched", opts[1] === "A car is faster");
  ok("leaves a bare letter option untouched", opts[3] === "D");
}

// ── section-title labels ────────────────────────────────────────────────
{
  const {value} = build();
  ok("drops 'SECTION A:' from the title",
      value.sections[0].title === "Multiple Choice");
}
{
  const {value} = build({
    sections: [
      {
        title: "Sections of a plant",
        questions: [{number: 1, type: "short_answer", prompt: "Q", marks: 1}],
      },
    ],
  });
  ok("keeps a real title beginning with 'Sections'",
      value.sections[0].title === "Sections of a plant");
}

// ── cover instructions ──────────────────────────────────────────────────
{
  const {value} = build({
    header: {
      instructions:
        "NAME: ______ DATE: ______ TOTAL MARKS: ______ " +
        "INSTRUCTIONS: Answer ALL the questions.",
    },
  });
  ok("drops the duplicated name/date header from instructions",
      value.header.instructions === "Answer ALL the questions.");
}
{
  const {value} = build({
    header: {instructions: "Answer ALL questions. Show your working."},
  });
  ok("leaves normal instructions unchanged",
      value.header.instructions === "Answer ALL questions. Show your working.");
}

console.log(`\nassessmentSchema: ${passed} assertions passed`);
