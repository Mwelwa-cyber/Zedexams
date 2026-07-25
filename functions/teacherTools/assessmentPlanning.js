/**
 * assessmentPlanning — the one place a paper's plan is decided.
 *
 * §3.1 asks for the blueprint to be shown to the teacher BEFORE generation and
 * for them to be able to adjust it. That creates a trap: if the confirmation
 * screen builds the plan one way and the generator builds it another, the
 * teacher confirms a paper they do not get. So both call the SAME function here
 * — `planPaper` — with the same inputs, and there is no second code path that
 * could drift.
 *
 * The teacher can then send that plan back with their adjustments. A blueprint
 * arriving from a browser is still an input, so `acceptClientBlueprint` re-checks
 * it against this request: right version, internally sound, marks still equal
 * the header total, same grade/subject/curriculum/type, and every slot's activity
 * still permitted by the level's band. Anything that fails is rebuilt server-side
 * rather than trusted — a client must not be able to put an essay on a Nursery
 * paper by editing a JSON payload.
 *
 * No model call happens here and nothing is charged: this is Firestore reads and
 * arithmetic.
 */

const {
  buildPaperBlueprint, validateBlueprint, BLUEPRINT_VERSION,
} = require("./paperBlueprint");
const {resolveGradeSubjectCoverage} = require("./cbcKnowledge");
const {resolveAssessmentFormatContext} = require("./assessmentFormats");
const {
  bandForGrade, allowedQuestionTypes, toSchemaTypes, bandPermitsActivity,
} = require("./assessmentBands");

/**
 * Split the studio's joined topic string ("Human Body; Plants") into a clean
 * list. Mirrors splitTopics in assessmentPromptV10 — the blueprint must plan
 * against exactly the topics the prompt describes.
 */
