/**
 * Template Bank — pure helpers for the reusable lesson-plan template library.
 *
 * The Template Bank is a SEPARATE collection (`lessonPlanTemplates`) from a
 * teacher's private library (`aiGenerations`). Whenever a teacher saves a
 * lesson plan, a Firestore trigger (templateBankFunctions.js) feeds the plan
 * through these helpers to build a clean, anonymised, curriculum-keyed
 * template, score it, and either create a new template or merge it into an
 * existing one for the same curriculum coordinates.
 *
 * Everything in THIS file is pure (no firebase-admin / firebase-functions
 * imports) so it runs under plain `node` for unit tests — see
 * lessonPlanTemplateBank.test.js. The Firestore I/O + Anthropic review live
 * in templateBankFunctions.js.
 */

// ── Personal-information stripping ───────────────────────────────────────
//
// A template must not carry any school / teacher / class identity. Rather
// than blacklist personal fields (and risk a new header field leaking through
// untouched), we WHITELIST the header keys that are genuinely curriculum /
// pedagogy metadata and drop everything else. New personal fields therefore
// fail closed — they are dropped unless explicitly added to the safe list.
const SAFE_HEADER_KEYS = new Set([
  "subject",
  "topic",
  "subtopic",
  "grade",
  "curriculum",
  "term",
  "week",
  "termAndWeek",
  "durationMinutes",
  "duration",
  "mediumOfInstruction",
]);

// Header keys we explicitly remove even if a future change adds them to the
// safe list by mistake — documents the intent of the spec (school, teacher,
// date, time, class, lesson number, pupil counts are NEVER on a template).
const PERSONAL_HEADER_KEYS = new Set([
  "school",
  "schoolName",
  "teacherName",
  "teacher",
  "date",
  "time",
  "class",
  "className",
  "lessonNumber",
  "lessonNo",
  "periodNumber",
  "boysPresent",
  "girlsPresent",
  "totalPupils",
  "numberOfPupils",
  "registerNumber",
  "year",
]);

function isObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

function cloneJson(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

/**
 * Produce a clean template body from a raw lesson plan: keep all teaching
 * content, strip every identifying header field. The returned object is a
 * deep clone — the source plan is never mutated.
 */
function anonymizeLessonPlan(plan) {
  if (!isObject(plan)) return {};
  const out = cloneJson(plan);

  const rawHeader = isObject(plan.header) ? plan.header : {};
  const cleanHeader = {};
  for (const [key, value] of Object.entries(rawHeader)) {
    if (PERSONAL_HEADER_KEYS.has(key)) continue;
    if (SAFE_HEADER_KEYS.has(key)) cleanHeader[key] = value;
    // Any other header key is dropped (fail-closed).
  }
  out.header = cleanHeader;

  // Studio plans sometimes mirror identity onto top-level fields too.
  for (const key of ["school", "schoolName", "teacherName", "date", "time", "class", "className", "lessonNumber"]) {
    if (key in out) delete out[key];
  }

  // `diagrams` / attachments are kept — they are teaching resources, not
  // identifying information.
  return out;
}

// ── Curriculum coordinate extraction ─────────────────────────────────────

// Strip a leading CBC syllabus code ("4.5.8 Describe light" → "Describe light")
// so two teachers whose syllabus pulled the code differently still dedupe.
function stripCbcCode(v) {
  if (typeof v !== "string") return "";
  const stripped = v.replace(/^\s*\d+(?:\.\d+)+\s*[-–—:.)]?\s*/, "").trim();
  return stripped.length > 0 ? stripped : v.trim();
}

function firstNonEmpty(...vals) {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (Array.isArray(v) && v.length && typeof v[0] === "string" && v[0].trim()) {
      return v[0].trim();
    }
  }
  return "";
}

// Normalise a grade label to a canonical "Grade N" / raw value.
function normalizeGrade(value) {
  if (typeof value !== "string") return "";
  const v = value.trim();
  const m = v.match(/(?:grade|g|form)\s*([0-9]{1,2})/i);
  if (m) {
    return /form/i.test(v) ? `Form ${m[1]}` : `Grade ${m[1]}`;
  }
  return v;
}

/**
 * Derive the template's curriculum coordinates from the plan + the studio
 * inputs that were saved alongside it. Returns plain strings (never null) so
 * the search index stays homogeneous.
 */
