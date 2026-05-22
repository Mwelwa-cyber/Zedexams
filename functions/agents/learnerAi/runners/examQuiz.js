/**
 * Exam Quiz Generator Agent — v2 (live LLM body).
 *
 * Consumes chainContext.curriculumReader (v2 agent contract) AND
 * chainContext.standards (Standards-Agent assessment structure) and
 * produces a structured ExamQuizContent payload written to
 * aiGeneratedContent.content.
 *
 * Hard rules:
 *   - NEVER auto-publishes. Enforced by the dispatcher's
 *     shouldAutoPublish gate which checks taskType === 'practice_quiz'
 *     and short-circuits everything else. Unit test asserts this.
 *   - Always requires admin approval. Terminal task status is
 *     NEEDS_REVIEW (existing dispatcher default for non-practice
 *     quizzes).
 *   - Refuses if chainContext.curriculumReader is missing OR if
 *     curriculumReader has no excerpts (would mean the resolver had
 *     nothing to ground on — see PR #538).
 *   - Uses chainContext.standards.structure for section sizing,
 *     mark allocation, Blooms mix, time limit, paper name. When the
 *     Standards Agent returned source='default' the runner still
 *     proceeds but stamps `standardsSource:'default'` onto the
 *     artifact so admins can see when the paper was built against
 *     bundled defaults vs an admin-approved standard.
 *
 * Generation modes are derived from parameters.assessmentType (one
 * of practice_quiz / topic_test / monthly_test / midterm_test /
 * end_of_term_test / composite_exam). Section sizes default to the
 * Standards-table values per assessmentType but can be overridden
 * via parameters.sectionASize / sectionBSize / sectionCSize.
 *
 * LLM gating: calls Anthropic Sonnet 4.5 with the tool-use schema in
 * ../schemas/examQuiz.js. If ANTHROPIC_API_KEY is absent (CI, local
 * dev, sandbox) it falls back to `buildStructuredStub` which uses
 * curriculumReader.keyConcepts + citedExcerpts to produce a
 * deterministic-but-realistic paper labelled modelUsed:'stub'.
 */

const {makeRunner} = require("./_stubFactory");
const {writeAgentLog} = require("../logger");
const {SEVERITY} = require("../v2Collections");
const promptModule = require("../prompts/examQuiz");
const toolSchema = require("../schemas/examQuiz");

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_MODEL = process.env.LEARNER_AI_EXAM_QUIZ_MODEL ||
  process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

const AGENT_ID = "examQuiz";

const VALID_ASSESSMENT_TYPES = new Set([
  "practice_quiz", "topic_test", "monthly_test",
  "midterm_test", "end_of_term_test", "composite_exam",
]);

// ── Parameter normalisation ──────────────────────────────────────────

function normaliseParameters({task, standards}) {
  const raw = (task && task.parameters) || {};
  const stdStruct = (standards && standards.structure) || {};
  const stdSections = Array.isArray(stdStruct.sections) ? stdStruct.sections : [];
  const stdA = stdSections.find((s) => s.id === "A") || {};
  const stdB = stdSections.find((s) => s.id === "B") || {};
  const stdC = stdSections.find((s) => s.id === "C") || {};

  // assessmentType priority: parameters → task.assessmentType → standards
  // → fallback. The runner refuses below if none resolves.
  const assessmentType = VALID_ASSESSMENT_TYPES.has(raw.assessmentType) ?
    raw.assessmentType :
    (VALID_ASSESSMENT_TYPES.has(task.assessmentType) ?
      task.assessmentType :
      (VALID_ASSESSMENT_TYPES.has(standards && standards.assessmentType) ?
        standards.assessmentType :
        null));

  const clampInt = (v, min, max, fallback) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(n)));
  };

  const sectionASize = clampInt(raw.sectionASize, 1, 30, stdA.count || 20);
  const sectionBSize = clampInt(raw.sectionBSize, 1, 20, stdB.count || 8);
  const sectionCSize = clampInt(raw.sectionCSize, 0, 10, stdC.count || 3);

  const totalMarks = clampInt(
      raw.totalMarks, 1, 500,
      (stdA.totalMarks || sectionASize) +
      (stdB.totalMarks || sectionBSize * 2) +
      (stdC.totalMarks || sectionCSize * 10),
  );

  return {
    assessmentType,
    year: Number.isInteger(raw.year) ?
      Math.max(2020, Math.min(2099, raw.year)) :
      new Date().getUTCFullYear(),
    schoolName: typeof raw.schoolName === "string" ?
      raw.schoolName.slice(0, 200) : "",
    paperName: typeof raw.paperName === "string" && raw.paperName.length ?
      raw.paperName.slice(0, 200) :
      (stdStruct.paperName || ""),
    sectionASize, sectionBSize, sectionCSize,
    totalMarks,
    timeAllowed: typeof raw.timeAllowed === "string" && raw.timeAllowed.length ?
      raw.timeAllowed.slice(0, 80) :
      (stdStruct.timeLimit || "1 hour 30 minutes"),
  };
}

