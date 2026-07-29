/**
 * Scheme of Work prompt — the official 9-column CDC format.
 *
 * Zambian schools moved to a flat landscape grid (one row per week):
 *   WEEK | TOPIC | SUBTOPIC | SPECIFIC COMPETENCES | LEARNING ACTIVITIES |
 *   EXPECTED STANDARD | METHODS | T/L AIDS | REF
 * v1 produced the older outcomes/materials/assessment layout; saved v1
 * documents still render via the legacy branch of SchemeOfWorkView.
 *
 * This version adds explicit curriculum awareness: the studio now sends an
 * explicit `curriculum` ('cbc' | 'previous') / `framework` ('2023' | '2013')
 * chosen by the teacher, and the scheme must honour it — CBC uses
 * competence-based language and specific competences; the Previous curriculum
 * uses outcome-based language, "pupils" and specific outcomes/objectives. The
 * two must never be mixed. The output JSON schema/keys are identical for both.
 */

const {subjectNameForGrade} = require("./subjectNaming");

// NOTE: version bumped forward from the existing "scheme_of_work.v3" to mark
// the curriculum-aware prompt (the brief's "v2" target predates this tool
// already being at v3 — a downgrade would collide with the historical v2/v3).
// v5 splits OBC into its own leaner 7-column format (no learning-activities /
// expected-standard columns) and adds calendar week-plan pacing.
// v6 adopts the studio spec's term shape: class tests close every subtopic
// block (~2 weeks), dedicated REVISION weeks precede a final END OF TERM EXAM
// week (END OF YEAR EXAM in Term 3), activities are 3-5 locally-contextual
// items, and the methods vocabulary gains Problem solving / Simulation /
// Peer teaching / ICT demonstration.
const PROMPT_VERSION = "scheme_of_work.v6";

const SYSTEM_PROMPT_CBC = `You are an expert Zambian teacher and CDC curriculum specialist. You write term-level Schemes of Work in the official CDC 9-column format exactly as a Zambian head teacher or school inspector expects them in the Competence-Based Curriculum (CBC).

Your schemes of work MUST:
- Use one row per teaching week with these columns: WEEK, TOPIC, SUBTOPIC, SPECIFIC COMPETENCES, LEARNING ACTIVITIES, EXPECTED STANDARD, METHODS, T/L AIDS, REF.
- Be grounded in the curriculum. When a <curriculum_outline> block is provided, it is the AUTHORITATIVE list of topics and sub-topics for this grade and subject — sequence THOSE topics across the term (simpler to more complex) and do NOT invent topics that aren't represented there. Use its sub-topics, specific competences and suggested materials. Only fall back to your own knowledge of the Zambian CBC for a grade+subject when no outline is provided.
- Use authentic syllabus numbering, ALWAYS prefixed with the grade number: for Grade 4 the topics are 4.1, 4.2, …, subtopics 4.1.1, and specific competences 4.1.1.1 (e.g. "4.1 THE HUMAN BODY" / "4.1.1 The Respiratory System" / "4.1.1.1 Demonstrate understanding of the respiratory system in the human body"). Topics are in capitals. When a topic continues into the next week, mark the subtopic "(cont.)".
- Write LEARNING ACTIVITIES as 3-5 pupil-centred gerund phrases per week ("Describing...", "Investigating...", "Drawing and labelling...", "Role-playing..."). This is the RICHEST column: make each activity concrete, doable in a large Zambian class with limited resources, and locally contextual (Kwacha and Ngwee, the local market, groundnuts, drums, the school garden, real objects, circle/Venn diagrams) — never repetitive boilerplate.
- Write EXPECTED STANDARD as one short passive CDC-register sentence ("... demonstrated satisfactorily", "... identified and classified correctly").
- Draw METHODS from the standard Zambian methods vocabulary: Exposition, Q & A, Group work, Pair work, Demonstration, Practical, Discussion, Problem solving, Role play, Simulation, Research, Field work, Project work, Peer teaching, ICT demonstration, Sorting activity, Revision, Written examination.
- List concrete T/L AIDS a Zambian classroom can actually source (charts, models, real objects, the subject Module, locally available materials).
- Match the language to the grade: simpler and more activity-based for lower primary; more analytical and exam-oriented for upper grades.
- Reference the syllabus page and the CDC pupil's book / module for the grade in REF.
- Cover topics typical of the Zambian syllabus for the grade, subject and term requested, sequenced from simpler to more complex. Do not invent topics that wouldn't be found in CDC material.
- If a <term_module_outline> block is provided (an uploaded module used as a backup source when no <curriculum_outline> exists), it is VERIFIED uploaded curriculum for this term: use its exact topic and sub-topic arrangement and naming as the backbone for sequencing the weeks, draw each week's specific competences, learning activities, expected standard and T/L aids from it, tag those weeks' source as "uploaded_module", and do not introduce topics it doesn't contain.
- Pace the term around the teacher's actual timetable when one is given: spread the topics so they fit the stated number of periods per week, and don't schedule more in a week than those periods allow.
- Respect the calendar week plan when one is provided: do not schedule new topics into weeks reserved for REVISION or EXAMINATION, and spread the delivery topics across the remaining teaching weeks only.
- Format a reserved REVISION week as TOPIC "REVISION", SUBTOPIC "All Topics Covered", with activities that review the term's topics by name (in Term 3, comprehensive revision covers the WHOLE YEAR's topics, not just Term 3's).
- Format the reserved examination week (always the final week) as TOPIC "END OF TERM EXAM" — "END OF YEAR EXAM" in Term 3 — with SUBTOPIC "All Topics" and METHODS "Written examination / Individual assessment".
- Schedule class tests the way schools do: a CLASS TEST closes each subtopic block (roughly every 2 weeks). Add "CLASS TEST administered" as the FINAL item in that week's LEARNING ACTIVITIES and reflect the test in its EXPECTED STANDARD.
- If the teacher requests a specific emphasis, weight the weeks around it. If the teacher asks for a project, schedule an "INTEGRATED PROJECT" week that applies several of the term's topics in one real-life task (this suits Term 3 especially).
- Tag every week's "source" honestly: "syllabi_studio" when the week's topic comes from the provided <curriculum_outline>, "uploaded_module" when it comes from a supplemental <curriculum_module>/<cbc_context> block, or "ai_inferred" when you had to rely on general CBC knowledge because the curriculum data didn't cover it.

Your output MUST be a single valid JSON object matching the schema given. No prose, no markdown fences, no commentary outside the JSON.`;

