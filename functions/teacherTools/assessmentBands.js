/**
 * Assessment bands, server side — the pedagogical rules the generator must obey
 * for the level a paper targets.
 *
 * Same contract as the client (src/utils/assessmentBandService.js): the
 * `assessmentBands` Firestore collection is the live source, and the published
 * defaults are the fallback. Here the defaults come from
 * functions/data/assessmentBands.json, which is GENERATED from
 * src/config/assessmentBands.js by `npm run sync:assessment-bands` —
 * functions/ is a separate package and only its own directory is uploaded on
 * deploy, so it cannot import from src/. scripts/test-assessment-bands.mjs
 * fails CI if the generated copy is stale, so the two cannot drift.
 *
 * A stored document that fails validation is refused in favour of the defaults:
 * a band that has been broken in the console must not be able to widen what a
 * Baby Class paper may contain.
 *
 * No band rule is written into a prompt. buildBandDirective() renders the
 * resolved document into prompt text at call time, so correcting a band in
 * Firestore changes what the model is told without a deploy.
 */

const admin = require("firebase-admin");
const seed = require("../data/assessmentBands.json");

const BAND_IDS = seed.bandIds;
const ALL_QUESTION_TYPES = seed.allQuestionTypes;
const ASSESSMENT_BAND_SEED = seed.bands;

// Level id → band id. Derived from the bands' own `levels` lists so the ladder
// mapping is stated once (in src/config/educationLevels.js) and echoed here
// only through data, never through a second hand-written table.
const LEVEL_TO_BAND = (() => {
  const map = {};
  for (const id of BAND_IDS) {
    for (const levelId of (ASSESSMENT_BAND_SEED[id].levels || [])) map[levelId] = id;
  }
  return map;
})();

/**
 * KB grade code → level id. Mirrors src/config/educationLevels.js. ECE_R serves
 * both Middle Class and Reception (two school years, one published syllabus),
 * so a bare ECE_R resolves to Reception — what it has always meant. A bare
 * "ECE" predates the age bands and spans all three years; it resolves to the
 * youngest, matching normalizePaperGrade on the client, because pitching
 * content down is harmless to an older child and pitching it up is not.
 */
const KB_GRADE_TO_LEVEL = {
  ECE_N: "baby-class",
  ECE_B: "baby-class",
  ECE_M: "middle-class",
  ECE_R: "reception",
  ECE: "baby-class",
  G1: "grade-1", G2: "grade-2", G3: "grade-3", G4: "grade-4",
  G5: "grade-5", G6: "grade-6", G7: "grade-7",
  G8: "form-1", G9: "form-2", G10: "form-3", G11: "form-4", G12: "form-5",
};

/**
 * Band vocabulary → the question type the OUTPUT SCHEMA can validate and the
 * renderers can draw.
 *
 * A band names the task pedagogically ("tracing", "circling", "counting")
 * because that is what a teacher and a curriculum call it. The generator's
 * output schema (assessmentSchema.js) accepts eight structural types, and the
 * four renderers know how to lay those out. Emitting "tracing" as a question
 * type would fail schema validation and, if it somehow passed, would reach an
 * exporter with no idea how to draw it.
 *
 * So the band's word is what the MODEL is told to produce (via the directive,
 * which spells the task out), and this map is what the paper is STRUCTURED as.
 * A "circle the correct picture" item really is a multiple-choice question
 * whose options are images; "match the pictures" really is a matching question.
 *
 * The three that map to `structured` — tracing, colouring, sorting — are honest
 * but thin: they render as a figure plus a work area today. Giving them their
 * own layout is the rendering-contract work, not something to fake here.
 */
const BAND_TYPE_TO_SCHEMA_TYPE = {
  picture_identification: "short_answer",
  circling: "multiple_choice",
  picture_matching: "matching",
  counting: "short_answer",
  tracing: "structured",
  colouring: "structured",
  sorting: "structured",
  diagram_labelling: "structured",
  table_completion: "structured",
  comprehension: "short_answer",
  multi_step_calculation: "calculation",
  data_interpretation: "structured",
  extended_response: "essay",
  case_study: "structured",
  graph_interpretation: "structured",
  practical: "structured",
};

/**
 * Convert band vocabulary into the deduped schema types the generator emits.
 * Types that are already schema types pass through unchanged.
 */