// ── Stamping + filtering ─────────────────────────────────────────────

function stampQuestion(question, curriculumReader, sectionId) {
  return {
    number: Number.isInteger(question.number) ? question.number : 1,
    questionType: question.questionType,
    prompt: String(question.prompt || "").slice(0, 1200),
    options: Array.isArray(question.options) ?
      question.options.map((o) => String(o).slice(0, 300)).slice(0, 6) :
      [],
    correctAnswer: String(question.correctAnswer || "").slice(0, 800),
    ...(Array.isArray(question.structuredParts) ? {
      structuredParts: question.structuredParts.slice(0, 6).map((p) => ({
        label: String(p.label || "").slice(0, 8),
        prompt: String(p.prompt || "").slice(0, 800),
        marks: Number.isInteger(p.marks) ?
          Math.max(1, Math.min(20, p.marks)) : 1,
        expectedAnswer: String(p.expectedAnswer || "").slice(0, 800),
        markingPoints: Array.isArray(p.markingPoints) ?
          p.markingPoints.map((m) => String(m).slice(0, 300)).slice(0, 8) :
          [],
      })),
    } : {}),
    marks: Number.isInteger(question.marks) ?
      Math.max(1, Math.min(40, question.marks)) : 1,
    grade: String(curriculumReader.grade || ""),
    subject: String(curriculumReader.subject || ""),
    term: curriculumReader.term ?? null,
    topic: String(curriculumReader.topic || ""),
    subtopic: curriculumReader.subtopic ?? null,
    competency: (curriculumReader.competencies && curriculumReader.competencies[0]) || "",
    learningOutcome: (curriculumReader.learningOutcomes && curriculumReader.learningOutcomes[0]) || null,
    groundingIndex: Number.isInteger(question.groundingIndex) ?
      question.groundingIndex : 0,
    bloomsLevel: ["remember", "understand", "apply", "analyze", "evaluate", "create"]
        .includes(question.bloomsLevel) ? question.bloomsLevel : "understand",
    _sectionId: sectionId, // internal — used by filter, stripped before write
  };
}

function filterValidQuestions(questions, citedExcerptsLength) {
  const out = [];
  for (const q of questions) {
    if (!q || typeof q !== "object") continue;
    if (!q.prompt || !q.questionType) continue;
    if (!Number.isInteger(q.groundingIndex) ||
        q.groundingIndex < 0 ||
        q.groundingIndex >= citedExcerptsLength) continue;
    if (q.questionType === "mcq") {
      if (!Array.isArray(q.options) || q.options.length < 2) continue;
      const lowered = q.options.map((o) => String(o).trim().toLowerCase());
      if (new Set(lowered).size !== lowered.length) continue;
      if (!lowered.includes(String(q.correctAnswer || "").trim().toLowerCase())) continue;
    }
    if (q.questionType === "short_answer") {
      if (!q.correctAnswer || !String(q.correctAnswer).trim()) continue;
    }
    if (q.questionType === "structured") {
      if (!Array.isArray(q.structuredParts) || q.structuredParts.length < 2) continue;
      if (q.structuredParts.some((p) => !p.prompt || !p.expectedAnswer)) continue;
    }
    out.push(q);
  }
  return out;
}

function stripInternalFields(q) {
  const {_sectionId, ...rest} = q;
  void _sectionId;
  return rest;
}

// ── Structured stub (CI / no-LLM fallback) ───────────────────────────

