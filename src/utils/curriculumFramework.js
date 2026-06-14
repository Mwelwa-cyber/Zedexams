/**
 * 2023 Curriculum Framework — period allocations per grade band.
 *
 * The authoritative weekly time allocation from the *2023 Approved National
 * School Curriculum Framework* (Curriculum Development Centre, Zambia). This
 * is the single source the Class Timetable Studio reads so a generated week
 * carries the official subject list and the right number of periods per
 * subject — not a guess.
 *
 * The same figures are shown to teachers in the Primary Curriculum reference
 * (src/components/teacher/curriculum/PrimaryCurriculum.jsx); keep the two in
 * sync if the framework is revised.
 *
 * Bands (period length and weekly load both differ):
 *   - Lower Primary  (Grades 1–3): 30-min periods · 42 periods/week ·
 *                                  4 combined learning areas
 *   - Upper Primary  (Grades 4–7): 40-min periods · 42 periods/week ·
 *                                  7 learning areas (Expressive Arts OR
 *                                  Home Economics is a one-of choice)
 *
 * Secondary bands are not yet specified here; getFrameworkForGrade() returns
 * null for them and the studio falls back to a manual subject list.
 *
 * Kept DOM-free and side-effect-free so `node` can unit test it.
 */

export const FRAMEWORK_SOURCE =
  '2023 Approved National School Curriculum Framework · Curriculum Development Centre, Zambia'

/* ── Cognitive load ───────────────────────────────────────────────
 * Drives the balanced auto-fill: "heavy" subjects are the cognitively
 * demanding ones that read best in the morning and should not pile up in a
 * single day; "light" subjects (practical / creative) sit comfortably later.
 */
export const LOAD_WEIGHT = { heavy: 3, medium: 2, light: 1 }

/** Classify a subject's cognitive load from its name. Tolerant of the many
 * label variants teachers type ("Maths", "Integrated Science", "Literacy"). */
export function subjectLoad(label = '') {
  const s = String(label).toLowerCase()
  if (/math|science|\benglish\b|literacy/.test(s)) return 'heavy'
  if (/social|zambian|\blanguage\b|history|geograph|civic|religious/.test(s)) return 'medium'
  return 'light'
}

/** Numeric load weight (heavy 3 → light 1) for a subject label. */
export function subjectLoadWeight(label = '') {
  return LOAD_WEIGHT[subjectLoad(label)] || LOAD_WEIGHT.medium
}

/* ── Grade → band ─────────────────────────────────────────────────
 * Accepts the internal 'G4' shorthand and the academic 'Grade 4' form. */
export function bandForGrade(grade) {
  const raw = String(grade ?? '').trim()
  const m = raw.match(/(\d{1,2})/)
  if (!m) return null
  const n = Number(m[1])
  if (n >= 1 && n <= 3) return 'lower_primary'
  if (n >= 4 && n <= 7) return 'upper_primary'
  return null // secondary bands not yet specified in the framework data
}

const BAND_META = {
  lower_primary: { label: 'Lower Primary (Grades 1–3)', periodMinutes: 30 },
  upper_primary: { label: 'Upper Primary (Grades 4–7)', periodMinutes: 40 },
}

/* ── Official subject allocations ─────────────────────────────────
 * `periodsPerWeek` is the official weekly count. `choiceGroup` marks the
 * one-of options (a class takes Expressive Arts OR Home Economics, not both)
 * — the alternative is seeded at 0 periods so the default week sums to the
 * framework total and the teacher can swap with one edit.
 */
const LOWER_PRIMARY_SUBJECTS = [
  { label: 'Literacy & Language — English', periodsPerWeek: 11, timeAllocation: '5 h 30 min', category: 'core' },
  { label: 'Literacy & Language — Zambian', periodsPerWeek: 11, timeAllocation: '5 h 30 min', category: 'core' },
  { label: 'Mathematics & Science',         periodsPerWeek: 10, timeAllocation: '5 h 00 min', category: 'core' },
  { label: 'Creative & Technology Studies', periodsPerWeek: 10, timeAllocation: '5 h 00 min', category: 'core' },
]

const UPPER_PRIMARY_SUBJECTS = [
  { label: 'English Language',   periodsPerWeek: 6, timeAllocation: '4 h 00 min',    category: 'core' },
  { label: 'Mathematics',        periodsPerWeek: 6, timeAllocation: '4 h 00 min',    category: 'core' },
  { label: 'Integrated Science', periodsPerWeek: 6, timeAllocation: '4 h 00 min',    category: 'core' },
  { label: 'Zambian Language',   periodsPerWeek: 5, timeAllocation: '3 h 20 min',    category: 'core' },
  { label: 'Social Studies',     periodsPerWeek: 5, timeAllocation: '3 h 20 min',    category: 'core' },
  { label: 'Technology Studies', periodsPerWeek: 7, timeAllocation: '4 h 40 min',    category: 'core' },
  { label: 'Expressive Arts',    periodsPerWeek: 7, timeAllocation: '4 h 40 min',    category: 'optional', choiceGroup: 'practical' },
  // Alternative to Expressive Arts — seeded at 0 so the week totals 42; flip
  // the two allocations for a class that takes Home Economics instead.
  { label: 'Home Economics',     periodsPerWeek: 0, timeAllocation: '4 h 40 min',    category: 'optional', choiceGroup: 'practical' },
]

const BAND_SUBJECTS = {
  lower_primary: LOWER_PRIMARY_SUBJECTS,
  upper_primary: UPPER_PRIMARY_SUBJECTS,
}

/**
 * The official framework allocation for a grade, or null when the grade's
 * band has no catalogued allocation yet (secondary). Each subject carries
 * its official weekly period count, time allocation, category and cognitive
 * load. `totalPeriods` is the framework's prescribed weekly total.
 *
 * @returns {{band,bandLabel,periodMinutes,totalPeriods,subjects:Array}|null}
 */
export function getFrameworkForGrade(grade) {
  const band = bandForGrade(grade)
  if (!band || !BAND_SUBJECTS[band]) return null
  const meta = BAND_META[band]
  const subjects = BAND_SUBJECTS[band].map((s) => ({
    ...s,
    load: subjectLoad(s.label),
  }))
  // The prescribed weekly total counts each choice group once (the seeded
  // alternative sits at 0, so a plain sum already yields the right figure).
  const totalPeriods = subjects.reduce((sum, s) => sum + s.periodsPerWeek, 0)
  return {
    band,
    bandLabel: meta.label,
    periodMinutes: meta.periodMinutes,
    totalPeriods,
    subjects,
  }
}

/** True when the framework prescribes an allocation for this grade. */
export function hasFramework(grade) {
  return getFrameworkForGrade(grade) != null
}