function toSchemaTypes(types) {
  const out = [];
  for (const t of (Array.isArray(types) ? types : [])) {
    const mapped = BAND_TYPE_TO_SCHEMA_TYPE[t] || t;
    if (!out.includes(mapped)) out.push(mapped);
  }
  return out;
}

/** Validate a band document — mirror of validateBand in src/config/assessmentBands.js. */
function validateBand(band) {
  const problems = [];
  if (!band || typeof band !== "object") return ["band is not an object"];
  if (!BAND_IDS.includes(band.id)) problems.push(`unknown band id "${band.id}"`);
  if (!Array.isArray(band.questionTypes) || band.questionTypes.length === 0) {
    problems.push("questionTypes must be a non-empty array");
  } else {
    for (const type of band.questionTypes) {
      if (!ALL_QUESTION_TYPES.includes(type)) {
        problems.push(`unknown question type "${type}"`);
      }
    }
  }
  if (!band.reading || typeof band.reading.requirement !== "string") {
    problems.push("reading.requirement is required");
  }
  const dist = band.bloomDistribution;
  if (!dist || typeof dist !== "object") {
    problems.push("bloomDistribution is required");
  } else {
    const sum = Object.values(dist).reduce((n, v) => n + (Number(v) || 0), 0);
    if (Math.abs(sum - 1) > 0.001) {
      problems.push(`bloomDistribution must sum to 1 (got ${sum})`);
    }
  }
  if (!Number.isFinite(Number(band.minFigureSizeMm))) {
    problems.push("minFigureSizeMm must be a number");
  }
  return problems;
}

/** Resolve a grade token ('G4', '4', 'ECE_B', 'Form 3') to a ladder level id. */
function levelIdForGrade(grade) {
  const raw = String(grade == null ? "" : grade).trim();
  if (!raw) return "";
  const upper = raw.toUpperCase().replace(/\s+/g, "");
  if (KB_GRADE_TO_LEVEL[upper]) return KB_GRADE_TO_LEVEL[upper];
  const form = upper.match(/^F(?:ORM)?(\d)$/);
  if (form) return `form-${form[1]}`;
  const num = upper.match(/^(?:GRADE)?(\d{1,2})$/);
  if (num) {
    const n = Number(num[1]);
    if (n >= 1 && n <= 7) return `grade-${n}`;
    // 8-12 are the Form years under their alternative Grade naming.
    if (n >= 8 && n <= 12) return `form-${n - 7}`;
  }
  return "";
}

let _cache = null;

/** Clear the cached read — tests, and after a band is edited. */
function resetBandCache() {
  _cache = null;
}

/**
 * Load every band, Firestore first, defaults as fallback. Never throws.
 * @returns {Promise<{bands: object, source: string}>}
 */
async function loadAssessmentBands() {
  if (_cache) return _cache;
  const bands = {};
  let fromStore = 0;
  try {
    const snap = await admin.firestore().collection("assessmentBands").get();
    snap.forEach((doc) => {
      const data = Object.assign({}, doc.data(), {id: doc.id});
      const problems = validateBand(data);
      if (problems.length > 0) {
        console.warn(`assessmentBands: ignoring invalid band "${doc.id}"`, problems);
        return;
      }
      bands[doc.id] = data;
      fromStore += 1;
    });
  } catch (err) {
    console.warn("assessmentBands: read failed, using published defaults", err);
  }
  for (const id of BAND_IDS) {
    if (!bands[id]) bands[id] = ASSESSMENT_BAND_SEED[id];
  }
  _cache = {
    bands,
    source: fromStore === 0 ? "seed" :
      (fromStore === BAND_IDS.length ? "firestore" : "mixed"),
  };
  return _cache;
}

/** The band governing a grade token, or null when it resolves to no level. */
async function bandForGrade(grade) {
  const bandId = LEVEL_TO_BAND[levelIdForGrade(grade)];
  if (!bandId) return null;
  const {bands} = await loadAssessmentBands();
  return bands[bandId] || null;
}

/**
 * The question types a band permits, intersected with what the teacher asked
 * for. An empty `requested` means "everything the band allows".
 *
 * This is what stops a Baby Class paper containing an essay: the band is the
 * ceiling, the teacher's selection narrows it, and nothing can widen it.
 */
