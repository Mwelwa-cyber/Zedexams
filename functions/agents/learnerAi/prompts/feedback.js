/**
 * Learner Feedback Generator — prompt builders.
 *
 * Inputs:
 *   - curriculumReader (v2 contract) → grade, subject, term, topic,
 *     subtopic, citedExcerpts[].
 *   - attempt          → { score, outOf, percentage, topicScores }
 *   - strengths[]      → topics ≥ 70% on THIS attempt
 *   - weakAreas[]      → topics < 70% on THIS attempt + from
 *                        learnerWeaknessProfile if present
 *   - studyTip?        → an existing tip pulled from the latest
 *                        study_tips artifact for this learner
 *                        (re-use rather than re-invent)
 *   - parameters       → maxCorrectiveExplanations
 *
 * Hard rules baked into the prompt:
 *   - NO fake praise. Only mention strengths that exist in the
 *     strengths[] list; otherwise omit the strengths sentence.
 *   - NO shaming. State the score plainly. Frame weak areas as
 *     "you need to revise X" not "you failed X".
 *   - Match tone to score band:
 *       ≥ 85  → 'celebratory'   ("Excellent work!")
 *       70-84 → 'positive'      ("Good work.")
 *       50-69 → 'balanced'      ("A fair start.")
 *       30-49 → 'supportive'    ("Not the score we wanted, but...")
 *       < 30  → 'gentle'        ("This was tough — let's fix it.")
 *   - Corrective explanations ground in <cited_excerpts>. If a weak
 *     area has no excerpt support, OMIT the corrective explanation
 *     rather than invent.
 *   - One actionable studyTip — verb-led (Practice / Review / Draw /
 *     Solve / Write / Read). NEVER "study hard" or generic praise.
 *   - Use Zambian classroom English.
 */

const SYSTEM = `You write personalised post-quiz feedback for Zambian school learners.

Inputs you receive:
  - The learner's grade + subject from the official curriculum.
  - The learner's actual score on this specific quiz attempt.
  - Their strengths list (topics they did well on — ≥ 70% on this attempt).
  - Their weak areas list (topics under 70%, optionally enriched with
    the persistent weakness profile).
  - Optionally: an existing study tip pulled from a recent
    study_tips artifact — prefer reusing it over inventing a new one.
  - Cited curriculum excerpts for grounding corrective explanations.

Feedback rules (non-negotiable):

  1. HONEST. State the score plainly. Match the tone band:
     ≥ 85%  → 'celebratory'   — start with "Excellent work!" or similar.
     70-84% → 'positive'      — start with "Good work." or "Well done.".
     50-69% → 'balanced'      — start with "A fair start." or "Decent effort.".
     30-49% → 'supportive'    — start with "Not the score we wanted, but…".
     < 30%  → 'gentle'        — start with "This one was tough — let's fix it.".

  2. NO FAKE PRAISE. Only celebrate strengths if the strengths list
     is non-empty. If the learner scored low everywhere, OMIT the
     strengths sentence — do NOT manufacture praise.

  3. NO SHAMING. Frame weak areas as "you need to revise X" or
     "spend more time on X". Never "you failed", "you're bad at",
     "you didn't try".

  4. CORRECTIVE EXPLANATIONS. For each weak area, write a short
     "what to correct" + a 1-2 sentence "brief explanation" drawn
     from <cited_excerpts>. If a weak area has no matching excerpt,
     OMIT the corrective explanation for that area — do not invent
     curriculum facts.

  5. ONE STUDY TIP. Verb-led, specific to the top weak area. Examples:
     "Practice five same-denominator additions before bed."
     "Draw a labelled diagram of the heart with arteries and veins."
     NEVER "study hard", "practice more", "do your best".
     If an existing tip is supplied, prefer reusing it.

  6. RECOMMENDED NOTES + QUIZZES. Notes are titles for the learner to
     re-read. Quizzes carry numQuestions + difficulty hint. Aim
     EASIER than the failed attempt — confidence-build first.

  7. Zambian classroom English. Avoid foreign place names + currencies.

You MUST emit your output via the learner_feedback_output tool. Do
not return prose.`;

function selectExcerpts(curriculumReader) {
  const excerpts = curriculumReader && Array.isArray(curriculumReader.citedExcerpts) ?
    curriculumReader.citedExcerpts : [];
  return excerpts
      .map((e, i) => `[${i}] (${e.anchor || "module"}) ${e.text}`)
      .join("\n");
}

function pickTone(percentage) {
  const p = Number(percentage);
  if (!Number.isFinite(p)) return "balanced";
  if (p >= 85) return "celebratory";
  if (p >= 70) return "positive";
  if (p >= 50) return "balanced";
  if (p >= 30) return "supportive";
  return "gentle";
}

function buildUserMessage({curriculumReader, attempt, strengths, weakAreas, studyTip, parameters}) {
  const p = parameters || {};
  const maxCorrective = Number.isInteger(p.maxCorrectiveExplanations) ?
    p.maxCorrectiveExplanations : 4;
  const score = attempt && Number.isFinite(attempt.score) ? attempt.score : 0;
  const outOf = attempt && Number.isFinite(attempt.outOf) ? attempt.outOf : 0;
  const percentage = attempt && Number.isFinite(attempt.percentage) ?
    attempt.percentage :
    (outOf > 0 ? Math.round((score / outOf) * 100) : 0);
  const tone = pickTone(percentage);

  const lines = [
    `Grade: ${curriculumReader.grade}`,
    `Subject: ${curriculumReader.subject}`,
    `Term: ${curriculumReader.term ?? "n/a"}`,
    `Topic: ${curriculumReader.topic}`,
    `Sub-topic: ${curriculumReader.subtopic || "n/a"}`,
    "",
    `Score: ${score} / ${outOf} (${percentage}%)`,
    `Tone band: ${tone}`,
    "",
    "Strengths (mention only these — never invent extra ones):",
    ...(strengths && strengths.length ?
      strengths.map((s) => `  - ${s}`) :
      ["  (none — OMIT the strengths sentence entirely)"]),
    "",
    "Weak areas (one corrective explanation per weak area, up to " +
      `${maxCorrective}):`,
    ...(weakAreas && weakAreas.length ?
      weakAreas.map((s) => `  - ${s}`) :
      ["  (none — encourage continued practice)"]),
    "",
    studyTip ?
      `Reuse this existing study tip if it still applies:\n  "${studyTip}"` :
      "No existing study tip available — write one targeted at the top weak area.",
    "",
    "<cited_excerpts>",
    selectExcerpts(curriculumReader),
    "</cited_excerpts>",
    "",
    `Set tone="${tone}" in your tool-use output (matches the score band).`,
    "Emit your output by calling the learner_feedback_output tool.",
  ];
  return lines.join("\n");
}

module.exports = {SYSTEM, buildUserMessage, pickTone, selectExcerpts};
