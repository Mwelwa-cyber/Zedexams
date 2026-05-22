/**
 * Practice Quiz Generator Agent — v2 (live LLM body).
 *
 * Consumes chainContext.curriculumReader (the v2 Curriculum Reader
 * agent output) and produces a structured PracticeQuizContent payload
 * onto aiGeneratedContent.content, validated against the canonical
 * Zod schemas in src/schemas/learnerAi.js.
 *
 * The agent does NOT write directly to the `quizzes` collection.
 * Practice quizzes flow Reader → Generator → QualityCheck →
 * Standards → Supervisor → (auto-publish if allowed | needs_review)
 * just like every other learner-AI artifact. The isolation grep in
 * `npm run test:learner-ai-isolation` enforces this.
 *
 * Generation modes (parameters.mode):
 *   - topic     — breadth across the topic
 *   - subtopic  — tight on one subtopic
 *   - lesson    — focused on a specific lesson number
 *   - revision  — easier recall + 1-2 harder applications; for
 *                 weakness-based revision the Weakness agent runs
 *                 first and seeds the task's curriculum context.
 *
 * Question types (parameters.allowedQuestionTypes):
 *   - mcq            — 4-option multiple choice, one correct answer
 *   - true_false     — options=['True','False']
 *   - short_answer   — options=[], canonical answer string
 *   - matching       — matchingPairs[{left,right}], options=[]
 *
 * LLM gating: the runner calls Anthropic Sonnet 4.5 with the tool-use
 * schema in ../schemas/practiceQuiz.js. If ANTHROPIC_API_KEY is absent
 * (CI, local dev, etc.) it falls back to `buildStructuredStub` which
 * uses the curriculumReader's keyConcepts + competencies to produce a
 * deterministic-but-realistic quiz so the rest of the pipeline keeps
 * running. The stub is clearly labelled with modelUsed:'stub'.
 */

const {makeRunner} = require("./_stubFactory");
const {writeAgentLog} = require("../logger");
const {SEVERITY} = require("../v2Collections");
const promptModule = require("../prompts/practiceQuiz");
const toolSchema = require("../schemas/practiceQuiz");

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_MODEL = process.env.LEARNER_AI_PRACTICE_QUIZ_MODEL ||
  process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

const AGENT_ID = "practiceQuiz";

// Defaults must match practiceQuizParametersSchema.default(). Centralised
// here so callers that bypass the SPA (smoke scripts, emulator manual
// writes) get the same behaviour.
const DEFAULT_PARAMETERS = Object.freeze({
  numQuestions: 10,
  difficulty: "mixed",
  mode: "topic",
  weakLearnerId: null,
  lessonNumber: null,
  allowedQuestionTypes: ["mcq", "true_false", "short_answer", "matching"],
});

// ── Parameter normalisation ──────────────────────────────────────────

/**
 * Pull a sane parameters object off the task. Falls back to defaults
 * if the task didn't carry one. Coerces numbers + clamps bounds so
 * a tampered queue write can't ask for 999 questions.
 */
function normaliseParameters(task) {
  const raw = (task && task.parameters) || {};
  const allowed = Array.isArray(raw.allowedQuestionTypes) && raw.allowedQuestionTypes.length ?
    raw.allowedQuestionTypes.filter((t) =>
      DEFAULT_PARAMETERS.allowedQuestionTypes.includes(t)) :
    DEFAULT_PARAMETERS.allowedQuestionTypes;
  const num = Number(raw.numQuestions);
  const numQuestions = Number.isFinite(num) ?
    Math.max(1, Math.min(50, Math.floor(num))) :
    DEFAULT_PARAMETERS.numQuestions;
  const difficulty = ["easy", "medium", "hard", "mixed"].includes(raw.difficulty) ?
    raw.difficulty : DEFAULT_PARAMETERS.difficulty;
  const mode = ["topic", "subtopic", "lesson", "revision"].includes(raw.mode) ?
    raw.mode : DEFAULT_PARAMETERS.mode;
  const weakLearnerId = typeof raw.weakLearnerId === "string" && raw.weakLearnerId.length ?
    raw.weakLearnerId.slice(0, 120) : null;
  const lessonNumber = Number.isInteger(raw.lessonNumber) ?
    Math.max(1, Math.min(60, raw.lessonNumber)) :
    (Number.isInteger(task.lessonNumber) ? task.lessonNumber : null);
  return {numQuestions, difficulty, mode, weakLearnerId, lessonNumber,
    allowedQuestionTypes: allowed};
}

// ── Question stamping ────────────────────────────────────────────────

/**
 * Echo curriculum identity onto each question the LLM returned. The
 * model isn't trusted to round-trip these fields correctly (and we
 * don't want to spend prompt tokens making it), so the runner stamps
 * them server-side.
 */
