/**
 * Node test for the per-question AI edit helpers (editQuizQuestion callable).
 * Run: node functions/editQuizQuestion.test.js
 */

const assert = require("node:assert");
// Import the PURE module (no firebase-functions / firebase-admin) so this test
// runs under CI's root-only `npm ci`. aiService.js re-exports these same
// helpers (wrapping parseEditedQuestion's Error in an HttpsError).
const {
  buildEditQuestionMessages,
  parseEditedQuestion,
  isEditQuestionAction,
} = require("./editQuestionPrompt");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("editQuizQuestion");

// ── Action allow-list ─────────────────────────────────────────────────────
ok("simplify is a known action", isEditQuestionAction("simplify"));
ok("suggest_answer is a known action", isEditQuestionAction("suggest_answer"));
ok("explain is a known action", isEditQuestionAction("explain"));
ok("unknown action is rejected", isEditQuestionAction("delete_everything") === false);
ok("empty action is rejected", isEditQuestionAction("") === false);
ok("prototype keys are rejected", isEditQuestionAction("toString") === false);

// ── Message builder ───────────────────────────────────────────────────────
const messages = buildEditQuestionMessages({
  action: "simplify",
  question: "What is 3/4 of 200?",
  options: ["150", "50", "100", "75"],
  correctAnswer: "A",
  subject: "Mathematics",
  grade: "7",
  topic: "Fractions",
});
ok("builds a system + user message", Array.isArray(messages) && messages.length === 2);
ok("system prompt teaches the maths markup", /\\frac/.test(messages[0].content));
ok("system prompt forbids 'all of the above'", /all of the above/i.test(messages[0].content));
ok("user prompt carries the question", messages[1].content.includes("What is 3/4 of 200?"));
ok("user prompt labels options A–D", /A\. 150/.test(messages[1].content));
ok("user prompt includes the grade/subject context", /Grade 7, Mathematics, Fractions/.test(messages[1].content));

// An unknown/missing action falls back to a safe default instruction, never crashes.
const fallback = buildEditQuestionMessages({action: "", question: "Q", options: []});
ok("missing action still builds messages", Array.isArray(fallback) && fallback.length === 2);

// Picture-free questions keep a plain-string user turn (back-compat).
ok("user content is a plain string without images", typeof messages[1].content === "string");

// ── Vision: a question with a picture builds a multimodal user turn ─────────
const HTTPS_IMG = "https://firebasestorage.googleapis.com/v0/b/x/o/diagram.png?alt=media&token=z";
const withImage = buildEditQuestionMessages({
  action: "suggest_answer",
  question: "Which shape is shown?",
  options: ["Circle", "Square", "Triangle", "Star"],
  imageUrl: HTTPS_IMG,
  optionImages: ["", HTTPS_IMG],
  passageImageUrl: "blob:should-be-dropped",
});
ok("user content becomes an array when a picture is attached", Array.isArray(withImage[1].content));
ok("first block is the question text", withImage[1].content[0].type === "text" && /Which shape/.test(withImage[1].content[0].text));
ok("text block warns the model not to claim it cannot see", /cannot see them/i.test(withImage[1].content[0].text));
ok("an image block uses an https url source", withImage[1].content.some(b => b.type === "image" && b.source.url === HTTPS_IMG));
ok("blob: passage url is dropped", !withImage[1].content.some(b => b.type === "image" && b.source.url.startsWith("blob:")));

// ── Response parser ───────────────────────────────────────────────────────
const full = parseEditedQuestion(JSON.stringify({
  text: "What is \\frac{3}{4} of 200?",
  options: ["150", "50", "100", "75"],
  correctAnswer: "A",
  explanation: "Three quarters of 200 is 150.",
  note: "Simplified the wording.",
}));
ok("parses revised text (markup preserved)", full.text.includes("\\frac{3}{4}"));
ok("parses options", Array.isArray(full.options) && full.options.length === 4);
ok("parses correct answer letter", full.correctAnswer === "A");
ok("parses explanation", full.explanation.startsWith("Three quarters"));
ok("parses note", full.note === "Simplified the wording.");

// Only-changed-fields: explanation-only response yields a patch with just that.
const explainOnly = parseEditedQuestion(JSON.stringify({explanation: "Because 4 is the LCM."}));
ok("explanation-only patch has explanation", explainOnly.explanation === "Because 4 is the LCM.");
ok("explanation-only patch omits text", !("text" in explainOnly));
ok("explanation-only patch omits options", !("options" in explainOnly));

// Empty strings are dropped, never applied as blanks over a teacher's field.
const blanks = parseEditedQuestion(JSON.stringify({text: "   ", options: ["", " "], explanation: ""}));
ok("blank text dropped", !("text" in blanks));
ok("all-blank options dropped", !("options" in blanks));
ok("blank explanation dropped", !("explanation" in blanks));

// Fenced / non-JSON responses are surfaced, not silently swallowed.
let threw = false;
try {
  parseEditedQuestion("Sorry, I cannot do that.");
} catch (err) {
  threw = true;
}
ok("non-JSON response throws (caller shows a clean error)", threw);

// A markdown-fenced JSON body is still parsed (models sometimes add fences).
const fenced = parseEditedQuestion("```json\n{\"explanation\":\"ok\"}\n```");
ok("fenced JSON is parsed", fenced.explanation === "ok");

console.log(`\n─── ${passed} assertions · all passed ───`);
