/**
 * Exam Quiz Generator — Anthropic tool-use schema.
 *
 * Mirrors `examQuizContentSchema` in src/schemas/learnerAi.js but in
 * the JSON-Schema dialect Anthropic tool-use expects. The model emits
 * a full Zambian-school-test paper: printable header, three sections
 * (A: MCQ, B: short answer, C: structured), an answer key, and a
 * marking guide. Every question MUST carry `groundingIndex` so
 * Quality Check can substring-match against the cited excerpt.
 */

const structuredPartSchema = {
  type: "object",
  required: ["label", "prompt", "marks", "expectedAnswer"],
  properties: {
    label: {type: "string"},
    prompt: {type: "string"},
    marks: {type: "integer", minimum: 1, maximum: 20},
    expectedAnswer: {type: "string"},
    markingPoints: {
      type: "array",
      items: {type: "string"},
      maxItems: 8,
    },
  },
};

const examQuestionSchema = {
  type: "object",
  required: [
    "number", "questionType", "prompt", "marks",
    "groundingIndex", "bloomsLevel",
  ],
  properties: {
    number: {type: "integer", minimum: 1, maximum: 100},
    questionType: {
      type: "string",
      enum: ["mcq", "short_answer", "structured"],
    },
    prompt: {type: "string"},
    options: {
      type: "array",
      items: {type: "string"},
      maxItems: 6,
    },
    correctAnswer: {type: "string"},
    structuredParts: {
      type: "array",
      items: structuredPartSchema,
      maxItems: 6,
    },
    marks: {type: "integer", minimum: 1, maximum: 40},
    groundingIndex: {type: "integer", minimum: 0},
    bloomsLevel: {
      type: "string",
      enum: ["remember", "understand", "apply", "analyze", "evaluate", "create"],
    },
  },
};

module.exports = {
  name: "exam_quiz_output",
  description:
    "Return a formal Zambian school exam paper (Section A: MCQ, " +
    "Section B: Short Answer, Section C: Structured) grounded in " +
    "the cited curriculum excerpts. Include the printable header, " +
    "answer key, and marking guide.",
  input_schema: {
    type: "object",
    required: ["header", "sections", "answerKey", "markingGuide"],
    properties: {
      header: {
        type: "object",
        required: [
          "schoolName", "grade", "term", "year", "subject",
          "totalMarks", "timeAllowed", "instructions",
        ],
        properties: {
          schoolName: {type: "string"},
          grade: {type: "string"},
          term: {type: "string"},
          year: {type: "integer", minimum: 2020, maximum: 2099},
          subject: {type: "string"},
          paperName: {type: "string"},
          learnerNameLabel: {type: "string"},
          dateLabel: {type: "string"},
          timeLabel: {type: "string"},
          totalMarks: {type: "integer", minimum: 1, maximum: 500},
          timeAllowed: {type: "string"},
          instructions: {
            type: "array",
            items: {type: "string"},
            minItems: 1, maxItems: 12,
          },
        },
      },
      sections: {
        type: "array",
        minItems: 1, maxItems: 5,
        items: {
          type: "object",
          required: ["id", "title", "marks", "questions"],
          properties: {
            id: {type: "string", enum: ["A", "B", "C"]},
            title: {type: "string"},
            instructions: {type: "string"},
            marks: {type: "integer", minimum: 1, maximum: 200},
            questions: {
              type: "array",
              minItems: 1, maxItems: 50,
              items: examQuestionSchema,
            },
          },
        },
      },
      answerKey: {
        type: "array",
        minItems: 1, maxItems: 150,
        items: {
          type: "object",
          required: ["sectionId", "questionNumber", "answer", "marks"],
          properties: {
            sectionId: {type: "string", enum: ["A", "B", "C"]},
            questionNumber: {type: "integer", minimum: 1, maximum: 100},
            answer: {type: "string"},
            marks: {type: "integer", minimum: 1, maximum: 40},
            markingNotes: {type: "string"},
          },
        },
      },
      markingGuide: {type: "string"},
    },
  },
};
