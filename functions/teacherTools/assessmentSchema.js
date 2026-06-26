/**
 * Assessment schema validator — same style as worksheetSchema.js. A formal,
 * graded test: sections of marked questions plus a marking scheme / answer
 * key. Heavier than a worksheet (marks, marking guide per question).
 */

const SCHEMA_VERSION = "1.4";

const ALLOWED_TYPES = new Set([
  "multiple_choice",
  "short_answer",
  "structured",
  "calculation",
  "true_false",
  "essay",
  "matching",
]);

// Visual question support (v1.4). A question may carry a structured `visual`
// describing a figure the studio generates and renders. The legacy string
// `diagram` is still honoured (treated as a stem_figure) so older payloads
// and cached generations are unaffected.
const {isAllowedShape, clampShapeParams} = require("./assessmentShapes");

const VISUAL_KINDS = new Set([
  "stem_figure",      // one illustrative drawing above the question
  "labelled_figure",  // a figure whose parts are named (labels[])
  "option_images",    // an MCQ whose options A-D are each a drawing
  "shape",            // an EXACT library figure (maths shape/graph) on the stem
  "shape_options",    // an MCQ whose options A-D are each a library shape
]);
const VISUAL_MODES = new Set(["labeled", "identify"]);

// Validate one library-shape spec ({libraryKey, params}) against the allowlist.
function normalizeShape(raw) {
  if (!raw || typeof raw !== "object" || !isAllowedShape(raw.libraryKey)) {
    return null;
  }
  return {libraryKey: raw.libraryKey, params: clampShapeParams(raw.params)};
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}
function str(v, max) {
  return isNonEmptyString(v) ? String(v).trim().slice(0, max) : "";
}
function isPositiveNumber(v) {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}
function isNonNegativeNumber(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

const OPTION_LETTERS = "ABCDEFGH".split("");

// Strip a letter prefix the model baked into an MCQ option ("A. digestive
// system" at index 0). The studio renderers add their own A/B/C/D label, so a
// stored prefix printed twice ("A. A. digestive system"). Only strips when the
// leading letter matches the slot and is followed by a delimiter, so genuine
// options like "Arteries" or "A car is faster" are never touched.
function stripOptionLabel(value, index) {
  const expected = OPTION_LETTERS[index];
  if (!expected || typeof value !== "string") return value;
  const m = value.match(/^\s*([A-Za-z])\s*[.):\-–—]\s+/);
  if (m && m[1].toUpperCase() === expected) return value.slice(m[0].length).trim();
  return value;
}

// Strip a leading "SECTION A:" / "PART 1 —" label from a section title. The
// renderers always print "Section <letter> — <title>", so a baked-in label
// produced "Section A — SECTION A: Multiple choice". A real title such as
// "Sections of a plant" is left alone (no label delimiter).
function stripSectionLabel(title) {
  const t = String(title || "").trim();
  if (!t) return "";
  const labelled = t.match(
      /^(?:section|part)\b\s*(?:[a-z]|[ivx]{1,4}|\d{1,3})?\s*[:.)\-–—]+\s*(.*)$/i,
  );
  if (labelled) return labelled[1].trim();
  if (/^(?:section|part)\b\s*(?:[a-z]|[ivx]{1,4}|\d{1,3})?\s*$/i.test(t)) return "";
  return t;
}

