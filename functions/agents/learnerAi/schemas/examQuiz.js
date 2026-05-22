module.exports = {
  name: "exam_quiz_output",
  description: "Return a CBC/ECZ-aligned exam draft grounded in cited excerpts.",
  input_schema: {
    type: "object",
    required: ["sections", "totalMarks"],
    properties: {
      sections: {
        type: "array",
        items: {
          type: "object",
          required: ["title", "items"],
          properties: {
            title: {type: "string"},
            durationMinutes: {type: "integer", minimum: 0},
            items: {
              type: "array",
              items: {
                type: "object",
                required: ["type", "prompt", "marks", "groundingIndex", "answerKey"],
                properties: {
                  type: {type: "string"},
                  prompt: {type: "string"},
                  marks: {type: "integer", minimum: 0},
                  answerKey: {type: "string"},
                  groundingIndex: {type: "integer", minimum: 0},
                  bloomsLevel: {type: "string"},
                },
              },
            },
          },
        },
      },
      totalMarks: {type: "integer", minimum: 0},
      durationMinutes: {type: "integer", minimum: 0},
    },
  },
};
