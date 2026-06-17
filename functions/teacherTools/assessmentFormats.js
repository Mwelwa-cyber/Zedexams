/**
 * assessmentFormats — Zambian assessment format profile resolver.
 *
 * Mirrors the cbcKnowledge.js pattern: an in-code seed
 * (assessmentFormatSeeds.js) overlaid by admin-editable Firestore docs at
 * cbcKnowledgeBase/{activeVersion}/assessmentFormats/{id}, merged behind a
 * 60-second module-level cache. The resolved profile renders to an
 * <assessment_format_context> block that generateAssessment passes to
 * Claude as a separately-cached system block, so the model reproduces the
 * paper structure, instruction wording, numbering and marks conventions
 * Zambian teachers expect.
 *
 * Matching is deterministic — exact `${type}-${band}-${subject}` id, then
 * the band-wide `${type}-${band}-_generic` fallback, then a minimal
 * hard-coded default. No fuzzy matching: stable ids keep the Anthropic
 * prompt-cache prefix stable across requests for the same paper shape.
 */

const {FORMAT_PROFILES} = require("./assessmentFormatSeeds");

const ASSESSMENT_TYPES = [
  "exercise", "topic_test", "monthly_test", "mid_term", "end_of_term",
  "mock_exam",
];
const ASSESSMENT_TYPE_LABELS = {
  exercise: "Exercise",
  topic_test: "Topic Test",
  monthly_test: "Monthly Test",
  mid_term: "Mid-Term Test",
  end_of_term: "End of Term Test",
  mock_exam: "Mock Examination",
};

// Types that have no dedicated format seeds yet borrow another type's paper
// structure when resolving the format context. A monthly test is a short
// cumulative check, so it reuses the mid-term layout until purpose-built
// monthly seeds are authored.
const FORMAT_TYPE_ALIASES = {
  monthly_test: "mid_term",
};
const GRADE_BANDS = [
  "lower_primary", "upper_primary", "junior_secondary", "senior_secondary",
];
const GENERIC_SUBJECT = "_generic";

// Mirrors the assessment schema's question types — profile structures must
// only suggest types the validator accepts.
const QUESTION_TYPES = new Set([
  "multiple_choice", "short_answer", "structured",
  "calculation", "true_false", "essay",
]);

/**
 * Map a sanitized grade code (ECE, G1-G12, F1-F4) to a format band.
 * Returns null for anything unrecognised — the caller then falls through
 * to the hard default profile.
 */
function gradeToBand(grade) {
  const g = String(grade || "").toUpperCase().trim();
  if (g === "ECE" || g === "ECE_N" || g === "ECE_R") return "lower_primary";
  const m = g.match(/^([GF])(\d{1,2})$/);
  if (!m) return null;
  const n = Number(m[2]);
  if (m[1] === "F") {
    if (n >= 1 && n <= 2) return "junior_secondary";
    if (n >= 3 && n <= 4) return "senior_secondary";
    return null;
  }
  if (n >= 1 && n <= 3) return "lower_primary";
  if (n >= 4 && n <= 7) return "upper_primary";
  if (n >= 8 && n <= 9) return "junior_secondary";
  if (n >= 10 && n <= 12) return "senior_secondary";
  return null;
}

function buildFormatId({assessmentType, gradeBand, subject}) {
  return `${assessmentType}-${gradeBand}-${subject}`;
}

// ── Validation ───────────────────────────────────────────────────────────

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}
function str(v, max) {
  return isNonEmptyString(v) ? String(v).trim().slice(0, max) : "";
}
function strList(v, maxItems, maxLen) {
  if (!Array.isArray(v)) return [];
  return v.filter(isNonEmptyString)
    .slice(0, maxItems)
    .map((s) => String(s).trim().slice(0, maxLen));
}

/**
 * Normalise the optional per-grade nuance map. Keys must be valid grade
 * codes (ECE, G1-G12, F1-F4); anything else is dropped. This is what lets a
 * single band-level profile carry the Baby-Class-vs-Grade-3 distinction the
 * Exam Paper Library learns from real papers.
 */
function normalizeGradeNotes(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out = {};
  let count = 0;
  for (const [k, val] of Object.entries(v)) {
    if (count >= 12) break;
    const grade = String(k || "").toUpperCase().trim();
    if (!gradeToBand(grade)) continue;
    const note = str(val, 400);
    if (!note) continue;
    out[grade] = note;
    count += 1;
  }
  return out;
}

/**
 * Validate + normalise a format profile. Returns {ok, errors, value} in the
 * same style as the generator schemas: `value` is always a usable
 * normalised profile, `errors` lists everything that disqualifies it.
 * Shared by the seed test, the built-in import callable and the admin save
 * path (client mirrors the checks).
 */