function stampCurriculumOnQuestion(question, curriculumReader) {
  return {
    questionText: String(question.questionText || "").slice(0, 800),
    questionType: question.questionType,
    options: Array.isArray(question.options) ?
      question.options.map((o) => String(o).slice(0, 200)).slice(0, 6) :
      [],
    correctAnswer: String(question.correctAnswer || "").slice(0, 400),
    ...(Array.isArray(question.matchingPairs) ?
      {matchingPairs: question.matchingPairs.slice(0, 8).map((p) => ({
        left: String(p.left || "").slice(0, 200),
        right: String(p.right || "").slice(0, 200),
      }))} :
      {}),
    explanation: String(question.explanation || "").slice(0, 800),
    difficulty: question.difficulty,
    marks: Number.isInteger(question.marks) ?
      Math.max(1, Math.min(10, question.marks)) : 1,
    grade: String(curriculumReader.grade || ""),
    subject: String(curriculumReader.subject || ""),
    term: curriculumReader.term ?? null,
    topic: String(curriculumReader.topic || ""),
    subtopic: curriculumReader.subtopic ?? null,
    competency: (curriculumReader.competencies && curriculumReader.competencies[0]) || "",
    learningOutcome: (curriculumReader.learningOutcomes && curriculumReader.learningOutcomes[0]) || null,
    groundingIndex: Number.isInteger(question.groundingIndex) ?
      question.groundingIndex : 0,
  };
}

/**
 * Drop questions whose `groundingIndex` is out of range or whose
 * options carry obvious problems (duplicate option text, empty
 * correctAnswer for MCQ, MCQ correctAnswer not in options). These are
 * the same checks Quality Check will run; we drop pre-emptively so
 * the artifact lands clean.
 */
function filterValidQuestions(questions, citedExcerptsLength) {
  const out = [];
  for (const q of questions) {
    if (!q || typeof q !== "object") continue;
    if (!q.questionText || !q.questionType) continue;
    if (!Number.isInteger(q.groundingIndex) ||
        q.groundingIndex < 0 ||
        q.groundingIndex >= citedExcerptsLength) continue;
    if (q.questionType === "mcq") {
      if (!Array.isArray(q.options) || q.options.length < 2) continue;
      const lowered = q.options.map((o) => String(o).trim().toLowerCase());
      if (new Set(lowered).size !== lowered.length) continue;
      if (!lowered.includes(String(q.correctAnswer || "").trim().toLowerCase())) continue;
    }
    if (q.questionType === "true_false") {
      const v = String(q.correctAnswer || "").trim();
      if (v !== "True" && v !== "False") continue;
    }
    if (q.questionType === "short_answer") {
      if (!q.correctAnswer || !String(q.correctAnswer).trim()) continue;
    }
    if (q.questionType === "matching") {
      if (!Array.isArray(q.matchingPairs) || q.matchingPairs.length < 2) continue;
    }
    out.push(q);
  }
  return out;
}

// ── Structured stub (CI / no-LLM fallback) ───────────────────────────

/**
 * Fallback content used when ANTHROPIC_API_KEY is unset. NOT random:
 * pulls 1 question per (keyConcept × difficulty) so the output is
 * deterministic and grounded in the curriculumReader excerpts. The
 * Quality Check will mark these as `verifierVerdict:'stub_no_llm_yet'`
 * and admins can still approve / regenerate from the UI.
 */
function buildStructuredStub({task, curriculumReader, parameters}) {
  const excerpts = (curriculumReader && curriculumReader.citedExcerpts) || [];
  if (!excerpts.length) {
    return {questions: [], modelUsed: "stub", parametersUsed: parameters};
  }
  const concepts = (curriculumReader.keyConcepts && curriculumReader.keyConcepts.length) ?
    curriculumReader.keyConcepts : [curriculumReader.topic || "this topic"];
  const types = parameters.allowedQuestionTypes;
  const questions = [];
  for (let i = 0; i < parameters.numQuestions && i < concepts.length * 4; i++) {
    const concept = concepts[i % concepts.length];
    const type = types[i % types.length];
    const groundingIndex = i % excerpts.length;
    const excerpt = excerpts[groundingIndex];
    const baseDifficulty = parameters.difficulty === "mixed" ?
      ["easy", "medium", "hard"][i % 3] : parameters.difficulty;
    const explanation = `From the syllabus: ${String(excerpt.text || "").slice(0, 240)}`;
    let q;
    if (type === "true_false") {
      q = {
        questionText: `True or False: "${concept}" appears in this lesson's content.`,
        questionType: "true_false",
        options: ["True", "False"],
        correctAnswer: "True",
        explanation,
        difficulty: baseDifficulty, marks: 1, groundingIndex,
      };
    } else if (type === "short_answer") {
      q = {
        questionText: `Briefly explain what "${concept}" means in the context of ${curriculumReader.topic}.`,
        questionType: "short_answer",
        options: [],
        correctAnswer: String(concept).slice(0, 200),
        explanation,
        difficulty: baseDifficulty, marks: 2, groundingIndex,
      };
    } else if (type === "matching") {
      const pairs = concepts.slice(0, 4).map((c, j) => ({
        left: c, right: `Definition ${j + 1}`,
      }));
      if (pairs.length < 2) continue;
      q = {
        questionText: `Match each term to its definition.`,
        questionType: "matching",
        options: [],
        correctAnswer: "",
        matchingPairs: pairs,
        explanation,
        difficulty: baseDifficulty, marks: 3, groundingIndex,
      };
    } else {
      // mcq fallback
      q = {
        questionText: `Which of the following best describes "${concept}"?`,
        questionType: "mcq",
        options: [
          String(concept).slice(0, 200),
          "An unrelated concept",
          "Not covered in this lesson",
          "A different subject",
        ],
        correctAnswer: String(concept).slice(0, 200),
        explanation,
        difficulty: baseDifficulty, marks: 2, groundingIndex,
      };
    }
    questions.push(q);
  }
  return {questions, modelUsed: "stub", parametersUsed: parameters};
}

