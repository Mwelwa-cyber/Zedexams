/**
 * Practice Quiz Generator — Anthropic tool-use schema.
 *
 * Mirrors `practiceQuizContentSchema` in src/schemas/learnerAi.js but
 * in the JSON-Schema dialect Anthropic tool-use expects. Anthropic
 * validates the model's output against this schema and only returns
 * a tool_use block with shape-correct input.
 *
 * `groundingIndex` is non-negotiable on every question — Quality Check
 * substring-matches the question text against the cited excerpt at
 * that index, refusing any quiz whose questions cite indices outside
 * the curriculumReader.citedExcerpts range.
 */

module.exports = {
  name: "practice_quiz_output",
  description:
    "Return a Zambian CBC-aligned practice quiz grounded in cited excerpts. " +
    "Each question MUST cite the curriculum excerpt it was derived from.",
  input_schema: {
    type: "object",
    required: [
      "title", "description", "mode", "difficulty",
      "totalMarks", "estimatedMinutes", "questions",
    ],
    properties: {
      title: {type: "string"},
      description: {type: "string"},
      mode: {type: "string", enum: ["topic", "subtopic", "lesson", "revision"]},
      difficulty: {type: "string", enum: ["easy", "medium", "hard", "mixed"]},
      totalMarks: {type: "integer", minimum: 1, maximum: 500},
      estimatedMinutes: {type: "integer", minimum: 1, maximum: 180},
      questions: {
        type: "array",
        minItems: 1,
        maxItems: 50,
        items: {
          type: "object",
          required: [
            "questionText", "questionType", "options", "correctAnswer",
            "explanation", "difficulty", "marks", "groundingIndex",
          ],
          properties: {
            questionText: {type: "string"},
            questionType: {
              type: "string",
              enum: ["mcq", "true_false", "short_answer", "matching"],
            },
            options: {
              type: "array",
              items: {type: "string"},
              maxItems: 6,
            },
            correctAnswer: {type: "string"},
            matchingPairs: {
              type: "array",
              maxItems: 8,
              items: {
                type: "object",
                required: ["left", "right"],
                properties: {
                  left: {type: "string"},
                  right: {type: "string"},
                },
              },
            },
            explanation: {type: "string"},
            difficulty: {type: "string", enum: ["easy", "medium", "hard"]},
            marks: {type: "integer", minimum: 1, maximum: 10},
            groundingIndex: {type: "integer", minimum: 0},
          },
        },
      },
    },
  },
};