function extractTemplateCoords(plan, inputs = {}, meta = {}) {
  const header = isObject(plan && plan.header) ? plan.header : {};
  const grade = normalizeGrade(
    firstNonEmpty(header.grade, inputs.grade, meta.grade, meta.klass),
  );
  const subject = firstNonEmpty(header.subject, inputs.subject, meta.subject);
  const topic = stripCbcCode(firstNonEmpty(header.topic, inputs.topic, meta.topic));
  const subtopic = stripCbcCode(
    firstNonEmpty(header.subtopic, inputs.subtopic, meta.subtopic),
  );
  const competency = stripCbcCode(
    firstNonEmpty(plan && plan.specificCompetence, plan && plan.generalCompetences),
  );
  const specificOutcome = firstNonEmpty(
    plan && plan.specificOutcome,
    plan && plan.expectedStandard,
  );
  const curriculum = firstNonEmpty(
    header.curriculum, inputs.curriculum, meta.curriculum, meta.syllabus,
  );
  const term = firstNonEmpty(header.term, header.termAndWeek, inputs.term, meta.term);

  return {grade, subject, topic, subtopic, competency, specificOutcome, curriculum, term};
}

function normToken(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * A stable dedupe key for "the same lesson" across teachers. Two plans that
 * share grade + subject + topic + subtopic collapse onto one template.
 */
function templateDedupeKey(coords) {
  const c = coords || {};
  return [
    normToken(normalizeGrade(c.grade)),
    normToken(c.subject),
    normToken(c.topic),
    normToken(c.subtopic),
  ].join("|");
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "this", "that", "are", "was", "will",
  "have", "has", "into", "their", "your", "you", "they", "what", "when",
  "lesson", "pupils", "learners", "teacher", "activity", "activities",
]);

/**
 * Build a lowercase keyword list for instant client-side keyword search.
 * Draws from the coordinates + lesson goal + key vocabulary.
 */
function extractKeywords(plan, coords) {
  const bag = new Set();
  const add = (text) => {
    normToken(text)
      .split(" ")
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
      .forEach((w) => bag.add(w));
  };
  const c = coords || {};
  [c.subject, c.topic, c.subtopic, c.competency].forEach(add);
  if (plan && plan.lessonGoal) add(plan.lessonGoal);
  if (Array.isArray(plan && plan.keyVocabulary)) plan.keyVocabulary.forEach(add);
  return Array.from(bag).slice(0, 40);
}

// ── Section presence helpers (shape-tolerant) ────────────────────────────
//
// Stages come in two field families: the studio shape ({name, duration,
// teacher, pupils, assessment} as strings) and the schema shape
// ({teacherActivities[], learnerActivities[], assessmentCriteria[]}). These
// helpers read both so scoring works on either.

function stageText(stage, role) {
  if (!isObject(stage)) return "";
  if (role === "teacher") {
    return joinStrings(stage.teacher, stage.teacherActivities);
  }
  if (role === "learner") {
    return joinStrings(stage.pupils, stage.learnerActivities, stage.learner);
  }
  if (role === "assessment") {
    return joinStrings(stage.assessment, stage.assessmentCriteria);
  }
  return "";
}

function joinStrings(...vals) {
  const parts = [];
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) parts.push(v.trim());
    else if (Array.isArray(v)) parts.push(v.filter((x) => typeof x === "string").join(" "));
  }
  return parts.join(" ").trim();
}

