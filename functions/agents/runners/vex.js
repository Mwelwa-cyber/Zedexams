/**
 * Vex — Quiz Verifier runner.
 *
 * Synchronous pre-publish quality check on a quiz. Unlike the Aria→Cala→
 * Reva→Pubo content pipeline, Vex is NOT queued through agentJobs. The
 * verifyQuiz callable invokes runVex directly so the teacher gets
 * Grammarly-style instant feedback before publishing.
 *
 * Two-phase verification:
 *   1. Deterministic structural checks (always trustworthy) → blockers
 *   2. Anthropic Haiku semantic checks (answer correctness, age fit,
 *      distractor plausibility, CBC alignment, grammar, difficulty)
 *
 * Output is a scored verdict: per-category 0-100 + overall + tiered
 * issue list separating publish-blocking errors from advisory warnings.
 */

const {callAnthropic} = require("../../aiService");

const MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = [
  "You are Vex, ZedExams' Quiz Verifier. You read every quiz like a strict",
  "but fair Zambian teacher who has seen too many bad answer keys reach",
  "learners. Your job is a pre-publish quality check.",
  "",
  "Your default stance is suspicion, not trust. Silence is the worst",
  "outcome — a quiz that ships with bad answers or typos hurts learners.",
  "If you are unsure, raise a warning. Empty issues lists are almost",
  "always wrong: a real, multi-question quiz nearly always has at least",
  "one thing worth flagging (a slightly weak distractor, an awkward",
  "phrasing, a borderline difficulty). Re-read every question twice",
  "before deciding nothing is wrong.",
  "",
  "Six checks:",
  "  1. Answer accuracy — Is the option marked as correct actually correct?",
  "     Are there two correct options? Is the keyed answer wrong?",
  "  2. Grade match — Is the vocabulary, cognitive load, and reading level",
  "     appropriate for the stated grade?",
  "  3. Clarity — Is the question understandable? Ambiguous wording?",
  "  4. Grammar — Spelling, punctuation, subject-verb agreement. Flag",
  "     ANY obvious typos in the question stem or options as a warning",
  "     (e.g. \"Nae\" instead of \"Name\", \"recieve\" instead of \"receive\").",
  "     Do not silently ignore typos.",
  "  5. Options quality — Plausible distractors, no near-duplicates, not",
  "     too obvious, not misleading.",
  "  6. CBC alignment — Does it match the stated subject, grade, topic,",
  "     and (if given) sub-topic per the Zambian CBC context provided?",
  "",
  "Severity rules:",
  "  - blocker: wrong correct answer, two correct answers in MCQ, math /",
  "    factual answer demonstrably wrong, options that contradict each",
  "    other, structural defects you observe (the system has already",
  "    caught empty / duplicate / out-of-range options before you ran).",
  "  - warning: spelling, grammar, wording suggestions, difficulty",
  "    mismatch, mildly weak distractor, mild curriculum drift.",
  "",
  "Calibration: if you would give every category a score of 95+ AND",
  "return zero issues for a quiz with 5 or more questions, you almost",
  "certainly missed something. Re-read first. Honest scores reflect",
  "honest critique — do not inflate scores to be polite.",
  "",
  "You MUST submit your verdict by calling the submit_verdict tool.",
  "Do not write prose, do not write JSON in your reply — only call the",
  "tool. All six scores and the issues array are required (issues may",
  "be empty if you are genuinely certain nothing is wrong).",
].join("\n");

