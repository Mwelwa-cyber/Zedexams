/**
 * The learner-notes generation pipeline (§3, §3b, §4b).
 *
 * Four steps, in this order, and the order is the design:
 *
 *   1. RETRIEVE — read the syllabus first (`notesBoundary`). Nothing is written
 *      before the boundary exists.
 *   2. PROPOSE — match the topic against the curriculum diagram library. This
 *      is deterministic and server-side: "Topic = Digestive System" gets the
 *      digestive figure every time, rather than whichever picture the model
 *      felt like describing.
 *   3. WRITE — one model call, inside the boundary, at the teacher's format,
 *      detail, length and English level.
 *   4. VERIFY — lint the voice and check the depth ceiling, then REGENERATE the
 *      sections that failed. A prompt instruction is a request; step 4 is what
 *      makes it a guarantee.
 *
 * Step 4 runs at most `MAX_REWRITE_PASSES` times per section. An unbounded
 * repair loop is a way to spend a teacher's afternoon and their AI budget on a
 * model that has decided it disagrees; a bounded one leaves the honest residue
 * in `checks`, which the studio shows and the saved document keeps.
 */

const {callClaude} = require("./anthropicClient");
const {resolveNotesBoundary, groundingSummary} = require("./notesBoundary");
const {validateLearnerNotes, replaceLearnerSection} = require("./learnerNotesSchema");
const {
  PROMPT_VERSION,
  pickLearnerSystemPrompt,
  buildLearnerUserPrompt,
  buildSectionRewritePrompt,
} = require("./learnerNotesPrompt");

const LEARNER_NOTES_MODEL = process.env.NOTES_MODEL || "claude-sonnet-4-6";

/** One repair attempt per failing section. See the docblock. */
const MAX_REWRITE_PASSES = 1;

/** The most sections one generation will pay to rewrite. */
const MAX_REWRITTEN_SECTIONS = 3;

// Permissive: the strict checking is `validateLearnerNotes`. The schema's job
// here is to force tool use so a prose reply can never reach the parser.
const LEARNER_TOOL_SCHEMA = {
  type: "object",
  description: "Study notes written for a Zambian learner to read and keep.",
  additionalProperties: true,
  properties: {header: {type: "object", additionalProperties: true}},
};

const SECTION_TOOL_SCHEMA = {
  type: "object",
  description: "One rewritten section of a learner-notes document.",
  additionalProperties: true,
};

/**
 * The shared ESM packages, reached the way Cloud Functions has to reach them.
 *
 * CommonJS runtime, ESM package: a top-level `require` throws at cold start, so
 * the import happens inside the async path. See functions/shared/README.md.
 */
async function loadShared() {
  const [options, voice, scope, diagrams] = await Promise.all([
    import("../shared/notes/notesOptionsCore.js"),
    import("../shared/notes/learnerVoiceCore.js"),
    import("../shared/notes/syllabusScopeCore.js"),
    import("../shared/assessment/curriculumDiagramsCore.js"),
  ]);
  return {options, voice, scope, diagrams};
}

/**
 * Choose the figure this topic asks for, and build both variants of it (§4b).
 *
 * Returns null when nothing in the library matches — a wrong figure on a
 * printed handout is worse than no figure, so there is no "closest match"
 * fallback here.
 */
function proposeDiagrams({diagrams, match, format}) {
  if (!match) return null;
  const {entry, key} = match;
  const board = format === "board";
  const answers = diagrams.diagramAnswerKey(entry, {board});
  const wordBank = diagrams.diagramWordBank(entry, {board});

  return {
    key,
    caption: entry.name,
    parts: answers.map((a) => a.name),
    answers,
    wordBank,
    // Board notes get the simplified copy — the few lines a teacher can
    // realistically chalk up — in both places it appears.
    blocks: [
      {
        placement: "body",
        sectionIndex: 0,
        libraryKey: key,
        mode: "study",
        caption: entry.name,
        params: {labels: "on", board: board ? "yes" : "no", cap: entry.name},
      },
      {
        placement: "exercise",
        libraryKey: key,
        mode: "label-it",
        caption: `Label the ${entry.name.toLowerCase()}`,
        params: {labels: "off", board: board ? "yes" : "no", cap: entry.name},
        wordBank,
      },
    ],
  };
}

