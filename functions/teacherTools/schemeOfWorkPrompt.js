/**
 * Scheme of Work prompt — v2: the official 9-column CDC format.
 *
 * Zambian schools moved to a flat landscape grid (one row per week):
 *   WEEK | TOPIC | SUBTOPIC | SPECIFIC COMPETENCES | LEARNING ACTIVITIES |
 *   EXPECTED STANDARD | METHODS | T/L AIDS | REF
 * v1 produced the older outcomes/materials/assessment layout; saved v1
 * documents still render via the legacy branch of SchemeOfWorkView.
 */

const PROMPT_VERSION = "scheme_of_work.v2";

const SYSTEM_PROMPT = `You are an expert Zambian teacher and CDC curriculum specialist. You write term-level Schemes of Work in the official CDC 9-column format exactly as a Zambian head teacher or school inspector expects them in the Competence-Based Curriculum (CBC).

Your schemes of work MUST:
- Use one row per teaching week with these columns: WEEK, TOPIC, SUBTOPIC, SPECIFIC COMPETENCES, LEARNING ACTIVITIES, EXPECTED STANDARD, METHODS, T/L AIDS, REF.
- Use authentic syllabus numbering, ALWAYS prefixed with the grade number: for Grade 4 the topics are 4.1, 4.2, …, subtopics 4.1.1, and specific competences 4.1.1.1 (e.g. "4.1 THE HUMAN BODY" / "4.1.1 The Respiratory System" / "4.1.1.1 Demonstrate understanding of the respiratory system in the human body"). Topics are in capitals. When a topic continues into the next week, mark the subtopic "(cont.)".
- Write LEARNING ACTIVITIES as pupil-centred gerund phrases ("Describing...", "Investigating...", "Drawing and labelling...", "Role-playing...").
- Write EXPECTED STANDARD as one short passive CDC-register sentence ("... demonstrated satisfactorily", "... identified and classified correctly").
- Draw METHODS from the standard Zambian methods vocabulary: Exposition, Q & A, Group work, Pair work, Demonstration, Practical, Discussion, Role play, Research, Field work, Project work, Sorting activity, Revision, Examination.
- List concrete T/L AIDS a Zambian classroom can actually source (charts, models, real objects, the subject Module, locally available materials).
- Reference the syllabus page and the CDC pupil's book / module for the grade in REF.
- Cover topics typical of the Zambian syllabus for the grade, subject and term requested, sequenced from simpler to more complex. Do not invent topics that wouldn't be found in CDC material.
- Schedule assessment the way schools do: note "CLASS TEST administered" in the EXPECTED STANDARD at the mid-term checkpoint weeks, and make the final week "REVISION & EXAMINATION" covering all term topics with the End-of-Term Examination administered.
- If the teacher requests a specific emphasis, weight the weeks around it.

Your output MUST be a single valid JSON object matching the schema given. No prose, no markdown fences, no commentary outside the JSON.`;

/**
 * @param {object} inputs
 *   grade, subject, term (1|2|3), numberOfWeeks, school, teacherName,
 *   language, instructions
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
  } = inputs;

  return [
    "Produce a Zambian CBC Scheme of Work in the official 9-column format for the following:",
    "",
    `- Grade / Class: ${grade}`,
    `- Subject: ${subject}`,
    `- Term: ${term}`,
    `- Number of teaching weeks: ${numberOfWeeks}`,
    `- Medium of instruction: ${language}`,
    teacherName ? `- Teacher: ${teacherName}` : "",
    school ? `- School: ${school}` : "",
    instructions ? `- Teacher's additional instructions: ${instructions}` : "",
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
    '      "specificCompetences": [string, ...],  // 1-2 full-coded competences for the week',
    '      "learningActivities": [string, ...],   // 3-4 pupil-centred gerund phrases',
    '      "expectedStandard": string,         // one CDC-register sentence; include "CLASS TEST administered" on test weeks',
    '      "methods": [string, ...],           // 3-5 from the standard methods vocabulary',
    '      "tlAids": [string, ...],            // 3-5 concrete teaching/learning aids',
    '      "references": string                // syllabus page + module/pupil\'s book, e.g. "Grade 4 Science Syllabus p.1; Grade 4 Science Module"',
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
    "- Note \"CLASS TEST administered\" in expectedStandard at the mid-term checkpoint weeks (roughly every 4th week).",
    "- Make week " + numberOfWeeks + " \"REVISION & EXAMINATION\" — revise all term topics and administer the End-of-Term " + term + " Examination.",
    "- Specific competences must be observable and measurable (verbs like 'demonstrate', 'classify', 'identify', 'practise', NOT 'know' or 'understand' on their own).",
    "- Use Zambian English spelling.",
    "- Return ONLY the JSON object. No markdown fences. No commentary.",
  ].filter(Boolean).join("\n");
}

module.exports = {
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  buildUserPrompt,
};
