/**
 * assessmentBandsCore — the pure half of the assessment bands.
 *
 * Everything here is data + decisions with no Firebase dependency, following the
 * repo's *Core.js split, so the blueprint builder and the plain-node tests can
 * use it without pulling in firebase-admin. The Firestore read (and its
 * fallback to the published defaults) lives in assessmentBands.js, which
 * re-exports all of this so existing importers are unaffected.
 */

const seed = require("../data/assessmentBands.json");

const BAND_IDS = seed.bandIds;
const ALL_QUESTION_TYPES = seed.allQuestionTypes;
const ASSESSMENT_BAND_SEED = seed.bands;
const DIFFICULTY_TIERS = seed.difficultyTiers;

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
 * Grade token → level id. Mirrors src/config/educationLevels.js, and the mirror
 * is asserted by scripts/test-assessment-bands.mjs so the two cannot drift.
 *
 * Early Childhood is exactly Nursery and Reception. "Baby Class", "Middle
 * Class" and their codes are NOT levels — they are legacy spellings kept only
 * so an old record still resolves, normalised onto Nursery. A bare "ECE"
 * predates the age bands and covers both years, so it is AMBIGUOUS: it resolves
 * to the youngest and is reported by levelResolutionForGrade() so the fallback
 * is logged rather than silently taken.
 */
const KB_GRADE_TO_LEVEL = {
  ECE_N: "nursery",
  ECE_R: "reception",
  G1: "grade-1", G2: "grade-2", G3: "grade-3", G4: "grade-4",
  G5: "grade-5", G6: "grade-6", G7: "grade-7",
  G8: "form-1", G9: "form-2", G10: "form-3", G11: "form-4", G12: "form-5",
};

/** Retired spellings — resolved so old records open, never offered as levels. */
const LEGACY_GRADE_TO_LEVEL = {
  ECE_B: {levelId: "nursery"},
  BABYCLASS: {levelId: "nursery"},
  BABY: {levelId: "nursery"},
  ECE_M: {levelId: "nursery"},
  MIDDLECLASS: {levelId: "nursery"},
  MIDDLE: {levelId: "nursery"},
  NURSERY: {levelId: "nursery"},
  RECEPTION: {levelId: "reception"},
  ECE: {levelId: "nursery", ambiguous: true},
};

/**
 * The ACTIVITY registry, generated alongside the bands from
 * src/config/questionActivities.js. A band lists ACTIVITIES — what the task is
 * ("tracing", "picture matching") — and each activity declares the render
 * structure that currently carries it plus how honestly it does so
 * ('native' | 'mapped' | 'unsupported').
 *
 * The two must stay separate on the saved question. Emitting "tracing" as a
 * question type would fail schema validation and reach an exporter with no idea
 * how to draw it; but storing it ONLY as `structured` loses what the teacher
 * asked for, permanently. So the paper is STRUCTURED as the render type and
 * TAGGED with the activity.
 */
const ACTIVITIES = seed.activities;
const ACTIVITY_BY_ID = new Map(ACTIVITIES.map((a) => [a.id, a]));

/** The render structure an activity is carried by ('tracing' → 'structured'). */
function renderTypeFor(id) {
  const found = ACTIVITY_BY_ID.get(String(id || ""));
  return found ? found.renderType : String(id || "");
}

/** 'native' | 'mapped' | 'unsupported'; unknown ids report 'unsupported'. */
function supportFor(id) {
  const found = ACTIVITY_BY_ID.get(String(id || ""));
  return found ? found.support : "unsupported";
}

/** Teacher-facing activity name — never the fallback renderer's name. */
function activityLabel(id) {
  const found = ACTIVITY_BY_ID.get(String(id || ""));
  return found ? found.label : String(id || "");
}

/**
 * Convert activity ids into the deduped render types the generator may emit.
 * Anything already a render type passes through unchanged.
 */
function toSchemaTypes(types) {
  const out = [];
  for (const t of (Array.isArray(types) ? types : [])) {
    const mapped = renderTypeFor(t);
    if (mapped && !out.includes(mapped)) out.push(mapped);
  }
  return out;
}

