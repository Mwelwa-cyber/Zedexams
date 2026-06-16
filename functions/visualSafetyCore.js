/**
 * Pure helpers for the visual safety check — prompt building + verdict parsing.
 * Dependency-free (no firebase-functions / aiService) so it is unit-testable
 * with plain `node`, matching the repo's functions-test convention.
 */

const SAFETY_MODEL = process.env.VISUAL_SAFETY_MODEL || "claude-haiku-4-5";

const SAFETY_SYSTEM_PROMPT = [
  "You are a careful reviewer of educational images for Zambian primary and",
  "secondary classrooms. Look at the image and judge whether it is suitable for",
  "the stated grade, subject and topic. Check, in order:",
  "1) age-appropriateness; 2) whether it actually shows the topic;",
  "3) spelling of any visible text/labels; 4) whether body parts or scientific",
  "structures are drawn correctly and plausibly; 5) whether it is appropriate",
  "for school use; 6) whether it will still read clearly when printed in black",
  "and white.",
  "Respond with ONLY a JSON object, no prose, no code fences:",
  "{\"verdict\":\"ok\"|\"review\",\"issues\":[\"short specific issue\"],\"summary\":\"one sentence\"}.",
  "Use \"review\" if anything is wrong, doubtful, inaccurate, misspelled, off-topic",
  "or not classroom-appropriate; otherwise \"ok\". Keep issues short and concrete.",
].join(" ");

function cleanCtx(v, max = 80) {
  return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
}

/** Build the user prompt for the safety review. Pure. */
function buildSafetyUserPrompt(context = {}) {
  const lines = [
    "Review this image for classroom use and return the JSON described.",
    `Grade: ${cleanCtx(context.grade, 16) || "unspecified"}`,
    `Subject: ${cleanCtx(context.subject) || "unspecified"}`,
    `Topic: ${cleanCtx(context.topic, 160) || "unspecified"}`,
  ];
  const style = cleanCtx(context.style, 60);
  if (style) lines.push(`Requested style: ${style}`);
  return lines.join("\n");
}

/**
 * Parse the model's JSON verdict defensively. Pure. Never throws.
 * @returns {{verdict:string, safetyStatus:string, issues:string[], summary:string}}
 */
function parseSafetyResult(text) {
  const fallback = {
    verdict: "review",
    safetyStatus: "flagged",
    issues: ["The safety check could not be read — please review the image yourself."],
    summary: "Could not interpret the automated check.",
  };
  if (!text || typeof text !== "string") return fallback;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return fallback;
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return fallback;
  }
  const verdict = parsed.verdict === "ok" ? "ok" : "review";
  const issues = Array.isArray(parsed.issues) ?
    parsed.issues.map((i) => String(i || "").slice(0, 200)).filter(Boolean).slice(0, 10) : [];
  return {
    verdict,
    safetyStatus: verdict === "ok" ? "ok" : "flagged",
    issues,
    summary: String(parsed.summary || (verdict === "ok" ? "Looks suitable for class." : "Needs a teacher's review.")).slice(0, 300),
  };
}

module.exports = {
  SAFETY_MODEL,
  SAFETY_SYSTEM_PROMPT,
  buildSafetyUserPrompt,
  parseSafetyResult,
};
