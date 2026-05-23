/**
 * Notes Generator Agent — v2 (live LLM body).
 *
 * Consumes chainContext.curriculumReader (the v2 Curriculum Reader
 * output) and produces a structured NotesContent payload onto
 * aiGeneratedContent.content. Pinned by `notesContentSchema` in
 * src/schemas/learnerAi.js.
 *
 * Pipeline chain (set by the supervisor planner):
 *   curriculumReader → notes → standardsCheck → qualityCheck
 *
 * Publishing rules:
 *   - Auto-publish only if settings/global.learnerAi.autoPublishNotes
 *     === true AND Quality Check passed. The dispatcher gate enforces
 *     this; see shouldAutoPublish in dispatcher.js.
 *   - Otherwise: needs_review (admin must approve).
 *
 * Notes carry the user-requested sections (short explanation, key
 * vocabulary, important facts, examples, summary, "remember this",
 * optional diagram suggestions, quick revision). Also carry a flat
 * `body` field built by the runner concatenating the structured
 * pieces — Quality Check v3 reads `body` for its sentence-length /
 * word-cap / topic-match axes so these notes pass QC cleanly.
 *
 * LLM gating: calls Anthropic Sonnet 4.5 with the tool-use schema in
 * ../schemas/notes.js. If ANTHROPIC_API_KEY is absent, falls back to
 * a deterministic structured stub built from curriculumReader.
 * keyConcepts + citedExcerpts so the rest of the pipeline runs.
 */

const {makeRunner} = require("./_stubFactory");
const {writeAgentLog} = require("../logger");
const {SEVERITY} = require("../v2Collections");
const promptModule = require("../prompts/notes");
const toolSchema = require("../schemas/notes");

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_MODEL = process.env.LEARNER_AI_NOTES_MODEL ||
  process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

const AGENT_ID = "notes";

const DEFAULT_PARAMETERS = Object.freeze({
  detailLevel: "standard",
  includeDiagrams: true,
  numExamples: 3,
  numKeyVocabulary: 5,
});

// Per-grade body word caps. Matches Quality Check v3's
// `notes_length` axis so the runner can self-trim if the LLM returns
// over-cap output. Lower-primary 1-4 = 300, upper-primary 5-7 = 600,
// secondary 8-12 = 1200.
function bodyWordCapForGrade(grade) {
  const n = parseInt(String(grade || "").replace(/[^0-9]/g, ""), 10);
  if (!Number.isFinite(n)) return 1200;
  if (n <= 4) return 300;
  if (n <= 7) return 600;
  return 1200;
}

// ── Parameter normalisation ─────────────────────────────────────────

function normaliseParameters(task) {
  const raw = (task && task.parameters) || {};
  const detailLevel = ["brief", "standard", "detailed"].includes(raw.detailLevel) ?
    raw.detailLevel : DEFAULT_PARAMETERS.detailLevel;
  const includeDiagrams = raw.includeDiagrams !== false; // default true
  const numExamples = Number.isInteger(raw.numExamples) ?
    Math.max(1, Math.min(8, raw.numExamples)) : DEFAULT_PARAMETERS.numExamples;
  const numKeyVocabulary = Number.isInteger(raw.numKeyVocabulary) ?
    Math.max(1, Math.min(15, raw.numKeyVocabulary)) :
    DEFAULT_PARAMETERS.numKeyVocabulary;
  return {detailLevel, includeDiagrams, numExamples, numKeyVocabulary};
}

// ── Body builder ────────────────────────────────────────────────────

/**
 * Concatenate the structured notes fields into a single plain-text
 * `body` block that Quality Check v3 + the future learner reader UI
 * can render without parsing the whole shape.
 */
function buildBody({
  title, shortExplanation, keyVocabulary, importantFacts,
  examples, summary, rememberThis, quickRevision,
}) {
  const parts = [];
  if (title) parts.push(title);
  if (shortExplanation) parts.push(shortExplanation);
  if (Array.isArray(keyVocabulary) && keyVocabulary.length) {
    parts.push("Key vocabulary:");
    for (const v of keyVocabulary) {
      if (v && v.term && v.definition) {
        parts.push(`- ${v.term}: ${v.definition}`);
      }
    }
  }
  if (Array.isArray(importantFacts) && importantFacts.length) {
    parts.push("Important facts:");
    for (const f of importantFacts) {
      if (typeof f === "string" && f.trim()) parts.push(`- ${f.trim()}`);
    }
  }
  if (Array.isArray(examples) && examples.length) {
    parts.push("Examples:");
    for (const ex of examples) {
      if (ex && ex.title && ex.explanation) {
        parts.push(`- ${ex.title}: ${ex.explanation}`);
      }
    }
  }
  if (summary) parts.push("Summary:");
  if (summary) parts.push(summary);
  if (Array.isArray(rememberThis) && rememberThis.length) {
    parts.push("Remember this:");
    for (const r of rememberThis) {
      if (typeof r === "string" && r.trim()) parts.push(`- ${r.trim()}`);
    }
  }
  if (Array.isArray(quickRevision) && quickRevision.length) {
    parts.push("Quick revision:");
    for (const q of quickRevision) {
      if (typeof q === "string" && q.trim()) parts.push(`- ${q.trim()}`);
    }
  }
  return parts.filter(Boolean).join("\n").slice(0, 20_000);
}

