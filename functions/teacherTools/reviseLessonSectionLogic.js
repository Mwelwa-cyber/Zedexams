/**
 * Pure input/prompt logic for the reviseLessonSection callable.
 *
 * Extracted from reviseLessonSection.js so it can be unit-tested under plain
 * `node` without pulling in firebase-functions — the same pattern as
 * reviseQuestionLogic.js. No side effects, no requires.
 *
 * The Lesson Plan Studio uses this to let a teacher AI-edit ONE part of an
 * already-generated lesson plan (a prose field like the Lesson Goal or
 * Rationale, or a list field like a stage's Teacher's Activities) without
 * regenerating the whole plan. The function rewrites only the section it is
 * handed and returns the revised content in the SAME shape it received —
 * a string for prose sections, an array of strings for list sections.
 */

// Prose sections return a single string; list sections return an array.
const ALLOWED_KINDS = new Set(["text", "list"]);

// Curriculum mode drives the learner/pupil terminology so a revision matches
// the rest of the plan (CBC says "learners", the 2013 curriculum says "pupils").
const ALLOWED_MODES = new Set(["cbc", "previous"]);

// Quick-action modifiers exposed as one-tap buttons in the editor. A teacher
// can also (or instead) type a free-text instruction. "polish" must NOT change
// the meaning or difficulty — it only fixes grammar, clarity and consistency.
const ALLOWED_MODIFIERS = new Set([
  "simpler",
  "detailed",
  "shorter",
  "polish",
  "rewrite",
]);

// A list section never needs more than this many items, and capping it keeps
// the token budget (and the rendered table cell) sane.
const MAX_LIST_ITEMS = 12;

