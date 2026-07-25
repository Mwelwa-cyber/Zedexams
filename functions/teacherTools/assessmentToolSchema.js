/**
 * assessmentToolSchema — the structured contract the model emits a paper through.
 *
 * §3.2: "Pass the blueprint as a hard constraint using tool-forced structured
 * output. Each generated item returns its own metadata … Never ask the model for a
 * free-form paper and parse it afterwards."
 *
 * The paper was already emitted through a tool call, but the tool's schema was
 * `{header: object}` with `additionalProperties: true` — which is to say, no
 * contract at all. Everything that made an item usable (its topic, its thinking
 * level, its difficulty, its marks, its outcome, why each wrong option is wrong)
 * was ASKED FOR IN PROSE and then hoped for. A model that skipped a tag produced a
 * paper that validated, saved, and then read "no cognitive levels tagged yet" in
 * the analysis panel.
 *
 * So the metadata is `required` here. An item cannot be emitted without saying what
 * it assesses and how hard it is. The prose in assessmentPromptV10 still explains
 * how to fill each field well; this makes the fields non-optional.
 *
 * Two deliberate looseneses:
 *
 *   - `additionalProperties: true` on a question. The eight render types carry
 *     different extra fields (matching's left/right/pairs, fill_blanks' statements
 *     and wordBank, structured's parts, the visual spec) and enumerating all of
 *     them here would duplicate assessmentSchema.js — which validates the result
 *     properly afterwards, and is the single place that knows the paper's shape.
 *   - `distractorRationale` is optional, because only choice questions have
 *     distractors. The prompt requires it for those; a short-answer question
 *     legitimately omits it.
 *
 * This schema constrains what the model EMITS. validateAssessment still validates
 * what arrives — a contract at the boundary does not remove the need to check.
 */

"use strict";

/** The eight render structures assessmentSchema.js can validate. */
const RENDER_TYPES = [
  "multiple_choice", "short_answer", "structured", "calculation",
  "true_false", "essay", "matching", "fill_blanks",
];

/** Bloom levels, in the generator's own (British) spelling. */
const BLOOM_LEVELS = [
  "remember", "understand", "apply", "analyse", "evaluate", "create",
];

/** The four blueprint difficulty tiers. */
const DIFFICULTY_TIERS = ["recall", "understanding", "analysis", "challenge"];

const QUESTION_SCHEMA = {
  type: "object",
  // See the file header: the per-type extras live in assessmentSchema.js.
  additionalProperties: true,
  required: [
    "type", "prompt", "marks", "answer", "markingGuide",
    "topic", "bloomLevel", "difficulty", "activityType", "learningOutcome",
  ],
  properties: {
    type: {
      type: "string", enum: RENDER_TYPES,
      description: "How the question is laid out — its blueprint slot states which.",
    },
    activityType: {
      type: "string",
      description:
        "The TASK this item is, from the permitted tasks for this level " +
        "(\"tracing\", \"picture_matching\", …). Use the plain type name when the " +
        "item is just that type. Kept with the question; \"type\" is only layout.",
    },
    prompt: {
      type: "string", maxLength: 2000,
      description: "The question as the learner reads it.",
    },
    marks: {
      type: "integer", minimum: 1, maximum: 50,
      description: "EXACTLY the marks this question's blueprint slot states.",
    },
    answer: {
      type: "string", maxLength: 2000,
      description:
        "The correct answer in full. For picture options, the correct LETTER.",
    },
    markingGuide: {
      type: "string", maxLength: 2000,
      description:
        "What earns each mark, acceptable alternatives, and the expected " +
        "working for a calculation.",
    },
    markingPoints: {
      type: "array", maxItems: 12, items: {type: "string", maxLength: 300},
      description:
        "The separate things that earn the marks — a 2-mark question names two. " +
        "This is what makes the marking scheme checkable against the marks.",
    },
    topic: {
      type: "string", maxLength: 160,
      description:
        "The topic this question assesses, copied from its blueprint slot.",
    },
    bloomLevel: {
      type: "string", enum: BLOOM_LEVELS,
      description: "Its cognitive level — its blueprint slot states which.",
    },
    difficulty: {
      type: "string", enum: DIFFICULTY_TIERS,
      description: "How demanding it is — its blueprint slot states which.",
    },
    learningOutcome: {
      type: "string", maxLength: 300,
      description:
        "The syllabus outcome it targets — COPY the one its blueprint slot " +
        "gives, or \"\" when the slot gives none. NEVER write an outcome the " +
        "syllabus does not contain.",
    },
    distractorRationale: {
      type: "array", maxItems: 8, items: {type: "string", maxLength: 300},
      description:
        "Choice questions only: one line per WRONG option naming the real " +
        "learner error it represents, e.g. \"Root: learners confuse anchorage " +
        "with reproduction\". Same order as \"options\".",
    },
    options: {
      type: "array", maxItems: 8, items: {type: "string", maxLength: 300},
      description: "Answer choices, for multiple_choice and true_false only.",
    },
    number: {
      type: "integer", minimum: 1,
      description: "Its number on the paper, from its blueprint slot.",
    },
    diagram: {
      type: "string", maxLength: 500,
      description: "A brief of the figure this question needs, if it needs one.",
    },
  },
};

const SECTION_SCHEMA = {
  type: "object",
  additionalProperties: true,
  required: ["questions"],
  properties: {
    title: {type: "string", maxLength: 200},
    instructions: {type: "string", maxLength: 500},
    questions: {
      type: "array", minItems: 1, maxItems: 80, items: QUESTION_SCHEMA,
    },
  },
};

const HEADER_SCHEMA = {
  type: "object",
  additionalProperties: true,
  required: ["title", "totalMarks"],
  properties: {
    title: {type: "string", maxLength: 200},
    grade: {type: "string", maxLength: 20},
    subject: {type: "string", maxLength: 60},
    topic: {type: "string", maxLength: 200},
    durationMinutes: {type: "integer", minimum: 1, maximum: 300},
    totalMarks: {
      type: "integer", minimum: 1, maximum: 200,
      description:
        "The sum of every question's marks — the blueprint's total. The header " +
        "and the questions must agree.",
    },
    instructions: {type: "string", maxLength: 1000},
  },
};

const ASSESSMENT_TOOL_SCHEMA = {
  type: "object",
  description:
    "A formal graded Zambian CBC assessment, filling every slot of the paper " +
    "blueprint exactly as specified.",
  additionalProperties: true,
  required: ["header", "sections"],
  properties: {
    header: HEADER_SCHEMA,
    sections: {
      type: "array", minItems: 1, maxItems: 12, items: SECTION_SCHEMA,
    },
    markingScheme: {
      type: "object", additionalProperties: true,
      properties: {notes: {type: "string", maxLength: 2000}},
    },
  },
};

module.exports = {
  ASSESSMENT_TOOL_SCHEMA,
  QUESTION_SCHEMA,
  SECTION_SCHEMA,
  HEADER_SCHEMA,
  RENDER_TYPES,
  BLOOM_LEVELS,
  DIFFICULTY_TIERS,
};