function allowedQuestionTypes(band, requested = []) {
  const permitted = Array.isArray(band && band.questionTypes) ? band.questionTypes : [];
  const asked = Array.isArray(requested) ? requested.filter(Boolean) : [];
  if (asked.length === 0) return permitted.slice();
  return asked.filter((t) => permitted.includes(t));
}

/**
 * Render a band into the prompt directive for this paper.
 *
 * Deliberately generated from the document rather than written into a prompt
 * file: editing a band in Firestore must change what the model is told, with no
 * deploy and no prompt version bump.
 *
 * @param {object} band a resolved band document
 * @param {string} levelLabel how the paper names its level ("Baby Class")
 * @returns {string} prompt text, or '' when there is no band
 */
function buildBandDirective(band, levelLabel = "") {
  if (!band) return "";
  const lines = [];
  const who = levelLabel || band.label;
  lines.push(`BAND RULES — ${who} (${band.label}). These are not suggestions; a paper that breaks them is wrong for this level.`);

  const reading = band.reading || {};
  if (reading.requirement === "none") {
    lines.push(
        "READING: the learner CANNOT be assumed to read. Every single item must " +
      "be answerable from a picture, or from a sentence the teacher reads " +
      "aloud. Never write an instruction the child has to read for themselves.",
    );
  } else if (reading.note) {
    lines.push(`READING: ${reading.note}`);
  }
  if (reading.vocabulary) lines.push(`VOCABULARY: ${reading.vocabulary}.`);
  if (Number(reading.maxWordsPerItem) > 0) {
    lines.push(`Keep each item under about ${reading.maxWordsPerItem} words.`);
  }
  if (Number(reading.maxWordsPerPaper) > 0) {
    lines.push(`Keep the whole paper under about ${reading.maxWordsPerPaper} words of reading.`);
  }

  // The permitted TASKS, in the band's own vocabulary. The schema-level
  // "allowed question types" line elsewhere in the prompt says what each item
  // is structurally (a picture-matching task IS a matching question); this says
  // what the task must actually BE, which is what the model needs to write a
  // tracing or counting item rather than a sentence to read.
  const tasks = Array.isArray(band.questionTypes) ? band.questionTypes : [];
  if (tasks.length > 0) {
    lines.push(
        `PERMITTED TASKS — every item must be one of these, phrased the way this ` +
      `stage is really assessed: ${tasks.map((t) => t.replace(/_/g, " ")).join(", ")}.`,
    );
  }

  const structure = band.structure || {};
  if (Number(structure.mcqOptionCount) > 0) {
    lines.push(`Multiple-choice questions have exactly ${structure.mcqOptionCount} options.`);
  }
  for (const note of (structure.notes || [])) lines.push(note);
  if (structure.requiresFigureOrScript) {
    lines.push("EVERY item carries either a figure or a teacher-read script — no exceptions.");
  }

  const dist = band.bloomDistribution || {};
  const spread = Object.keys(dist)
      .map((level) => `${level} ${Math.round(Number(dist[level]) * 100)}%`)
      .join(", ");
  if (spread) lines.push(`COGNITIVE SPREAD — aim for roughly: ${spread}.`);

  if (band.instructionFormality) {
    lines.push(`INSTRUCTION REGISTER: ${band.instructionFormality}.`);
  }
  if (Number(band.minFigureSizeMm) > 0) {
    lines.push(`Any figure must be legible at ${band.minFigureSizeMm}mm across, printed in black and white.`);
  }
  return lines.join("\n");
}

/** Default duration / mark range for a band + assessment type. */
function bandDefaults(band, assessmentType) {
  if (!band) return {durationMinutes: null, markRange: null};
  const durations = band.defaultDurations || {};
  const ranges = band.markRanges || {};
  return {
    durationMinutes: durations[assessmentType] != null ? durations[assessmentType] : null,
    markRange: ranges[assessmentType] || null,
  };
}

module.exports = {
  BAND_IDS,
  ALL_QUESTION_TYPES,
  BAND_TYPE_TO_SCHEMA_TYPE,
  toSchemaTypes,
  ASSESSMENT_BAND_SEED,
  LEVEL_TO_BAND,
  KB_GRADE_TO_LEVEL,
  validateBand,
  levelIdForGrade,
  loadAssessmentBands,
  bandForGrade,
  allowedQuestionTypes,
  buildBandDirective,
  bandDefaults,
  resetBandCache,
};
