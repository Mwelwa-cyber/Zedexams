module.exports = {
  name: "learner_feedback_output",
  description: "Return age-appropriate learner feedback grounded in cited excerpts.",
  input_schema: {
    type: "object",
    required: ["message"],
    properties: {
      message: {type: "string"},
      strengths: {type: "array", items: {type: "string"}},
      developing: {type: "array", items: {type: "string"}},
      nextSteps: {type: "array", items: {type: "string"}},
      groundingIndices: {type: "array", items: {type: "integer", minimum: 0}},
    },
  },
};
