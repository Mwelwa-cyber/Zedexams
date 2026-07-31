/**
 * Pure input/prompt logic for the reviseQuestion callable.
 *
 * Extracted from reviseQuestion.js so it can be unit-tested under plain `node`
 * without pulling in firebase-functions (the same pattern as
 * editQuestionPrompt.js). No side effects, no requires.
 */

const ALLOWED_GRADES = new Set([
  "ECE", "ECE_N", "ECE_R", "G1", "G2", "G3", "G4", "G5", "G6", "G7",
  "G8", "G9", "G10", "G11", "G12",
]);

const ALLOWED_LANGUAGES = new Set([
  "english", "bemba", "nyanja", "tonga", "lozi", "kaonde", "lunda", "luvale",
]);

// "polish" is the odd one out: unlike easier/harder/simpler it must NOT change
// the difficulty or grade — it only fixes grammar, spelling, and clarity. The
// prompt enforces that distinction (see buildUserPrompt).
const ALLOWED_MODIFIERS = new Set(["easier", "harder", "simpler", "polish"]);

// Trim + length-cap a string field. Crucially this does NOT strip internal
// spaces — an earlier version replaced every space, which silently mangled the
// question text ("Define the term" → "Definetheterm") before it reached the
// model. Short code-like fields (grade/subject/language) do their own
// space-stripping in sanitizeInputs where that's actually wanted.
function str(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function sanitizeInputs(raw = {}) {
  const text = str(raw.text, 2000);
  const fromGrade = str(raw.fromGrade, 10).toUpperCase().replace(/\s+/g, "");
  const toGrade = str(raw.toGrade, 10).toUpperCase().replace(/\s+/g, "");
  const subject = str(raw.subject, 40).toLowerCase().replace(/[^a-z_]/g, "_");
  const language = str(raw.language || "english", 20).toLowerCase();
  const modifierRaw = str(raw.modifier, 20).toLowerCase();
  const modifier = ALLOWED_MODIFIERS.has(modifierRaw) ? modifierRaw : null;

  return {
    text,
    fromGrade: ALLOWED_GRADES.has(fromGrade) ? fromGrade : "",
    toGrade: ALLOWED_GRADES.has(toGrade) ? toGrade : "",
    subject,
    // Source curriculum (CBC vs 2013/previous). Carried so the revision is
    // pinned to the SAME syllabus the question came from — checkSourceCurriculum
    // normalises + fail-closes on it. Grade may change (that is the point of a
    // re-grade), but the curriculum and subject must be preserved.
    curriculum: str(raw.curriculum, 20).toLowerCase(),
    language: ALLOWED_LANGUAGES.has(language) ? language : "english",
    modifier,
  };
}

function validateInputs(inputs) {
  const errs = [];
  if (!inputs.text) errs.push("Question text is required.");
  if (!inputs.toGrade && !inputs.modifier) {
    errs.push(
      "Please pick a target grade or a modifier (easier / harder / " +
      "simpler / polish) so the AI knows how to revise the question.",
    );
  }
  return errs;
}

const SYSTEM_PROMPT = [
  "You are an expert Zambian examiner.",
  "Your job: rewrite ONE exam question to fit a different grade level or",
  "tone, while preserving the original intent. You are NOT generating",
  "options, answers, or marking notes — only rewriting the question text.",
  "",
  "Rules:",
  "- Stay strictly within the Zambian syllabus and subject named in the request",
  "  (a request states its curriculum). Never move the question into a different",
  "  curriculum or subject than the one it came from.",
  "- Preserve the original learning goal — don't change what the question",
  "  is actually asking for, only HOW it's asked.",
  "- Match the target grade's reading level and vocabulary.",
  "- Keep the question concise — one sentence is usually enough.",
  "- If the original is multiple choice, write the question stem only.",
  "  Do not return any options.",
  "- Output the rewritten question and nothing else. No quotes, no",
  "  preamble, no explanations.",
].join("\n");

function buildUserPrompt(inputs) {
  const lines = [];
  if (inputs.fromGrade) lines.push(`Original grade: ${inputs.fromGrade}`);
  if (inputs.toGrade) lines.push(`Target grade: ${inputs.toGrade}`);
  if (inputs.subject) lines.push(`Subject: ${inputs.subject.replace(/_/g, " ")}`);
  if (inputs.language && inputs.language !== "english") {
    lines.push(`Language: ${inputs.language}`);
  }
  if (inputs.modifier) {
    const tone = {
      easier: "Make the question EASIER while keeping the same learning intent.",
      harder: "Make the question HARDER while keeping the same learning intent.",
      simpler: "Use SIMPLER vocabulary and shorter sentences. Same learning intent.",
      polish:
        "POLISH ONLY: fix grammar, spelling, and clarity so the question reads " +
        "cleanly and is appropriate for the grade. Do NOT make it easier or " +
        "harder and do NOT change the difficulty, grade level, or what it asks " +
        "for. If the original is already clear and correct, return it unchanged.",
    }[inputs.modifier];
    lines.push(tone);
  }
  lines.push("");
  lines.push("Original question:");
  lines.push(inputs.text);
  lines.push("");
  lines.push("Rewritten question:");
  return lines.join("\n");
}

// Strip common preamble patterns the model might emit even though the
// system prompt forbids them. We don't want a teacher to paste
// "Here is the rewritten question: ..." into their paper by accident.
function stripPreamble(out) {
  const cleaned = String(out || "").trim();
  if (cleaned.startsWith("\"") && cleaned.endsWith("\"") && cleaned.length > 2) {
    return cleaned.slice(1, -1).trim();
  }
  const preambleMatch = cleaned.match(
    /^(?:Rewritten question|Here(?:'s| is) (?:the )?(?:rewritten|revised) question)\s*:\s*([\s\S]+)$/i,
  );
  if (preambleMatch) return preambleMatch[1].trim();
  return cleaned;
}

module.exports = {
  ALLOWED_GRADES,
  ALLOWED_LANGUAGES,
  ALLOWED_MODIFIERS,
  sanitizeInputs,
  validateInputs,
  buildUserPrompt,
  stripPreamble,
  SYSTEM_PROMPT,
};
