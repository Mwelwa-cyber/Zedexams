/**
 * Cala — CBC Alignment Officer runner.
 *
 * Verifies an Aria-produced draft against the verified Zambian CBC KB.
 * Returns a structured alignment report: { aligned, citations, gaps }.
 *
 * Cala does not call Anthropic — it walks the same KB that the teacher
 * tool runners use, then compares against the draft text. Cheap and
 * deterministic.
 */

const {
  resolveCbcContext,
  KB_VERSION,
} = require("../../teacherTools/cbcKnowledge");

function collectDraftText(draft) {
  if (!draft) return "";
  if (typeof draft === "string") return draft;
  // Walk the draft object and concatenate all string values. This is a
  // crude but robust way to extract every piece of teacher-facing text
  // regardless of the schema (lesson plan vs worksheet shapes differ).
  const out = [];
  const stack = [draft];
  while (stack.length) {
    const node = stack.pop();
    if (node == null) continue;
    if (typeof node === "string") {
      out.push(node);
    } else if (Array.isArray(node)) {
      for (const v of node) stack.push(v);
    } else if (typeof node === "object") {
      for (const v of Object.values(node)) stack.push(v);
    }
  }
  return out.join("\n");
}

function extractOutcomeCodes(text) {
  // Zambian CBC outcome codes look like M.6.2.1 or ENG.5.1.3 — domain
  // letters, dots, and digits. Loose match keeps us resilient to small KB
  // formatting changes.
  const matches = text.match(/\b[A-Z]{1,4}\.\d+\.\d+(?:\.\d+)?\b/g) || [];
  return [...new Set(matches)];
}

/**
 * @param {object} args
 * @param {object} args.job - The agentJobs document data with output.aria.draft populated.
 * @returns {Promise<object>} { aligned, citations, gaps, kbVersion }
 */
async function runCala({job}) {
  const input = job.input || {};
  const ariaOutput = job.output && job.output.aria;
  const draft = ariaOutput && ariaOutput.draft;
  if (!draft) {
    throw new Error("Cala needs job.output.aria.draft — Aria must run first.");
  }

  const {kbMatch, kbWarning} = await resolveCbcContext({
    grade: input.grade,
    subject: input.subject,
    topic: input.topic,
    subtopic: input.subtopic,
  });

  const draftText = collectDraftText(draft);
  const draftCodes = extractOutcomeCodes(draftText);
  const kbCodes = extractOutcomeCodes(JSON.stringify(kbMatch || {}));

  const citations = draftCodes
    .filter((code) => kbCodes.includes(code))
    .map((code) => ({outcome: code}));

  const gaps = [];
  if (!kbMatch) {
    gaps.push("Topic not found in verified CBC KB.");
  }
  if (citations.length === 0) {
    gaps.push("Draft does not cite any verified outcome codes.");
  }

  const drift = draftCodes.filter((code) => !kbCodes.includes(code))
    .map((code) => ({outcome: code, note: "Not present in KB lookup."}));

  return {
    aligned: gaps.length === 0,
    citations,
    gaps,
    drift,
    kbVersion: KB_VERSION,
    kbWarning: kbWarning || null,
  };
}

module.exports = {runCala};