/**
 * Trim a body string to N words. Preserves sentences when possible by
 * truncating at the last full-stop within the limit. Always ends with
 * a period.
 */
function trimBodyToWords(body, maxWords) {
  if (!body || !Number.isFinite(maxWords)) return body;
  const words = String(body).split(/\s+/);
  if (words.length <= maxWords) return body;
  const truncated = words.slice(0, maxWords).join(" ");
  const lastFullStop = truncated.lastIndexOf(".");
  if (lastFullStop > maxWords * 3) { // arbitrary heuristic
    return truncated.slice(0, lastFullStop + 1);
  }
  return truncated + ".";
}

// ── Stamping + filtering ────────────────────────────────────────────

function trimString(s, max) {
  return String(s || "").trim().slice(0, max);
}

function stampVocabulary(list, max) {
  const out = [];
  if (!Array.isArray(list)) return out;
  for (const v of list.slice(0, max)) {
    const term = trimString(v && v.term, 120);
    const def = trimString(v && v.definition, 400);
    if (term && def) out.push({term, definition: def});
  }
  return out;
}

function stampExamples(list, max) {
  const out = [];
  if (!Array.isArray(list)) return out;
  for (const e of list.slice(0, max)) {
    const title = trimString(e && e.title, 200);
    const exp = trimString(e && e.explanation, 800);
    if (title && exp) out.push({title, explanation: exp});
  }
  return out;
}

function stampStringList(list, max, perEntryMax) {
  const out = [];
  if (!Array.isArray(list)) return out;
  for (const s of list.slice(0, max)) {
    const t = trimString(s, perEntryMax);
    if (t) out.push(t);
  }
  return out;
}

// ── Structured stub (CI / no-LLM fallback) ──────────────────────────

function buildStructuredStub({curriculumReader, parameters}) {
  const excerpts = (curriculumReader && curriculumReader.citedExcerpts) || [];
  if (!excerpts.length) return null;

  const concepts = (curriculumReader.keyConcepts && curriculumReader.keyConcepts.length) ?
    curriculumReader.keyConcepts : [curriculumReader.topic || "this topic"];
  const competencies = curriculumReader.competencies || [];
  const outcomes = curriculumReader.learningOutcomes || [];

  const title = `${curriculumReader.subject} — ${curriculumReader.topic}` +
    (curriculumReader.subtopic ? ` (${curriculumReader.subtopic})` : "") +
    " — Notes";

  const shortExplanation =
    `${curriculumReader.topic}` +
    (curriculumReader.subtopic ? ` (${curriculumReader.subtopic})` : "") +
    ` is part of the Grade ${curriculumReader.grade} ` +
    `${curriculumReader.subject} syllabus. ` +
    (outcomes[0] ? `By the end of this lesson you should be able to ${outcomes[0].toLowerCase()}.` : "");

  const keyVocabulary = concepts.slice(0, parameters.numKeyVocabulary).map((c) => ({
    term: String(c),
    definition: `Key term from the ${curriculumReader.topic} lesson. ` +
      `See the cited curriculum excerpts for the official definition.`,
  }));

  const importantFacts = [];
  for (let i = 0; i < Math.min(excerpts.length, 8); i++) {
    importantFacts.push(String(excerpts[i].text || "").slice(0, 300));
  }

  const examples = [];
  for (let i = 0; i < parameters.numExamples; i++) {
    const concept = concepts[i % concepts.length];
    examples.push({
      title: `Example: ${concept}`,
      explanation: `In a Zambian classroom, you might meet "${concept}" when ` +
        `studying ${curriculumReader.topic}. ` +
        (excerpts[i % excerpts.length] ?
          String(excerpts[i % excerpts.length].text).slice(0, 200) : ""),
    });
  }

  const summary = `${curriculumReader.topic} is a Grade ${curriculumReader.grade} ` +
    `${curriculumReader.subject} topic. ` +
    (competencies[0] ? `Learners should be able to ${competencies[0].toLowerCase()}. ` : "") +
    `Always work through examples in your notebook and ask your teacher when stuck.`;

  const rememberThis = [
    ...concepts.slice(0, 3).map((c) => `Remember the meaning of "${c}".`),
    `Practice with examples from your textbook.`,
  ];

  const diagramSuggestions = parameters.includeDiagrams ? [
    `Draw a simple diagram showing the key idea of "${concepts[0] || curriculumReader.topic}".`,
    `Sketch a labelled example from a Zambian classroom setting.`,
  ] : [];

  const quickRevision = [
    ...concepts.slice(0, 4).map((c) => `${c} — review meaning + 1 example.`),
    `Re-read the cited excerpts before the test.`,
  ];

  return {
    title, shortExplanation, keyVocabulary, importantFacts, examples,
    summary, rememberThis, diagramSuggestions, quickRevision,
    estimatedReadingMinutes: 5,
  };
}

