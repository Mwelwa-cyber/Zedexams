/**
 * Study Tips Generator — Anthropic tool-use schema.
 *
 * Mirrors `studyTipsContentSchema` in src/schemas/learnerAi.js.
 * Anthropic enforces this shape so the model only returns valid
 * structured tips.
 */

const tipSchema = {
  type: "object",
  required: ["tip", "reason", "topic", "priority", "estimatedMinutes"],
  properties: {
    tip: {type: "string"},
    reason: {type: "string"},
    topic: {type: "string"},
    subtopic: {type: "string"},
    priority: {type: "string", enum: ["high", "medium", "low"]},
    estimatedMinutes: {type: "integer", minimum: 2, maximum: 60},
  },
};

const recommendedQuizSchema = {
  type: "object",
  required: ["topic", "focus", "numQuestions", "difficulty"],
  properties: {
    topic: {type: "string"},
    subtopic: {type: "string"},
    focus: {type: "string"},
    numQuestions: {type: "integer", minimum: 3, maximum: 20},
    difficulty: {type: "string", enum: ["easy", "medium", "hard", "mixed"]},
  },
};

const revisionDaySchema = {
  type: "object",
  required: ["day", "focus", "activity", "estimatedMinutes"],
  properties: {
    day: {type: "integer", minimum: 1, maximum: 14},
    focus: {type: "string"},
    activity: {type: "string"},
    estimatedMinutes: {type: "integer", minimum: 5, maximum: 120},
  },
};

module.exports = {
  name: "study_tips_output",
  description:
    "Return personalised study tips for a Zambian school learner, " +
    "grounded in their weakness signals + the cited curriculum.",
  input_schema: {
    type: "object",
    required: ["title", "feedback", "tips"],
    properties: {
      title: {type: "string"},
      feedback: {type: "string"},
      tips: {
        type: "array",
        minItems: 1, maxItems: 15,
        items: tipSchema,
      },
      recommendedNotes: {
        type: "array",
        maxItems: 10,
        items: {type: "string"},
      },
      recommendedQuizzes: {
        type: "array",
        maxItems: 6,
        items: recommendedQuizSchema,
      },
      revisionPlan: {
        type: "array",
        maxItems: 14,
        items: revisionDaySchema,
      },
    },
  },
};