function validateFormatProfile(input) {
  const errors = [];
  if (!input || typeof input !== "object") {
    return {ok: false, errors: ["Profile must be an object."], value: null};
  }

  const assessmentType = str(input.assessmentType, 30);
  if (!ASSESSMENT_TYPES.includes(assessmentType)) {
    errors.push(`assessmentType must be one of: ${ASSESSMENT_TYPES.join(", ")}.`);
  }
  const gradeBand = str(input.gradeBand, 30);
  if (!GRADE_BANDS.includes(gradeBand)) {
    errors.push(`gradeBand must be one of: ${GRADE_BANDS.join(", ")}.`);
  }
  const subject = str(input.subject, 60).toLowerCase();
  if (!subject || !/^[a-z_]+$/.test(subject)) {
    errors.push("subject must be a canonical subject key or '_generic'.");
  }
  const label = str(input.label, 120);
  if (!label) errors.push("label is required.");

  const rawStructure = Array.isArray(input.paperStructure) ?
    input.paperStructure.filter((s) => s && typeof s === "object") : [];
  const paperStructure = rawStructure.slice(0, 6).map((s) => ({
    name: str(s.name, 60),
    heading: str(s.heading, 120),
    instructions: str(s.instructions, 400),
    questionTypes: strList(s.questionTypes, 6, 30)
      .filter((t) => QUESTION_TYPES.has(t)),
    questionCountHint: str(s.questionCountHint, 30),
    marksShare: Number.isFinite(Number(s.marksShare)) ?
      Math.round(Number(s.marksShare)) : 0,
    marksPerQuestionHint: str(s.marksPerQuestionHint, 120),
  }));
  if (paperStructure.length === 0) {
    errors.push("paperStructure must have at least one section.");
  } else {
    const shareSum = paperStructure
      .reduce((sum, s) => sum + s.marksShare, 0);
    if (shareSum !== 100) {
      errors.push(`paperStructure marksShare must sum to 100 (got ${shareSum}).`);
    }
    if (paperStructure.some((s) => !s.name || !s.heading)) {
      errors.push("every paperStructure section needs a name and heading.");
    }
    if (paperStructure.some((s) => s.questionTypes.length === 0)) {
      errors.push("every paperStructure section needs at least one valid questionType.");
    }
  }

  const coverInstructions = strList(input.coverInstructions, 8, 200);
  if (coverInstructions.length === 0) {
    errors.push("coverInstructions must have at least one line.");
  }
  const numberingStyle = str(input.numberingStyle, 600);
  if (!numberingStyle) errors.push("numberingStyle is required.");

  const rawExemplars = Array.isArray(input.exemplarQuestions) ?
    input.exemplarQuestions.filter((q) => q && typeof q === "object") : [];
  const exemplarQuestions = rawExemplars.slice(0, 4).map((q) => ({
    type: QUESTION_TYPES.has(q.type) ? q.type : "short_answer",
    marks: Number.isFinite(Number(q.marks)) ?
      Math.max(1, Math.round(Number(q.marks))) : 1,
    prompt: str(q.prompt, 500),
    note: str(q.note, 200),
  })).filter((q) => q.prompt);
  if (exemplarQuestions.length < 2) {
    errors.push("exemplarQuestions needs 2-4 items with prompts.");
  }

  const value = {
    id: str(input.id, 120) ||
      buildFormatId({assessmentType, gradeBand, subject}),
    assessmentType,
    gradeBand,
    subject,
    label,
    paperStructure,
    coverInstructions,
    numberingStyle,
    phrasingNotes: strList(input.phrasingNotes, 6, 300),
    marksConventions: strList(input.marksConventions, 6, 300),
    diagramConventions: strList(input.diagramConventions, 4, 400),
    // Richer signals the Exam Paper Library distils from many real papers.
    // All optional — older profiles (seeds, manual edits) simply omit them.
    answerSpaceConventions: strList(input.answerSpaceConventions, 6, 300),
    pictureUsage: strList(input.pictureUsage, 6, 400),
    gradeNotes: normalizeGradeNotes(input.gradeNotes),
    exemplarQuestions,
    status: input.status === "draft" ? "draft" : "active",
    origin: str(input.origin, 30) || "manual",
    sourceNote: str(input.sourceNote, 300),
  };

  return errors.length === 0 ? {ok: true, errors: [], value} :
    {ok: false, errors, value};
}

// ── Matching ─────────────────────────────────────────────────────────────

/**
 * Deterministic profile lookup over an already-merged profile list.
 * Pure — no Firestore — so the precedence rules are unit-testable.
 */
