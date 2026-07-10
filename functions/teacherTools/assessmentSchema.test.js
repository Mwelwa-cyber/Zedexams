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
  ok("schema version is 1.6", value.schemaVersion === "1.6");
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

// ── v1.6 fill_blanks ───────────────────────────────────────────────────────

// Valid fill_blanks question passes and is normalized.
{
  const {ok: valid, value} = validateAssessment({
    header: {
      title: "Science Test",
      grade: "4",
      subject: "Integrated Science",
      topic: "Human Body",
    },
    sections: [{
      title: "Fill in the blanks",
      questions: [{
        number: 1,
        type: "fill_blanks",
        prompt: "Fill in the blanks using the word bank.",
        // AI emits singular 'answer' per statement — must be mapped to 'answers' array.
        statements: [
          {text: "The heart pumps ____.", answer: "blood"},
          {text: "We breathe with our ____.", answer: "lungs"},
          {text: "We think with our ____.", answer: "brain"},
        ],
        wordBank: ["blood", "lungs", "brain", "bones"],
        marks: 3,
        answer: "blood; lungs; brain",
        markingGuide: "1 mark each blank.",
      }],
    }],
  });
  ok("fill_blanks payload validates", valid);
  const q = value.sections[0].questions[0];
  ok("fill_blanks type preserved", q.type === "fill_blanks");
  ok("statements are normalised to {text, answers} shape",
      Array.isArray(q.statements) && q.statements.length === 3);
  ok("singular answer is mapped to answers array",
      Array.isArray(q.statements[0].answers) &&
      q.statements[0].answers[0] === "blood");
  ok("wordBank is preserved", Array.isArray(q.wordBank) &&
      q.wordBank.includes("bones"));
  ok("marks are preserved from AI value", q.marks === 3);
  ok("prose answer survives for marking key", q.answer === "blood; lungs; brain");
  ok("schema version bumped to 1.6", value.schemaVersion === "1.6");
}

// Malformed fill_blanks (no blanks in any statement) degrades to short_answer.
{
  const {ok: valid, value} = validateAssessment({
    header: {
      title: "Science Test",
      grade: "4",
      subject: "Integrated Science",
      topic: "Plants",
    },
    sections: [{
      title: "Questions",
      questions: [
        {
          number: 1,
          type: "fill_blanks",
          prompt: "Complete the sentences.",
          // Statements with no blanks — degrade
          statements: [
            {text: "Plants make food through photosynthesis.", answer: ""},
          ],
          marks: 2,
          answer: "photosynthesis; sunlight",
          markingGuide: "Model answers given.",
        },
        {
          number: 2,
          type: "fill_blanks",
          prompt: "Fill in.",
          // No statements at all — degrade
          statements: [],
          marks: 1,
          answer: "water",
          markingGuide: "water",
        },
      ],
    }],
  });
  ok("malformed fill_blanks with no blanks still validates (degrades)",
      valid);
  const qs = value.sections[0].questions;
  ok("fill_blanks with no blanks degrades to short_answer",
      qs[0].type === "short_answer");
  ok("degraded question keeps its prose answer for the marking key",
      qs[0].answer === "photosynthesis; sunlight");
  ok("fill_blanks with empty statements degrades to short_answer",
      qs[1].type === "short_answer");
}

// fill_blanks: marks default to blank count when AI omits them.
{
  const {value} = validateAssessment({
    header: {
      title: "Test",
      grade: "4",
      subject: "Integrated Science",
      topic: "Hygiene",
    },
    sections: [{
      title: "Blanks",
      questions: [{
        number: 1,
        type: "fill_blanks",
        prompt: "Fill in.",
        statements: [
          {text: "We use ____ to wash our hands.", answer: "soap"},
          {text: "Dirt contains ____.", answer: "germs"},
        ],
        wordBank: ["soap", "germs", "water"],
        // marks intentionally omitted — should default to 2 (one per blank)
      }],
    }],
  });
  ok("fill_blanks marks default to total blank count (2)",
      value.sections[0].questions[0].marks === 2);
}

// Pre-v1.6 payload (no fill_blanks questions) validates unchanged.
{
  const {ok: valid, value} = build();
  ok("pre-1.6 payload without fill_blanks validates unchanged", valid);
  ok("schema version is still 1.6 for pre-1.6 payloads",
      value.schemaVersion === "1.6");
}

console.log(`\nassessmentSchema: ${passed} assertions passed`);
