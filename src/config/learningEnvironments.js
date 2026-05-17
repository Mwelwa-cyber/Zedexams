/**
 * Canonical learning-environment options for curriculum modules and the
 * teacher generators.
 *
 * Teachers pick one of these 10 concrete environments. Each one maps onto a
 * CBC Lesson-Plan category (natural | artificial | technological | classroom)
 * — the 4-value model that functions/teacherTools/lessonPlanSchema.js already
 * validates. The concrete choice is what shapes activities/materials in the
 * prompt; the cbcCategory keeps the existing lesson-plan schema untouched.
 *
 * Server mirror: functions/teacherTools/learningEnvironments.js — keep the
 * value / cbcCategory pairs in sync with that file.
 */

export const LEARNING_ENVIRONMENTS = [
  { value: 'classroom',      label: 'Classroom',                    cbcCategory: 'classroom' },
  { value: 'outdoor',        label: 'Outdoor Environment',          cbcCategory: 'natural' },
  { value: 'laboratory',     label: 'Laboratory',                   cbcCategory: 'artificial' },
  { value: 'school_garden',  label: 'School Garden',                cbcCategory: 'natural' },
  { value: 'community',      label: 'Community Environment',        cbcCategory: 'natural' },
  { value: 'home',           label: 'Home Environment',             cbcCategory: 'natural' },
  { value: 'library',        label: 'Library',                      cbcCategory: 'artificial' },
  { value: 'computer_lab',   label: 'Computer Lab',                 cbcCategory: 'technological' },
  { value: 'group_work',     label: 'Group Work Setting',           cbcCategory: 'classroom' },
  { value: 'practical_demo', label: 'Practical Demonstration Area', cbcCategory: 'artificial' },
]

export const LEARNING_ENVIRONMENT_VALUES = LEARNING_ENVIRONMENTS.map((e) => e.value)

const BY_VALUE = new Map(LEARNING_ENVIRONMENTS.map((e) => [e.value, e]))

/** Look up a single environment descriptor by value. Returns null if unknown. */
export function getLearningEnvironment(value) {
  return BY_VALUE.get(String(value || '').toLowerCase()) || null
}

/** Human-readable label for a value (empty string if unknown). */
export function learningEnvironmentLabel(value) {
  const e = getLearningEnvironment(value)
  return e ? e.label : ''
}

/** CBC lesson-plan category for a value (defaults to 'classroom'). */
export function learningEnvironmentCbcCategory(value) {
  const e = getLearningEnvironment(value)
  return e ? e.cbcCategory : 'classroom'
}