function matchFormatProfile(profiles, {gradeBand, subject, assessmentType}) {
  if (!Array.isArray(profiles) || !gradeBand ||
      !ASSESSMENT_TYPES.includes(assessmentType)) {
    return null;
  }
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const subjectKey = String(subject || "").toLowerCase();
  const exact = byId.get(
    buildFormatId({assessmentType, gradeBand, subject: subjectKey}));
  if (exact) return exact;
  return byId.get(buildFormatId(
    {assessmentType, gradeBand, subject: GENERIC_SUBJECT})) || null;
}

// Last-resort profile when even the band-generic seed is missing (e.g. an
// unrecognised grade). Keeps the generator grounded on the basics.
const DEFAULT_PROFILE = Object.freeze({
  id: "default",
  assessmentType: "topic_test",
  gradeBand: "upper_primary",
  subject: GENERIC_SUBJECT,
  label: "Zambian School Test (general format)",
  paperStructure: [
    {
      name: "SECTION A",
      heading: "SECTION A: SHORT QUESTIONS",
      instructions: "Answer ALL questions in this section.",
      questionTypes: ["multiple_choice", "short_answer"],
      questionCountHint: "6-10",
      marksShare: 50,
      marksPerQuestionHint: "1-2 marks each",
    },
    {
      name: "SECTION B",
      heading: "SECTION B: WRITTEN QUESTIONS",
      instructions: "Answer ALL questions. Show your working where needed.",
      questionTypes: ["short_answer", "calculation", "structured"],
      questionCountHint: "3-5",
      marksShare: 50,
      marksPerQuestionHint: "2-5 marks each",
    },
  ],
  coverInstructions: [
    "Write your name and class in the spaces provided.",
    "Answer ALL questions.",
    "Write neatly and clearly.",
  ],
  numberingStyle:
    "Sections are lettered A, B. Questions are numbered continuously " +
    "across the paper. Multi-part questions use (a), (b), (c). Show marks " +
    "in square brackets at the end of each question, e.g. [2].",
  phrasingNotes: [
    "Use ECZ command words (State, Name, List, Calculate, Explain, Describe) and Zambian contexts (kwacha, markets, local names).",
  ],
  marksConventions: [
    "1 mark per valid point or step; method and answer marked separately on calculations.",
  ],
  diagramConventions: [
    "Use a diagram only when the question genuinely needs one; describe it in the diagram field.",
  ],
  exemplarQuestions: [
    {type: "short_answer", marks: 2, prompt: "Name TWO sources of water in your community.", note: "capitalised count word"},
    {type: "calculation", marks: 2, prompt: "Work out 456 + 287. Show your working.", note: "method + answer"},
  ],
  status: "active",
  origin: "builtin_seed",
  sourceNote: "",
});

// ── Rendering ────────────────────────────────────────────────────────────

function renderFormatContextBlock(profile, {grade} = {}) {
  const p = profile || DEFAULT_PROFILE;
  const lines = [
    "<assessment_format_context>",
    `This is the REQUIRED paper format for a Zambian ${p.label}.`,
    "Follow it exactly: section names and headings, instruction wording, " +
      "numbering convention, marks distribution and question register. " +
      "Adapt the QUESTION COUNT to the requested total marks while keeping " +
      "each section's share of the marks.",
    "",
    "Paper structure (in order):",
  ];
  for (const s of (p.paperStructure || []).slice(0, 6)) {
    lines.push(
      `- ${s.heading} — about ${s.marksShare}% of the total marks. ` +
      `Question types: ${s.questionTypes.join(", ")}. ` +
      (s.questionCountHint ? `Typically ${s.questionCountHint} questions. ` : "") +
      (s.marksPerQuestionHint ? `Marks: ${s.marksPerQuestionHint}. ` : "") +
      (s.instructions ? `Section instruction text: "${s.instructions}"` : ""),
    );
  }
  const cover = (p.coverInstructions || []).slice(0, 8);
  if (cover.length > 0) {
    lines.push("", "Front-page instructions (use this wording in header.instructions):");
    for (const c of cover) lines.push(`- ${c}`);
  }
  if (p.numberingStyle) {
    lines.push("", `Numbering: ${p.numberingStyle}`);
  }
  const phrasing = (p.phrasingNotes || []).slice(0, 6);
  if (phrasing.length > 0) {
    lines.push("", "Phrasing and register:");
    for (const n of phrasing) lines.push(`- ${n}`);
  }
  const marks = (p.marksConventions || []).slice(0, 6);
  if (marks.length > 0) {
    lines.push("", "Marks conventions:");
    for (const m of marks) lines.push(`- ${m}`);
  }
  const diagrams = (p.diagramConventions || []).slice(0, 4);
  if (diagrams.length > 0) {
    lines.push("", "Diagrams:");
    for (const d of diagrams) lines.push(`- ${d}`);
  }
  const pictures = (p.pictureUsage || []).slice(0, 6);
  if (pictures.length > 0) {
    lines.push("", "Pictures, drawings and diagrams (how this paper uses " +
      "them — request matching diagram briefs where appropriate):");
    for (const pic of pictures) lines.push(`- ${pic}`);
  }
  const answerSpaces = (p.answerSpaceConventions || []).slice(0, 6);
  if (answerSpaces.length > 0) {
    lines.push("", "Answer spaces and layout:");
    for (const a of answerSpaces) lines.push(`- ${a}`);
  }
  // Per-grade nuance within the band — surfaced only for the grade being
  // generated, so a Grade 1 paper reads differently from a Grade 3 one even
  // though both resolve to the lower_primary profile.
  const gradeKey = String(grade || "").toUpperCase().trim();
  const gradeNote = p.gradeNotes && p.gradeNotes[gradeKey];
  if (gradeNote) {
    lines.push("", `Grade-specific guidance for ${gradeKey}: ${gradeNote}`);
  }
  const exemplars = (p.exemplarQuestions || []).slice(0, 4);
  if (exemplars.length > 0) {
    lines.push("", "Style exemplars (PARAPHRASED — match the register and layout, never copy these):");
    for (const q of exemplars) {
      lines.push(
        `- [${q.type}, ${q.marks} mark${q.marks === 1 ? "" : "s"}] ` +
        `"${q.prompt}"` + (q.note ? ` (${q.note})` : ""),
      );
    }
  }
  lines.push("</assessment_format_context>");
  return lines.join("\n");
}