/** The document fragment a section id names, for the rewrite prompt. */
function sectionValue(notes, sectionId) {
  if (sectionId === "outcomes") return {learningOutcomes: notes.learningOutcomes};
  if (sectionId === "exercise") return {exercise: notes.exercise};
  return {[sectionId]: notes[sectionId]};
}

/**
 * Rewrite the sections the checks refused.
 *
 * Each rewrite is validated by re-running BOTH checks over the whole document,
 * not just the section: a rewrite that fixes the voice by importing a
 * beyond-grade term has not fixed anything, and only a whole-document check
 * sees that.
 */
async function repairSections({
  apiKey, uid, notes, inputs, options, boundary, voice, scope, checks,
}) {
  const failing = [...new Set([...checks.voice.sections, ...checks.scope.sections])]
      .slice(0, MAX_REWRITTEN_SECTIONS);
  if (failing.length === 0) return {notes, checks, rewritten: [], usage: []};

  let current = notes;
  const rewritten = [];
  const usage = [];

  for (const sectionId of failing) {
    for (let pass = 0; pass < MAX_REWRITE_PASSES; pass += 1) {
      const label = (voice.LEARNER_SECTION_FIELDS.find((s) => s.id === sectionId) || {}).label
        || sectionId;
      const prompt = buildSectionRewritePrompt({
        sectionId,
        sectionLabel: label,
        current: sectionValue(current, sectionId),
        voiceViolations: checks.voice.violations.filter((v) => v.section === sectionId),
        scopeViolations: checks.scope.outOfScope.filter(
            (v) => v.section === sectionId || v.section.startsWith(`${sectionId}.`),
        ),
        inputs: {boundary, options},
      });

      let response;
      try {
        response = await callClaude(apiKey, {
          track: {uid, tool: "notes"},
          systemPrompt: pickLearnerSystemPrompt(inputs),
          messages: [{role: "user", content: prompt}],
          maxTokens: 2000,
          temperature: 0.3,
          model: LEARNER_NOTES_MODEL,
          mode: "tool",
          toolName: "emit_notes_section",
          toolDescription: "Emit the rewritten section as a single structured object.",
          toolInputSchema: SECTION_TOOL_SCHEMA,
        });
      } catch (err) {
        // A failed repair leaves the ORIGINAL section in place and says so in
        // `checks`. Dropping the section instead would turn a wording problem
        // into a missing part of the handout.
        console.error("[learnerNotes] section rewrite failed", {sectionId}, err);
        break;
      }
      usage.push(response.usage || {});

      const parsed = response.parsed;
      if (!parsed || typeof parsed !== "object") break;

      // Re-validate the whole document so a rewrite cannot smuggle in a shape
      // the schema would have rejected on the first pass.
      const candidate = replaceLearnerSection(current, sectionId, parsed);
      const revalidated = validateLearnerNotes(candidate, options, {
        grounding: candidate.grounding,
        diagrams: candidate.diagrams,
        diagramLabels: candidate.answerKey && candidate.answerKey.diagramLabels,
        diagramCaption: candidate.answerKey && candidate.answerKey.diagramCaption,
      });
      if (!revalidated.value) break;

      current = revalidated.value;
      rewritten.push(sectionId);
      break;
    }
  }

  const finalChecks = runChecks({notes: current, inputs, boundary, voice, scope});
  return {notes: current, checks: finalChecks, rewritten, usage};
}

/** Both post-generation checks, over the whole document. */
function runChecks({notes, inputs, boundary, voice, scope}) {
  return {
    voice: voice.lintLearnerNotes(notes),
    scope: scope.checkScope(notes, {
      grade: inputs.grade,
      subject: inputs.subject,
      outcomes: boundary.outcomes,
    }),
  };
}

/**
 * Generate one learner-notes document.
 *
 * Returns everything the caller needs to persist and to answer the client; it
 * deliberately does no Firestore writing, no usage metering and no idempotency
 * work — those belong to `generateNotes.js`, which owns them for both
 * audiences.
 */
