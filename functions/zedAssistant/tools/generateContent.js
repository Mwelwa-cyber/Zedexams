/**
 * Lightweight content generator for chat-surface use.
 *
 * The full teacher tools (lesson-plan, worksheet, scheme-of-work, etc.) are
 * already wired in functions/teacherTools/* and produce structured JSON for
 * the in-app teacher UI. Those are NOT a great fit for a Telegram chat —
 * they require auth context, return huge JSON payloads, and meter against a
 * teacher's quota.
 *
 * This tool is a chat-friendly alternative: it emits plain-text, CBC-aligned
 * content (quiz questions, worksheet outlines, lesson-plan sketches) inline
 * in the assistant reply. It's a passthrough to the model — the assistant
 * itself is what generates the content; this tool just enforces the shape
 * and tags so output stays Grade 4–6 / CBC-aligned without the user having
 * to repeat that on every message.
 */

const definition = {
  name: "generate_content",
  description:
    "Generate CBC-aligned learning content (quiz questions, worksheets, " +
    "lesson-plan outlines) for Grade 4–6 directly in the chat reply. Use " +
    "when the user asks to create or draft content. Returns a structured " +
    "spec the assistant should expand into the final reply — DO NOT just " +
    "echo this spec verbatim, treat it as a brief and write the actual " +
    "content in your next turn.",
  input_schema: {
    type: "object",
    properties: {
      contentType: {
        type: "string",
        enum: ["quiz", "worksheet", "lesson_plan", "questions"],
        description: "What to produce.",
      },
      grade: {
        type: "string",
        enum: ["4", "5", "6"],
        description: "Target grade — must be 4, 5, or 6.",
      },
      subject: {
        type: "string",
        maxLength: 80,
        description:
          "Subject. Common values: Mathematics, English, Science, Social " +
          "Studies, ICT, Religious Education, Zambian Languages.",
      },
      topic: {
        type: "string",
        maxLength: 200,
        description: "Specific CBC topic or sub-topic.",
      },
      count: {
        type: "integer",
        minimum: 1,
        maximum: 20,
        description: "Number of items (questions, worksheet sections, etc.).",
      },
      notes: {
        type: "string",
        maxLength: 400,
        description: "Optional extra constraints (difficulty, format, etc.).",
      },
    },
    required: ["contentType", "grade", "subject", "topic"],
  },
};

function buildSpec(input) {
  const grade = String(input.grade);
  const subject = String(input.subject || "").trim();
  const topic = String(input.topic || "").trim();
  const count = Math.max(1, Math.min(20, Number(input.count) || 5));
  const notes = String(input.notes || "").trim();
  const contentType = input.contentType;

  const guardrails = [
    "Zambian CBC alignment — vocabulary, spelling, examples must match " +
      "Grade " + grade + " curriculum and local context.",
    "Age-appropriate language. No jargon a Grade " + grade + " learner " +
      "wouldn't understand.",
    "Mark each item or section with the CBC sub-topic it covers, when " +
      "possible.",
  ];

  let shape;
  switch (contentType) {
    case "quiz":
      shape =
        `Produce ${count} multiple-choice questions. Each: question stem, ` +
        "4 options (A–D), the correct letter, and a one-line explanation. " +
        "Mix MCQ difficulty: some recall, some application.";
      break;
    case "questions":
      shape =
        `Produce ${count} short-answer questions. Each: the question, the ` +
        "expected answer (one sentence), and the marking note for partial " +
        "credit.";
      break;
    case "worksheet":
      shape =
        `Produce a worksheet with ${count} sections. Each section: a clear ` +
        "heading, 2–4 practice items, and (where relevant) a small " +
        "diagram description the teacher can sketch on the board.";
      break;
    case "lesson_plan":
      shape =
        "Produce a one-period (40 min) lesson plan: objective, key " +
        "competency, materials, lesson stages (intro / development / " +
        "practice / wrap-up) with time allocations, and 3 assessment " +
        "questions for the end of class.";
      break;
    default:
      shape = "Produce the requested content in a clear, scannable format.";
  }

  return {
    contentType,
    grade,
    subject,
    topic,
    count,
    notes: notes || null,
    guardrails,
    shape,
    instructionToAssistant:
      "Write the actual content in your next reply. Keep formatting tight " +
      "for Telegram — short headings, no markdown tables. Total reply " +
      "should fit in ~3000 characters; if longer, the runtime will split " +
      "it into multiple messages automatically.",
  };
}

function run(input = {}) {
  if (!input.contentType) throw new Error("contentType is required.");
  if (!["4", "5", "6"].includes(String(input.grade))) {
    throw new Error("grade must be 4, 5, or 6.");
  }
  if (!input.subject || !input.topic) {
    throw new Error("subject and topic are required.");
  }
  return buildSpec(input);
}

module.exports = {definition, run};
