module.exports = {
  name: "quality_check_output",
  description: "Return pedagogy + clarity scores for a learner-AI artifact.",
  input_schema: {
    type: "object",
    required: ["verdict", "scores"],
    properties: {
      verdict: {type: "string", enum: ["pass", "warn", "fail"]},
      scores: {
        type: "object",
        properties: {
          clarity: {type: "integer", minimum: 0, maximum: 100},
          age_appropriateness: {type: "integer", minimum: 0, maximum: 100},
          cbc_alignment: {type: "integer", minimum: 0, maximum: 100},
          options_quality: {type: "integer", minimum: 0, maximum: 100},
          cultural_fit: {type: "integer", minimum: 0, maximum: 100},
        },
      },
      blockers: {type: "array", items: {type: "string"}},
      warnings: {type: "array", items: {type: "string"}},
      summary: {type: "string"},
    },
  },
};