function buildStructuredStub({curriculumReader, parameters}) {
  const excerpts = (curriculumReader && curriculumReader.citedExcerpts) || [];
  if (!excerpts.length) {
    return null;
  }
  const concepts = (curriculumReader.keyConcepts && curriculumReader.keyConcepts.length) ?
    curriculumReader.keyConcepts : [curriculumReader.topic || "this topic"];

  const mcqMarks = 1;
  const shortMarks = 2;
  const structuredMarks = 10;

  // Section A: MCQs
  const sectionAQuestions = [];
  for (let i = 0; i < parameters.sectionASize; i++) {
    const concept = concepts[i % concepts.length];
    const excerpt = excerpts[i % excerpts.length];
    sectionAQuestions.push({
      number: i + 1,
      questionType: "mcq",
      prompt: `Which of the following best describes "${concept}"?`,
      options: [
        String(concept).slice(0, 200),
        "An unrelated concept",
        "Not covered in this lesson",
        "A different subject",
      ],
      correctAnswer: String(concept).slice(0, 200),
      marks: mcqMarks,
      groundingIndex: i % excerpts.length,
      bloomsLevel: ["remember", "understand"][i % 2],
      _excerpt: excerpt,
    });
  }

  // Section B: short-answer
  const sectionBQuestions = [];
  for (let i = 0; i < parameters.sectionBSize; i++) {
    const concept = concepts[i % concepts.length];
    sectionBQuestions.push({
      number: i + 1,
      questionType: "short_answer",
      prompt: `Briefly explain what "${concept}" means in the context of ${curriculumReader.topic}.`,
      options: [],
      correctAnswer: String(concept).slice(0, 200),
      marks: shortMarks,
      groundingIndex: i % excerpts.length,
      bloomsLevel: ["apply", "analyze"][i % 2],
    });
  }

  // Section C: structured questions
  const sectionCQuestions = [];
  for (let i = 0; i < parameters.sectionCSize; i++) {
    const concept = concepts[i % concepts.length];
    const parts = [
      {label: "a", prompt: `Define "${concept}".`, marks: 2,
        expectedAnswer: String(concept).slice(0, 200),
        markingPoints: ["Correct definition", "Uses Zambian CBC vocabulary"]},
      {label: "b", prompt: `Give an example of "${concept}" from everyday Zambian life.`,
        marks: 4, expectedAnswer: `Any Zambian example demonstrating ${concept}.`,
        markingPoints: ["Zambian example", "Demonstrates concept", "Clear explanation"]},
      {label: "c", prompt: `Explain why understanding "${concept}" matters in ${curriculumReader.subject}.`,
        marks: 4, expectedAnswer: `Application-level explanation of ${concept}.`,
        markingPoints: ["Connects to subject", "Demonstrates reasoning"]},
    ];
    sectionCQuestions.push({
      number: i + 1,
      questionType: "structured",
      prompt: `Consider "${concept}" as taught in this lesson.`,
      options: [],
      correctAnswer: "",
      structuredParts: parts,
      marks: structuredMarks,
      groundingIndex: i % excerpts.length,
      bloomsLevel: ["analyze", "evaluate", "create"][i % 3],
    });
  }

  const sections = [
    {id: "A", title: "Section A — Multiple Choice",
      instructions: `Answer ALL ${parameters.sectionASize} questions in this section.`,
      marks: parameters.sectionASize * mcqMarks,
      questions: sectionAQuestions},
    {id: "B", title: "Section B — Short Answer",
      instructions: `Answer ALL ${parameters.sectionBSize} questions in this section.`,
      marks: parameters.sectionBSize * shortMarks,
      questions: sectionBQuestions},
    {id: "C", title: "Section C — Structured Questions",
      instructions: `Answer ALL ${parameters.sectionCSize} questions in this section. Show all working.`,
      marks: parameters.sectionCSize * structuredMarks,
      questions: sectionCQuestions},
  ];

  const answerKey = [];
  const pushKey = (sectionId, q) => {
    let answer = q.correctAnswer;
    if (q.questionType === "mcq") {
      const idx = q.options.findIndex((o) =>
        o.toLowerCase() === String(q.correctAnswer).toLowerCase());
      answer = `${"ABCD"[idx] || "A"} (${q.correctAnswer})`;
    } else if (q.questionType === "structured" && Array.isArray(q.structuredParts)) {
      answer = JSON.stringify({parts: q.structuredParts.map((p) => ({
        label: p.label, expected: p.expectedAnswer, points: p.markingPoints,
      }))});
    }
    answerKey.push({
      sectionId, questionNumber: q.number, answer,
      marks: q.marks,
      markingNotes: q.questionType === "structured" ?
        "Award marks by part; see marking guide for partial-credit policy." : "",
    });
  };
  sectionAQuestions.forEach((q) => pushKey("A", q));
  sectionBQuestions.forEach((q) => pushKey("B", q));
  sectionCQuestions.forEach((q) => pushKey("C", q));

  return {
    sections,
    answerKey,
    markingGuide:
      "Award full marks for answers that demonstrate the learning outcomes " +
      "verbatim from the cited curriculum excerpts. For Section B award 1 " +
      "mark for partial answers (correct concept but incomplete explanation). " +
      "For Section C, mark by part: each part is independently graded against " +
      "its markingPoints. In Mathematics, award 1 mark for method even if " +
      "the final answer is wrong, and full marks only when working is shown " +
      "and the numeric answer is correct with units. Half-marks are not used.",
  };
}

