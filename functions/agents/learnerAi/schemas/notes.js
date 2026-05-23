/**
 * Notes Generator — Anthropic tool-use schema.
 *
 * Mirrors `notesContentSchema` in src/schemas/learnerAi.js. Anthropic
 * validates the model's tool_use input against this schema and only
 * returns shape-correct output.
 */

module.exports = {
  name: "learner_notes_output",
  description:
    "Return learner-facing study notes for a single Zambian CBC " +
    "topic. Notes MUST be grounded in the cited curriculum excerpts; " +
    "every fact you state should be traceable to <cited_excerpts>.",
  input_schema: {
    type: "object",
    required: [
      "title", "shortExplanation", "keyVocabulary", "importantFacts",
      "examples", "summary", "rememberThis", "quickRevision",
    ],
    properties: {
      title: {type: "string"},
      shortExplanation: {type: "string"},
      keyVocabulary: {
        type: "array",
        minItems: 0, maxItems: 15,
        items: {
          type: "object",
          required: ["term", "definition"],
          properties: {
            term: {type: "string"},
            definition: {type: "string"},
          },
        },
      },
      importantFacts: {
        type: "array",
        minItems: 0, maxItems: 20,
        items: {type: "string"},
      },
      examples: {
        type: "array",
        minItems: 0, maxItems: 8,
        items: {
          type: "object",
          required: ["title", "explanation"],
          properties: {
            title: {type: "string"},
            explanation: {type: "string"},
          },
        },
      },
      summary: {type: "string"},
      rememberThis: {
        type: "array",
        minItems: 0, maxItems: 10,
        items: {type: "string"},
      },
      diagramSuggestions: {
        type: "array",
        minItems: 0, maxItems: 8,
        items: {type: "string"},
      },
      quickRevision: {
        type: "array",
        minItems: 0, maxItems: 12,
        items: {type: "string"},
      },
      estimatedReadingMinutes: {
        type: "integer", minimum: 1, maximum: 120,
      },
    },
  },
};
