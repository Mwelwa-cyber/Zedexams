/**
 * Pure helpers for the Exam Paper Library — the corpus of real Zambian
 * assessment papers (Baby Class → Grade 7 and beyond) that the admin
 * uploads so the AI learns the country's assessment style.
 *
 * Two AI steps sit on top of these helpers:
 *   1. analyzeExamPaper   — distils ONE uploaded paper into a structured
 *                           per-paper analysis stored in
 *                           cbcKnowledgeBase/{version}/examPaperSamples/{id}.
 *                           Unlike the single-shot format extractor, each
 *                           paper keeps its own doc (auto-id) so many papers
 *                           for the same grade/subject accumulate instead of
 *                           overwriting one another.
 *   2. synthesizeAssessmentFormat — merges every analysed sample for a
 *                           (type, band, subject) into ONE consolidated
 *                           format-profile draft the generator grounds on.
 *
 * Split out from the callables (same pattern as
 * assessmentFormatExtractHelpers.js) so the unit test can load them without
 * pulling firebase-admin/firebase-functions — CI's test job installs root
 * deps only.
 *
 * COPYRIGHT RULE: every prompt below instructs the model to capture
 * CONVENTIONS and to write exemplar questions as FRESH PARAPHRASES in the
 * same style — never to transcribe a real paper's questions, passages or
 * diagrams beyond short conventional instruction phrases. The admin review
 * step (CBC KB page) is the human backstop before anything goes live.
 */

const {
  ASSESSMENT_TYPES,
  GRADE_BANDS,
  GENERIC_SUBJECT,
  gradeToBand,
  buildFormatId,
} = require("./assessmentFormats");

// ── Metadata normalisation ───────────────────────────────────────────────

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}
function str(v, max) {
  return isNonEmptyString(v) ? String(v).trim().slice(0, max) : "";
}
function strList(v, maxItems, maxLen) {
  if (!Array.isArray(v)) return [];
  return v
    .map((s) => (s == null ? "" : String(s).trim()))
    .filter(Boolean)
    .slice(0, maxItems)
    .map((s) => s.slice(0, maxLen));
}

/** Canonical subject key, or '_generic'. */
function normalizeSubjectKey(subject) {
  const s = String(subject || "_generic")
    .toLowerCase().replace(/[^a-z_]/g, "_").slice(0, 60);
  return s || GENERIC_SUBJECT;
}

/** Whole-year sanity check; returns a 4-digit year or null. */
function normalizeYear(value) {
  const n = Number(value);
  if (!Number.isInteger(n)) return null;
  if (n < 1990 || n > 2100) return null;
  return n;
}

/**
 * Validate + normalise the admin's classification of an uploaded paper.
 * The precise grade (ECE, G1-G12, F1-F4) is kept AND mapped to its band so
 * synthesis can group by band while per-grade nuance survives. Returns
 * {error} on a bad classification, otherwise {meta}.
 */
function normalizeSampleMeta(input) {
  const assessmentType = String(input && input.assessmentType || "")
    .toLowerCase().trim();
  if (!ASSESSMENT_TYPES.includes(assessmentType)) {
    return {error: "Pick a valid assessment type."};
  }
  const grade = String(input && input.grade || "").toUpperCase().trim();
  const gradeBand = gradeToBand(grade);
  if (!gradeBand || !GRADE_BANDS.includes(gradeBand)) {
    return {error: "Pick a valid grade (ECE, G1-G12 or F1-F4)."};
  }
  const subject = normalizeSubjectKey(input && input.subject);
  return {
    meta: {
      assessmentType,
      grade,
      gradeBand,
      subject,
      title: str(input && input.title, 160),
      year: normalizeYear(input && input.year),
      region: str(input && input.region, 80),
    },
  };
}

// ── Per-paper analysis (step 1) ──────────────────────────────────────────