/**
 * Is this activity permitted for the band? Used to REJECT rather than silently
 * accept — a Master Bank question or a model output whose activity the band
 * forbids must not reach the paper.
 */
function bandPermitsActivity(band, activityId) {
  const permitted = Array.isArray(band && band.questionTypes) ? band.questionTypes : [];
  if (permitted.length === 0) return true;
  const id = String(activityId || "");
  if (permitted.includes(id)) return true;
  // A question tagged only with its render type is permitted when SOME allowed
  // activity is carried by that structure — that is what a plain structured or
  // multiple-choice question is.
  return permitted.some((p) => renderTypeFor(p) === id);
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
  const mix = band.difficultyMix;
  if (!mix || typeof mix !== "object") {
    problems.push("difficultyMix is required");
  } else {
    const sum = Object.values(mix).reduce((n, v) => n + (Number(v) || 0), 0);
    if (Math.abs(sum - 1) > 0.001) {
      problems.push(`difficultyMix must sum to 1 (got ${sum})`);
    }
    for (const tier of Object.keys(mix)) {
      if (!DIFFICULTY_TIERS.includes(tier)) {
        problems.push(`unknown difficulty tier "${tier}"`);
      }
    }
  }
  if (!Number.isFinite(Number(band.minFigureSizeMm))) {
    problems.push("minFigureSizeMm must be a number");
  }
  return problems;
}

/**
 * Resolve a grade token to a ladder level id, reporting how it matched so a
 * legacy or ambiguous value can be logged instead of silently accepted.
 *
 * @returns {{levelId: string, legacy: boolean, ambiguous: boolean}}
 */
function levelResolutionForGrade(grade) {
  const none = {levelId: "", legacy: false, ambiguous: false};
  const raw = String(grade == null ? "" : grade).trim();
  if (!raw) return none;
  const upper = raw.toUpperCase().replace(/\s+/g, "");
  if (KB_GRADE_TO_LEVEL[upper]) {
    return {levelId: KB_GRADE_TO_LEVEL[upper], legacy: false, ambiguous: false};
  }
  const legacy = LEGACY_GRADE_TO_LEVEL[upper];
  if (legacy) {
    return {
      levelId: legacy.levelId,
      legacy: true,
      ambiguous: Boolean(legacy.ambiguous),
    };
  }
  const form = upper.match(/^F(?:ORM)?(\d)$/);
  if (form) return {levelId: `form-${form[1]}`, legacy: false, ambiguous: false};
  const num = upper.match(/^(?:GRADE)?(\d{1,2})$/);
  if (num) {
    const n = Number(num[1]);
    if (n >= 1 && n <= 7) {
      return {levelId: `grade-${n}`, legacy: false, ambiguous: false};
    }
    // 8-12 are the Form years under their alternative Grade naming.
    if (n >= 8 && n <= 12) {
      return {levelId: `form-${n - 7}`, legacy: false, ambiguous: false};
    }
  }
  return none;
}

/** Resolve a grade token ('G4', '4', 'ECE_N', 'Form 3') to a ladder level id. */
function levelIdForGrade(grade) {
  const res = levelResolutionForGrade(grade);
  if (res.levelId && (res.legacy || res.ambiguous)) {
    // Recorded, not silent: the diagnostics are how a stale value gets noticed
    // and normalised rather than living on forever.
    console.warn(
        `assessmentBands: ${res.ambiguous ? "ambiguous legacy" : "legacy"} ` +
      `grade value "${grade}" resolved to ${res.levelId}.`,
    );
  }
  return res.levelId;
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
  DIFFICULTY_TIERS,
  ASSESSMENT_BAND_SEED,
  LEVEL_TO_BAND,
  KB_GRADE_TO_LEVEL,
  LEGACY_GRADE_TO_LEVEL,
  ACTIVITIES,
  renderTypeFor,
  supportFor,
  activityLabel,
  toSchemaTypes,
  bandPermitsActivity,
  validateBand,
  levelIdForGrade,
  levelResolutionForGrade,
  allowedQuestionTypes,
  buildBandDirective,
  bandDefaults,
};
