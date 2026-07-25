/**
 * regenerateQuestionCore — the pure half of single-question regeneration (§3.6).
 *
 * Sanitising the request, describing the slot to the model, and pulling one
 * validated question back out. No firebase, no network, so all of it unit-tests
 * under plain `node` — which matters here because the failure mode is subtle: a
 * regeneration that quietly returns a question worth different marks, or on a
 * different topic, unbalances a paper the teacher already approved.
 *
 * The slot is the contract. Whatever the model writes, the marks, topic,
 * sub-topic, outcome, thinking level and structure of the replacement are the
 * slot's — the model supplies wording, options, answer and marking guide.
 */

"use strict";

const {ACTIVITIES} = require("./assessmentBandsCore");

const ACTIVITY_IDS = new Set(ACTIVITIES.map((a) => a.id));
const RENDER_TYPES = new Set([
  "multiple_choice", "short_answer", "structured", "calculation",
  "true_false", "essay", "matching", "fill_blanks",
]);
const BLOOM_LEVELS = new Set([
  "remember", "understand", "apply", "analyse", "analyze", "evaluate", "create",
]);
const TIERS = new Set(["recall", "understanding", "analysis", "challenge"]);

function str(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/**
 * Sanitise the blueprint slot the replacement must satisfy.
 *
 * The slot arrives from the client (it is part of the saved paper's plan), so
 * every field is re-checked. A slot that does not describe a real question —
 * no marks, or a structure nothing can render — is rejected rather than guessed
 * at: regenerating against a nonsense slot would produce a question that cannot
 * be placed back on the paper.
 *
 * @returns {?object} the clean slot, or null when it is unusable
 */
function sanitizeSlot(raw) {
  if (!raw || typeof raw !== "object") return null;
  const marks = Math.round(Number(raw.marks));
  if (!Number.isInteger(marks) || marks < 1 || marks > 50) return null;

  const renderType = str(raw.renderType, 40).toLowerCase();
  const activityType = str(raw.activityType, 40).toLowerCase();
  const resolvedRender = RENDER_TYPES.has(renderType) ? renderType : "";
  if (!resolvedRender) return null;

  const bloomLevel = str(raw.bloomLevel, 20).toLowerCase();
  const difficulty = str(raw.difficulty, 20).toLowerCase();
  return {
    number: Number.isInteger(Number(raw.number)) && Number(raw.number) > 0 ?
      Number(raw.number) : 1,
    marks,
    renderType: resolvedRender,
    activityType: ACTIVITY_IDS.has(activityType) ? activityType : resolvedRender,
    activityLabel: str(raw.activityLabel, 60),
    topic: str(raw.topic, 160),
    subtopic: str(raw.subtopic, 200),
    learningOutcome: str(raw.learningOutcome, 300),
    bloomLevel: BLOOM_LEVELS.has(bloomLevel) ? bloomLevel : "understand",
    difficulty: TIERS.has(difficulty) ? difficulty : "understanding",
    figureRequired: Boolean(raw.figureRequired),
  };
}

/** Sanitise the whole regeneration request. */
function sanitizeRegenerateInputs(raw = {}) {
  const grade = str(raw.grade, 10).toUpperCase().replace(/\s+/g, "");
  const subject = str(raw.subject, 40).toLowerCase().replace(/[^a-z_]/g, "_");
  return {
    grade,
    subject,
    framework: String(raw.framework) === "2013" ? "2013" : "2023",
    assessmentType: str(raw.assessmentType, 30).toLowerCase() || "topic_test",
    slot: sanitizeSlot(raw.slot),
    // What is on the paper now — given to the model so the replacement is a
    // genuinely different question rather than a paraphrase of the same one.
    currentText: str(raw.currentText, 1200),
    // The other questions' stems, so the replacement does not duplicate one.
    avoid: (Array.isArray(raw.avoid) ? raw.avoid : [])
        .map((t) => str(t, 200)).filter(Boolean).slice(0, 20),
    // Optional steer from the teacher ("make it about money", "too easy").
    guidance: str(raw.guidance, 300),
  };
}

/** Problems that must stop the request before any model call. */
function validateRegenerateInputs(inputs) {
  const errs = [];
  if (!inputs.grade) errs.push("Please select a valid grade.");
  if (!inputs.subject) errs.push("Please select a supported subject.");
  if (!inputs.slot) {
    errs.push(
        "This question's place on the paper could not be read, so it cannot " +
      "be rewritten on its own.",
    );
  }
  return errs;
}

/**
 * The tool schema for ONE question.
 *
 * Strict (`additionalProperties: false`) and with the metadata REQUIRED, not
 * requested in prose: §3.2's point is that a structured contract is the
 * constraint. A single item is where that is cheapest to enforce, so it is
 * enforced here properly.
 */
const QUESTION_TOOL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["prompt", "answer", "markingGuide"],
  properties: {
    prompt: {type: "string", maxLength: 2000,
      description: "The question as the learner reads it."},
    options: {
      type: "array", maxItems: 6, items: {type: "string", maxLength: 300},
      description:
        "Answer choices, for multiple-choice or true/false only. Omit otherwise.",
    },
    answer: {type: "string", maxLength: 2000,
      description: "The correct answer, in full."},
    markingGuide: {type: "string", maxLength: 2000,
      description: "How a marker awards the marks for this question."},
    markingPoints: {
      type: "array", maxItems: 10, items: {type: "string", maxLength: 300},
      description: "One marking point per mark, where the marks divide.",
    },
    distractorRationale: {
      type: "array", maxItems: 6, items: {type: "string", maxLength: 300},
      description:
        "For each wrong option, the learner misconception that would lead to " +
        "it. Same order as options. Omit for non-choice questions.",
    },
    diagram: {type: "string", maxLength: 500,
      description:
        "A brief of the figure this question needs, if it needs one."},
    left: {type: "array", maxItems: 6, items: {type: "string", maxLength: 200}},
    right: {type: "array", maxItems: 8, items: {type: "string", maxLength: 200}},
    pairs: {type: "array", maxItems: 6, items: {type: "integer"}},
  },
};