function nonEmpty(v) {
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.some(nonEmpty);
  if (isObject(v)) return Object.values(v).some(nonEmpty);
  return false;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Deterministic 0–100 quality score + an 8-axis breakdown. This always runs
 * (even when the AI reviewer is paused) so every template carries a score.
 * The AI reviewer can refine these numbers later.
 */
function scoreTemplateDeterministic(plan) {
  const stages = Array.isArray(plan && plan.stages) ? plan.stages : [];
  const teacherStages = stages.filter((s) => nonEmpty(stageText(s, "teacher")));
  const learnerStages = stages.filter((s) => nonEmpty(stageText(s, "learner")));
  const assessmentStages = stages.filter((s) => nonEmpty(stageText(s, "assessment")));

  // 1. Curriculum alignment — competence + outcome + general competences.
  const curriculumAlignment = clamp(
    (nonEmpty(plan && plan.specificCompetence) || nonEmpty(plan && plan.specificOutcome) ? 45 : 0) +
    (nonEmpty(plan && plan.generalCompetences) ? 30 : 0) +
    (nonEmpty(plan && plan.expectedStandard) ? 25 : 0),
    0, 100,
  );

  // 2. Completeness — count the core sections that are present.
  const sectionsPresent = [
    nonEmpty(plan && (plan.lessonGoal || plan.objectives)),
    teacherStages.length > 0,
    learnerStages.length > 0,
    assessmentStages.length > 0,
    nonEmpty(plan && plan.materials),
    nonEmpty(plan && (plan.remedialWork || plan.extensionActivity || plan.differentiation)),
    nonEmpty(plan && (plan.references || plan.keyVocabulary)),
  ];
  const completeness = Math.round(
    (sectionsPresent.filter(Boolean).length / sectionsPresent.length) * 100,
  );

  // 3. Accuracy — not assessable deterministically; neutral baseline lifted
  //    when the plan is grounded in a coded competence / expected standard.
  const accuracy = clamp(
    65 + (nonEmpty(plan && plan.expectedStandard) ? 15 : 0) +
      (nonEmpty(plan && plan.rationale) ? 10 : 0),
    0, 100,
  );

  // 4. Methodology — staged progression with both teacher + learner roles.
  const methodology = clamp(
    clamp(stages.length, 0, 5) * 8 +
      (learnerStages.length >= teacherStages.length && learnerStages.length > 0 ? 30 : 10) +
      (assessmentStages.length > 0 ? 30 : 0),
    0, 100,
  );

  // 5. Learner engagement — learner-led activity + vocabulary + varied stages.
  const engagement = clamp(
    learnerStages.length * 15 +
      (nonEmpty(plan && plan.keyVocabulary) ? 20 : 0) +
      (nonEmpty(plan && (plan.remedialWork || plan.extensionActivity)) ? 20 : 0),
    0, 100,
  );

  // 6. Assessment quality — assessment criteria + an exercise/homework block.
  const assessment = clamp(
    assessmentStages.length * 25 +
      (nonEmpty(plan && (plan.homework || plan.exercise)) ? 20 : 0) +
      (nonEmpty(plan && plan.lessonGoal) ? 15 : 0),
    0, 100,
  );

  // 7. Clarity — sections have real, non-degenerate text.
  const goalLen = typeof (plan && plan.lessonGoal) === "string" ? plan.lessonGoal.trim().length : 0;
  const clarity = clamp(
    (goalLen >= 20 ? 40 : goalLen > 0 ? 20 : 0) +
      (teacherStages.length > 0 ? 30 : 0) +
      (nonEmpty(plan && plan.rationale) ? 30 : 0),
    0, 100,
  );

  // 8. Resource quality — materials + references richness.
  const materialsCount = Array.isArray(plan && plan.materials) ? plan.materials.length : 0;
  const resources = clamp(
    clamp(materialsCount, 0, 5) * 15 + (nonEmpty(plan && plan.references) ? 25 : 0),
    0, 100,
  );

  const breakdown = {
    curriculumAlignment,
    completeness,
    accuracy,
    methodology,
    engagement,
    assessment,
    clarity,
    resources,
  };

  // Weighted overall — alignment + completeness carry the most weight.
  const weights = {
    curriculumAlignment: 0.2,
    completeness: 0.2,
    accuracy: 0.12,
    methodology: 0.14,
    engagement: 0.1,
    assessment: 0.12,
    clarity: 0.06,
    resources: 0.06,
  };
  let overall = 0;
  for (const [k, w] of Object.entries(weights)) overall += breakdown[k] * w;

  return {score: Math.round(clamp(overall, 0, 100)), breakdown};
}

// The bank only accepts plans that clear a structural floor — half-finished
// drafts never pollute the searchable library.
const MIN_TEMPLATE_SCORE = 45;

function meetsQualityFloor(deterministic) {
  return deterministic && deterministic.score >= MIN_TEMPLATE_SCORE;
}

// ── Preview + title ──────────────────────────────────────────────────────

function truncate(text, max) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1).trim()}…` : s;
}

function buildPreview(plan) {
  const goal = firstNonEmpty(plan && plan.lessonGoal, plan && plan.rationale);
  if (goal) return truncate(goal, 200);
  const stages = Array.isArray(plan && plan.stages) ? plan.stages : [];
  for (const s of stages) {
    const t = stageText(s, "teacher") || stageText(s, "learner");
    if (t) return truncate(t, 200);
  }
  return "";
}

function buildTitle(coords) {
  const c = coords || {};
  const head = c.subtopic || c.topic;
  if (head && c.topic && c.subtopic && c.topic !== c.subtopic) {
    return `${c.topic} — ${c.subtopic}`;
  }
  return head || `${c.grade} ${c.subject}`.trim() || "Lesson plan template";
}

// ── Merge ─────────────────────────────────────────────────────────────────

const MERGE_FILLABLE_KEYS = [
  "generalCompetences", "specificCompetence", "specificOutcome", "lessonGoal",
  "rationale", "priorKnowledge", "references", "materials", "expectedStandard",
  "keyVocabulary", "remedialWork", "extensionActivity", "differentiation",
  "homework", "exercise", "learningEnvironment",
];

/**
 * Combine two anonymised plans for the same lesson into one stronger template
 * (the spec's "intelligently combine the strongest ideas"). The higher-scoring
 * plan is the base; any section it leaves empty is grafted from the other.
 * Stages are taken whole from whichever plan has the richer progression.
 * Deterministic — the AI reviewer scores the merged result afterwards.
 */
function mergeTemplateContent(existing, incoming, existingScore = 0, incomingScore = 0) {
  const a = anonymizeLessonPlan(existing);
  const b = anonymizeLessonPlan(incoming);
  const [base, other] = incomingScore > existingScore ? [b, a] : [a, b];
  const merged = cloneJson(base);

  for (const key of MERGE_FILLABLE_KEYS) {
    if (!nonEmpty(merged[key]) && nonEmpty(other[key])) {
      merged[key] = cloneJson(other[key]);
    }
  }

  // Stages: keep the progression with more populated stages.
  const baseStages = (Array.isArray(base.stages) ? base.stages : [])
    .filter((s) => nonEmpty(stageText(s, "teacher")) || nonEmpty(stageText(s, "learner")));
  const otherStages = (Array.isArray(other.stages) ? other.stages : [])
    .filter((s) => nonEmpty(stageText(s, "teacher")) || nonEmpty(stageText(s, "learner")));
  merged.stages = otherStages.length > baseStages.length ? cloneJson(otherStages) : cloneJson(baseStages);

  // Union the covered-content + key vocabulary so nothing is lost.
  merged.coveredContent = unionStringArrays(base.coveredContent, other.coveredContent).slice(0, 40);
  if (nonEmpty(base.keyVocabulary) || nonEmpty(other.keyVocabulary)) {
    merged.keyVocabulary = unionStringArrays(base.keyVocabulary, other.keyVocabulary).slice(0, 60);
  }
  // Header: prefer the most complete subject/topic/subtopic.
  merged.header = {...(other.header || {}), ...(base.header || {})};
  for (const k of ["subject", "topic", "subtopic"]) {
    if (!nonEmpty(merged.header[k]) && nonEmpty(other.header && other.header[k])) {
      merged.header[k] = other.header[k];
    }
  }
  return merged;
}

function unionStringArrays(...arrs) {
  const seen = new Set();
  const out = [];
  for (const arr of arrs) {
    if (!Array.isArray(arr)) continue;
    for (const v of arr) {
      if (typeof v !== "string") continue;
      const k = v.trim().toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(v.trim());
    }
  }
  return out;
}

/**
 * Decide whether an incoming plan should replace/merge into the existing
 * template. We merge when the incoming plan is materially better OR adds
 * sections the existing one lacks — never on a like-for-like re-save.
 */
function shouldMerge(existingScore, incomingScore, existingPlan, incomingPlan) {
  if (incomingScore >= existingScore + 3) return true;
  // Adds a section the existing template is missing.
  for (const key of MERGE_FILLABLE_KEYS) {
    if (!nonEmpty(existingPlan && existingPlan[key]) && nonEmpty(incomingPlan && incomingPlan[key])) {
      return true;
    }
  }
  return false;
}

/**
 * Assemble the full Firestore template record body (minus server timestamps /
 * version bookkeeping, which the trigger owns). Shared by create + merge so
 * the stored shape is identical on both paths.
 */
function buildTemplateRecord({plan, inputs, meta, curriculumVersion}) {
  const content = anonymizeLessonPlan(plan);
  const coords = extractTemplateCoords(plan, inputs, meta);
  const {score, breakdown} = scoreTemplateDeterministic(content);
  return {
    ...coords,
    dedupeKey: templateDedupeKey(coords),
    keywords: extractKeywords(content, coords),
    title: buildTitle(coords),
    preview: buildPreview(content),
    content,
    qualityScore: score,
    qualityBreakdown: breakdown,
    curriculumVersion: curriculumVersion || "",
  };
}

module.exports = {
  anonymizeLessonPlan,
  extractTemplateCoords,
  templateDedupeKey,
  extractKeywords,
  scoreTemplateDeterministic,
  meetsQualityFloor,
  MIN_TEMPLATE_SCORE,
  buildPreview,
  buildTitle,
  mergeTemplateContent,
  shouldMerge,
  buildTemplateRecord,
  normalizeGrade,
  stripCbcCode,
  // internal helpers exported for tests
  _stageText: stageText,
  _normToken: normToken,
};