// ── Firestore overlay + cache ────────────────────────────────────────────

const CACHE_TTL_MS = 60_000;
let _cache = null;
let _cacheAt = 0;

/**
 * Merged profile list: in-code seeds overlaid by Firestore docs from the
 * active KB version (Firestore wins on id). Draft docs are excluded —
 * only active profiles ground generations. A Firestore failure degrades
 * to seeds-only; this never throws.
 */
async function getAllFormatProfiles() {
  const now = Date.now();
  if (_cache && (now - _cacheAt) < CACHE_TTL_MS) return _cache;

  const byId = new Map();
  for (const p of FORMAT_PROFILES) {
    byId.set(p.id, {...p, _source: "seed"});
  }
  try {
    // Lazy requires keep this module's pure logic (gradeToBand, matching,
    // validation, rendering) loadable in the dependency-free CI test job,
    // which installs root deps only — same pattern as the budget check in
    // anthropicClient.js.
    const admin = require("firebase-admin");
    const {getActiveKbVersion} = require("./cbcKnowledge");
    const version = await getActiveKbVersion();
    const snap = await admin.firestore()
      .collection("cbcKnowledgeBase").doc(version)
      .collection("assessmentFormats").get();
    for (const d of snap.docs) {
      const data = d.data() || {};
      if (data.status === "draft") continue;
      byId.set(d.id, {...data, id: d.id, _source: "firestore"});
    }
  } catch (err) {
    console.error("getAllFormatProfiles: Firestore overlay failed; using seeds", err);
  }
  const value = Array.from(byId.values());
  _cache = value;
  _cacheAt = now;
  return value;
}

/** Force the next getAllFormatProfiles() to re-read Firestore. */
function invalidateFormatCache() {
  _cache = null;
  _cacheAt = 0;
}

/**
 * Resolve the format context for one generation request.
 * Never throws — worst case is the hard default profile.
 */
async function resolveAssessmentFormatContext({grade, subject, assessmentType} = {}) {
  const type = ASSESSMENT_TYPES.includes(assessmentType) ?
    assessmentType : "topic_test";
  // Resolve format seeds under an aliased type when this type has none of its
  // own (e.g. monthly_test → mid_term). The generated paper is still labelled
  // with the real type via ASSESSMENT_TYPE_LABELS.
  const formatType = FORMAT_TYPE_ALIASES[type] || type;
  const band = gradeToBand(grade);
  let match = null;
  try {
    const profiles = await getAllFormatProfiles();
    match = matchFormatProfile(profiles,
      {gradeBand: band, subject, assessmentType: formatType});
  } catch (err) {
    console.error("resolveAssessmentFormatContext failed; using default", err);
  }
  const profile = match || DEFAULT_PROFILE;
  return {
    formatBlock: renderFormatContextBlock(profile, {grade}),
    formatProfileId: profile.id,
    formatSource: match ? (match._source || "seed") : "default",
  };
}

module.exports = {
  ASSESSMENT_TYPES,
  ASSESSMENT_TYPE_LABELS,
  FORMAT_TYPE_ALIASES,
  GRADE_BANDS,
  GENERIC_SUBJECT,
  DEFAULT_PROFILE,
  gradeToBand,
  buildFormatId,
  validateFormatProfile,
  matchFormatProfile,
  renderFormatContextBlock,
  getAllFormatProfiles,
  invalidateFormatCache,
  resolveAssessmentFormatContext,
};