// Mirrors the format-profile shape plus the richer signals the library
// adds (pictureUsage, answerSpaceConventions, gradeLevelNotes). Permissive
// like the other generator tool schemas — normaliseAnalysis tidies it after.
const ANALYSIS_TOOL_SCHEMA = {
  type: "object",
  description:
    "A structured analysis of ONE real Zambian assessment paper: how it " +
    "is formatted, worded, arranged and laid out — never its content.",
  additionalProperties: true,
  properties: {
    summary: {
      type: "string",
      description:
        "2-4 sentences characterising this paper's overall style and how " +
        "it fits its grade level.",
    },
    paperStructure: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          name: {type: "string"},
          heading: {type: "string"},
          instructions: {type: "string"},
          questionTypes: {type: "array", items: {type: "string"}},
          questionCountHint: {type: "string"},
          marksShare: {type: "number"},
          marksPerQuestionHint: {type: "string"},
        },
      },
    },
    questionArrangement: {
      type: "string",
      description:
        "How questions are ordered and grouped across the paper (easy → " +
        "hard, by topic, recall before application, passage-led, etc.).",
    },
    coverInstructions: {type: "array", items: {type: "string"}},
    numberingStyle: {type: "string"},
    phrasingNotes: {type: "array", items: {type: "string"}},
    commandWords: {type: "array", items: {type: "string"}},
    marksConventions: {type: "array", items: {type: "string"}},
    diagramConventions: {type: "array", items: {type: "string"}},
    pictureUsage: {
      type: "array",
      items: {type: "string"},
      description:
        "How pictures, drawings, diagrams, maps, tables and graphs are " +
        "used and what the learner does with them (label, draw, count, " +
        "read off, interpret).",
    },
    answerSpaceConventions: {
      type: "array",
      items: {type: "string"},
      description:
        "How answer space is provided: blank lines, ruled boxes, dotted " +
        "spaces, working columns, tick boxes, tables to complete.",
    },
    gradeLevelNotes: {
      type: "string",
      description:
        "How this paper's difficulty and style fit its grade, and how it " +
        "differs from the grade below and above.",
    },
    exemplarQuestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          type: {type: "string"},
          marks: {type: "number"},
          prompt: {type: "string"},
          note: {type: "string"},
        },
      },
    },
    observedTotalMarks: {type: "number"},
    estimatedDifficulty: {type: "string"},
  },
  required: ["summary", "paperStructure", "numberingStyle"],
};

const ANALYSIS_SYSTEM_PROMPT = `You are a senior Zambian examiner building a reference library of how real school assessment papers are written, grade by grade, from Baby Class through to Grade 7 and beyond. You are studying ONE sample paper. Capture HOW it is made — its format, wording, arrangement, layout and use of pictures — NOT its content.

Analyse and record:
- Overall format: each section in order, its printed heading, its instruction wording, the question types it uses, roughly how many questions, and what share of the marks it carries (marksShare values should sum to about 100).
- Question arrangement: how questions are ordered and grouped (easy to hard, recall before application, by topic, grouped under a passage or picture).
- Question types commonly asked at this level.
- Phrasing and questioning technique: the command words used (Name, State, List, Match, Draw, Calculate, Explain…), sentence length, reading load, and the Zambian contexts and names that appear.
- Numbering and layout: how sections are lettered, how questions are numbered, how multi-part questions are labelled, how marks are shown.
- Cover / front-page instructions as worded.
- Marks conventions: how marks are allocated.
- Pictures, drawings and diagrams: when and how the paper uses figures, pictures, maps, tables or graphs, and what the learner does with them (label, colour, draw, count, read off, interpret). Lower grades lean heavily on pictures; record that.
- Answer spaces: how space for answers is provided (blank lines, ruled boxes, dotted spaces, working columns, tables to fill in, tick boxes).
- Grade-level fit: how this paper's difficulty and style suit its grade, and how it differs from the grade below and the grade above.
- 2-4 exemplar questions.

COPYRIGHT — HARD RULES:
- Exemplar questions must be FRESH PARAPHRASES you write yourself in the same style, difficulty and register as the paper's questions. NEVER transcribe a question, passage, comprehension text or answer from the paper.
- Do not reproduce any passage, data table or diagram content from the paper.
- Short conventional instruction phrases ("Answer ALL questions.", "Show ALL your working.") may be kept verbatim — they are standard wording, not creative content.

Output a single structured object via the tool. No prose outside the tool call.`;