// ── LLM call ────────────────────────────────────────────────────────

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
      system: [{type: "text", text: systemPrompt, cache_control: {type: "ephemeral"}}],
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

// ── runLive ─────────────────────────────────────────────────────────

async function runLive({task, curriculumReader}) {
  if (!curriculumReader || !curriculumReader.topic) {
    throw new Error("missing_curriculum_reader_output");
  }
  if (!Array.isArray(curriculumReader.citedExcerpts) ||
      !curriculumReader.citedExcerpts.length) {
    throw new Error("no_cited_excerpts");
  }
  const parameters = normaliseParameters(task);
  const systemPrompt = promptModule.SYSTEM;
  const userMessage = promptModule.buildUserMessage({curriculumReader, parameters});

  const apiKey = process.env.ANTHROPIC_API_KEY;
  let raw = null;
  let modelUsed;
  if (apiKey) {
    try {
      // Token budget by detail level: brief 1.5k, standard 3k, detailed 5k.
      const baseTokens = parameters.detailLevel === "brief" ? 1500 :
        parameters.detailLevel === "detailed" ? 5000 : 3000;
      const result = await callLLM({
        systemPrompt, userMessage, apiKey,
        maxTokens: Math.min(8000, baseTokens),
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

  if (!raw) {
    raw = buildStructuredStub({curriculumReader, parameters});
    modelUsed = "stub";
  }
  if (!raw) {
    throw new Error("no_notes_after_stub");
  }

  // Stamp + trim every structured field.
  const title = trimString(raw.title, 200) ||
    `${curriculumReader.subject} — ${curriculumReader.topic} Notes`;
  const shortExplanation = trimString(raw.shortExplanation, 800) ||
    `${curriculumReader.topic} notes.`;
  const keyVocabulary = stampVocabulary(raw.keyVocabulary, parameters.numKeyVocabulary);
  const importantFacts = stampStringList(raw.importantFacts, 20, 400);
  const examples = stampExamples(raw.examples, parameters.numExamples);
  const summary = trimString(raw.summary, 800) ||
    `${curriculumReader.topic} summary.`;
  const rememberThis = stampStringList(raw.rememberThis, 10, 300);
  const diagramSuggestions = parameters.includeDiagrams ?
    stampStringList(raw.diagramSuggestions, 8, 300) : [];
  const quickRevision = stampStringList(raw.quickRevision, 12, 300);
  const estimatedReadingMinutes = Number.isInteger(raw.estimatedReadingMinutes) ?
    Math.max(1, Math.min(120, raw.estimatedReadingMinutes)) : 5;

  let body = buildBody({
    title, shortExplanation, keyVocabulary, importantFacts,
    examples, summary, rememberThis, quickRevision,
  });
  // Self-trim to QC v3's per-grade word cap so the artifact doesn't
  // get flagged by `notes_length`.
  const cap = bodyWordCapForGrade(curriculumReader.grade);
  body = trimBodyToWords(body, cap);
  if (!body) body = `${curriculumReader.topic} notes.`;

  const content = {
    title, shortExplanation, keyVocabulary, importantFacts, examples,
    summary, rememberThis, diagramSuggestions, quickRevision,
    body,
    grade: String(curriculumReader.grade || ""),
    subject: String(curriculumReader.subject || ""),
    term: curriculumReader.term ?? null,
    topic: String(curriculumReader.topic || ""),
    subtopic: curriculumReader.subtopic ?? null,
    competency: (curriculumReader.competencies && curriculumReader.competencies[0]) || "",
    learningOutcome: (curriculumReader.learningOutcomes && curriculumReader.learningOutcomes[0]) || null,
    estimatedReadingMinutes,
    modelUsed: String(modelUsed || "unknown").slice(0, 80),
    parametersUsed: parameters,
  };

  return {content, modelUsed};
}

const runNotes = makeRunner({
  agentId: AGENT_ID,
  artifactType: "notes",
  runLive,
});

module.exports = {
  runNotes,
  // Pure helpers exported for unit tests + downstream agents.
  normaliseParameters,
  buildBody,
  trimBodyToWords,
  buildStructuredStub,
  bodyWordCapForGrade,
  DEFAULT_PARAMETERS,
  AGENT_ID,
};