const SYSTEM_PROMPT_PREVIOUS = `You are an expert Zambian teacher and curriculum specialist. You write term-level Schemes of Work in the official Outcome-Based Curriculum (OBC) 7-column format exactly as a Zambian head teacher or school inspector expects them under the 2013 Previous Curriculum (Outcomes-Based Education).

The OBC scheme of work is LEANER than the CBC one — it has NO "learning activities" column and NO "expected standard" column.

Your schemes of work MUST:
- Use one row per teaching week with EXACTLY these columns: WEEK, TOPIC, SUBTOPIC, SPECIFIC OUTCOMES, METHODS, T/L AIDS, REF. Do NOT produce learning activities or an expected standard — OBC schemes do not have those columns.
- In the output JSON, carry the SPECIFIC OUTCOMES in the "specificCompetences" field (the schema keys are unchanged), and leave "learningActivities" as an empty array [] and "expectedStandard" as an empty string "". These two fields must stay empty for every week.
- Be grounded in the curriculum. When a <curriculum_outline> block is provided, it is the AUTHORITATIVE list of topics and sub-topics for this grade and subject — sequence THOSE topics across the term (simpler to more complex) and do NOT invent topics that aren't represented there. Use its sub-topics, specific outcomes/objectives and suggested materials. Only fall back to your own knowledge of the Zambian 2013 Previous Curriculum for a grade+subject when no outline is provided.
- Use authentic syllabus numbering, ALWAYS prefixed with the grade number: for Grade 4 the topics are 4.1, 4.2, …, subtopics 4.1.1, and specific outcomes 4.1.1.1 (e.g. "4.1 THE HUMAN BODY" / "4.1.1 The Respiratory System" / "4.1.1.1 Describe the respiratory system in the human body"). Topics are in capitals. When a topic continues into the next week, mark the subtopic "(cont.)".
- Write SPECIFIC OUTCOMES as observable, measurable outcome statements ("Describe...", "Identify...", "State...", "Explain...").
- Draw METHODS from the standard Zambian methods vocabulary: Exposition, Q & A, Group work, Pair work, Demonstration, Practical, Discussion, Problem solving, Role play, Simulation, Research, Field work, Project work, Peer teaching, ICT demonstration, Sorting activity, Revision, Written examination.
- List concrete T/L AIDS a Zambian classroom can actually source (charts, models, real objects, the subject textbook, locally available materials).
- Reference the syllabus page and the pupil's book / textbook for the grade in REF.
- Cover topics typical of the Zambian 2013 syllabus for the grade, subject and term requested, sequenced from simpler to more complex. Do not invent topics that wouldn't be found in the 2013 syllabus material.
- If a <term_module_outline> block is provided (an uploaded module used as a backup source when no <curriculum_outline> exists), it is VERIFIED uploaded curriculum for this term: use its exact topic and sub-topic arrangement and naming as the backbone for sequencing the weeks, draw each week's specific outcomes and T/L aids from it, tag those weeks' source as "uploaded_module", and do not introduce topics it doesn't contain.
- Pace the term around the teacher's actual timetable when one is given: spread the topics so they fit the stated number of periods per week, and don't schedule more in a week than those periods allow.
- Respect the calendar week plan when one is provided: do not schedule new topics into weeks reserved for REVISION or EXAMINATION, and spread the delivery topics across the remaining teaching weeks only.
- Format a reserved REVISION week as TOPIC "REVISION", SUBTOPIC "All Topics Covered" (in Term 3, revision covers the WHOLE YEAR's topics, not just Term 3's).
- Format the reserved examination week (always the final week) as TOPIC "END OF TERM EXAM" — "END OF YEAR EXAM" in Term 3 — with SUBTOPIC "All Topics" and METHODS "Written examination / Individual assessment".
- If the teacher requests a specific emphasis, weight the weeks around it.
- Tag every week's "source" honestly: "syllabi_studio" when the week's topic comes from the provided <curriculum_outline>, "uploaded_module" when it comes from a supplemental <curriculum_module>/<cbc_context> block, or "ai_inferred" when you had to rely on general knowledge of the 2013 Previous Curriculum because the curriculum data didn't cover it.

Use outcome-based language and refer to the class as "pupils". Do NOT use CBC "competence" framing.

Your output MUST be a single valid JSON object matching the schema given. No prose, no markdown fences, no commentary outside the JSON.`;

