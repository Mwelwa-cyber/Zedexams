/**
 * paperBlueprint — decide the WHOLE paper before the model writes a word of it.
 *
 * This is the inversion the upgrade is about. Until now the intelligence ran
 * AFTER generation: the model was asked for a paper and a checker then reported
 * that no cognitive levels were tagged, that 0 of 5 competency strands were
 * covered, that the difficulty was 1 easy / 0 medium / 0 hard. Those are audits
 * of a paper that is already written — findings you can only act on by throwing
 * it away.
 *
 * A blueprint decides all of that first, deterministically and with no model
 * call: how many sections, how many items, which topic and sub-topic each item
 * assesses, which learning outcome it targets, its Bloom level, its difficulty
 * tier, its marks, and whether it needs a figure. The model's job becomes
 * FILLING slots rather than inventing a paper, and the checkers become
 * verification against a stated intent rather than discovery of its absence.
 *
 * Everything here is derived from data the studio already has — the band
 * (src/config/assessmentBands.js), the paper format profile
 * (assessmentFormats.js) and the verified curriculum module — so a blueprint is
 * reproducible and explainable. Nothing is invented: if there is no syllabus
 * content for the grade+subject, the caller refuses to generate rather than
 * letting this file make something up.
 *
 * Pure and dependency-light (bands + activity registry only) so it unit-tests
 * under plain `node`, and so the same function produces the blueprint the
 * TEACHER CONFIRMS and the blueprint the generator is CONSTRAINED BY — they
 * cannot drift, because there is only one.
 */

// The pure half of the bands — no firebase-admin, so a blueprint can be built
// and tested without any Firebase at all.
const {
  allowedQuestionTypes, renderTypeFor, activityLabel, supportFor,
} = require("./assessmentBandsCore");

const BLUEPRINT_VERSION = "blueprint.v1";

/** Bloom levels in ascending demand — used to order items easier-first. */
const BLOOM_ORDER = [
  "remember", "understand", "apply", "analyse", "evaluate", "create",
];

/** Difficulty tiers in ascending demand. */
const TIER_ORDER = ["recall", "understanding", "analysis", "challenge"];

/**
 * Activities that inherently need a figure: the task IS the picture. Used to
 * decide `figureRequired` per item, alongside the band's own rule (Early
 * Childhood requires one on every item because the learner cannot read).
 */
const FIGURE_ACTIVITIES = new Set([
  "picture_identification", "picture_matching", "circling", "counting",
  "tracing", "colouring", "sorting", "diagram_labelling",
  "graph_interpretation", "data_interpretation", "table_completion",
]);

/**
 * Rough answering time in minutes for one mark, by the structure carrying the
 * item. Used for the duration estimate — the point is to catch a paper that is
 * plainly unanswerable in the time given, not to be exact.
 */
const MINUTES_PER_MARK = {
  multiple_choice: 0.6,
  true_false: 0.4,
  fill_blanks: 0.6,
  matching: 0.5,
  short_answer: 1.0,
  calculation: 1.4,
  structured: 1.2,
  essay: 1.6,
};
const DEFAULT_MINUTES_PER_MARK = 1.0;

/** Split "6-10" / "8" into a {min,max} item-count range; null when unusable. */
function parseCountHint(hint) {
  const m = String(hint || "").match(/(\d+)\s*(?:[-–]\s*(\d+))?/);
  if (!m) return null;
  const min = Number(m[1]);
  const max = m[2] ? Number(m[2]) : min;
  if (!Number.isFinite(min) || min <= 0) return null;
  return {min, max: Math.max(min, max)};
}

/** Average marks per item from "1-2 marks each"; null when unusable. */
function parseMarksHint(hint) {
  const m = String(hint || "").match(/(\d+)\s*(?:[-–]\s*(\d+))?/);
  if (!m) return null;
  const lo = Number(m[1]);
  const hi = m[2] ? Number(m[2]) : lo;
  if (!Number.isFinite(lo) || lo <= 0) return null;
  return (lo + hi) / 2;
}