// Tool-enforced schema for the verdict. Forcing Claude to call this
// tool guarantees the response matches the shape — no prose drift, no
// missing fields, no truncated JSON. Mirrors the validation in
// buildScores / normaliseIssue below.
const VERDICT_TOOL = {
  name: "submit_verdict",
  description:
    "Submit your quiz quality verdict. Call this exactly once with all " +
    "six category scores, a short summary, and the list of issues found.",
  input_schema: {
    type: "object",
    required: ["scores", "summary", "issues"],
    properties: {
      scores: {
        type: "object",
        required: [
          "answerAccuracy",
          "gradeMatch",
          "clarity",
          "grammar",
          "optionsQuality",
          "cbcAlignment",
        ],
        properties: {
          answerAccuracy: {type: "integer", minimum: 0, maximum: 100},
          gradeMatch: {type: "integer", minimum: 0, maximum: 100},
          clarity: {type: "integer", minimum: 0, maximum: 100},
          grammar: {type: "integer", minimum: 0, maximum: 100},
          optionsQuality: {type: "integer", minimum: 0, maximum: 100},
          cbcAlignment: {type: "integer", minimum: 0, maximum: 100},
        },
      },
      summary: {
        type: "string",
        description: "One or two sentences summarising the verdict.",
      },
      issues: {
        type: "array",
        items: {
          type: "object",
          required: [
            "questionIndex",
            "severity",
            "category",
            "field",
            "message",
            "suggestion",
          ],
          properties: {
            questionIndex: {type: "integer", minimum: 0},
            severity: {type: "string", enum: ["blocker", "warning"]},
            category: {
              type: "string",
              enum: [
                "answer", "options", "clarity",
                "grammar", "curriculum", "difficulty",
              ],
            },
            field: {
              type: "string",
              enum: ["text", "options", "correctAnswer", "meta"],
            },
            message: {type: "string"},
            suggestion: {type: "string"},
          },
        },
      },
    },
  },
};

function safeParseJson(text) {
  if (!text || typeof text !== "string") return null;
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch { return null; }
    }
    return null;
  }
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function clampStr(value, max) {
  return String(value || "").slice(0, max);
}

// Walk a Tiptap document to plain text. Defense in depth for the
// structural checks below in case a caller forgets to flatten rich text
// client-side. Mirrors src/utils/quizRichText.js#extractRichTextPlain.
function walkTiptapNode(node, out) {
  if (!node || typeof node !== "object") return;
  const type = node.type;
  if (type === "text") {
    if (typeof node.text === "string") out.push(node.text);
    return;
  }
  if (type === "hardBreak" || type === "hard_break") {
    out.push("\n");
    return;
  }
  const isBlock = type === "paragraph" || type === "heading" ||
    type === "blockquote" || type === "bulletList" ||
    type === "orderedList" || type === "listItem" || type === "codeBlock";
  if (isBlock) out.push("\n");
  (node.content || []).forEach((child) => walkTiptapNode(child, out));
  if (isBlock) out.push("\n");
}

function tiptapDocToPlain(doc) {
  if (!doc || doc.type !== "doc") return "";
  const out = [];
  (doc.content || []).forEach((child) => walkTiptapNode(child, out));
  return out.join("").replace(/\s+/g, " ").trim();
}

function extractPlainText(text) {
  if (text === null || text === undefined) return "";
  if (typeof text === "object") {
    if (text.type === "doc") return tiptapDocToPlain(text);
    try {
      return JSON.stringify(text);
    } catch {
      return "";
    }
  }
  if (typeof text !== "string") return "";
  const trimmed = text.trim();
  if (trimmed.startsWith("{") &&
      trimmed.includes("\"type\"") &&
      trimmed.includes("\"doc\"")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && parsed.type === "doc") return tiptapDocToPlain(parsed);
    } catch {
      /* fall through to raw string */
    }
  }
  return trimmed;
}

/**
 * Deterministic structural checks. These run before the LLM and ALWAYS
 * produce blockers when violated, regardless of what Claude says. Mirrors
 * the contract enforced by validateStandaloneQuestion in
 * src/utils/quizValidation.js, but adds the duplicate-option check the
 * editor doesn't enforce.
 */