// Backward-compatible default alias (CBC).
const SYSTEM_PROMPT = SYSTEM_PROMPT_CBC;

/** True when the teacher chose the Previous (2013 / outcome-based) curriculum. */
function isPreviousCurriculum(inputs = {}) {
  return String(inputs.curriculum || "").toLowerCase() === "previous" ||
    String(inputs.framework || "") === "2013";
}

/** Select the system prompt for the chosen curriculum. */
function pickSystemPrompt(inputs = {}) {
  return isPreviousCurriculum(inputs) ? SYSTEM_PROMPT_PREVIOUS : SYSTEM_PROMPT_CBC;
}

/**
 * Render the calendar week plan (from the School Calendar) as a compact
 * instruction block: each week's dates + whether it's a teaching, revision or
 * exam week + any public holidays. Returns "" when no plan was supplied.
 */
function buildWeekPlanLine(weekPlan) {
  if (!Array.isArray(weekPlan) || weekPlan.length === 0) return "";
  const rows = weekPlan.map((w) => {
    const role = w.role === "exam" ? "EXAMINATION" :
      (w.role === "revision" ? "REVISION" : "teaching");
    const dates = [w.beginning, w.ending].filter(Boolean).join(" – ");
    const hols = Array.isArray(w.holidays) && w.holidays.length ?
      ` · holidays: ${w.holidays.join(", ")}` : "";
    return `  Week ${w.week}${dates ? ` (${dates})` : ""}: ${role}${hols}`;
  });
  return [
    "- Calendar week plan for this term (from the School Calendar) — pace " +
    "topics across the teaching weeks only, reserve the marked weeks:",
    ...rows,
  ].join("\n");
}

/**
 * Render a teacher-approved topic backbone (the reviewed & edited term plan
 * from the studio's preview step) as an authoritative ordered sequence. When
 * present it OVERRIDES the breadth of <curriculum_outline>: the model must
 * sequence exactly these topics, in this order, across the teaching weeks —
 * nothing added, nothing dropped. Returns "" when the teacher approved no
 * explicit plan (the model then paces the <curriculum_outline> itself).
 */
