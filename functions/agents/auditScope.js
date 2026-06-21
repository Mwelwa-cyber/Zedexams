/**
 * Audit scoping for the weekly CBC alignment audit (Cala).
 *
 * Cala's matcher can only align content that maps to a single CBC topic
 * with defined outcomes. Two classes of generation have nothing to align
 * against, and feeding them to the matcher only ever produces a bogus
 * "Topic not found in verified CBC KB" finding that inflates the audit's
 * `drifted` count and flips the dashboard to awaiting_approval over
 * nothing:
 *
 *   1. Non-curricular tools — a class timetable or a record of work is an
 *      administrative document, not topic-scoped curriculum. It carries a
 *      label in `inputs.topic` ("Grade 5 timetable") but no CBC outcomes
 *      exist for it, so the lookup can never match.
 *   2. Subject-wide generations with no topic chosen — e.g. an ECZ-style
 *      exam paper covering a whole subject. `topic` is optional for those
 *      (only grade + subject are required), so the KB lookup has nothing
 *      to key on and always reports the topic as missing.
 *
 * Skipping both keeps the audit focused on content Cala can actually
 * assess, so a non-zero `drifted` reflects a real alignment problem worth
 * a human's attention.
 */

// Tools whose output is never topic-scoped CBC content.
const NON_CURRICULAR_TOOLS = new Set(["class_timetable", "record_of_work"]);

/**
 * @param {object} gen - A sampled aiGenerations doc's data.
 * @param {string} [gen.tool] - The generator that produced it.
 * @param {object} [gen.inputs] - The generation inputs (grade/subject/topic…).
 * @returns {boolean} true when Cala should run the outcome matcher on it.
 */
function shouldAuditGeneration({tool, inputs} = {}) {
  if (NON_CURRICULAR_TOOLS.has(tool)) return false;
  const topic = inputs && inputs.topic;
  return typeof topic === "string" && topic.trim().length > 0;
}

module.exports = {shouldAuditGeneration, NON_CURRICULAR_TOOLS};