function runStructuralChecks(questions) {
  const blockers = [];

  questions.forEach((q, i) => {
    const type = q?.type || "mcq";
    const textPlain = extractPlainText(q?.text).trim();

    if (!textPlain) {
      blockers.push({
        questionIndex: i,
        severity: "blocker",
        category: "answer",
        field: "text",
        message: `Question ${i + 1} has no question text.`,
        suggestion: "Add the question prompt before publishing.",
      });
    }

    if (type !== "mcq") return;

    const options = Array.isArray(q?.options) ? q.options : [];

    if (options.length < 2) {
      blockers.push({
        questionIndex: i,
        severity: "blocker",
        category: "options",
        field: "options",
        message: `Question ${i + 1} has fewer than two options.`,
        suggestion: "Multiple-choice questions need at least two options.",
      });
      return;
    }

    if (options.some((o) => !String(o || "").trim())) {
      blockers.push({
        questionIndex: i,
        severity: "blocker",
        category: "options",
        field: "options",
        message: `Question ${i + 1} has an empty option.`,
        suggestion: "Fill in every option or remove the blank one.",
      });
    }

    const seen = new Map();
    options.forEach((o, idx) => {
      const key = String(o || "").trim().toLowerCase();
      if (!key) return;
      if (seen.has(key)) {
        blockers.push({
          questionIndex: i,
          severity: "blocker",
          category: "options",
          field: "options",
          message: `Question ${i + 1} has duplicate options ` +
            `(${seen.get(key) + 1} and ${idx + 1}).`,
          suggestion: "Make every option unique.",
        });
      } else {
        seen.set(key, idx);
      }
    });

    const correctIdx = Number(q?.correctAnswer);
    if (!Number.isInteger(correctIdx) ||
        correctIdx < 0 ||
        correctIdx >= options.length) {
      blockers.push({
        questionIndex: i,
        severity: "blocker",
        category: "answer",
        field: "correctAnswer",
        message: `Question ${i + 1} has no valid correct answer selected.`,
        suggestion: "Mark exactly one of the options as the correct answer.",
      });
    }
  });

  return blockers;
}

function buildUserPrompt({input}) {
  const meta = input.meta || {};
  const parts = [
    `Grade: ${meta.grade || "?"}`,
    `Subject: ${meta.subject || "?"}`,
    `Topic: ${meta.topic || "?"}`,
    `Sub-topic: ${meta.subtopic || "?"}`,
    `Stated difficulty: ${meta.difficulty || "?"}`,
    "",
    "CBC context (authoritative — questions should align with this):",
    String(input.cbcContextBlock || "(no CBC context resolved)").slice(0, 4000),
    "",
    "Quiz questions (0-indexed). For MCQ, correctAnswer is the 0-based",
    "index of the option marked correct.",
    JSON.stringify(input.questions || [], null, 2).slice(0, 28000),
  ];
  return parts.join("\n");
}

function normaliseIssue(raw) {
  const allowedSeverity = ["blocker", "warning"];
  const allowedCategory =
    ["answer", "options", "clarity", "grammar", "curriculum", "difficulty"];
  const allowedField = ["text", "options", "correctAnswer", "meta"];
  return {
    questionIndex: clampInt(raw?.questionIndex, 0, 999, 0),
    severity: allowedSeverity.includes(raw?.severity) ? raw.severity : "warning",
    category: allowedCategory.includes(raw?.category) ? raw.category : "clarity",
    field: allowedField.includes(raw?.field) ? raw.field : "text",
    message: clampStr(raw?.message, 600),
    suggestion: clampStr(raw?.suggestion, 600),
  };
}

function buildScores(parsed) {
  const s = parsed?.scores || {};
  return {
    answerAccuracy: clampInt(s.answerAccuracy, 0, 100, 0),
    gradeMatch: clampInt(s.gradeMatch, 0, 100, 0),
    clarity: clampInt(s.clarity, 0, 100, 0),
    grammar: clampInt(s.grammar, 0, 100, 0),
    optionsQuality: clampInt(s.optionsQuality, 0, 100, 0),
    cbcAlignment: clampInt(s.cbcAlignment, 0, 100, 0),
  };
}

function overallFromScores(scores) {
  const weights = {
    answerAccuracy: 0.30,
    gradeMatch: 0.15,
    clarity: 0.15,
    grammar: 0.10,
    optionsQuality: 0.15,
    cbcAlignment: 0.15,
  };
  let total = 0;
  Object.keys(weights).forEach((k) => {
    total += (scores[k] || 0) * weights[k];
  });
  return Math.round(total);
}

/**
 * @param {object} args
 * @param {object} args.input - { quizId, questions[], meta, cbcContextBlock }
 * @param {object} args.anthropicApiKeySecret - Firebase secret param.
 * @returns {Promise<object>} verdict report — see plan for shape.
 */