/**
 * Split `total` into `count` whole parts as evenly as possible, largest first,
 * so the parts always sum EXACTLY to the total. This is what makes the
 * blueprint's marks reconcile with the header by construction rather than by
 * asking the model to be careful.
 */
function splitEvenly(total, count) {
  if (count <= 0) return [];
  const base = Math.floor(total / count);
  let remainder = total - base * count;
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    out.push(base + extra);
  }
  return out;
}

/**
 * Allocate `count` slots across weighted buckets so the counts sum to exactly
 * `count` and each bucket gets its share as closely as whole numbers allow
 * (largest-remainder). Buckets with a zero weight get nothing.
 */
function allocateByWeight(count, weights) {
  const keys = Object.keys(weights).filter((k) => Number(weights[k]) > 0);
  if (keys.length === 0 || count <= 0) return {};
  const exact = keys.map((k) => ({k, want: count * Number(weights[k])}));
  const out = {};
  let used = 0;
  for (const {k, want} of exact) {
    const n = Math.floor(want);
    out[k] = n;
    used += n;
  }
  // Hand the leftovers to the largest fractional parts.
  const leftovers = exact
      .map(({k, want}) => ({k, frac: want - Math.floor(want)}))
      .sort((a, b) => b.frac - a.frac);
  let remaining = count - used;
  let i = 0;
  while (remaining > 0 && leftovers.length > 0) {
    out[leftovers[i % leftovers.length].k] += 1;
    remaining -= 1;
    i += 1;
  }
  return out;
}

/** Expand {recall: 2, understanding: 1} into ['recall','recall','understanding']. */
function expandAllocation(allocation, order) {
  const out = [];
  for (const key of order) {
    for (let i = 0; i < (allocation[key] || 0); i += 1) out.push(key);
  }
  for (const key of Object.keys(allocation)) {
    if (order.includes(key)) continue;
    for (let i = 0; i < allocation[key]; i += 1) out.push(key);
  }
  return out;
}

/** Normalise a weight map to sum 1, dropping non-positive entries. */
function normalizeWeights(weights, allowedKeys) {
  const clean = {};
  let sum = 0;
  for (const [k, v] of Object.entries(weights || {})) {
    if (allowedKeys && !allowedKeys.includes(k)) continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) continue;
    clean[k] = n;
    sum += n;
  }
  if (sum <= 0) return null;
  for (const k of Object.keys(clean)) clean[k] /= sum;
  return clean;
}

/**
 * Build the blueprint.
 *
 * @param {object} input
 * @param {string} input.grade          KB grade code ('G4', 'ECE_N')
 * @param {string} input.gradeLabel     display label ('Grade 4')
 * @param {string} input.subject        canonical subject key
 * @param {string} input.framework      '2023' | '2013'
 * @param {string} input.assessmentType canonical assessment type
 * @param {number} input.totalMarks
 * @param {number} input.durationMinutes
 * @param {string[]} input.topics       the teacher's chosen topics (>= 1)
 * @param {string[]} input.subtopics    optional, scoped across the topics
 * @param {string[]} input.activityTypes the teacher's requested activities
 * @param {object} input.band           resolved assessmentBands document
 * @param {object[]} input.paperStructure format profile sections (marksShare …)
 * @param {object} input.outcomesByTopic topic → learning outcomes from the
 *   verified curriculum module. Missing/empty is fine — an item simply carries
 *   no outcome rather than an invented one.
 * @param {string[]} input.competencies  curriculum strands to cover
 * @param {object} input.difficultyMix   optional teacher override
 * @returns {object} the blueprint
 */
