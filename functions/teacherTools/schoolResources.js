/**
 * Server mirror of src/config/schoolResources.js — keep the value /
 * promptLines pairs in sync with that file (same pattern as
 * learningEnvironments.js).
 *
 * Born from direct teacher feedback: rural teachers found generated lesson
 * activities "not doable" because they assumed projectors, printing, lab kits
 * and other equipment their schools do not have. The selected level is turned
 * into prompt lines that constrain every generated activity and material to
 * what the school actually has.
 */

const SCHOOL_RESOURCE_LEVELS = [
  {
    value: "low",
    label: "Low-resource / rural (local materials only)",
    promptLines: [
      "- School resources: LOW-RESOURCE RURAL SCHOOL — no electricity, projector, computers, internet, photocopier, laboratory or shop-bought apparatus.",
      "HARD CONSTRAINT: every activity, material and homework task MUST be doable with only a chalkboard and chalk, learners' exercise books and pencils, hand-made paper aids, and free objects from the local environment (stones, sticks, bottle tops, seeds, leaves, sand, clay, charcoal, string, old containers and newspapers, the school grounds and the community).",
      "Do NOT include any activity that needs printing, photocopying, projection, computers, internet or laboratory equipment. Homework must not assume learners have textbooks, electricity or internet at home.",
    ],
  },
  {
    value: "basic",
    label: "Basic (chalkboard + a few textbooks)",
    promptLines: [
      "- School resources: BASIC — a chalkboard, chalk, exercise books and a small number of shared textbooks are available, but no projector, computers, internet or photocopier. Prefer locally available and improvised materials; whenever a bought item is named, give a free local alternative in the same line.",
    ],
  },
  {
    value: "full",
    label: "Well-resourced (printing + electricity)",
    promptLines: [
      "- School resources: WELL-RESOURCED — electricity, printed worksheets and standard teaching aids are available; digital aids may be used where they genuinely help. Still include local low-cost alternatives so the plan works on days resources fail.",
    ],
  },
];

const BY_VALUE = new Map(SCHOOL_RESOURCE_LEVELS.map((l) => [l.value, l]));

/** Prompt lines for a level ([] if unknown/empty so callers can spread safely). */
function schoolResourcePromptLines(value) {
  const level = BY_VALUE.get(String(value || "").toLowerCase());
  return level ? level.promptLines : [];
}

/** Human-readable label for a value (empty string if unknown). */
function schoolResourceLabel(value) {
  const level = BY_VALUE.get(String(value || "").toLowerCase());
  return level ? level.label : "";
}

module.exports = {
  SCHOOL_RESOURCE_LEVELS,
  SCHOOL_RESOURCE_VALUES: SCHOOL_RESOURCE_LEVELS.map((l) => l.value),
  schoolResourcePromptLines,
  schoolResourceLabel,
};
