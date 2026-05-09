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
  "Six checks:",
  "  1. Answer accuracy — Is the option marked as correct actually correct?",
  "     Are there two correct options? Is the keyed answer wrong?",
  "  2. Grade match — Is the vocabulary, cognitive load, and reading level",
  "     appropriate for the stated grade?",
  "  3. Clarity — Is the question understandable? Ambiguous wording?",
  "  4. Grammar — Spelling, punctuation, subject-verb agreement.",
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
  "Be confident only when you are sure. Prefer warning over blocker if",
  "you have any reasonable doubt about the keyed answer.",
  "",
  "Output ONLY a single JSON object matching this shape (no prose):",
  "{",
  "  \"scores\": {",
  "    \"answerAccuracy\": 0-100,",
  "    \"gradeMatch\": 0-100,",
  "    \"clarity\": 0-100,",
  "    \"grammar\": 0-100,",
  "    \"optionsQuality\": 0-100,",
  "    \"cbcAlignment\": 0-100",
  "  },",
  "  \"summary\": \"one or two sentences\",",
  "  \"issues\": [",
  "    {",
  "      \"questionIndex\": <0-based int>,",
  "      \"severity\": \"blocker\" | \"warning\",",
  "      \"category\": \"answer\" | \"options\" | \"clarity\" | \"grammar\" | \"curriculum\" | \"difficulty\",",
  "      \"field\": \"text\" | \"options\" | \"correctAnswer\" | \"meta\",",
  "      \"message\": \"plain-English description of the issue\",",
  "      \"suggestion\": \"concrete fix the teacher can apply\"",
  "    }",
  "  ]",
  "}",
].join("\n");

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

function extractPlainText(text) {
  if (!text) return "";
  if (typeof text === "string") return text;
  if (typeof text === "object") {
    try {
      return JSON.stringify(text);
    } catch {
      return "";
    }
  }
  return "";
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
      maxTokens: 1500,
      temperature: 0.1,
      json: true,
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

  const parsed = safeParseJson(raw) || {};
  const scores = buildScores(parsed);
  const overallScore = overallFromScores(scores);

  const llmIssues = Array.isArray(parsed.issues) ?
    parsed.issues.slice(0, 100).map(normaliseIssue) :
    [];
  const llmBlockers = llmIssues.filter((i) => i.severity === "blocker");
  const llmWarnings = llmIssues.filter((i) => i.severity === "warning");

  const blockers = [...structuralBlockers, ...llmBlockers];
  const warnings = llmWarnings;

  let verdict;
  if (blockers.length > 0) verdict = "fail";
  else if (overallScore < 80 || warnings.length > 0) verdict = "warn";
  else verdict = "pass";

  return {
    verdict,
    overallScore,
    scores,
    summary: clampStr(parsed.summary, 600) ||
      (blockers.length ?
        "Quiz has critical issues that must be fixed before publishing." :
        warnings.length ?
          "Quiz is publishable but has minor issues to consider." :
          "Quiz looks good to publish."),
    blockers,
    warnings,
    modelUsed: MODEL,
  };
}

module.exports = {runVex, runStructuralChecks};