function buildPaperBlueprint(input = {}) {
  const {
    grade = "", gradeLabel = "", subject = "", framework = "2023",
    assessmentType = "topic_test", totalMarks = 20, durationMinutes = 40,
    topics = [], subtopics = [], activityTypes = [],
    band = null, paperStructure = [], outcomesByTopic = {},
    competencies = [], difficultyMix = null,
  } = input;

  const warnings = [];
  const topicList = topics.map((t) => String(t || "").trim()).filter(Boolean);
  const subtopicList = subtopics.map((s) => String(s || "").trim()).filter(Boolean);

  // The activities this paper may use: the band's ceiling, narrowed by what the
  // teacher asked for. Never widened — see allowedQuestionTypes.
  const permitted = allowedQuestionTypes(band, activityTypes);
  const activities = permitted.length > 0 ?
    permitted : (band && band.questionTypes) || ["short_answer"];
  if (activityTypes.length > 0 && permitted.length === 0) {
    warnings.push(
        "None of the chosen question types are allowed at this level, so the " +
      "level's own types are used instead.",
    );
  }

  // ── Sections ────────────────────────────────────────────────────────────
  // A band that does not use sections (Early Childhood, Grades 1-4) gets one
  // unnamed run of items — printing "SECTION A" on a Nursery worksheet would be
  // theatre. Otherwise the format profile's sections are used, filtered to the
  // sections that can be built from the permitted activities.
  const bandUsesSections = Boolean(band && band.structure && band.structure.sections);
  const sectionPlans = [];
  if (!bandUsesSections || paperStructure.length === 0) {
    sectionPlans.push({
      name: "", heading: "", instructions: "",
      activities: activities.slice(),
      marksShare: 100,
      countHint: null,
      marksHint: null,
    });
  } else {
    for (const section of paperStructure) {
      const sectionActivities = (section.questionTypes || [])
          .filter((t) => activities.includes(t) ||
            activities.some((a) => renderTypeFor(a) === t));
      // A section whose types are all forbidden at this level is dropped, and
      // its marks re-spread — printing an empty section would be worse.
      if (sectionActivities.length === 0) continue;
      sectionPlans.push({
        name: section.name || "",
        heading: section.heading || "",
        instructions: section.instructions || "",
        activities: sectionActivities,
        marksShare: Number(section.marksShare) || 0,
        countHint: parseCountHint(section.questionCountHint),
        marksHint: parseMarksHint(section.marksPerQuestionHint),
      });
    }
    if (sectionPlans.length === 0) {
      sectionPlans.push({
        name: "", heading: "", instructions: "",
        activities: activities.slice(),
        marksShare: 100, countHint: null, marksHint: null,
      });
      warnings.push(
          "The usual paper format for this level uses question types this paper " +
        "does not allow, so it is laid out as a single run of questions.",
      );
    }
  }

  // ── Marks per section ───────────────────────────────────────────────────
  // Shares are re-normalised (a dropped section's marks must go somewhere) and
  // split into whole marks that sum EXACTLY to the total.
  const shareSum = sectionPlans.reduce((n, s) => n + s.marksShare, 0);
  const weights = {};
  sectionPlans.forEach((s, i) => {
    weights[String(i)] = shareSum > 0 ? s.marksShare / shareSum : 1 / sectionPlans.length;
  });
  const marksPerSection = allocateByWeight(totalMarks, weights);
  sectionPlans.forEach((s, i) => {
    s.marks = marksPerSection[String(i)] || 0;
  });
  // A section that rounded to zero marks cannot hold a question.
  const usable = sectionPlans.filter((s) => s.marks > 0);
  if (usable.length < sectionPlans.length) {
    const dropped = sectionPlans.length - usable.length;
    warnings.push(
        `${dropped} section${dropped === 1 ? "" : "s"} would have carried no ` +
      "marks at this total and were left out.",
    );
  }
  const sections = usable;

  // ── Item counts ─────────────────────────────────────────────────────────
  const maxItems = Number(band && band.structure && band.structure.maxItems) || 60;
  let plannedTotal = 0;
  for (const section of sections) {
    const avgMarks = section.marksHint || 2;
    let count = Math.max(1, Math.round(section.marks / avgMarks));
    if (section.countHint) {
      count = Math.min(Math.max(count, section.countHint.min), section.countHint.max);
    }
    // Never more items than marks — a question worth zero marks is not a
    // question.
    count = Math.min(count, section.marks);
    section.itemCount = Math.max(1, count);
    plannedTotal += section.itemCount;
  }
  if (plannedTotal > maxItems) {
    // Scale every section down proportionally rather than truncating the last.
    const scale = maxItems / plannedTotal;
    plannedTotal = 0;
    for (const section of sections) {
      section.itemCount = Math.max(1, Math.round(section.itemCount * scale));
      plannedTotal += section.itemCount;
    }
    warnings.push(
        `This level caps a paper at ${maxItems} questions, so the count was ` +
      "reduced to fit.",
    );
  }

  // ── Per-item allocation ─────────────────────────────────────────────────
  // Bloom levels and difficulty tiers are allocated across the WHOLE paper, not
  // per section, so the mix holds for the paper the learner actually sits.
  const bloomWeights = normalizeWeights(
      (band && band.bloomDistribution) || {}, BLOOM_ORDER,
  ) || {remember: 0.5, understand: 0.5};
  const tierWeights = normalizeWeights(
      difficultyMix || (band && band.difficultyMix) || {}, TIER_ORDER,
  ) || {recall: 0.3, understanding: 0.4, analysis: 0.2, challenge: 0.1};

  const bloomSequence = expandAllocation(
      allocateByWeight(plannedTotal, bloomWeights), BLOOM_ORDER,
  );
  const tierSequence = expandAllocation(
      allocateByWeight(plannedTotal, tierWeights), TIER_ORDER,
  );

  // Topics rotate across the paper so consecutive items come from DIFFERENT
  // topics. This is the deterministic version of the interleaving the prompt
  // used to have to ask for — and then be checked on afterwards.
  let itemIndex = 0;
  let number = 0;
  const subtopicCursor = {};

  for (const section of sections) {
    const itemMarks = splitEvenly(section.marks, section.itemCount);
    section.items = [];
    for (let i = 0; i < section.itemCount; i += 1) {
      const topic = topicList.length > 0 ?
        topicList[itemIndex % topicList.length] : "";
      // Sub-topics are scoped to the paper as a whole (the studio collects them
      // across every chosen topic), so they rotate independently.
      let subtopic = "";
      if (subtopicList.length > 0) {
        const cursor = subtopicCursor[topic] || 0;
        subtopic = subtopicList[cursor % subtopicList.length];
        subtopicCursor[topic] = cursor + 1;
      }
      const outcomes = outcomesByTopic[topic] || [];
      const activity = section.activities[i % section.activities.length];
      const renderType = renderTypeFor(activity);
      number += 1;
      section.items.push({
        id: `q${number}`,
        number,
        topic,
        subtopic,
        // Only a real outcome from the verified module, never an invented one.
        learningOutcome: outcomes.length > 0 ?
          outcomes[itemIndex % outcomes.length] : "",
        activityType: activity,
        activityLabel: activityLabel(activity),
        activitySupport: supportFor(activity),
        renderType,
        bloomLevel: bloomSequence[itemIndex] || "understand",
        difficulty: tierSequence[itemIndex] || "understanding",
        marks: itemMarks[i],
        figureRequired: Boolean(
            (band && band.structure && band.structure.requiresFigureOrScript) ||
          FIGURE_ACTIVITIES.has(activity),
        ),
      });
      itemIndex += 1;
    }
  }

  // Order each section's items easier-first while KEEPING the topic rotation:
  // sort by Bloom demand only, which is a stable reshuffle of the tags, not of
  // the topics (every item already has its topic assigned).
  for (const section of sections) {
    const tags = section.items
        .map((item) => ({bloomLevel: item.bloomLevel, difficulty: item.difficulty}))
        .sort((a, b) => (
          BLOOM_ORDER.indexOf(a.bloomLevel) - BLOOM_ORDER.indexOf(b.bloomLevel) ||
        TIER_ORDER.indexOf(a.difficulty) - TIER_ORDER.indexOf(b.difficulty)
        ));
    section.items.forEach((item, i) => {
      item.bloomLevel = tags[i].bloomLevel;
      item.difficulty = tags[i].difficulty;
    });
  }

  const allItems = sections.flatMap((s) => s.items);

  // ── Duration ────────────────────────────────────────────────────────────
  const estimatedMinutes = Math.round(allItems.reduce((sum, item) => {
    const perMark = MINUTES_PER_MARK[item.renderType] || DEFAULT_MINUTES_PER_MARK;
    return sum + item.marks * perMark;
  }, 0));
  if (durationMinutes > 0 && estimatedMinutes > durationMinutes * 1.15) {
    warnings.push(
        `This paper looks like about ${estimatedMinutes} minutes of work but ` +
      `${durationMinutes} minutes are allowed — consider fewer marks or more time.`,
    );
  }

  // ── Coverage targets ────────────────────────────────────────────────────
  // What the paper INTENDS to cover, so the checkers can report drift from it
  // instead of reporting absence.
  const topicTargets = {};
  for (const item of allItems) {
    if (!item.topic) continue;
    topicTargets[item.topic] = (topicTargets[item.topic] || 0) + 1;
  }
  const uncovered = topicList.filter((t) => !topicTargets[t]);
  if (uncovered.length > 0) {
    warnings.push(
        `There are more topics than questions, so these are not covered: ` +
      `${uncovered.join(", ")}.`,
    );
  }

  const marksTotal = allItems.reduce((sum, item) => sum + item.marks, 0);

  return {
    version: BLUEPRINT_VERSION,
    grade,
    gradeLabel,
    subject,
    framework,
    assessmentType,
    bandId: band ? band.id : "",
    bandLabel: band ? band.label : "",
    totalMarks: marksTotal,
    requestedMarks: totalMarks,
    durationMinutes,
    estimatedMinutes,
    itemCount: allItems.length,
    topics: topicList,
    subtopics: subtopicList,
    activityTypes: activities,
    difficultyMix: tierWeights,
    bloomMix: bloomWeights,
    coverage: {
      topics: topicTargets,
      uncoveredTopics: uncovered,
      competencyTargets: competencies.map((c) => String(c || "").trim()).filter(Boolean),
      bloom: allItems.reduce((acc, item) => {
        acc[item.bloomLevel] = (acc[item.bloomLevel] || 0) + 1;
        return acc;
      }, {}),
      difficulty: allItems.reduce((acc, item) => {
        acc[item.difficulty] = (acc[item.difficulty] || 0) + 1;
        return acc;
      }, {}),
      figuresRequired: allItems.filter((i) => i.figureRequired).length,
    },
    sections: sections.map((s) => ({
      name: s.name,
      heading: s.heading,
      instructions: s.instructions,
      marks: s.marks,
      itemCount: s.itemCount,
      activityTypes: s.activities,
      items: s.items,
    })),
    warnings,
  };
}