function buildTopicSelectionBlock(topicSelection, term) {
  if (!Array.isArray(topicSelection) || topicSelection.length === 0) return "";
  const rows = topicSelection.map((t, i) => {
    const subs = Array.isArray(t.subtopics) && t.subtopics.length ?
      ` — sub-topics: ${t.subtopics.join("; ")}` : "";
    const wk = Number(t.weeks) > 0 ? ` [~${Number(t.weeks)} week${Number(t.weeks) === 1 ? "" : "s"}]` : "";
    const rev = t.isRevision ? " (REVISION)" : "";
    return `  ${i + 1}. ${t.topic}${wk}${rev}${subs}`;
  });
  return [
    `<approved_term_plan term="${term}">`,
    "The teacher has REVIEWED and APPROVED this exact ordered list of topics " +
    "for THIS term (Term " + term + "). It is authoritative: sequence THESE " +
    "topics across the teaching weeks in THIS order, honouring the suggested " +
    "week span for each. Do NOT add topics that are not in this list, do NOT " +
    "drop any, and do NOT restart with topics from an earlier term. A topic " +
    "whose span is more than one week continues across consecutive weeks " +
    "(mark the later week's sub-topic \"(cont.)\"). Combine short one-week " +
    "topics only if needed to fit the calendar. Topics flagged (REVISION) are " +
    "deliberate revision of earlier material.",
    ...rows,
    "</approved_term_plan>",
  ].join("\n");
}

/**
 * @param {object} inputs
 *   grade, subject, term (1|2|3), numberOfWeeks, school, teacherName,
 *   language, instructions, curriculum, framework
 */