// ── LLM call ─────────────────────────────────────────────────────────

async function callLLM({systemPrompt, userMessage, apiKey, maxTokens}) {
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      temperature: 0.35,
      system: [{
        type: "text",
        text: systemPrompt,
        cache_control: {type: "ephemeral"},
      }],
      messages: [{role: "user", content: userMessage}],
      tools: [toolSchema],
      tool_choice: {type: "tool", name: toolSchema.name},
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`anthropic_${res.status}:${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const blocks = Array.isArray(data && data.content) ? data.content : [];
  const toolUse = blocks.find((b) => b && b.type === "tool_use" && b.name === toolSchema.name);
  if (!toolUse || !toolUse.input) {
    throw new Error("anthropic_no_tool_use_block");
  }
  return {raw: toolUse.input, modelUsed: data.model || ANTHROPIC_MODEL};
}

// ── runLive ──────────────────────────────────────────────────────────

async function runLive({task, curriculumReader, standards}) {
  if (!curriculumReader || !curriculumReader.topic) {
    throw new Error("missing_curriculum_reader_output");
  }
  if (!Array.isArray(curriculumReader.citedExcerpts) ||
      !curriculumReader.citedExcerpts.length) {
    throw new Error("no_cited_excerpts");
  }
  const parameters = normaliseParameters({task, standards});
  if (!parameters.assessmentType) {
    throw new Error("missing_assessment_type");
  }

  const systemPrompt = promptModule.SYSTEM;
  const userMessage = promptModule.buildUserMessage({
    curriculumReader, standards, parameters,
  });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  let raw = null;
  let modelUsed;
  if (apiKey) {
    try {
      // Token budget grows with section count. Sections A+B+C of typical
      // end-of-term exam ~ 36 questions × 180 tokens = 6.5k tokens.
      const totalQuestions = parameters.sectionASize + parameters.sectionBSize +
        parameters.sectionCSize * 4; // structured questions cost more
      const result = await callLLM({
        systemPrompt, userMessage, apiKey,
        maxTokens: Math.min(12_000, 1200 + totalQuestions * 200),
      });
      raw = result.raw;
      modelUsed = result.modelUsed;
    } catch (err) {
      await writeAgentLog({
        taskId: task.id, agentName: AGENT_ID,
        action: "llm_call_failed",
        message: `LLM call failed (${String(err && err.message || err).slice(0, 240)}); falling back to structured stub`,
        taskType: task.taskType,
        grade: task.grade, subject: task.subject, topic: task.topic,
        severity: SEVERITY.WARNING,
      });
      raw = null;
    }
  }

  let assembledSections;
  let answerKey;
  let markingGuide;

  if (raw && Array.isArray(raw.sections) && raw.sections.length) {
    assembledSections = raw.sections.map((sec) => {
      const stamped = (Array.isArray(sec.questions) ? sec.questions : [])
          .map((q) => stampQuestion(q, curriculumReader, sec.id));
      const valid = filterValidQuestions(stamped, curriculumReader.citedExcerpts.length)
          .map(stripInternalFields);
      const marksTotal = valid.reduce((acc, q) => acc + q.marks, 0);
      return {
        id: sec.id,
        title: String(sec.title || "").slice(0, 120),
        instructions: String(sec.instructions || "").slice(0, 800),
        marks: marksTotal || 1,
        questions: valid,
      };
    }).filter((sec) => sec.questions.length > 0);
    answerKey = Array.isArray(raw.answerKey) ?
      raw.answerKey
          .filter((ak) => ak && ak.sectionId && Number.isInteger(ak.questionNumber))
          .map((ak) => ({
            sectionId: ak.sectionId,
            questionNumber: ak.questionNumber,
            answer: String(ak.answer || "").slice(0, 2000),
            marks: Number.isInteger(ak.marks) ? Math.max(1, Math.min(40, ak.marks)) : 1,
            markingNotes: String(ak.markingNotes || "").slice(0, 800),
          })) : [];
    markingGuide = String(raw.markingGuide || "").slice(0, 4000);
  } else {
    const stub = buildStructuredStub({curriculumReader, parameters});
    if (!stub) {
      throw new Error("no_valid_sections");
    }
    assembledSections = stub.sections.map((sec) => {
      const stamped = sec.questions.map((q) => stampQuestion(q, curriculumReader, sec.id));
      const valid = filterValidQuestions(stamped, curriculumReader.citedExcerpts.length)
          .map(stripInternalFields);
      return {...sec, questions: valid};
    }).filter((sec) => sec.questions.length > 0);
    answerKey = stub.answerKey;
    markingGuide = stub.markingGuide;
    modelUsed = "stub";
  }

  if (!assembledSections.length) {
    throw new Error("no_valid_sections_after_filter");
  }

  // Total marks recomputed from actual generated content (not raw
  // header echo) so it always matches.
  const totalMarks = assembledSections.reduce((acc, sec) => acc + sec.marks, 0);

  const header = {
    schoolName: String((raw && raw.header && raw.header.schoolName) ||
      parameters.schoolName || "").slice(0, 200),
    grade: String(curriculumReader.grade || ""),
    term: String(curriculumReader.term || ""),
    year: parameters.year,
    subject: String(curriculumReader.subject || ""),
    paperName: String((raw && raw.header && raw.header.paperName) ||
      parameters.paperName || "").slice(0, 200),
    learnerNameLabel: String((raw && raw.header && raw.header.learnerNameLabel) ||
      "Learner name:").slice(0, 80),
    dateLabel: String((raw && raw.header && raw.header.dateLabel) ||
      "Date:").slice(0, 80),
    timeLabel: String((raw && raw.header && raw.header.timeLabel) ||
      "Time:").slice(0, 80),
    totalMarks,
    timeAllowed: parameters.timeAllowed,
    instructions: (raw && raw.header && Array.isArray(raw.header.instructions) &&
      raw.header.instructions.length ?
      raw.header.instructions :
      [
        "Read each question carefully before answering.",
        "Answer ALL questions.",
        "Write your answers in the spaces provided.",
        "Show all working where applicable.",
      ]).slice(0, 12).map((i) => String(i).slice(0, 400)),
  };

  const content = {
    header,
    sections: assembledSections,
    answerKey: answerKey.length ? answerKey : assembledSections.flatMap((sec) =>
      sec.questions.map((q) => ({
        sectionId: sec.id,
        questionNumber: q.number,
        answer: q.correctAnswer || "(see structured parts)",
        marks: q.marks,
        markingNotes: "",
      })),
    ),
    markingGuide: markingGuide || "See per-question marks. Award full marks " +
      "only when the answer matches the cited curriculum content. Partial " +
      "credit per Zambian school convention.",
    modelUsed: String(modelUsed || "unknown").slice(0, 80),
    parametersUsed: parameters,
    standardsUsed: standards ? {
      source: standards.source,
      assessmentType: standards.assessmentType,
      standardId: standards.standardId || null,
      sourceReference: standards.sourceReference || "",
    } : null,
  };

  return {content, modelUsed};
}

const runExamQuiz = makeRunner({
  agentId: AGENT_ID,
  artifactType: "exam_quiz",
  runLive,
});

module.exports = {
  runExamQuiz,
  normaliseParameters,
  stampQuestion,
  filterValidQuestions,
  buildStructuredStub,
  AGENT_ID,
  VALID_ASSESSMENT_TYPES,
};