/**
 * The instruction for one replacement question.
 *
 * Deliberately narrow. The model is not being asked to write a paper, or to
 * decide what this question should be worth, or what it should assess — all of
 * that is settled. It is being asked for a different question in a fixed slot.
 */
function buildRegeneratePrompt(inputs, {gradeLabel = "", subjectLabel = ""} = {}) {
  const {slot} = inputs;
  const lines = [];
  lines.push(
      `Write ONE replacement question for a ${subjectLabel || inputs.subject} ` +
    `${gradeLabel || inputs.grade} assessment.`,
  );
  lines.push("");
  lines.push("THE SLOT THIS QUESTION MUST FILL — none of this is yours to change:");
  lines.push(`- Worth exactly ${slot.marks} mark${slot.marks === 1 ? "" : "s"}.`);
  lines.push(`- Question structure: ${slot.renderType}.`);
  if (slot.activityLabel || slot.activityType !== slot.renderType) {
    lines.push(`- Task: ${slot.activityLabel || slot.activityType}.`);
  }
  if (slot.topic) lines.push(`- Topic: ${slot.topic}.`);
  if (slot.subtopic) lines.push(`- Sub-topic: ${slot.subtopic}.`);
  if (slot.learningOutcome) {
    lines.push(`- Syllabus outcome it assesses: ${slot.learningOutcome}.`);
  }
  lines.push(`- Thinking level: ${slot.bloomLevel}.`);
  lines.push(`- Difficulty: ${slot.difficulty}.`);
  if (slot.figureRequired) {
    lines.push("- It needs a figure; describe the figure in \"diagram\".");
  }

  if (inputs.currentText) {
    lines.push("");
    lines.push(
        "THE QUESTION BEING REPLACED — write something genuinely different, not " +
      "a rewording of it:",
    );
    lines.push(inputs.currentText);
  }

  if (inputs.avoid.length > 0) {
    lines.push("");
    lines.push("ALREADY ON THIS PAPER — do not duplicate or near-duplicate any of these:");
    for (const stem of inputs.avoid) lines.push(`- ${stem}`);
  }

  if (inputs.guidance) {
    lines.push("");
    lines.push(`THE TEACHER ASKS: ${inputs.guidance}`);
  }

  lines.push("");
  if (slot.renderType === "multiple_choice" || slot.renderType === "true_false") {
    lines.push(
        "Give the answer choices in \"options\", with exactly one correct. Every " +
      "wrong option must be a mistake a learner at this level would actually " +
      "make — a misread of the question, a common misconception, a plausible " +
      "wrong method — never a filler value nobody would choose. Explain each " +
      "wrong option in \"distractorRationale\", in the same order as \"options\".",
    );
  }
  lines.push(
      `Divide the ${slot.marks} mark${slot.marks === 1 ? "" : "s"} in ` +
    "\"markingPoints\", one point per mark.",
  );
  return lines.join("\n");
}

/**
 * Wrap one model-emitted question in the smallest valid assessment so the
 * paper's own validator checks it, then hand the validated question back.
 *
 * Reusing validateAssessment rather than writing a second validator is the whole
 * point: a question regenerated in place must be exactly as trustworthy as one
 * generated with the paper, and two validators would drift.
 *
 * @param {function} validateAssessment the real validator, injected
 * @returns {{ok: boolean, question: ?object, errors: string[]}}
 */
function extractSingleQuestion(validateAssessment, raw, slot) {
  if (!raw || typeof raw !== "object") {
    return {ok: false, question: null, errors: ["The AI returned nothing usable."]};
  }
  const candidate = {
    ...raw,
    number: slot.number,
    type: slot.renderType,
    activityType: slot.activityType,
    // The slot's values, not the model's — see the file header.
    marks: slot.marks,
    topic: slot.topic || null,
    bloomLevel: slot.bloomLevel,
    difficulty: slot.difficulty,
    learningOutcome: slot.learningOutcome || null,
  };
  const wrapped = {
    header: {title: "Regeneration", totalMarks: slot.marks},
    sections: [{title: "A", questions: [candidate]}],
  };
  const result = validateAssessment(wrapped);
  const question = result.value && Array.isArray(result.value.sections) &&
    result.value.sections[0] && Array.isArray(result.value.sections[0].questions) ?
    result.value.sections[0].questions[0] : null;
  if (!question) {
    return {
      ok: false, question: null,
      errors: result.errors && result.errors.length ?
        result.errors : ["The AI returned nothing usable."],
    };
  }
  // A replacement whose stem is missing is worse than no replacement: it would
  // blank a question the teacher already had.
  if (!question.prompt || question.prompt === "(missing question)") {
    return {
      ok: false, question: null,
      errors: ["The AI returned an empty question."],
    };
  }
  // The slot's marks are restored even if the validator recomputed them from
  // sub-parts — the paper's header total depends on this being exact.
  question.marks = slot.marks;
  return {ok: true, question, errors: result.errors || []};
}

module.exports = {
  sanitizeSlot,
  sanitizeRegenerateInputs,
  validateRegenerateInputs,
  buildRegeneratePrompt,
  extractSingleQuestion,
  QUESTION_TOOL_SCHEMA,
};
