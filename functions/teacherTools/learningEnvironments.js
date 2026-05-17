/**
 * Server mirror of src/config/learningEnvironments.js — keep the
 * value / cbcCategory pairs in sync with that file.
 *
 * Maps the 10 concrete teacher-facing learning environments onto the 4 CBC
 * Lesson-Plan categories (natural | artificial | technological | classroom)
 * already validated by lessonPlanSchema.js, so the existing lesson-plan
 * schema stays untouched while the concrete choice shapes the prompt.
 */

const LEARNING_ENVIRONMENTS = [
  {value: "classroom", label: "Classroom", cbcCategory: "classroom"},
  {value: "outdoor", label: "Outdoor Environment", cbcCategory: "natural"},
  {value: "laboratory", label: "Laboratory", cbcCategory: "artificial"},
  {value: "school_garden", label: "School Garden", cbcCategory: "natural"},
  {value: "community", label: "Community Environment", cbcCategory: "natural"},
  {value: "home", label: "Home Environment", cbcCategory: "natural"},
  {value: "library", label: "Library", cbcCategory: "artificial"},
  {value: "computer_lab", label: "Computer Lab", cbcCategory: "technological"},
  {value: "group_work", label: "Group Work Setting", cbcCategory: "classroom"},
  {value: "practical_demo", label: "Practical Demonstration Area", cbcCategory: "artificial"},
];

const BY_VALUE = new Map(LEARNING_ENVIRONMENTS.map((e) => [e.value, e]));

/** Look up a single environment descriptor by value. Returns null if unknown. */
function getLearningEnvironment(value) {
  return BY_VALUE.get(String(value || "").toLowerCase()) || null;
}

/** Human-readable label for a value (empty string if unknown). */
function learningEnvironmentLabel(value) {
  const e = getLearningEnvironment(value);
  return e ? e.label : "";
}

/** CBC lesson-plan category for a value (defaults to "classroom"). */
function learningEnvironmentCbcCategory(value) {
  const e = getLearningEnvironment(value);
  return e ? e.cbcCategory : "classroom";
}

module.exports = {
  LEARNING_ENVIRONMENTS,
  LEARNING_ENVIRONMENT_VALUES: LEARNING_ENVIRONMENTS.map((e) => e.value),
  getLearningEnvironment,
  learningEnvironmentLabel,
  learningEnvironmentCbcCategory,
};