// ── LLM call (Anthropic tool-use) ────────────────────────────────────

/**
 * Calls Anthropic Sonnet 4.5 with the tool-use schema and parses the
 * tool_use input back out. Returns `{questions, modelUsed}` or throws.
 */
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
      temperature: 0.4,
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
  if (!toolUse || !toolUse.input || !Array.isArray(toolUse.input.questions)) {
    throw new Error("anthropic_no_tool_use_block");
  }
  return {
    raw: toolUse.input,
    modelUsed: data.model || ANTHROPIC_MODEL,
  };
}

// ── runLive (passed to makeRunner) ───────────────────────────────────

async function runLive({task, curriculumReader}) {
  if (!curriculumReader || !curriculumReader.topic) {
    throw new Error("missing_curriculum_reader_output");
  }
  const parameters = normaliseParameters(task);
  const systemPrompt = promptModule.SYSTEM;
  const userMessage = promptModule.buildUserMessage({curriculumReader, parameters});

  const apiKey = process.env.ANTHROPIC_API_KEY;
  let raw;
  let modelUsed;
  if (apiKey) {
    try {
      const result = await callLLM({
        systemPrompt, userMessage, apiKey,
        // Token budget: ~150 tokens/question for headroom on long
        // explanations + matchingPairs. Cap at 8000 to keep cost
        // bounded on a single task.
        maxTokens: Math.min(8000, 600 + parameters.numQuestions * 150),
      });
      raw = result.raw;
      modelUsed = result.modelUsed;
    } catch (err) {
      // Log + fall back to the structured stub. The artifact still
      // lands so the rest of the pipeline can proceed.
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

  if (!raw) {
    raw = buildStructuredStub({task, curriculumReader, parameters});
    modelUsed = "stub";
  }

  // Stamp curriculum echo + filter invalid questions.
  const stampedQuestions = (Array.isArray(raw.questions) ? raw.questions : [])
      .map((q) => stampCurriculumOnQuestion(q, curriculumReader));
  const validQuestions = filterValidQuestions(
      stampedQuestions,
      (curriculumReader.citedExcerpts || []).length,
  );

  if (!validQuestions.length) {
    throw new Error("no_valid_questions_after_filter");
  }

  const totalMarks = validQuestions.reduce((acc, q) => acc + q.marks, 0);
  const estimatedMinutes = Math.max(
      1, Math.min(180, Math.round(validQuestions.length * 1.5)),
  );

  const content = {
    title: String(raw.title || `${curriculumReader.subject} — ${curriculumReader.topic}${curriculumReader.subtopic ? ` (${curriculumReader.subtopic})` : ""} practice quiz`).slice(0, 200),
    description: String(raw.description || `Auto-generated practice quiz on ${curriculumReader.topic}.`).slice(0, 800),
    mode: parameters.mode,
    difficulty: parameters.difficulty,
    totalMarks: Math.max(1, totalMarks),
    estimatedMinutes,
    questions: validQuestions,
    modelUsed: String(modelUsed || "unknown").slice(0, 80),
    parametersUsed: parameters,
  };

  return {content, modelUsed};
}

const runPracticeQuiz = makeRunner({
  agentId: AGENT_ID,
  artifactType: "practice_quiz",
  runLive,
});

module.exports = {
  runPracticeQuiz,
  // Pure helpers exported for unit tests + future agents that need
  // to reproduce the same validation locally.
  normaliseParameters,
  stampCurriculumOnQuestion,
  filterValidQuestions,
  buildStructuredStub,
  DEFAULT_PARAMETERS,
  AGENT_ID,
};