/**
 * Is this blueprint internally sound? Called before the model runs, and again
 * on any blueprint that arrives from a client — a teacher-adjusted blueprint is
 * still an input, and an input is never trusted.
 *
 * @returns {string[]} problems; empty means sound
 */
function validateBlueprint(blueprint) {
  const problems = [];
  if (!blueprint || typeof blueprint !== "object") return ["blueprint is not an object"];
  if (blueprint.version !== BLUEPRINT_VERSION) {
    problems.push(`unsupported blueprint version "${blueprint.version}"`);
  }
  const sections = Array.isArray(blueprint.sections) ? blueprint.sections : [];
  if (sections.length === 0) problems.push("blueprint has no sections");
  const items = sections.flatMap((s) => (Array.isArray(s.items) ? s.items : []));
  if (items.length === 0) problems.push("blueprint has no items");

  // The invariant that makes "marks in the header always equal the sum of
  // question marks" true by construction rather than by hoping.
  const sum = items.reduce((n, item) => n + (Number(item.marks) || 0), 0);
  if (sum !== Number(blueprint.totalMarks)) {
    problems.push(`item marks sum to ${sum} but totalMarks is ${blueprint.totalMarks}`);
  }
  for (const item of items) {
    if (!Number.isInteger(item.marks) || item.marks <= 0) {
      problems.push(`item ${item.id} has invalid marks (${item.marks})`);
    }
    if (!item.activityType) problems.push(`item ${item.id} has no activityType`);
    if (!item.renderType) problems.push(`item ${item.id} has no renderType`);
  }
  // Numbering must be continuous — the paper a learner sits is numbered 1..n.
  const numbers = items.map((i) => Number(i.number));
  for (let i = 0; i < numbers.length; i += 1) {
    if (numbers[i] !== i + 1) {
      problems.push("item numbering is not continuous from 1");
      break;
    }
  }
  return problems;
}