function buildAnalysisUserPrompt(meta) {
  const subjectLabel = meta.subject === GENERIC_SUBJECT ?
    "(generic — any subject)" : meta.subject;
  const lines = [
    "Analyse the attached real assessment paper for the reference library.",
    "",
    "The admin has classified this paper as:",
    `- Grade: ${meta.grade}`,
    `- Grade band: ${meta.gradeBand}`,
    `- Subject: ${subjectLabel}`,
    `- Assessment type: ${meta.assessmentType}`,
  ];
  if (meta.title) lines.push(`- Title: ${meta.title}`);
  if (meta.year) lines.push(`- Year: ${meta.year}`);
  if (meta.region) lines.push(`- Region / source: ${meta.region}`);
  lines.push(
    "",
    "Describe HOW this paper is written so a fresh paper of the same kind " +
      "and grade could be built from your analysis alone. Remember: " +
      "exemplars are fresh paraphrases, never copies.",
  );
  return lines.join("\n");
}

function normalizeStructureRow(s) {
  return {
    name: str(s && s.name, 60),
    heading: str(s && s.heading, 120),
    instructions: str(s && s.instructions, 400),
    questionTypes: strList(s && s.questionTypes, 6, 30),
    questionCountHint: str(s && s.questionCountHint, 30),
    marksShare: Number.isFinite(Number(s && s.marksShare)) ?
      Math.max(0, Math.round(Number(s.marksShare))) : 0,
    marksPerQuestionHint: str(s && s.marksPerQuestionHint, 120),
  };
}

function normalizeExemplar(q) {
  return {
    type: str(q && q.type, 30) || "short_answer",
    marks: Number.isFinite(Number(q && q.marks)) ?
      Math.max(1, Math.round(Number(q.marks))) : 1,
    prompt: str(q && q.prompt, 500),
    note: str(q && q.note, 200),
  };
}

/**
 * Turn the model's tool output into a stored analysis object. Lenient by
 * design — a real paper analysis is reference material, not a publishable
 * profile, so we keep whatever the model gave and only flag a paper that is
 * too thin to be useful (no structure at all).
 */
function normalizeAnalysis(extracted) {
  const src = (extracted && typeof extracted === "object") ? extracted : {};
  const paperStructure = (Array.isArray(src.paperStructure) ?
    src.paperStructure : [])
    .filter((s) => s && typeof s === "object")
    .slice(0, 8)
    .map(normalizeStructureRow)
    .filter((s) => s.name || s.heading);
  const exemplarQuestions = (Array.isArray(src.exemplarQuestions) ?
    src.exemplarQuestions : [])
    .filter((q) => q && typeof q === "object")
    .slice(0, 4)
    .map(normalizeExemplar)
    .filter((q) => q.prompt);

  const analysis = {
    summary: str(src.summary, 800),
    paperStructure,
    questionArrangement: str(src.questionArrangement, 600),
    coverInstructions: strList(src.coverInstructions, 8, 200),
    numberingStyle: str(src.numberingStyle, 600),
    phrasingNotes: strList(src.phrasingNotes, 8, 300),
    commandWords: strList(src.commandWords, 20, 30),
    marksConventions: strList(src.marksConventions, 6, 300),
    diagramConventions: strList(src.diagramConventions, 6, 400),
    pictureUsage: strList(src.pictureUsage, 8, 400),
    answerSpaceConventions: strList(src.answerSpaceConventions, 8, 300),
    gradeLevelNotes: str(src.gradeLevelNotes, 800),
    exemplarQuestions,
    observedTotalMarks: Number.isFinite(Number(src.observedTotalMarks)) ?
      Math.max(0, Math.round(Number(src.observedTotalMarks))) : null,
    estimatedDifficulty: str(src.estimatedDifficulty, 60),
  };

  const warnings = [];
  if (analysis.paperStructure.length === 0) {
    warnings.push("No paper structure was detected — the file may be " +
      "unreadable or not an assessment paper.");
  }
  if (!analysis.summary) {
    warnings.push("No summary was produced.");
  }
  return {analysis, warnings};
}