function str(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/**
 * Coerce the incoming `current` value to the canonical shape for `kind`.
 * - text  → a single trimmed string (joins arrays with newlines).
 * - list  → an array of trimmed, non-empty strings (splits strings on
 *           newlines / semicolons), capped at MAX_LIST_ITEMS.
 */
function coerceCurrent(current, kind) {
  if (kind === "list") {
    const arr = Array.isArray(current) ?
      current :
      String(current == null ? "" : current).split(/\n|;\s*/);
    return arr
      .map((x) => String(x == null ? "" : x).trim())
      .filter(Boolean)
      .slice(0, MAX_LIST_ITEMS);
  }
  // text
  if (Array.isArray(current)) {
    return current.map((x) => String(x == null ? "" : x).trim()).filter(Boolean).join("\n").slice(0, 4000);
  }
  return str(current, 4000);
}

function sanitizeInputs(raw = {}) {
  const kindRaw = str(raw.kind, 10).toLowerCase();
  const kind = ALLOWED_KINDS.has(kindRaw) ? kindRaw : "text";

  // NO default: a missing / unknown curriculum mode becomes "" so the
  // transformation gate (checkSourceCurriculum) fails closed rather than
  // silently editing a 2013-syllabus section with CBC terminology. Real client
  // calls always send a valid mode; a direct API call that omits it is refused.
  const modeRaw = str(raw.curriculumMode, 10).toLowerCase();
  const curriculumMode = ALLOWED_MODES.has(modeRaw) ? modeRaw : "";

  const modifierRaw = str(raw.modifier, 20).toLowerCase();
  const modifier = ALLOWED_MODIFIERS.has(modifierRaw) ? modifierRaw : null;

  const ctx = raw.context && typeof raw.context === "object" ? raw.context : {};

  return {
    sectionLabel: str(raw.sectionLabel, 120),
    kind,
    curriculumMode,
    current: coerceCurrent(raw.current, kind),
    modifier,
    instruction: str(raw.instruction, 600),
    context: {
      grade: str(ctx.grade, 40),
      subject: str(ctx.subject, 80),
      topic: str(ctx.topic, 200),
      subtopic: str(ctx.subtopic, 200),
    },
  };
}

function validateInputs(inputs) {
  const errs = [];
  if (!inputs.sectionLabel) errs.push("A section label is required.");
  const hasCurrent = inputs.kind === "list" ?
    Array.isArray(inputs.current) && inputs.current.length > 0 :
    !!inputs.current;
  // "rewrite" / "detailed" can work from an empty section (the teacher wants
  // the AI to draft it from the lesson context), but the polish/shorten/simpler
  // actions need existing content to act on.
  const needsContent = inputs.modifier === "simpler" ||
    inputs.modifier === "shorter" || inputs.modifier === "polish";
  if (needsContent && !hasCurrent) {
    errs.push("This section is empty — there is nothing to " +
      `${inputs.modifier === "shorter" ? "shorten" : inputs.modifier}.`);
  }
  if (!inputs.modifier && !inputs.instruction) {
    errs.push(
      "Pick a quick action (simpler / more detail / shorter / polish / " +
      "rewrite) or type an instruction so the AI knows what to change.",
    );
  }
  return errs;
}

const SYSTEM_PROMPT = [
  "You are an expert Zambian teacher and curriculum specialist who edits",
  "lesson plans. You will be given ONE section of an existing lesson plan and",
  "an instruction. Rewrite ONLY that section.",
  "",
  "Rules:",
  "- Stay within the Zambian syllabus named in the request (a request states",
  "  its curriculum) and keep the section consistent with the lesson topic and",
  "  grade you are told. Never move it into a different curriculum.",
  "- Preserve the section's purpose. Improve it — do not drift to a different",
  "  section or invent unrelated content.",
  "- Teacher activities are imperatives that start with a strong verb",
  "  (\"Ask\", \"Demonstrate\", \"Guide\"). Learner/pupil activities are",
  "  present-tense responses (\"Discuss\", \"Draw\", \"Observe\").",
  "- Complete, grammatically correct sentences. No fragments, no trailing",
  "  \"...\", no double spaces, no contractions, no first person, no slang,",
  "  and no placeholder text like \"N/A\" or \"TBD\".",
  "- Use Zambian English spelling (colour, practise as a verb, programme) and",
  "  plain-text fractions like 1/2 — never unicode glyphs. No markdown.",
  "- Return ONLY the revised section content through the tool — no preamble,",
  "  no labels, no commentary.",
].join("\n");

function modifierLine(modifier, kind) {
  const noun = kind === "list" ? "list" : "text";
  return {
    simpler: `Use SIMPLER vocabulary and shorter sentences so a trainee ` +
      `teacher can follow it. Keep the same meaning and coverage.`,
    detailed: `Add more useful detail and make the ${noun} more thorough and ` +
      `classroom-ready, while staying concise and on-topic.`,
    shorter: `Make the ${noun} more concise. Keep the essential points and ` +
      `remove padding.`,
    polish: `POLISH ONLY: fix grammar, spelling, clarity and consistency. Do ` +
      `NOT change the meaning, difficulty or coverage. If it is already clean, ` +
      `return it unchanged.`,
    rewrite: `Rewrite this ${noun} so it is clearer, stronger and more ` +
      `classroom-ready, keeping the same purpose.`,
  }[modifier];
}

function buildUserPrompt(inputs) {
  const learner = inputs.curriculumMode === "previous" ? "pupils" : "learners";
  const lines = [];
  const c = inputs.context;
  if (c.grade) lines.push(`Grade / Class: ${c.grade}`);
  if (c.subject) lines.push(`Subject: ${c.subject}`);
  if (c.topic) lines.push(`Topic: ${c.topic}`);
  if (c.subtopic) lines.push(`Sub-topic: ${c.subtopic}`);
  lines.push(`Curriculum terminology: use "${learner}" for the class.`);
  lines.push("");
  lines.push(`Section to edit: ${inputs.sectionLabel}`);

  if (inputs.kind === "list") {
    lines.push(
      "This section is a LIST. Return an array of short, parallel items " +
      `(maximum ${MAX_LIST_ITEMS}). Each item is one action or point — no ` +
      "numbering or bullet characters inside the items.",
    );
  } else {
    lines.push(
      "This section is PROSE. Return it as clean sentences (a short paragraph " +
      "unless the section is naturally a single line).",
    );
  }

  if (inputs.modifier) lines.push("", modifierLine(inputs.modifier, inputs.kind));
  if (inputs.instruction) {
    lines.push("", `Teacher's instruction: ${inputs.instruction}`);
  }

  lines.push("", "Current content:");
  if (inputs.kind === "list") {
    if (inputs.current.length === 0) {
      lines.push("(empty — draft this section from the lesson context above)");
    } else {
      inputs.current.forEach((item, i) => lines.push(`${i + 1}. ${item}`));
    }
  } else {
    lines.push(inputs.current || "(empty — draft this section from the lesson context above)");
  }
  return lines.join("\n");
}

/**
 * Tool input schema for the model's structured reply. It returns BOTH possible
 * shapes optional; the caller picks the one matching `kind` and falls back to
 * the other so a stray shape from the model is still usable.
 */
function toolInputSchema(kind) {
  if (kind === "list") {
    return {
      type: "object",
      additionalProperties: false,
      properties: {
        items: {
          type: "array",
          maxItems: MAX_LIST_ITEMS,
          items: {type: "string", maxLength: 600},
        },
      },
      required: ["items"],
    };
  }
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      text: {type: "string", maxLength: 4000},
    },
    required: ["text"],
  };
}

/**
 * Normalise the model's tool reply to the shape requested by `kind`.
 * Returns { text } for prose, { items } for lists. Strips any stray leading
 * numbering / bullet glyphs from list items.
 */
function normalizeOutput(parsed, kind) {
  const p = parsed && typeof parsed === "object" ? parsed : {};
  if (kind === "list") {
    let items = Array.isArray(p.items) ? p.items : null;
    // Tolerate a model that returned prose for a list section.
    if (!items && typeof p.text === "string") {
      items = p.text.split(/\n|;\s*/);
    }
    items = (items || [])
      .map((x) => String(x == null ? "" : x).replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "").trim())
      .filter(Boolean)
      .slice(0, MAX_LIST_ITEMS);
    return {items};
  }
  // text — tolerate a model that returned an items array for a prose section.
  let text = typeof p.text === "string" ? p.text.trim() : "";
  if (!text && Array.isArray(p.items)) {
    text = p.items.map((x) => String(x == null ? "" : x).trim()).filter(Boolean).join(" ");
  }
  return {text: text.slice(0, 4000)};
}

module.exports = {
  ALLOWED_KINDS,
  ALLOWED_MODES,
  ALLOWED_MODIFIERS,
  MAX_LIST_ITEMS,
  coerceCurrent,
  sanitizeInputs,
  validateInputs,
  buildUserPrompt,
  toolInputSchema,
  normalizeOutput,
  SYSTEM_PROMPT,
};
