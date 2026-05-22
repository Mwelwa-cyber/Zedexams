/**
 * Study Tips Generator — prompt builders.
 *
 * Inputs:
 *   - curriculumReader (v2 agent contract) → grade, subject, topic,
 *     subtopic, keyConcepts[], citedExcerpts[].
 *   - weakSignals: [{ source, topic, subtopic, mistakeNote }] —
 *     pre-computed by the runner from learnerWeaknessProfiles +
 *     task.parameters.weakAreas (NEVER generic — runner refuses
 *     without at least one signal).
 *   - parameters → maxTips, includeRevisionPlan, planDurationDays.
 *
 * Hard rules baked in:
 *   - Every tip must tie back to one weakSignal — the `reason` field
 *     names the topic and the specific mistake.
 *   - Tips MUST start with an imperative verb (Practice / Draw /
 *     Review / Solve / Memorise / Write / Read / List / ...).
 *   - Tips MUST be specific to the learner's weak topic — never
 *     "study hard" or "practice more". Quality Check v3 will fail
 *     the artifact otherwise.
 *   - Feedback is encouraging-but-honest: name the gap, then point
 *     at the fix.
 *   - Use Zambian classroom English. No foreign currencies / cities.
 */

const SYSTEM = `You write personalised study tips for Zambian school learners.

Inputs you receive:
  - The learner's weak topics and subtopics (from their performance
    history). NEVER generate tips outside these.
  - The official curriculum context for those weak topics.
  - The learner's grade — match vocabulary complexity.

Tip-writing standards (non-negotiable):
  - Each tip starts with an imperative verb: Practice, Draw, Review,
    Solve, Memorise, Write, Read, List, Spell, Count, Underline,
    Trace, Circle, ...
  - Each tip names the specific weak topic or subtopic.
  - Each tip's "reason" field explains WHY it was offered, referring
    to the weakness signal (e.g. "You missed 3/5 same-denominator
    questions last attempt — start there.").
  - Each tip is one sentence. Maximum 30 words.
  - NEVER write generic tips like "study hard", "practice more",
    "believe in yourself", "never give up". Quality Check will
    reject the artifact.

Feedback opener:
  - Honest: name the score or the gap in plain words.
  - Encouraging: say what is fixable and how quickly.
  - 2-4 sentences. Use the learner's voice (you / your).

Revision plan (day-by-day):
  - Day 1 is "today". One focus per day. One concrete activity per
    day with an estimatedMinutes. Build up: vocabulary → examples
    → practice → harder application → revision.

Recommended notes / quizzes:
  - Notes: titles of notes the learner should re-read first.
  - Quizzes: each entry suggests a focus + a difficulty hint the
    learner-AI practice-quiz generator will honour.

You MAY only reference content from <cited_excerpts>. Do not invent
new CBC facts. Use Zambian classroom English. No foreign place names
or currencies.

You MUST emit your output via the study_tips_output tool. Do not
return prose.`;

function selectExcerpts(curriculumReader) {
  const excerpts = curriculumReader && Array.isArray(curriculumReader.citedExcerpts) ?
    curriculumReader.citedExcerpts : [];
  return excerpts
      .map((e, i) => `[${i}] (${e.anchor || "module"}) ${e.text}`)
      .join("\n");
}

function renderSignals(weakSignals) {
  if (!Array.isArray(weakSignals) || !weakSignals.length) return "(none)";
  return weakSignals
      .map((s, i) => {
        const sub = s.subtopic ? ` / ${s.subtopic}` : "";
        const why = s.mistakeNote ? ` — ${s.mistakeNote}` : "";
        return `[${i}] ${s.source.toUpperCase()}: ${s.topic}${sub}${why}`;
      })
      .join("\n");
}

function buildUserMessage({curriculumReader, weakSignals, parameters}) {
  const p = parameters || {};
  const maxTips = Number.isInteger(p.maxTips) ? p.maxTips : 6;
  const includeRevisionPlan = p.includeRevisionPlan !== false;
  const planDurationDays = Number.isInteger(p.planDurationDays) ?
    p.planDurationDays : 7;

  const lines = [
    `Learner grade: ${curriculumReader.grade}`,
    `Subject: ${curriculumReader.subject}`,
    `Curriculum topic: ${curriculumReader.topic}`,
    `Curriculum sub-topic: ${curriculumReader.subtopic || "n/a"}`,
    `Source document: ${curriculumReader.sourceDocId} ` +
      `(${curriculumReader.curriculumDocumentPath})`,
    "",
    "Weakness signals (use ALL of these — produce one tip per signal " +
      "where possible; never invent extra topics):",
    renderSignals(weakSignals),
    "",
    `Target tip count: ${maxTips}`,
    `Revision plan: ${includeRevisionPlan ? `${planDurationDays}-day plan, day 1 = today` : "OMIT"}`,
    "",
    "Curriculum key concepts (use as terminology anchors):",
    ...(curriculumReader.keyConcepts || []).slice(0, 8).map((k) => `  - ${k}`),
    "",
    "<cited_excerpts>",
    selectExcerpts(curriculumReader),
    "</cited_excerpts>",
    "",
    "Emit your output by calling the study_tips_output tool.",
  ];
  return lines.join("\n");
}

module.exports = {SYSTEM, buildUserMessage, renderSignals, selectExcerpts};