// ── Synthesis (step 2) ───────────────────────────────────────────────────

// The consolidated profile the generator consumes. Format-profile fields
// plus the library's richer signals; validateFormatProfile (server) /
// saveAssessmentFormat (client) enforce the strict rules afterwards.
const SYNTHESIS_TOOL_SCHEMA = {
  type: "object",
  description:
    "One consolidated Zambian assessment format profile distilled from " +
    "several real sample papers of the same kind.",
  additionalProperties: true,
  properties: {
    label: {type: "string"},
    paperStructure: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          name: {type: "string"},
          heading: {type: "string"},
          instructions: {type: "string"},
          questionTypes: {type: "array", items: {type: "string"}},
          questionCountHint: {type: "string"},
          marksShare: {type: "number"},
          marksPerQuestionHint: {type: "string"},
        },
      },
    },
    coverInstructions: {type: "array", items: {type: "string"}},
    numberingStyle: {type: "string"},
    phrasingNotes: {type: "array", items: {type: "string"}},
    marksConventions: {type: "array", items: {type: "string"}},
    diagramConventions: {type: "array", items: {type: "string"}},
    pictureUsage: {type: "array", items: {type: "string"}},
    answerSpaceConventions: {type: "array", items: {type: "string"}},
    gradeNotes: {
      type: "object",
      additionalProperties: {type: "string"},
      description:
        "Optional map of grade code (e.g. \"G1\", \"G3\") to a one-line " +
        "note on how that grade's paper differs within this band.",
    },
    exemplarQuestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          type: {type: "string"},
          marks: {type: "number"},
          prompt: {type: "string"},
          note: {type: "string"},
        },
      },
    },
  },
  required: ["label", "paperStructure", "coverInstructions", "numberingStyle"],
};

const SYNTHESIS_SYSTEM_PROMPT = `You are a senior Zambian examiner writing the house style guide for one kind of school paper, drawing on analyses of several real sample papers. Produce ONE consolidated format profile that captures what is TYPICAL across the samples — the common structure, instruction wording, numbering, marks distribution, register, picture use and answer-space layout — so a brand-new paper of this kind can be generated to match.

Rules:
- paperStructure: the common section pattern across the samples, in order. marksShare values MUST sum to exactly 100. Only use these question types: multiple_choice, short_answer, structured, calculation, true_false, essay.
- Merge, don't list per paper. Where samples differ, pick the most representative convention and note variation briefly.
- pictureUsage and answerSpaceConventions: carry across how these papers use pictures/diagrams and provide answer space — this is essential for lower grades.
- gradeNotes: when the samples span several grades in the band, add a short per-grade note (keyed by grade code like "G1", "G3") on how that grade's paper differs (reading load, picture reliance, answer length).
- exemplarQuestions: 2-4 FRESH PARAPHRASES you write yourself in the samples' style and difficulty. NEVER transcribe a real question. Do not reproduce any passage or diagram content.

Output a single structured object via the tool. No prose outside the tool call.`;