async function generateLearnerNotesDocument({apiKey, uid, inputs, rawOptions = {}}) {
  const {options: optionsCore, voice, scope, diagrams} = await loadShared();
  const options = optionsCore.normalizeNotesOptions(
      {...rawOptions, audience: "learner"},
      {audienceFallback: "learner"},
  );
  const budget = optionsCore.lengthBudget(options);

  // 1. RETRIEVE.
  const boundary = await resolveNotesBoundary({
    grade: inputs.grade,
    subject: inputs.subject,
    topic: inputs.topic,
    subtopic: inputs.subtopic,
    term: inputs.term,
    framework: inputs.framework,
  });

  // 2. PROPOSE.
  const match = diagrams.matchCurriculumDiagram({
    topic: inputs.topic,
    subtopic: inputs.subtopic,
    subject: inputs.subject,
  });
  const diagram = proposeDiagrams({diagrams, match, format: options.format});

  // 3. WRITE.
  const userPrompt = buildLearnerUserPrompt({
    ...inputs,
    options,
    budget,
    boundary,
    diagram: diagram ? {
      caption: diagram.caption,
      parts: diagram.parts,
      hasLabelIt: true,
    } : null,
  });

  const response = await callClaude(apiKey, {
    track: {uid, tool: "notes"},
    systemPrompt: pickLearnerSystemPrompt(inputs),
    messages: [{role: "user", content: userPrompt}],
    maxTokens: 6000,
    temperature: 0.4,
    model: LEARNER_NOTES_MODEL,
    mode: "tool",
    toolName: "emit_learner_notes",
    toolDescription:
      "Emit the complete learner study notes as a single structured object. " +
      "Do not include any prose or commentary outside this tool call.",
    toolInputSchema: LEARNER_TOOL_SCHEMA,
  });

  const grounding = groundingSummary(boundary, {
    gradeLabel: String(inputs.grade || "").replace(/^G/i, "Grade "),
    subjectLabel: String(inputs.subject || "").replace(/_/g, " "),
  });

  const parsed = response.parsed || {};
  if (parsed.header && typeof parsed.header === "object") {
    // Teacher-supplied, never model-invented.
    if (inputs.date) parsed.header.date = inputs.date;
    if (inputs.school) parsed.header.school = inputs.school;
    if (inputs.teacherName) parsed.header.teacherName = inputs.teacherName;
    if (inputs.lessonPlanId) parsed.header.lessonPlanId = inputs.lessonPlanId;
  }

  const validation = validateLearnerNotes(parsed, options, {
    grounding,
    diagrams: diagram ? diagram.blocks : [],
    diagramLabels: diagram ? diagram.answers : [],
    diagramCaption: diagram ? diagram.caption : "",
  });
  let notes = validation.value;

  // 4. VERIFY, then repair what failed.
  let checks = runChecks({notes, inputs, boundary, voice, scope});
  const repair = await repairSections({
    apiKey, uid, notes, inputs, options, boundary, voice, scope, checks,
  });
  notes = repair.notes;
  checks = repair.checks;

  // The verdict travels WITH the document. A teacher reopening it a week later
  // sees the same warnings the studio showed when it was written — a check that
  // only ever existed in one render is a check nobody can act on later.
  notes.checks = {
    voiceClean: checks.voice.ok,
    voiceMessage: voice.learnerVoiceMessage(checks.voice),
    scopeChecked: checks.scope.checked,
    scopeClean: checks.scope.ok,
    scopeMessage: scope.scopeMessage(checks.scope),
    uncoveredOutcomes: checks.scope.uncoveredOutcomes,
    rewrittenSections: repair.rewritten,
  };

  const tokensIn = Number((response.usage || {}).inputTokens || 0)
    + repair.usage.reduce((sum, u) => sum + Number(u.inputTokens || 0), 0);
  const tokensOut = Number((response.usage || {}).outputTokens || 0)
    + repair.usage.reduce((sum, u) => sum + Number(u.outputTokens || 0), 0);

  return {
    notes,
    validation,
    options,
    boundary,
    grounding,
    checks: notes.checks,
    raw: response.text || "",
    modelUsed: response.model || LEARNER_NOTES_MODEL,
    usageInfo: {inputTokens: tokensIn, outputTokens: tokensOut},
    promptVersion: PROMPT_VERSION,
  };
}

module.exports = {
  generateLearnerNotesDocument,
  proposeDiagrams,
  runChecks,
  LEARNER_NOTES_MODEL,
  MAX_REWRITE_PASSES,
};