// Some generations stuffed a whole name/date/marks header into the cover
// instructions ("NAME: ___ DATE: ___ TOTAL MARKS: ___ INSTRUCTIONS: Answer
// ALL questions."), which then printed twice because the paper already draws
// those fields. When the text before an "Instructions:" marker is just field
// labels, drop it and keep the real instruction prose.
function cleanCoverInstructions(text) {
  const t = String(text || "").trim();
  if (!t) return "";
  const m = t.match(/^(.*?)\binstructions?\b\s*[:\-–—]\s*(.+)$/is);
  if (m) {
    const preamble = m[1];
    const rest = m[2].trim();
    if (rest &&
        /\b(?:pupil'?s?\s*name|name|date|class|total\s*marks|marks)\b\s*[:_]/i
            .test(preamble)) {
      return rest;
    }
  }
  return t;
}

// Normalise a question's visual spec. Prefers the structured `visual`, falls
// back to the legacy `diagram` string (a bare stem figure). Always degrades
// gracefully — a malformed visual becomes null rather than throwing. Returns
// one of:
//   { kind: "stem_figure", prompt }
//   { kind: "labelled_figure", prompt, labels[], mode }
//   { kind: "option_images", prompt, options: [{prompt}] }
//   null
function normalizeVisual(q) {
  const raw = q && typeof q.visual === "object" && q.visual ? q.visual : null;
  const legacy = str(q && q.diagram, 500);
  if (!raw) {
    return legacy ? {kind: "stem_figure", prompt: legacy} : null;
  }
  const kind = VISUAL_KINDS.has(raw.kind) ? raw.kind : null;
  const prompt = str(raw.prompt, 500) || legacy;

  if (kind === "shape") {
    // Exact library figure on the stem. Falls back to a drawn stem figure when
    // the libraryKey isn't on the allowlist but a prompt was given.
    const shape = normalizeShape(raw);
    if (shape) return {kind: "shape", ...shape};
    return prompt ? {kind: "stem_figure", prompt} : null;
  }

  if (kind === "shape_options") {
    const options = Array.isArray(raw.options) ?
      raw.options.map(normalizeShape).filter(Boolean).slice(0, 6) : [];
    if (options.length >= 2) return {kind: "shape_options", options};
    return prompt ? {kind: "stem_figure", prompt} : null;
  }

  if (kind === "option_images") {
    const options = Array.isArray(raw.options) ?
      raw.options
          .map((o) => (o && typeof o === "object" ?
            str(o.prompt, 400) : str(o, 400)))
          .filter(Boolean)
          .slice(0, 6) : [];
    // Need at least two pictured options to be a picture-MCQ; otherwise fall
    // back to a stem figure if there's a usable prompt.
    if (options.length < 2) {
      return prompt ? {kind: "stem_figure", prompt} : null;
    }
    return {
      kind: "option_images",
      prompt,
      options: options.map((p) => ({prompt: p})),
    };
  }

  if (!prompt) return null;

  if (kind === "labelled_figure") {
    const labels = Array.isArray(raw.labels) ?
      raw.labels.filter(isNonEmptyString)
          .map((v) => str(v, 80)).slice(0, 8) : [];
    const mode = VISUAL_MODES.has(raw.mode) ? raw.mode : "labeled";
    return {kind: "labelled_figure", prompt, labels, mode};
  }

  // stem_figure, or an unknown kind that still carries a drawable prompt.
  return {kind: "stem_figure", prompt};
}

// Normalise a short-answer question's SUB-PARTS — the "(a) … (b) … (c) …"
// structure under one instruction stem. Each part carries its own sentence,
// marks and model answer. Returns [] when absent/garbage so old payloads are
// unaffected. The (a)(b)(c) label is positional (the studio derives it), so any
// label the model emits is ignored.
function normalizeParts(raw) {
  if (!Array.isArray(raw)) return [];
  const parts = raw
      .filter((p) => p && typeof p === "object")
      .map((p) => {
        const fmt = ["inline", "lines", "none"].includes(p.answerFormat) ?
          p.answerFormat : "inline";
        const marks = isPositiveNumber(Number(p.marks)) ?
          Math.min(99, Math.round(Number(p.marks))) : 1;
        return {
          text: str(p.text || p.prompt, 2000),
          answer: str(p.answer || p.correctAnswer, 1000),
          marks,
          answerFormat: fmt,
        };
      })
      .filter((p) => p.text)
      .slice(0, 12);
  return parts;
}

function validateAssessment(input) {
  const errors = [];
  if (!input || typeof input !== "object") {
    return {ok: false, errors: ["Top-level payload must be an object."]};
  }

  const h = input.header || {};
  const header = {
    title: str(h.title, 200),
    grade: str(h.grade, 20),
    subject: str(h.subject, 60),
    topic: str(h.topic, 200),
    subtopic: str(h.subtopic, 200),
    term: Number.isInteger(Number(h.term)) ? Number(h.term) : null,
    durationMinutes: isPositiveNumber(Number(h.durationMinutes)) ?
      Math.round(Number(h.durationMinutes)) : 40,
    totalMarks: isNonNegativeNumber(Number(h.totalMarks)) ?
      Math.round(Number(h.totalMarks)) : 0,
    instructions: cleanCoverInstructions(str(h.instructions, 1000)) ||
      "Answer ALL questions. Write clearly and show your working.",
  };
  if (!header.title) errors.push("header.title is required");
  if (!header.grade) errors.push("header.grade is required");
  if (!header.subject) errors.push("header.subject is required");
  if (!header.topic) errors.push("header.topic is required");

  let globalQNum = 1;
  let marksFromQuestions = 0;
  const sections = Array.isArray(input.sections) ?
    input.sections
        .filter((s) => s && typeof s === "object")
        .map((s, sIdx) => {
          const questions = Array.isArray(s.questions) ?
            s.questions
                .filter((q) => q && typeof q === "object")
                .map((q) => {
                  let type = ALLOWED_TYPES.has(q.type) ?
                    q.type : "short_answer";
                  // Sub-parts: "(a)…(b)…(c)…" under one instruction stem. When
                  // present the question's marks are the SUM of its parts (the
                  // stem owns none), so the paper total stays honest.
                  const parts = normalizeParts(q.parts);
                  const marks = parts.length ?
                    parts.reduce((s, p) => s + (Number(p.marks) || 0), 0) :
                    (isPositiveNumber(q.marks) ? Math.round(q.marks) : 1);
                  marksFromQuestions += marks;
                  const number = isPositiveNumber(q.number) ?
                    Math.round(q.number) : globalQNum;
                  globalQNum = Math.max(globalQNum + 1, number + 1);
                  const options = Array.isArray(q.options) ?
                    q.options.filter(isNonEmptyString)
                        .map((o, i) => stripOptionLabel(o, i)) : null;
                  // Match-the-columns (v1.3): left/right string columns +
                  // pairs[i] = index into right that pairs with left[i].
                  // A malformed matching question degrades to short_answer
                  // (the model answer still carries the pairs in prose).
                  let matching = null;
                  if (type === "matching") {
                    const left = Array.isArray(q.left) ?
                      q.left.filter(isNonEmptyString)
                          .slice(0, 6).map((v) => str(v, 200)) : [];
                    const right = Array.isArray(q.right) ?
                      q.right.filter(isNonEmptyString)
                          .slice(0, 8).map((v) => str(v, 200)) : [];
                    const pairs = Array.isArray(q.pairs) ?
                      q.pairs.map((p) => Number(p)) : [];
                    const valid = left.length >= 2 && right.length >= 2 &&
                      pairs.length === left.length &&
                      pairs.every((p) => Number.isInteger(p) &&
                        p >= 0 && p < right.length);
                    if (valid) {
                      matching = {left, right, pairs};
                    } else {
                      type = "short_answer";
                    }
                  }
                  return {
                    number,
                    type,
                    prompt: str(q.prompt, 2000) || "(missing question)",
                    options: (type === "multiple_choice" ||
                      type === "true_false") ?
                      (options && options.length >= 2 ? options : null) :
                      null,
                    matching,
                    marks,
                    // Optional brief of a figure the teacher should attach
                    // (v1.1). Coerces to null for absent/garbage values so
                    // old payloads and clients are unaffected. Kept alongside
                    // `visual` for backward compatibility.
                    diagram: str(q.diagram, 500) || null,
                    // Structured figure spec (v1.4): stem_figure /
                    // labelled_figure / option_images, or null. The studio
                    // generates the actual image(s) from this.
                    visual: normalizeVisual(q),
                    answer: str(q.answer, 2000),
                    markingGuide: str(q.markingGuide, 2000),
                    // [] for single-answer questions; populated for "(a)(b)(c)".
                    parts,
                  };
                }) :
            [];
          return {
            title: stripSectionLabel(str(s.title, 200)) || `Section ${sIdx + 1}`,
            instructions: str(s.instructions, 600),
            // Optional original reading passage (v1.2). Coerces to null
            // unless a non-empty text is present, so old payloads and
            // clients are unaffected.
            passage: s.passage && typeof s.passage === "object" &&
              isNonEmptyString(s.passage.text) ?
              {
                title: str(s.passage.title, 200),
                text: str(s.passage.text, 6000),
              } : null,
            questions,
          };
        }) :
    [];

  if (sections.length === 0 ||
      sections.every((s) => s.questions.length === 0)) {
    errors.push("The assessment has no questions.");
  }

  if (header.totalMarks === 0 || header.totalMarks !== marksFromQuestions) {
    header.totalMarks = marksFromQuestions;
  }

  const value = {
    schemaVersion: SCHEMA_VERSION,
    header,
    sections,
    markingScheme: {
      notes: str((input.markingScheme || {}).notes, 3000),
      totalMarks: marksFromQuestions,
    },
  };

  return errors.length === 0 ?
    {ok: true, value} :
    {ok: false, errors, value};
}

module.exports = {SCHEMA_VERSION, validateAssessment};
