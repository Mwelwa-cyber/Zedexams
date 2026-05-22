module.exports = {
  name: "weakness_report_output",
  description: "Return a structured weakness report for one learner.",
  input_schema: {
    type: "object",
    required: ["weaknesses"],
    properties: {
      summary: {type: "string"},
      weaknesses: {
        type: "array",
        items: {
          type: "object",
          required: ["topic", "evidence", "nextStep", "groundingIndex"],
          properties: {
            topic: {type: "string"},
            subtopic: {type: "string"},
            evidence: {type: "string"},
            nextStep: {type: "string"},
            groundingIndex: {type: "integer", minimum: 0},
          },
        },
      },
    },
  },
};