function splitTopicList(value) {
  const seen = new Set();
  const out = [];
  for (const raw of String(value || "").split(/[;\n]+/)) {
    const t = raw.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/**
 * The question activities this paper may use: the band's ceiling narrowed by
 * what the teacher asked for, in the band's own vocabulary, plus the schema
 * render types the generator can actually emit.
 *
 * The ceiling only ever NARROWS. When the intersection is empty — a stale client
 * asking Nursery for an essay — fall back to the BAND's own list, never to the
 * request: falling back to the request would hand back exactly the activities
 * the band just refused.
 */
function resolvePermittedActivities({band, requestedBandTypes = [], questionTypes = []}) {
  const requested = requestedBandTypes.length > 0 ? requestedBandTypes : questionTypes;
  const narrowed = allowedQuestionTypes(band, requested);
  const permitted = narrowed.length > 0 ?
    narrowed : (band ? band.questionTypes : requested);
  return {permitted, effectiveTypes: toSchemaTypes(permitted)};
}

/**
 * Everything a blueprint needs that lives in Firestore: the band, the paper
 * format profile for this level+type, and the verified syllabus coverage.
 *
 * Read concurrently — none of them depends on another. A read FAILURE is allowed
 * to propagate: "we could not read the syllabus" and "there is no syllabus" are
 * different facts and must not be reported as the same one (§3.5).
 */
async function resolvePlanningContext(inputs) {
  const [band, formatContext, coverage] = await Promise.all([
    bandForGrade(inputs.grade),
    resolveAssessmentFormatContext({
      grade: inputs.grade,
      subject: inputs.subject,
      assessmentType: inputs.assessmentType,
      allowedTypes: inputs.questionTypes,
    }),
    resolveGradeSubjectCoverage({
      grade: inputs.grade,
      subject: inputs.subject,
      framework: inputs.framework,
    }),
  ]);
  return {band, formatContext, coverage};
}

/**
 * Build the blueprint for a request from already-resolved context.
 *
 * Separate from `resolvePlanningContext` so the generator — which resolves the
 * band and the format profile alongside its own CBC context and usage meter —
 * can reuse the exact mapping of request → blueprint arguments rather than
 * repeating it. One mapping, one plan.
 *
 * @param {object} args
 * @param {object} args.inputs      sanitized generator inputs
 * @param {object} args.band        resolved assessmentBands document (or null)
 * @param {object[]} args.paperStructure format profile sections
 * @param {object} args.coverage    resolveGradeSubjectCoverage result
 * @param {number} [args.totalMarks] override (the free preview plans the gap)
 * @param {string} args.gradeLabel  display label ('Grade 4')
 */
function buildBlueprintForRequest({
  inputs, band, paperStructure = [], coverage = {}, totalMarks, gradeLabel = "",
}) {
  const {permitted} = resolvePermittedActivities({
    band,
    requestedBandTypes: inputs.requestedBandTypes || [],
    questionTypes: inputs.questionTypes || [],
  });
  return buildPaperBlueprint({
    grade: inputs.grade,
    gradeLabel,
    subject: inputs.subject,
    framework: inputs.framework,
    assessmentType: inputs.assessmentType,
    totalMarks: Number.isFinite(Number(totalMarks)) ?
      Number(totalMarks) : inputs.totalMarks,
    durationMinutes: inputs.durationMinutes,
    topics: splitTopicList(inputs.topic),
    subtopics: splitTopicList(inputs.subtopic),
    activityTypes: permitted,
    band,
    paperStructure,
    outcomesByTopic: coverage.outcomesByTopic || {},
    competencies: coverage.competencies || [],
    difficultyMix: inputs.difficultyMix || null,
  });
}

/**
 * Plan a paper end to end: read the context, refuse if the curriculum has
 * nothing for this grade+subject, otherwise build and validate the blueprint.
 *
 * Returns a structured refusal rather than throwing so the caller decides how to
 * present it — the confirmation screen shows it inline, the generator turns it
 * into a failed-precondition and refunds.
 *
 * @returns {Promise<{ok: boolean, refusal: ?object, blueprint: ?object,
 *   problems: string[], band: ?object, coverage: object, formatContext: object,
 *   permitted: string[], effectiveTypes: string[]}>}
 */
async function planPaper({inputs, gradeLabel = "", totalMarks}) {
  const {band, formatContext, coverage} = await resolvePlanningContext(inputs);
  const {permitted, effectiveTypes} = resolvePermittedActivities({
    band,
    requestedBandTypes: inputs.requestedBandTypes || [],
    questionTypes: inputs.questionTypes || [],
  });

  if (!coverage || coverage.count === 0) {
    return {
      ok: false,
      refusal: {code: "NO_SYLLABUS_CONTENT", framework: inputs.framework},
      blueprint: null,
      problems: [],
      band, coverage: coverage || {}, formatContext, permitted, effectiveTypes,
    };
  }

  const blueprint = buildBlueprintForRequest({
    inputs, band, paperStructure: formatContext.paperStructure || [],
    coverage, totalMarks, gradeLabel,
  });
  const problems = validateBlueprint(blueprint);
  return {
    ok: problems.length === 0,
    refusal: null,
    // A plan we cannot vouch for is worse than none: it would constrain the
    // model to something incoherent. The caller falls back to unconstrained
    // generation rather than shipping a broken plan.
    blueprint: problems.length === 0 ? blueprint : null,
    problems,
    band, coverage, formatContext, permitted, effectiveTypes,
  };
}

/** Every item across every section of a blueprint. */
function blueprintItems(blueprint) {
  if (!blueprint || !Array.isArray(blueprint.sections)) return [];
  return blueprint.sections.flatMap((s) => (Array.isArray(s.items) ? s.items : []));
}

/**
 * Decide whether a blueprint that arrived from a client may be used.
 *
 * A teacher who adjusted the plan on the confirmation screen must get the paper
 * they confirmed — that is the whole point of §3.1. But the payload travelled
 * through a browser, so it is checked against this request before it is allowed
 * to constrain anything:
 *
 *  - the version we know how to render
 *  - internally sound (validateBlueprint: marks reconcile, numbering continuous)
 *  - the same grade, subject, curriculum and assessment type as this request
 *  - the same total marks the header will print
 *  - every slot's activity still permitted by the level's band
 *
 * @returns {{accepted: boolean, reason: string}}
 */
function acceptClientBlueprint({candidate, inputs, band, expectedMarks}) {
  if (!candidate || typeof candidate !== "object") {
    return {accepted: false, reason: "absent"};
  }
  if (candidate.version !== BLUEPRINT_VERSION) {
    return {accepted: false, reason: "version"};
  }
  if (validateBlueprint(candidate).length > 0) {
    return {accepted: false, reason: "unsound"};
  }
  const mismatched = [
    ["grade", inputs.grade],
    ["subject", inputs.subject],
    ["framework", inputs.framework],
    ["assessmentType", inputs.assessmentType],
  ].filter(([key, want]) => String(candidate[key] || "") !== String(want || ""));
  if (mismatched.length > 0) {
    return {accepted: false, reason: `mismatch:${mismatched.map(([k]) => k).join(",")}`};
  }
  if (Number(candidate.totalMarks) !== Number(expectedMarks)) {
    return {accepted: false, reason: "marks"};
  }
  const items = blueprintItems(candidate);
  if (band) {
    const forbidden = items.find((item) => !bandPermitsActivity(
        band, item.activityType || item.renderType,
    ));
    if (forbidden) {
      return {accepted: false, reason: `activity:${forbidden.activityType}`};
    }
  }
  return {accepted: true, reason: "ok"};
}

module.exports = {
  planPaper,
  resolvePlanningContext,
  buildBlueprintForRequest,
  resolvePermittedActivities,
  acceptClientBlueprint,
  blueprintItems,
  splitTopicList,
};
