module.exports = {
  name: "study_tips_output",
  description: "Return learner study tips grounded in cited excerpts.",
  input_schema: {
    type: "object",
    required: ["tips"],
    properties: {
      tips: {
        type: "array",
        items: {
          type: "object",
          required: ["text", "groundingIndex"],
          properties: {
            text: {type: "string"},
            groundingIndex: {type: "integer", minimum: 0},
          },
        },
      },
    },
  },
};
