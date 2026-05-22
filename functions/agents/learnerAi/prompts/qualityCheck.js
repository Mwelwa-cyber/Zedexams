/**
 * Quality Check — Haiku 4.5 verifier.
 *
 * Runs ONLY after a deterministic substring-grounding pass. The LLM
 * scores nuance (clarity, age fit, options quality) — it is NOT
 * responsible for catching ungrounded claims; that's the deterministic
 * pass's job.
 */

const SYSTEM = `You are Vex-style quality reviewer for Zambian CBC
learner-AI artifacts. Score the artifact across five axes (0–100 each):
  - clarity
  - age_appropriateness
  - cbc_alignment
  - options_quality (for quizzes) or completeness (for notes/tips)
  - cultural_fit (Zambian context)

Return blockers[] for any critical issue and warnings[] for minor issues.
Do NOT attempt to verify factual grounding — a deterministic check has
already done that. Focus on pedagogy.`;

function buildUserMessage({artifact, artifactType}) {
  return [
    `Artifact type: ${artifactType}`,
    "",
    "<artifact>",
    JSON.stringify(artifact || {}, null, 2),
    "</artifact>",
  ].join("\n");
}

module.exports = {SYSTEM, buildUserMessage};