/**
 * A blueprint the model must fill, as prompt text.
 *
 * Rendered from the blueprint object at call time — the slots ARE the
 * instruction, so there is no separate prose description of the paper that
 * could disagree with them.
 */
function renderBlueprintDirective(blueprint) {
  if (!blueprint || !Array.isArray(blueprint.sections)) return "";
  const lines = [];
  lines.push(
      "PAPER BLUEPRINT — this is the paper. Fill EVERY slot below exactly as " +
    "specified: same count, same marks, same topic, same thinking level. Do " +
    "not add a question, drop one, merge two, or change any slot's marks. The " +
    "wording of each question is yours; its shape is not.",
  );
  lines.push(
      `Total: ${blueprint.itemCount} questions, ${blueprint.totalMarks} marks, ` +
    `${blueprint.durationMinutes} minutes.`,
  );
  for (const section of blueprint.sections) {
    const title = section.heading || section.name || "Questions";
    lines.push("");
    lines.push(`${title} — ${section.itemCount} questions, ${section.marks} marks.`);
    if (section.instructions) lines.push(`Instruction: ${section.instructions}`);
    for (const item of section.items) {
      const bits = [
        `Q${item.number}`,
        `[${item.marks} mark${item.marks === 1 ? "" : "s"}]`,
        `task: ${item.activityLabel || item.activityType}`,
        `type: ${item.renderType}`,
        `thinking: ${item.bloomLevel}`,
        `difficulty: ${item.difficulty}`,
      ];
      if (item.topic) bits.push(`topic: ${item.topic}`);
      if (item.subtopic) bits.push(`sub-topic: ${item.subtopic}`);
      if (item.learningOutcome) bits.push(`outcome: ${item.learningOutcome}`);
      if (item.figureRequired) bits.push("needs a figure");
      lines.push(`  ${bits.join(" · ")}`);
    }
  }
  lines.push("");
  lines.push(
      "Tag every question you emit with the blueprint's own values for " +
    "\"topic\", \"activityType\", \"bloomLevel\", \"difficulty\" and " +
    "\"learningOutcome\", and give it EXACTLY the marks its slot states. The " +
    "marks must add up to the total above.",
  );
  return lines.join("\n");
}

module.exports = {
  BLUEPRINT_VERSION,
  buildPaperBlueprint,
  validateBlueprint,
  renderBlueprintDirective,
  // Exported for tests + reuse by the targeted-regeneration path.
  splitEvenly,
  allocateByWeight,
  parseCountHint,
  parseMarksHint,
  FIGURE_ACTIVITIES,
};