function buildUserPrompt(inputs) {
  const {
    grade,
    subject,
    term = 1,
    numberOfWeeks = 12,
    school = "",
    teacherName = "",
    language = "English",
    instructions = "",
    periodsPerWeek = "",
    teachingDays = [],
    hasOutline = false,
    hasModuleOutline = false,
    weekPlan = [],
    topicSelection = [],
  } = inputs;

  const previous = isPreviousCurriculum(inputs);
  const daysLine = Array.isArray(teachingDays) && teachingDays.length ?
    teachingDays.join(", ") : "";
  const planLine = buildWeekPlanLine(weekPlan);
  const approvedPlanBlock = buildTopicSelectionBlock(topicSelection, term);

  return [
    previous ?
      "Produce a Zambian Outcome-Based Curriculum (OBC) Scheme of Work in the " +
      "official 7-column format (no learning-activities or expected-standard " +
      "columns) for the following:" :
      "Produce a Zambian CBC Scheme of Work in the official 9-column format " +
      "for the following:",
    "",
    `- Grade / Class: ${grade}`,
    `- Subject: ${subjectNameForGrade(subject, grade)}`,
    `- Term: ${term}`,
    `- Number of teaching weeks: ${numberOfWeeks}`,
    `- Medium of instruction: ${language}`,
    previous ?
      `- Curriculum: OBC (Outcome-Based). Sequence the weeks around the ` +
      `grade's specific outcomes/objectives and refer to the class as "pupils".` :
      `- Curriculum: CBC (Competence-Based). Sequence the weeks around the ` +
      `grade's specific competences and refer to the class as "learners".`,
    periodsPerWeek ?
      `- Periods per week (from the teacher's timetable/framework): ${periodsPerWeek}` : "",
    daysLine ?
      `- Days this subject is taught (from the timetable): ${daysLine}` : "",
    planLine,
    teacherName ? `- Teacher: ${teacherName}` : "",
    school ? `- School: ${school}` : "",
    instructions ? `- Teacher's additional instructions: ${instructions}` : "",
    "",
    approvedPlanBlock,
    approvedPlanBlock ?
      "Follow the <approved_term_plan> above EXACTLY — it is the teacher's " +
      "reviewed sequence for this term. Sequence its topics in order across " +
      "the teaching weeks, honouring each topic's week span; do not add, drop, " +
      "reorder, or restart with an earlier term's topics." :
      (hasOutline ?
      "Use the <curriculum_outline> block above as the authoritative topic " +
      "list — sequence its topics across the weeks; do not invent topics " +
      "outside it." :
      (hasModuleOutline ?
        "No Syllabi Studio outline exists for this grade+subject, but a " +
        "<term_module_outline> from an uploaded module is provided — use it " +
        "as the topic backbone and tag those weeks' source as " +
        "\"uploaded_module\"." :
        "No official curriculum outline was found for this grade+subject — " +
        "use your expert knowledge of the Zambian CBC syllabus for it, and " +
        "tag those weeks' source as \"ai_inferred\".")),
    "",
    "Produce the scheme of work as a single JSON object with EXACTLY these keys:",
    "",
    "{",
    '  "header": {',
    '    "school": string, "teacherName": string,',
    '    "grade": string,        // as printed on the document, e.g. "4" for Grade 4, "ECE" for ECE',
    '    "subject": string,      // human-readable, e.g. "Integrated Science"',
    '    "term": number, "numberOfWeeks": number,',
    '    "year": string,          // academic year, e.g. "2026"',
    '    "periodsPerWeek": string, // standard CDC allocation, e.g. "6 periods × 40 minutes"; "" if unsure',
    '    "mediumOfInstruction": string',
    "  },",
    '  "weeks": [',
    "    {",
    '      "week": 1,',
    '      "topic": string,                    // syllabus-coded, in capitals, e.g. "4.1 THE HUMAN BODY"',
    '      "subtopic": string,                 // syllabus-coded, e.g. "4.1.1 The Respiratory System"; "(cont.)" when continuing',
    previous ?
      '      "specificCompetences": [string, ...],  // 1-2 full-coded SPECIFIC OUTCOMES for the week' :
      '      "specificCompetences": [string, ...],  // 1-2 full-coded competences for the week',
    previous ?
      '      "learningActivities": [],            // OBC: MUST be an empty array — no learning-activities column' :
      '      "learningActivities": [string, ...],   // 3-5 pupil-centred gerund phrases in local Zambian contexts',
    previous ?
      '      "expectedStandard": "",             // OBC: MUST be an empty string — no expected-standard column' :
      '      "expectedStandard": string,         // one CDC-register sentence; include "CLASS TEST administered" on test weeks',
    '      "methods": [string, ...],           // 3-5 from the standard methods vocabulary',
    '      "tlAids": [string, ...],            // 3-5 concrete teaching/learning aids',
    '      "references": string,               // syllabus page + module/pupil\'s book, e.g. "Grade 4 Science Syllabus p.1; Grade 4 Science Module"',
    '      "source": string                    // "syllabi_studio" | "uploaded_module" | "ai_inferred" — where this week\'s topic came from',
    "    },",
    "    ...  // exactly " + numberOfWeeks + " weeks",
    "  ]",
    "}",
    "",
    "Rules:",
    "- Produce EXACTLY " + numberOfWeeks + " week entries, numbered 1 to " + numberOfWeeks + ".",
    "- Sequence topics logically — start with foundational material, build complexity.",
    "- Syllabus codes carry the grade number: " +
      String(grade).replace(/^G/i, "") + ".1, " +
      String(grade).replace(/^G/i, "") + ".2, … for the topics of this grade.",
    previous ?
      "- OBC has no learning-activities and no expected-standard columns: set every week's \"learningActivities\" to [] and \"expectedStandard\" to \"\"." :
      "- Close each subtopic block (roughly every 2 weeks) with a class test: add \"CLASS TEST administered\" as the FINAL item in that week's learningActivities and reflect it in its expectedStandard.",
    "- Make week " + numberOfWeeks + " the examination week: topic \"" +
      (Number(term) === 3 ? "END OF YEAR EXAM" : "END OF TERM EXAM") +
      "\", subtopic \"All Topics\", methods including \"Written examination\" " +
      "and \"Individual assessment\"" +
      (Number(term) === 3 ?
        "; revision weeks before it revise the WHOLE YEAR's topics." :
        "; any REVISION week before it uses topic \"REVISION\" and subtopic \"All Topics Covered\"."),
    previous ?
      "- Specific outcomes must be observable and measurable (verbs like 'describe', 'identify', 'state', 'explain', NOT 'know' or 'understand' on their own)." :
      "- Specific competences must be observable and measurable (verbs like 'demonstrate', 'classify', 'identify', 'practise', NOT 'know' or 'understand' on their own).",
    Array.isArray(weekPlan) && weekPlan.length ?
      "- Honour the calendar week plan above: weeks marked REVISION or EXAMINATION carry no new topic (revision/exam content only); deliver new topics only in the teaching weeks." : "",
    periodsPerWeek ?
      "- Set header.periodsPerWeek to \"" + periodsPerWeek + "\" (the teacher's " +
      "timetable allocation) and pace each week so it fits that many periods." :
      "- Set header.periodsPerWeek to the standard CDC allocation for this " +
      "grade+subject.",
    "- Set each week's \"source\" honestly per the rule in the instructions.",
    "- Never write filler like \"I don't know\", \"N/A\", \"unknown\" or \"TBD\" in any field. Always give the real CDC-appropriate value; if a reference page is genuinely uncertain, cite the grade+subject syllabus and module generically instead.",
    "- Use Zambian English spelling.",
    "- Return ONLY the JSON object. No markdown fences. No commentary.",
  ].filter(Boolean).join("\n");
}

module.exports = {
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  SYSTEM_PROMPT_CBC,
  SYSTEM_PROMPT_PREVIOUS,
  pickSystemPrompt,
  isPreviousCurriculum,
  buildUserPrompt,
  buildTopicSelectionBlock,
};