/** Compact one stored sample's analysis into prompt-friendly text. */
function summarizeSampleForSynthesis(sample, index) {
  const a = (sample && sample.analysis) || {};
  const lines = [`### Sample ${index + 1}` +
    (sample && sample.grade ? ` — ${sample.grade}` : "") +
    (sample && sample.year ? ` (${sample.year})` : "") +
    (sample && sample.title ? ` — ${sample.title}` : "")];
  if (a.summary) lines.push(a.summary);
  const structure = Array.isArray(a.paperStructure) ? a.paperStructure : [];
  if (structure.length) {
    lines.push("Structure:");
    for (const s of structure.slice(0, 8)) {
      lines.push(`- ${s.heading || s.name || "section"}` +
        (Number.isFinite(Number(s.marksShare)) ? ` (~${s.marksShare}%)` : "") +
        (Array.isArray(s.questionTypes) && s.questionTypes.length ?
          ` [${s.questionTypes.join(", ")}]` : ""));
    }
  }
  const bullets = [
    ["Arrangement", a.questionArrangement],
    ["Numbering", a.numberingStyle],
    ["Phrasing", (a.phrasingNotes || []).join(" · ")],
    ["Command words", (a.commandWords || []).join(", ")],
    ["Marks", (a.marksConventions || []).join(" · ")],
    ["Pictures", (a.pictureUsage || []).join(" · ")],
    ["Answer spaces", (a.answerSpaceConventions || []).join(" · ")],
    ["Grade fit", a.gradeLevelNotes],
    ["Cover", (a.coverInstructions || []).join(" · ")],
  ];
  for (const [k, v] of bullets) {
    if (isNonEmptyString(v)) lines.push(`${k}: ${String(v).slice(0, 600)}`);
  }
  return lines.join("\n");
}

function buildSynthesisUserPrompt(samples, {assessmentType, gradeBand, subject}) {
  const subjectLabel = subject === GENERIC_SUBJECT ?
    "(generic — any subject)" : subject;
  const head = [
    `Build the consolidated format profile for a Zambian ${assessmentType} ` +
      `paper, ${gradeBand} band, subject: ${subjectLabel}.`,
    `You are drawing on ${samples.length} analysed sample paper(s) below.`,
    "",
  ];
  const body = samples
    .map((s, i) => summarizeSampleForSynthesis(s, i))
    .join("\n\n");
  return head.join("\n") + body;
}

/**
 * Assemble the synthesised tool output into a draft profile ready for the
 * existing assessmentFormatDrafts review flow. The admin's grouping
 * (type/band/subject) always wins; validateFormatProfile (server) runs
 * after. Returns {error} on a bad grouping, otherwise {candidate}.
 */
function buildSynthesisDraft({
  extracted, assessmentType, gradeBand, subject, sampleCount,
}) {
  if (!ASSESSMENT_TYPES.includes(assessmentType)) {
    return {error: "Invalid assessment type for synthesis."};
  }
  if (!GRADE_BANDS.includes(gradeBand)) {
    return {error: "Invalid grade band for synthesis."};
  }
  const subjectKey = normalizeSubjectKey(subject);
  const candidate = {
    ...(extracted && typeof extracted === "object" ? extracted : {}),
    assessmentType,
    gradeBand,
    subject: subjectKey,
    id: buildFormatId({assessmentType, gradeBand, subject: subjectKey}),
    status: "draft",
    origin: "library_synthesis",
    sourceNote: `Synthesised from ${sampleCount} sample paper(s).`,
  };
  return {candidate};
}

module.exports = {
  // metadata
  normalizeSampleMeta,
  normalizeSubjectKey,
  normalizeYear,
  // analysis
  ANALYSIS_TOOL_SCHEMA,
  ANALYSIS_SYSTEM_PROMPT,
  buildAnalysisUserPrompt,
  normalizeAnalysis,
  // synthesis
  SYNTHESIS_TOOL_SCHEMA,
  SYNTHESIS_SYSTEM_PROMPT,
  summarizeSampleForSynthesis,
  buildSynthesisUserPrompt,
  buildSynthesisDraft,
};
