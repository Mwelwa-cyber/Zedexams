module.exports = {
  name: "assessment_standards_output",
  description: "Return draft Zambian assessment standards.",
  input_schema: {
    type: "object",
    required: ["bloomsDistribution", "questionTypes"],
    properties: {
      bloomsDistribution: {
        type: "object",
        properties: {
          remember:   {type: "integer", minimum: 0, maximum: 100},
          understand: {type: "integer", minimum: 0, maximum: 100},
          apply:      {type: "integer", minimum: 0, maximum: 100},
          analyze:    {type: "integer", minimum: 0, maximum: 100},
          evaluate:   {type: "integer", minimum: 0, maximum: 100},
          create:     {type: "integer", minimum: 0, maximum: 100},
        },
      },
      questionTypes: {type: "array", items: {type: "string"}},
      durationMinutes: {type: "integer", minimum: 1, maximum: 360},
      totalMarks: {type: "integer", minimum: 1, maximum: 1000},
      markSchemeFormat: {type: "string"},
    },
  },
};
