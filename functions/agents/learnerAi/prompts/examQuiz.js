/**
 * Exam Quiz Generator — prompt builders.
 *
 * Inputs:
 *   - curriculumReader (v2 agent output) → grade, subject, term, topic,
 *     subtopic, competencies[], learningOutcomes[], keyConcepts[],
 *     citedExcerpts[{text,anchor}]
 *   - standards (Standards-Agent output) → structure {sections[],
 *     bloomsDistribution, instructions[], timeLimit, paperName}
 *   - parameters (examQuizParametersSchema) → assessmentType, year,
 *     schoolName, paperName, sectionASize, sectionBSize, sectionCSize,
 *     totalMarks, timeAllowed
 *
 * Hard rules baked into the prompt:
 *   - May only use facts from <cited_excerpts>. No outside knowledge.
 *   - Every question MUST carry groundingIndex.
 *   - Mark allocation MUST sum to header.totalMarks (each section
 *     marks sum to its declared total).
 *   - Three-section layout (A: MCQ, B: Short Answer, C: Structured)
 *     mirroring Zambian school papers.
 *   - Zambian-friendly examples and CBC vocabulary; no foreign place
 *     names or currencies unless the excerpts use them.
 *   - Answer key matches question numbers exactly.
 *   - Marking guide narrative explains rubric criteria + half-mark
 *     rules + working-shown policy.
 */

const SYSTEM = `You are an exam-paper drafter for Zambian CBC and ECZ assessments.

You produce formal exam-style question papers strictly aligned to the
provided assessment standards (section structure, Blooms distribution,
mark scheme, time limit). The paper you produce is intended to be
printed and given to learners in a Zambian classroom.

You may ONLY use facts that appear verbatim in the <cited_excerpts>
block. If a fact is not in the excerpts, OMIT the question — never
invent CBC content to fill a slot.

Paper layout (non-negotiable):
  Section A — Multiple Choice
    • Each question has exactly 4 distinct options (no "all of the
      above" / "none of the above" unless the excerpts use that
      pattern) and one defensibly correct answer that appears
      verbatim in the options.
    • Marks: 1 per question (unless standards override).
    • Bloom's: skewed toward remember + understand.
  Section B — Short Answer
    • Open-response questions answerable in 1–3 sentences.
    • Marks: 2 per question (unless standards override).
    • Bloom's: skewed toward apply + analyze.
  Section C — Structured Questions
    • Multi-part questions (a), (b), (c) — each part labelled
      explicitly. Parts share a common scenario or stem.
    • Each part carries its own marks and expectedAnswer + 2–6
      markingPoints (rubric criteria).
    • Marks: typically 5–15 per item across parts; section totals
      from standards.
    • Bloom's: skewed toward analyze + evaluate + create.

Question-writing standards:
  - Simple, learner-friendly Zambian English. Avoid jargon unless the
    excerpts define it.
  - Use Zambian examples (Kapiri Mposhi, Lusaka, Kafue, ZMW, chitenge,
    nshima, ECZ, sukulu, etc.) when an example is needed. Avoid
    foreign place names or currencies unless the excerpts use them.
  - Each question MUST carry "groundingIndex" — the index into
    <cited_excerpts> the question is derived from.
  - Each question MUST carry "bloomsLevel" from
    {remember, understand, apply, analyze, evaluate, create}.
  - Number questions consecutively within each section starting at 1.

Answer key:
  - One row per question, sectionId + questionNumber + answer + marks
    + markingNotes.
  - For MCQ the answer is "<letter> (<option text>)" e.g. "B (3/4)".
  - For short_answer the answer is the canonical 1–3 sentence response.
  - For structured the answer is a JSON-stringified object encoding
    each part's expected answer + marking points.

Marking guide:
  - 200-600 word narrative covering: how partial credit is awarded,
    when working must be shown, half-mark policy, and any
    subject-specific rubric (e.g. mathematics: 1 mark for method, 1
    for correct numeric answer with units; language: 2 marks for
    content + 1 for structure).

If you cannot fill the requested section sizes from <cited_excerpts>,
return fewer questions per section but make sure each section has at
least one question and the per-section marks sum to the requested
section total. Never pad with general knowledge.

You MUST emit your output via the exam_quiz_output tool. Do not
return prose.`;

