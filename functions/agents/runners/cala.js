/**
 * Cala — CBC Alignment Officer runner.
 *
 * Verifies an Aria-produced draft against the verified Zambian CBC KB.
 * Returns a structured alignment report:
 *   { aligned, citations, gaps, drift, kbVersion, kbWarning }
 *
 * Cala does not call Anthropic. It reads the same KB the teacher-tool
 * runners use, then checks whether the draft text mentions each KB
 * outcome statement (paraphrase-tolerant substring match). Cheap,
 * deterministic, and — unlike the previous regex-only matcher —
 * actually capable of producing non-empty citations.
 */

const {
  resolveCbcContext,
} = require("../../teacherTools/cbcKnowledge");

// Dotted ZEC-style codes like M.6.2.1 or ENG.5.1.3. Used only for drift
// detection (a draft that mentions a code never present in the KB
// outcomes is probably hallucinating a curriculum reference).
const DOTTED_CODE_RE = /\b[A-Z]{1,4}\.\d+\.\d+(?:\.\d+)?\b/g;

function collectDraftText(draft) {
  if (!draft) return "";
  if (typeof draft === "string") return draft;
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

function extractDottedCodes(text) {
  const matches = (text || "").match(DOTTED_CODE_RE) || [];
  return [...new Set(matches)];
}

// Normalise free text for substring matching: lowercase, collapse
// whitespace, strip punctuation. Lets "Count forwards and backwards
// from 1 to 20" match a draft that says "Pupils count forwards and
// backwards from 1 to 20." or "Counts, forwards and backwards, 1-20."
function normalise(text) {
  return String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
}

// Pull the outcome list out of whatever shape kbMatch happens to be.
// Topic entries (seed + editable KB) use `specificOutcomes`; stored
// sub-topic curriculum modules use `outcomes`. Either way we want an
// array of non-empty strings.
function extractKbOutcomes(kbMatch) {
  if (!kbMatch || typeof kbMatch !== "object") return [];
  const raw = Array.isArray(kbMatch.outcomes) ? kbMatch.outcomes :
    Array.isArray(kbMatch.specificOutcomes) ? kbMatch.specificOutcomes :
      [];
  return raw
      .map((o) => (typeof o === "string" ? o : (o && o.text) || ""))
      .filter((s) => typeof s === "string" && s.trim().length > 0);
}

// Stable, cite-able id for a KB outcome: `<kbEntryId>:o<n>` (1-indexed).
// kbEntryId falls back to a synthesised slug when the KB entry has no
// `id`, which can happen for ad-hoc fallback matches.
function buildOutcomeId(kbMatch, index) {
  const base = (kbMatch && (kbMatch.id || kbMatch.moduleId || kbMatch.topicId)) ||
    [kbMatch && kbMatch.grade, kbMatch && kbMatch.subject, kbMatch && kbMatch.topic]
        .filter(Boolean)
        .join("-")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") ||
    "kb";
  return `${base}:o${index + 1}`;
}

// "Soft" substring match: the normalised outcome text appears in the
// normalised draft text. We also accept a token-overlap fallback for
// outcomes that get heavily reworded — at least 70% of the outcome's
// content words must appear somewhere in the draft.
function draftCoversOutcome(normDraft, draftTokens, outcomeText) {
  const normOutcome = normalise(outcomeText);
  if (!normOutcome) return false;
  if (normDraft.includes(normOutcome)) return true;

  const STOP = new Set([
    "the", "a", "an", "and", "or", "of", "to", "in", "on", "for",
    "with", "is", "are", "be", "as", "at", "by", "from", "into", "that",
    "this", "these", "those", "their", "its", "it", "they", "them",
    "we", "our", "your", "his", "her",
  ]);
  const outcomeTokens = normOutcome
      .split(" ")
      .filter((t) => t.length > 2 && !STOP.has(t));
  if (outcomeTokens.length < 3) return false;
  const overlap = outcomeTokens.filter((t) => draftTokens.has(t)).length;
  return overlap / outcomeTokens.length >= 0.7;
}

/**
 * @param {object} args
 * @param {object} args.job - The agentJobs document data with
 *   output.aria.draft populated.
 * @returns {Promise<object>}
 *   { aligned, citations, gaps, drift, kbVersion, kbWarning }
 */
async function runCala({job}) {
  const input = job.input || {};
  const ariaOutput = job.output && job.output.aria;
  const draft = ariaOutput && ariaOutput.draft;
  if (!draft) {
    throw new Error("Cala needs job.output.aria.draft — Aria must run first.");
  }

  const {kbMatch, kbWarning, kbVersion} = await resolveCbcContext({
    grade: input.grade,
    subject: input.subject,
    topic: input.topic,
    subtopic: input.subtopic,
    term: input.term,
  });

  const draftText = collectDraftText(draft);
  const normDraft = normalise(draftText);
  const draftTokens = new Set(normDraft.split(" ").filter(Boolean));

  const gaps = [];
  let citations = [];
  let drift = [];

  if (!kbMatch) {
    gaps.push({
      note: "Topic not found in verified CBC KB.",
      topic: input.topic || null,
    });
  } else {
    const outcomes = extractKbOutcomes(kbMatch);
    if (outcomes.length === 0) {
      gaps.push({
        note: "KB entry has no outcomes defined.",
        kbEntryId: kbMatch.id || null,
      });
    } else {
      for (let i = 0; i < outcomes.length; i++) {
        const text = outcomes[i];
        const outcome = buildOutcomeId(kbMatch, i);
        if (draftCoversOutcome(normDraft, draftTokens, text)) {
          citations.push({outcome, text});
        } else {
          gaps.push({outcome, text, note: "Outcome not covered in draft."});
        }
      }
    }

    // Drift: dotted codes mentioned in the draft that don't correspond
    // to anything in the KB entry. These usually mean the draft cited a
    // curriculum code that doesn't exist for this topic.
    const draftCodes = extractDottedCodes(draftText);
    if (draftCodes.length) {
      const kbCodes = new Set(
          extractDottedCodes(JSON.stringify(kbMatch || {})),
      );
      drift = draftCodes
          .filter((code) => !kbCodes.has(code))
          .map((code) => ({outcome: code, note: "Code not present in KB entry."}));
    }
  }

  return {
    aligned: gaps.length === 0,
    citations,
    gaps,
    drift,
    kbVersion,
    kbWarning: kbWarning || null,
  };
}

module.exports = {
  runCala,
  // Exported for the matcher unit test.
  _internals: {
    collectDraftText,
    extractKbOutcomes,
    draftCoversOutcome,
    buildOutcomeId,
    normalise,
  },
};
