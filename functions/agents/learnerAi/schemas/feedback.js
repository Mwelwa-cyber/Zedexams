/**
 * Learner Feedback Generator — Anthropic tool-use schema.
 * Mirrors learnerFeedbackContentSchema in src/schemas/learnerAi.js.
 */

const correctiveSchema = {
  type: "object",
  required: ["topic", "whatToCorrect", "briefExplanation"],
  properties: {
    topic: {type: "string"},
    subtopic: {type: "string"},
    whatToCorrect: {type: "string"},
    briefExplanation: {type: "string"},
  },
};

const recommendedQuizSchema = {
  type: "object",
  required: ["topic", "focus", "numQuestions", "difficulty"],
  properties: {
    topic: {type: "string"},
    subtopic: {type: "string"},
    focus: {type: "string"},
    numQuestions: {type: "integer", minimum: 3, maximum: 15},
    difficulty: {type: "string", enum: ["easy", "medium", "hard", "mixed"]},
  },
};

module.exports = {
  name: "learner_feedback_output",
  description:
    "Return honest, encouraging, age-appropriate post-quiz feedback for " +
    "a Zambian school learner. Grounded in the learner's actual score + " +
    "weakness signals + cited curriculum excerpts.",
  input_schema: {
    type: "object",
    required: ["title", "tone", "encouragingMessage", "strengths", "weakAreas"],
    properties: {
      title: {type: "string"},
      tone: {
        type: "string",
        enum: ["celebratory", "positive", "balanced", "supportive", "gentle"],
      },
      encouragingMessage: {type: "string"},
      strengths: {
        type: "array", maxItems: 10,
        items: {type: "string"},
      },
      weakAreas: {
        type: "array", maxItems: 10,
        items: {type: "string"},
      },
      correctiveExplanations: {
        type: "array", maxItems: 8,
        items: correctiveSchema,
      },
      recommendedNotes: {
        type: "array", maxItems: 6,
        items: {type: "string"},
      },
      recommendedQuizzes: {
        type: "array", maxItems: 4,
        items: recommendedQuizSchema,
      },
      studyTip: {type: "string"},
    },
  },
};