function selectExcerpts(curriculumReader) {
  const excerpts = curriculumReader && Array.isArray(curriculumReader.citedExcerpts) ?
    curriculumReader.citedExcerpts : [];
  return excerpts
      .map((e, i) => `[${i}] (${e.anchor || "module"}) ${e.text}`)
      .join("\n");
}

function buildUserMessage({curriculumReader, standards, parameters}) {
  const p = parameters || {};
  const s = (standards && standards.structure) || {};
  const sections = Array.isArray(s.sections) ? s.sections : [];
  const sectionA = sections.find((sec) => sec.id === "A") || {};
  const sectionB = sections.find((sec) => sec.id === "B") || {};
  const sectionC = sections.find((sec) => sec.id === "C") || {};

  const lines = [
    `Grade: ${curriculumReader.grade}`,
    `Subject: ${curriculumReader.subject}`,
    `Term: ${curriculumReader.term ?? "n/a"}`,
    `Year: ${p.year ?? new Date().getUTCFullYear()}`,
    `Topic: ${curriculumReader.topic}`,
    `Sub-topic: ${curriculumReader.subtopic || "n/a"}`,
    `Source document: ${curriculumReader.sourceDocId} ` +
      `(${curriculumReader.curriculumDocumentPath})`,
    `Curriculum version: ${curriculumReader.curriculumVersion}`,
    "",
    "Header to render on the paper:",
    `  School name:  ${p.schoolName || "_____________________ (school to fill in)"}`,
    `  Paper name:   ${p.paperName || s.paperName || ""}`,
    `  Total marks:  ${p.totalMarks ?? "?"}`,
    `  Time allowed: ${p.timeAllowed || s.timeLimit || "1 hour 30 minutes"}`,
    "",
    "Section sizing (from Standards Agent):",
    `  Section A — Multiple Choice:   ${p.sectionASize ?? sectionA.count ?? 20} questions, ${sectionA.totalMarks ?? p.sectionASize ?? 20} marks`,
    `  Section B — Short Answer:      ${p.sectionBSize ?? sectionB.count ?? 8} questions, ${sectionB.totalMarks ?? (p.sectionBSize ?? 8) * 2} marks`,
    `  Section C — Structured:        ${p.sectionCSize ?? sectionC.count ?? 3} items,   ${sectionC.totalMarks ?? (p.sectionCSize ?? 3) * 10} marks`,
    "",
    "Bloom's distribution target (percentages, may shift ±5%):",
    JSON.stringify(s.bloomsDistribution ||
      {remember: 20, understand: 30, apply: 30, analyze: 15, evaluate: 5, create: 0}),
    "",
    "Standard instructions to include on the paper:",
    ...(Array.isArray(s.instructions) ? s.instructions : []).map((i) => `  - ${i}`),
    "",
    "Competencies to assess (from KB module):",
    ...(curriculumReader.competencies || []).slice(0, 6).map((c) => `  - ${c}`),
    "",
    "Learning outcomes (from KB module):",
    ...(curriculumReader.learningOutcomes || []).slice(0, 6).map((o) => `  - ${o}`),
    "",
    "Key concepts (use as terminology anchors):",
    ...(curriculumReader.keyConcepts || []).slice(0, 8).map((k) => `  - ${k}`),
    "",
    "<cited_excerpts>",
    selectExcerpts(curriculumReader),
    "</cited_excerpts>",
    "",
    "Emit your output by calling the exam_quiz_output tool.",
  ];
  return lines.join("\n");
}

module.exports = {SYSTEM, buildUserMessage, selectExcerpts};
