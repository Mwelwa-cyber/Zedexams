module.exports = {
  name: "learner_notes_output",
  description: "Return learner-facing study notes grounded in cited excerpts.",
  input_schema: {
    type: "object",
    required: ["sections"],
    properties: {
      sections: {
        type: "array",
        items: {
          type: "object",
          required: ["heading", "paragraphs"],
          properties: {
            heading: {type: "string"},
            paragraphs: {
              type: "array",
              items: {
                type: "object",
                required: ["text", "groundingIndices"],
                properties: {
                  text: {type: "string"},
                  groundingIndices: {
                    type: "array",
                    items: {type: "integer", minimum: 0},
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};