async function runVex({input, anthropicApiKeySecret}) {
  const questions = Array.isArray(input?.questions) ? input.questions : [];
  const structuralBlockers = runStructuralChecks(questions);

  const apiKey = anthropicApiKeySecret.value() ||
    process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      verdict: structuralBlockers.length ? "fail" : "warn",
      overallScore: 0,
      scores: buildScores({}),
      summary: "AI verifier is not configured — only structural checks ran.",
      blockers: structuralBlockers,
      warnings: [],
      modelUsed: null,
    };
  }

  const userPrompt = buildUserPrompt({input});

  let raw;
  try {
    raw = await callAnthropic(apiKey, {
      systemPrompt: SYSTEM_PROMPT,
      messages: [{role: "user", content: userPrompt}],
      model: MODEL,
      // 4000 (up from 1500) gives room for a full verdict on a 10+ question
      // quiz with several issues each. The previous 1500 cap was truncating
      // mid-JSON and producing the "AI response unreadable" verdict.
      maxTokens: 4000,
      temperature: 0.1,
      tools: [VERDICT_TOOL],
      // Force the model to call submit_verdict — guarantees structured
      // output that matches the schema, no prose drift.
      toolChoice: {
        type: "tool",
        name: "submit_verdict",
        disable_parallel_tool_use: true,
      },
    });
  } catch (err) {
    console.error("Vex Anthropic call failed", err);
    return {
      verdict: structuralBlockers.length ? "fail" : "warn",
      overallScore: 0,
      scores: buildScores({}),
      summary: "AI verifier could not run. Structural checks still apply.",
      blockers: structuralBlockers,
      warnings: [],
      modelUsed: MODEL,
      error: clampStr(err && err.message, 300),
    };
  }

  const parsed = safeParseJson(raw);
  // Both scores object AND issues array are required for a usable
  // verdict. A response with only one half is a malformed answer that
  // would silently default the missing half to zeros / empties and
  // produce a falsely-clean verdict.
  const hasScoresObject = parsed && typeof parsed === "object" &&
    parsed.scores && typeof parsed.scores === "object";
  const hasIssuesArray = parsed && Array.isArray(parsed.issues);
  const parsedOk = Boolean(hasScoresObject && hasIssuesArray);
  const scores = buildScores(parsed || {});
  const overallScore = overallFromScores(scores);

  const llmIssues = Array.isArray(parsed?.issues) ?
    parsed.issues.slice(0, 100).map(normaliseIssue) :
    [];
  const llmBlockers = llmIssues.filter((i) => i.severity === "blocker");
  const llmWarnings = llmIssues.filter((i) => i.severity === "warning");

  const blockers = [...structuralBlockers, ...llmBlockers];
  const warnings = llmWarnings;

  // Distinguish a clean pass from a parse failure or a stripped response.
  // If parsedOk is false, the response was malformed. If every score
  // defaulted to 0 (because the scores object was missing fields), treat
  // that as unreadable too — otherwise the modal cheerfully says "Quiz
  // looks good to publish" with all bars at 0%.
  const allScoresZero = Object.values(scores).every((v) => v === 0);
  const aiUnreadable = !parsedOk || allScoresZero;

  if (aiUnreadable) {
    // Surface the failure mode in logs so we can tell whether we're
    // losing responses to truncation, prose drift, or a schema-skipping
    // model. Without this, the modal just says "unreadable" and there's
    // no way to debug.
    console.warn("Vex: AI response unreadable", {
      parsedOk,
      allScoresZero,
      hasScoresObject: Boolean(parsed && parsed.scores),
      hasIssuesArray: Array.isArray(parsed && parsed.issues),
      rawLength: typeof raw === "string" ? raw.length : 0,
      rawPreview: clampStr(raw, 500),
    });
  }

  let verdict;
  if (blockers.length > 0) verdict = "fail";
  else if (aiUnreadable) verdict = "warn";
  else if (overallScore < 80 || warnings.length > 0) verdict = "warn";
  else verdict = "pass";

  let summary = clampStr(parsed?.summary, 600);
  if (!summary) {
    if (blockers.length) {
      summary = "Quiz has critical issues that must be fixed before publishing.";
    } else if (aiUnreadable) {
      summary = "AI verifier returned an unreadable response — only " +
        "structural checks ran. Review the quiz manually before publishing.";
    } else if (warnings.length) {
      summary = "Quiz is publishable but has minor issues to consider.";
    } else {
      summary = "Quiz looks good to publish.";
    }
  }

  return {
    verdict,
    overallScore,
    scores,
    summary,
    blockers,
    warnings,
    modelUsed: MODEL,
    aiUnreadable: aiUnreadable || undefined,
  };
}

module.exports = {runVex, runStructuralChecks};
