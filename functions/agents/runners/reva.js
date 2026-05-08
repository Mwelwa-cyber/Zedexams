/**
 * Reva — Content Reviewer runner.
 *
 * Pedagogy + tone + age-appropriateness review of an aligned draft.
 * Calls Anthropic via the existing aiService.callAnthropic and parses a
 * JSON verdict. Suggests edits but never auto-applies them — Aria's
 * draft stays untouched.
 */

const {callAnthropic, getAnthropicApiKey} = require("../../aiService");

const SYSTEM_PROMPT = [
  "You are Reva, ZedExams' Content Reviewer. You read like an experienced",
  "Zambian teacher — kind, direct, allergic to fluff. You suggest edits but",
  "never apply them. The draft below has already been verified against the",
  "Zambian CBC knowledge base; your job is pedagogy, voice, age-",
  "appropriateness, inclusivity, and length.",
  "",
  "Output ONLY a single JSON object matching this shape:",
  "{",
  "  \"verdict\": \"approve\" | \"revise\" | \"reject\",",
  "  \"severity\": \"low\" | \"medium\" | \"high\",",
  "  \"summary\": \"1-2 sentence overall verdict\",",
  "  \"edits\": [",
  "    { \"where\": \"section/path\", \"suggestion\": \"...\", \"reason\": \"...\" }",
  "  ]",
  "}",
  "",
  "Use \"approve\" only if no edits would block publishing. Use \"reject\"",
  "only for fundamental problems. Be specific. No prose outside the JSON.",
].join("\n");

function buildUserPrompt({input, draft, alignment}) {
  const parts = [
    `Grade: ${input.grade || "?"}`,
    `Subject: ${input.subject || "?"}`,
    `Topic: ${input.topic || "?"}`,
    `Tool: ${input.tool || "?"}`,
    "",
    "CBC alignment summary:",
    JSON.stringify({
      aligned: alignment?.aligned,
      citations: alignment?.citations || [],
      gaps: alignment?.gaps || [],
    }, null, 2),
    "",
    "Draft to review:",
    JSON.stringify(draft, null, 2).slice(0, 18000),
  ];
  return parts.join("\n");
}

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

/**
 * @param {object} args
 * @param {object} args.job - The agentJobs document data; must have
 *   output.aria.draft and output.cala (alignment).
 * @param {object} args.anthropicApiKeySecret - Firebase secret param.
 * @returns {Promise<object>} { verdict, severity, edits, summary, modelUsed }
 */
async function runReva({job, anthropicApiKeySecret}) {
  const input = job.input || {};
  const ariaOutput = job.output && job.output.aria;
  const calaOutput = job.output && job.output.cala;
  if (!ariaOutput || !ariaOutput.draft) {
    throw new Error("Reva needs job.output.aria.draft — Aria must run first.");
  }

  const apiKey = getAnthropicApiKey(anthropicApiKeySecret);
  const userPrompt = buildUserPrompt({
    input,
    draft: ariaOutput.draft,
    alignment: calaOutput || {},
  });

  const raw = await callAnthropic(apiKey, {
    systemPrompt: SYSTEM_PROMPT,
    messages: [{role: "user", content: userPrompt}],
    maxTokens: 1500,
    temperature: 0.2,
    json: true,
  });

  const parsed = safeParseJson(raw);
  if (!parsed || !parsed.verdict) {
    return {
      verdict: "revise",
      severity: "medium",
      summary: "Reva could not parse a verdict — needs manual review.",
      edits: [],
      raw: String(raw || "").slice(0, 2000),
    };
  }

  return {
    verdict: ["approve", "revise", "reject"].includes(parsed.verdict) ?
      parsed.verdict :
      "revise",
    severity: ["low", "medium", "high"].includes(parsed.severity) ?
      parsed.severity :
      "medium",
    summary: String(parsed.summary || "").slice(0, 1000),
    edits: Array.isArray(parsed.edits) ?
      parsed.edits.slice(0, 50).map((e) => ({
        where: String(e.where || "").slice(0, 200),
        suggestion: String(e.suggestion || "").slice(0, 1000),
        reason: String(e.reason || "").slice(0, 500),
      })) :
      [],
  };
}

module.exports = {runReva};
