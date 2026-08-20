"use strict";

/**
 * §6 — the prompt that drafts a past-paper question's coaching.
 *
 * "The explanations are the whole feature. Coverage is the constraint, not the
 * UI." Which makes THIS the constraint: everything downstream can only be as
 * good as what comes out of here, and a plausible wrong explanation is worse
 * than none — a learner who cannot yet tell has been taught the wrong thing by
 * something they trust.
 *
 * ── The rule that shapes the whole prompt ────────────────────────────────
 *
 * "AI drafts `why`, `distractors`, `example` from the paper's MARKING SCHEME
 * and the prescribed textbook for that grade — never from general knowledge."
 * So the marking scheme's own words, where the paper has them, go into the
 * prompt as the authority, and the model is told to explain what the scheme
 * says rather than to work the question out for itself. A model that solves it
 * independently and gets a different answer is the failure mode this is built
 * to prevent, and it is why disagreeing with the key is an explicit refusal
 * path rather than something the model has to be talked out of.
 *
 * Nothing here writes anything. A draft lands as `explanationStatus:
 * 'ai_draft'`, which the learner-facing gate refuses to show — a human has to
 * approve it before a child ever reads it.
 */

const PROMPT_VERSION = "paper-quiz-explanations@1";

/** §6's writing rules, as the model reads them. */
const SYSTEM_PROMPT = `You write short explanations for Zambian primary and secondary
learners who have just answered a past-paper question. Your reader is a child of
about 12. They have already chosen an answer and want to know two things: why the
right answer is right, and why the one THEY picked was wrong.

HOW TO WRITE
- Grade-7 reading level. Short sentences. One idea per sentence.
- No metalanguage the school notes have not already taught. If you must use a
  term (denominator, past participle), say what it means in the same breath.
- "why" is at most 40 words. Each entry in "distractors" is at most 30 words.
- Every distractor must name the SPECIFIC mistake behind that option — the
  thinking that would lead a learner to choose it. Never "this is incorrect",
  never "this does not fit", never a restatement of the right answer.
- "example" is a worked line or a memory hook ("one collar, two sleeves"), never
  the rule said again.
- Zambian English, and Zambian names and things in examples: Mutinta, Chanda,
  Bwalya, kwacha, maize, the Zambezi. The paper is Zambian and so is the reader.
- Never mention this system, an AI, a model, a prompt, or a marking scheme. The
  learner is reading a teacher's voice.

WHERE YOUR FACTS COME FROM
- The marking scheme and the syllabus material you are given are the authority.
  Explain what they say. Do not work the question out independently and do not
  bring in outside knowledge to fill a gap.
- If the material does not support an explanation, or if working through the
  question makes you doubt the given answer key, DO NOT GUESS and do not quietly
  explain a different answer. Set "confident" to false and say what is wrong in
  "concern". A question you refuse is reviewed by a person; a question you
  invent an explanation for is read by a child.`;

/**
 * The user turn for ONE question.
 *
 * One question per call rather than a whole paper in one: a 60-question paper
 * in a single response is one refusal away from losing all sixty, the output
 * cap truncates the tail, and a reviewer who rejects question 41 would have to
 * re-run the other 59 to redraft it.
 */
function buildUserPrompt({question, paper, markingScheme}) {
  // `question.text` and `question.options` arrive ALREADY PROJECTED to plain
  // text by the caller — see `tidy` below for why this module does no markup
  // handling of its own.
  const options = (Array.isArray(question.options) ? question.options : [])
      .map((opt, i) => `  ${String.fromCharCode(65 + i)}. ${tidy(opt)}`)
      .join("\n");
  const answerLetter = String.fromCharCode(65 + (question.correctIndex ?? 0));

  const parts = [
    `PAPER: ${paper.title || "Past paper"}`,
    `SUBJECT: ${paper.subject || ""}   GRADE: ${paper.grade || ""}   YEAR: ${paper.year || ""}`,
    question.section ? `SECTION: ${question.section}` : "",
    question.topic ? `TOPIC: ${question.topic}` : "",
    "",
    `QUESTION ${question.n || ""}: ${tidy(question.text)}`,
    options ? `\nOPTIONS:\n${options}` : "",
    `\nTHE CORRECT ANSWER IS ${answerLetter}. This is the paper's own key. Treat it as given.`,
  ];

  if (markingScheme) {
    parts.push(
        "\nWHAT THE MARKING SCHEME SAYS ABOUT THIS QUESTION — this is your source:",
        markingScheme,
    );
  }
  // The syllabus extract is NOT interpolated here — it travels as
  // `cbcContextBlock`, which `callClaude` places in the cacheable prefix of
  // the system turn. Sixty questions from one paper share one grade and one
  // subject, so putting it in the per-question user turn would re-send (and
  // re-bill) the same block sixty times.
  if (!markingScheme) {
    parts.push(
        "\nNo marking scheme is available for this question.",
        "Explain it only if the question and the syllabus material make the reasoning",
        "plain. If they do not, set confident to false rather than reaching for outside knowledge.",
    );
  }

  parts.push(
      "",
      "Write the coaching for this one question:",
      `- why: why ${answerLetter} is right, at most 40 words.`,
      "- distractors: one entry per WRONG option, keyed by its letter, at most 30",
      "  words each, naming the specific mistake that leads to it.",
      "- example: a worked line or a memory hook.",
      "- confident: false if the material does not support this, or if you doubt the key.",
  );
  return parts.filter(Boolean).join("\n");
}

/**
 * Collapse whitespace on an ALREADY-PROJECTED string.
 *
 * This module deliberately owns no markup handling. It used to strip tags with
 * a regex and `JSON.stringify` anything that was not a string — which meant a
 * question stored as a Tiptap doc reached the model as raw JSON, and a
 * question stored as a STRINGIFIED Tiptap doc reached it as raw JSON with the
 * tags removed. Either way the model was asked to explain a blob of markup.
 *
 * The caller projects with `functions/shared/paperQuiz/answerKey.js` — the
 * same extractor the browser's runner uses — and hands the result here. One
 * projection, so the prompt, the studio's review queue and the learner's
 * screen cannot disagree about what the question says.
 */
function tidy(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}

/** The tool schema. Forcing a tool call removes "the model returned prose". */
const EXPLANATION_TOOL_SCHEMA = {
  type: "object",
  properties: {
    why: {type: "string", description: "Why the correct answer is right. At most 40 words."},
    distractors: {
      type: "object",
      description: "One entry per WRONG option, keyed by its letter (A, B, C, D). At most 30 words each.",
      additionalProperties: {type: "string"},
    },
    example: {type: "string", description: "A worked line or a memory hook."},
    confident: {
      type: "boolean",
      description: "False if the source material does not support an explanation, or if you doubt the answer key.",
    },
    concern: {type: "string", description: "When confident is false, what is wrong."},
  },
  required: ["why", "distractors", "example", "confident"],
  additionalProperties: false,
};

module.exports = {PROMPT_VERSION, SYSTEM_PROMPT, EXPLANATION_TOOL_SCHEMA, buildUserPrompt, tidy};
