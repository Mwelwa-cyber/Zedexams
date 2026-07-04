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

// ── v1.5 topic + bloomLevel tags ────────────────────────────────────────
{
  const {value} = build({
    sections: [
      {
        title: "Questions",
        questions: [
          {
            number: 1, type: "short_answer", prompt: "Name two bones.",
            marks: 1, topic: "Human Body", bloomLevel: "Knowledge",
          },
          {
            number: 2, type: "short_answer", prompt: "Explain photosynthesis.",
            marks: 2, topic: "Plants", bloomLevel: "understand",
          },
          {
            number: 3, type: "short_answer", prompt: "Untagged.", marks: 1,
          },
        ],
      },
    ],
  });
  const qs = value.sections[0].questions;
  ok("carries the question topic through", qs[0].topic === "Human Body");
  ok("normalises bloomLevel 'Knowledge' → 'remember'",
      qs[0].bloomLevel === "remember");
  ok("normalises bloomLevel 'understand' → 'understand'",
      qs[1].bloomLevel === "understand");
  ok("leaves topic null when omitted", qs[2].topic === null);
  ok("leaves bloomLevel null when omitted", qs[2].bloomLevel === null);
  ok("schema version is 1.5", value.schemaVersion === "1.5");
}

// Junk tags degrade to null rather than corrupting the paper.
{
  const {value} = build({
    sections: [
      {
        title: "Questions",
        questions: [{
          number: 1, type: "short_answer", prompt: "Q", marks: 1,
          topic: 12345, bloomLevel: "wisdom",
        }],
      },
    ],
  });
  const q = value.sections[0].questions[0];
  ok("non-string topic degrades to null", q.topic === null);
  ok("unknown bloomLevel degrades to null", q.bloomLevel === null);
}

console.log(`\nassessmentSchema: ${passed} assertions passed`);
