/**
 * Anthropic tool-use schema for practice quiz output.
 *
 * Each question must include `groundingIndex` — the index into
 * curriculumRef.citedExcerpts that the question is grounded in. Quality
 * Check uses this index to substring-match the question against the
 * cited excerpt's text.
 */

module.exports = {
  name: "practice_quiz_output",
  description: "Return a CBC-aligned practice quiz grounded in cited excerpts.",
  input_schema: {
    type: "object",
    required: ["questions"],
    properties: {
      questions: {
        type: "array",
        minItems: 0,
        maxItems: 20,
        items: {
          type: "object",
          required: ["type", "prompt", "groundingIndex", "answer"],
          properties: {
            type: {type: "string", enum: ["mcq", "short_answer", "true_false"]},
            prompt: {type: "string"},
            options: {
              type: "array",
              items: {type: "string"},
              maxItems: 6,
            },
            answer: {type: "string"},
            explanation: {type: "string"},
            groundingIndex: {type: "integer", minimum: 0},
          },
        },
      },
    },
  },
};
