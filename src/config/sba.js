/**
 * School Based Assessment (SBA) taxonomy + mark conversion — single source of
 * truth for the SBA Studio (task generator) and the SBA Mark Tracker.
 *
 * Encodes the structure mandated by the Examinations Council of Zambia (ECZ)
 * "Guidelines for the Administration of School Based Assessment at Primary
 * School Level" (valid from 2020) for Grades 5, 6 and 7:
 *
 *   - the task-type catalogue per subject (and how each is marked),
 *   - the official per-grade task blueprint (which tasks, how many, the marks
 *     each, and the year total) used by the tracker,
 *   - the conversion of a learner's raw total to the 10%-per-grade SBA mark and
 *     the cumulative G5+G6+G7 final mark entered on the ECZ OMES portal.
 *
 * This module is deliberately side-effect free (no firebase / no
 * import.meta.env) so plain `node` test scripts can import it directly. See
 * scripts/test-sba-config.mjs, which checks the conversion math against the
 * worked examples printed in the guidelines.
 *
 * NOTE: SBA is an upper-primary (OBC) instrument. The 2020 roll-out had
 * transitional weightings (15% at G6 in 2020, etc.); this module implements the
 * steady-state rule (1.1.1): 10% banked per grade, 30% total.
 */

/* ── Grades ──────────────────────────────────────────────────────────── */

export const SBA_GRADES = [
  { value: 'G5', label: 'Grade 5' },
  { value: 'G6', label: 'Grade 6' },
  { value: 'G7', label: 'Grade 7' },
]

export const SBA_GRADE_VALUES = SBA_GRADES.map((g) => g.value)

/* ── Subjects ────────────────────────────────────────────────────────── */
//
// `kind` drives which marking UI / prompt strategy the studio uses:
//   language → four language skills, oral observation + written keys
//   maths    → one topic task per topic, method + accuracy marks
//   science  → assignments / experiments / projects / theory tests
//   cts      → three components (Expressive Arts / Home Ec / Tech Studies)
//   social   → tests / projects / discussions / written assignments

export const SBA_SUBJECTS = [
  { value: 'english',                          label: 'English Language',              kind: 'language' },
  { value: 'zambian_language',                 label: 'Zambian Languages',             kind: 'language' },
  { value: 'mathematics',                      label: 'Mathematics',                   kind: 'maths' },
  { value: 'integrated_science',               label: 'Integrated Science',            kind: 'science' },
  { value: 'creative_and_technology_studies',  label: 'Creative & Technology Studies', kind: 'cts' },
  { value: 'social_studies',                   label: 'Social Studies',                kind: 'social' },
]

export const SBA_SUBJECT_VALUES = SBA_SUBJECTS.map((s) => s.value)

export function getSbaSubject(value) {
  return SBA_SUBJECTS.find((s) => s.value === value) || null
}

/* ── Bloom's Taxonomy cognitive levels ───────────────────────────────── */
//
// Every SBA task in the guidelines is plotted against a Bloom level; the
// generator tags each task it produces with one of these.

export const SBA_BLOOM_LEVELS = [
  'Knowledge', 'Comprehension', 'Application', 'Analysis', 'Synthesis', 'Evaluation',
]

/* ── How a task is marked ────────────────────────────────────────────── */

export const SBA_MARKING_STYLES = {
  ANSWER_KEY: 'answer_key',               // written questions with model answers
  ORAL_OBSERVATION: 'oral_observation',   // speaking — teacher observation sheet, no written key
  METHOD_MARKS: 'method_marks',           // maths — method + accuracy + formula + diagram marks
  EXPERIMENT_RUBRIC: 'experiment_rubric', // science 6-skill process rubric (10)
  PROJECT_RUBRIC: 'project_rubric',       // science/CTS project rubric
  COMPETENCE_RUBRIC: 'competence_rubric', // CTS practical/written competences
  CRITERIA_RUBRIC: 'criteria_rubric',     // social studies marking criteria
}

/* ── CTS components ──────────────────────────────────────────────────── */

export const SBA_CTS_COMPONENTS = [
  { value: 'expressive_arts',   label: 'Expressive Arts' },
  { value: 'home_economics',    label: 'Home Economics' },
  { value: 'technology_studies', label: 'Technology Studies' },
]

const SBA_CTS_COMPONENT_LABELS = Object.fromEntries(
  SBA_CTS_COMPONENTS.map((c) => [c.value, c.label]),
)

/* ── Task-type labels (shared by generator + tracker) ────────────────── */

export const SBA_TASK_LABELS = {
  prepared_speech: 'Prepared Speech',
  unprepared_speech: 'Unprepared Speech',
  listening_comprehension: 'Listening Comprehension',
  reading_aloud: 'Reading Aloud',
  reading_comprehension: 'Reading Comprehension',
  skimming_scanning: 'Skimming & Scanning',
  interpretation_of_information: 'Interpretation of Information',
  sequencing: 'Sequencing',
  language_structures: 'Language Structures',
  composition: 'Composition',
  summary: 'Summary',
  dictation: 'Dictation',
  punctuation: 'Punctuation',
  topic_task: 'Topic Task',
  assignment: 'Assignment',
  experiment: 'Experiment',
  project: 'Project',
  theory_test: 'Theory Test',
  written: 'Written Task',
  practical: 'Practical Task',
  class_test: 'Class Test',
  group_discussion: 'Group Discussion',
  role_play: 'Role Play',
  written_assignment: 'Written Assignment',
  debate: 'Debate',
}

const M = SBA_MARKING_STYLES

/**
 * The catalogue of task types a teacher can generate per subject, with the
 * default marks and the marking style each carries. `group` clusters language
 * tasks by the four-skills model.
 */
export const SBA_TASK_TYPES = {
  english: [
    { value: 'prepared_speech',              group: 'Listening & Speaking', defaultMarks: 10, marking: M.ORAL_OBSERVATION },
    { value: 'unprepared_speech',            group: 'Listening & Speaking', defaultMarks: 10, marking: M.ORAL_OBSERVATION },
    { value: 'listening_comprehension',      group: 'Listening & Speaking', defaultMarks: 10, marking: M.ANSWER_KEY },
    { value: 'reading_aloud',                group: 'Reading',              defaultMarks: 10, marking: M.ORAL_OBSERVATION },
    { value: 'reading_comprehension',        group: 'Reading',              defaultMarks: 10, marking: M.ANSWER_KEY },
    { value: 'skimming_scanning',            group: 'Reading',              defaultMarks: 10, marking: M.ANSWER_KEY },
    { value: 'interpretation_of_information', group: 'Reading',             defaultMarks: 10, marking: M.ANSWER_KEY },
    { value: 'sequencing',                   group: 'Writing',              defaultMarks: 10, marking: M.ANSWER_KEY },
    { value: 'language_structures',          group: 'Writing',              defaultMarks: 10, marking: M.ANSWER_KEY },
    { value: 'composition',                  group: 'Writing',              defaultMarks: 10, marking: M.CRITERIA_RUBRIC },
    { value: 'summary',                      group: 'Writing',              defaultMarks: 10, marking: M.ANSWER_KEY },
    { value: 'dictation',                    group: 'Writing',              defaultMarks: 10, marking: M.ANSWER_KEY },
    { value: 'punctuation',                  group: 'Writing',              defaultMarks: 10, marking: M.ANSWER_KEY },
  ],
  mathematics: [
    { value: 'topic_task', group: 'Topic', defaultMarks: 20, marking: M.METHOD_MARKS },
  ],
  integrated_science: [
    { value: 'assignment',  group: 'Continuous', defaultMarks: 10, marking: M.ANSWER_KEY },
    { value: 'experiment',  group: 'Practical',  defaultMarks: 10, marking: M.EXPERIMENT_RUBRIC },
    { value: 'project',     group: 'Practical',  defaultMarks: 10, marking: M.PROJECT_RUBRIC },
    { value: 'theory_test', group: 'Tests',      defaultMarks: 20, marking: M.ANSWER_KEY },
  ],
  creative_and_technology_studies: [
    { value: 'written',   group: 'CTS', defaultMarks: 10, marking: M.COMPETENCE_RUBRIC, needsComponent: true },
    { value: 'practical', group: 'CTS', defaultMarks: 15, marking: M.COMPETENCE_RUBRIC, needsComponent: true },
    { value: 'project',   group: 'CTS', defaultMarks: 20, marking: M.PROJECT_RUBRIC,    needsComponent: true },
  ],
  social_studies: [
    { value: 'class_test',         group: 'Social Studies', defaultMarks: 20, marking: M.ANSWER_KEY },
    { value: 'project',            group: 'Social Studies', defaultMarks: 20, marking: M.CRITERIA_RUBRIC },
    { value: 'group_discussion',   group: 'Social Studies', defaultMarks: 20, marking: M.CRITERIA_RUBRIC },
    { value: 'role_play',          group: 'Social Studies', defaultMarks: 20, marking: M.CRITERIA_RUBRIC },
    { value: 'written_assignment', group: 'Social Studies', defaultMarks: 20, marking: M.CRITERIA_RUBRIC },
    { value: 'debate',             group: 'Social Studies', defaultMarks: 20, marking: M.CRITERIA_RUBRIC },
  ],
}
// Zambian Languages shares English's four-skills catalogue.
SBA_TASK_TYPES.zambian_language = SBA_TASK_TYPES.english

/** Task types for a subject, each enriched with its display label. */
export function getSbaTaskTypes(subject) {
  return (SBA_TASK_TYPES[subject] || []).map((t) => ({
    ...t,
    label: SBA_TASK_LABELS[t.value] || t.value,
  }))
}

export function getSbaTaskType(subject, value) {
  return getSbaTaskTypes(subject).find((t) => t.value === value) || null
}

/* ── Per-grade task blueprints (the official tables) ─────────────────── */
//
// Each blueprint flattens to `columns` (one per required task instance, with a
// stable key + max marks + a visual `group` header) plus the year `total`.
// The tracker renders one column per task and converts the row total against
// `total`. The total IS the conversion divisor — single source of truth.

const t = (type, max, label) => ({ type, max, label })
const rep = (type, n, max, label) => Array.from({ length: n }, () => t(type, max, label))
const cts = (component, type, max) => ({
  type,
  max,
  component,
  label: `${SBA_CTS_COMPONENT_LABELS[component]} — ${SBA_TASK_LABELS[type]}`,
})

function buildBlueprint(groups) {
  const columns = []
  let total = 0
  let seq = 0
  for (const g of groups) {
    for (const tk of g.tasks) {
      seq += 1
      total += tk.max
      columns.push({
        key: `c${seq}`,
        type: tk.type,
        component: tk.component || null,
        label: tk.label || SBA_TASK_LABELS[tk.type] || tk.type,
        max: tk.max,
        group: g.group,
      })
    }
  }
  return { columns, total }
}

const SBA_BLUEPRINTS = {
  english: {
    G5: buildBlueprint([
      { group: 'Term 1', tasks: [t('unprepared_speech', 10), t('reading_aloud', 10), t('reading_comprehension', 10), t('sequencing', 10), t('language_structures', 10), t('composition', 10)] },
      { group: 'Term 2', tasks: [t('prepared_speech', 10), t('reading_comprehension', 10), t('skimming_scanning', 10), t('language_structures', 10), t('composition', 10), t('summary', 10)] },
      { group: 'Term 3', tasks: [t('unprepared_speech', 10), t('prepared_speech', 10), t('interpretation_of_information', 10), t('language_structures', 10), t('composition', 10), t('summary', 10)] },
    ]),
    G6: buildBlueprint([
      { group: 'Term 1', tasks: [t('prepared_speech', 10), t('reading_aloud', 10), t('skimming_scanning', 10), t('language_structures', 10), t('punctuation', 10), t('composition', 10)] },
      { group: 'Term 2', tasks: [t('unprepared_speech', 10), t('reading_aloud', 10), t('reading_comprehension', 10), t('language_structures', 10), t('composition', 10), t('summary', 10)] },
      { group: 'Term 3', tasks: [t('prepared_speech', 10), t('reading_comprehension', 10), t('interpretation_of_information', 10), t('language_structures', 10), t('composition', 10), t('summary', 10)] },
    ]),
    G7: buildBlueprint([
      { group: 'Term 1', tasks: [t('unprepared_speech', 10), t('prepared_speech', 10), t('reading_aloud', 10), t('reading_comprehension', 10), t('language_structures', 10), t('punctuation', 10), t('composition', 10), t('dictation', 10)] },
      { group: 'Term 2', tasks: [t('unprepared_speech', 10), t('prepared_speech', 10), t('reading_comprehension', 10), t('interpretation_of_information', 10), t('language_structures', 10), t('punctuation', 10), t('composition', 10), t('summary', 10)] },
    ]),
  },

  zambian_language: {
    // 10 tasks per grade, grouped by skill (L&S 30 · Writing 50 · Reading 20).
    G5: buildBlueprint([
      { group: 'Listening & Speaking (30)', tasks: [t('prepared_speech', 10), t('unprepared_speech', 10), t('listening_comprehension', 10)] },
      { group: 'Writing (50)', tasks: [t('composition', 10), t('language_structures', 10), t('sequencing', 10), t('summary', 10), t('dictation', 10)] },
      { group: 'Reading (20)', tasks: [t('reading_comprehension', 10), t('interpretation_of_information', 10)] },
    ]),
  },

  mathematics: {
    G5: buildBlueprint([
      { group: 'Term 1', tasks: rep('topic_task', 4, 20) },
      { group: 'Term 2', tasks: rep('topic_task', 4, 20) },
      { group: 'Term 3', tasks: rep('topic_task', 4, 20) },
    ]),
    G7: buildBlueprint([
      { group: 'Term 1', tasks: rep('topic_task', 4, 20) },
      { group: 'Term 2', tasks: rep('topic_task', 4, 20) },
    ]),
  },

  integrated_science: {
    G5: buildBlueprint([
      { group: 'Term 1', tasks: [...rep('assignment', 4, 10), ...rep('experiment', 2, 10), ...rep('theory_test', 2, 20)] },
      { group: 'Term 2', tasks: [...rep('assignment', 3, 10), ...rep('experiment', 2, 10), t('project', 10), ...rep('theory_test', 2, 20)] },
      { group: 'Term 3', tasks: [...rep('assignment', 4, 10), ...rep('experiment', 2, 10), ...rep('theory_test', 2, 20)] },
    ]),
    G7: buildBlueprint([
      { group: 'Term 1', tasks: [...rep('assignment', 4, 10), ...rep('experiment', 2, 10), ...rep('theory_test', 2, 20)] },
      { group: 'Term 2', tasks: [...rep('assignment', 4, 10), ...rep('experiment', 2, 10), ...rep('theory_test', 2, 20)] },
    ]),
  },

  creative_and_technology_studies: {
    G5: buildBlueprint([
      { group: 'Expressive Arts', tasks: [cts('expressive_arts', 'written', 10), cts('expressive_arts', 'practical', 15), cts('expressive_arts', 'practical', 15), cts('expressive_arts', 'project', 20)] },
      { group: 'Home Economics', tasks: [cts('home_economics', 'written', 10), cts('home_economics', 'practical', 15), cts('home_economics', 'practical', 15), cts('home_economics', 'project', 20)] },
      { group: 'Technology Studies', tasks: [cts('technology_studies', 'written', 10), cts('technology_studies', 'practical', 15), cts('technology_studies', 'practical', 15), cts('technology_studies', 'project', 20)] },
    ]),
    G7: buildBlueprint([
      { group: 'Expressive Arts', tasks: [cts('expressive_arts', 'practical', 15), cts('expressive_arts', 'project', 20)] },
      { group: 'Home Economics', tasks: [cts('home_economics', 'practical', 15), cts('home_economics', 'project', 20)] },
      { group: 'Technology Studies', tasks: [cts('technology_studies', 'practical', 15), cts('technology_studies', 'project', 20)] },
    ]),
  },

  social_studies: {
    G5: buildBlueprint([
      { group: 'Term 1', tasks: [t('class_test', 20), t('project', 20, 'Educational Visit / Project')] },
      { group: 'Term 2', tasks: [t('group_discussion', 20, 'Group Discussion / Role Play / Debate'), t('written_assignment', 20)] },
      { group: 'Term 3', tasks: [t('class_test', 20)] },
    ]),
    G6: buildBlueprint([
      { group: 'Term 1', tasks: [t('class_test', 14), t('group_discussion', 14), t('project', 12, 'Educational Visit / Project')] },
      { group: 'Term 2', tasks: [t('group_discussion', 12), t('class_test', 12), t('written_assignment', 12)] },
      { group: 'Term 3', tasks: [t('written_assignment', 12), t('class_test', 12)] },
    ]),
    G7: buildBlueprint([
      { group: 'Term 1', tasks: [t('class_test', 20), t('group_discussion', 20), t('project', 20, 'Educational Visit / Project')] },
      { group: 'Term 2', tasks: [t('group_discussion', 20), t('written_assignment', 20)] },
    ]),
  },
}
// G5 and G6 share the same blueprint for Maths, Science, CTS and Zambian Languages.
SBA_BLUEPRINTS.mathematics.G6 = SBA_BLUEPRINTS.mathematics.G5
SBA_BLUEPRINTS.integrated_science.G6 = SBA_BLUEPRINTS.integrated_science.G5
SBA_BLUEPRINTS.creative_and_technology_studies.G6 = SBA_BLUEPRINTS.creative_and_technology_studies.G5
SBA_BLUEPRINTS.zambian_language.G6 = SBA_BLUEPRINTS.zambian_language.G5
SBA_BLUEPRINTS.zambian_language.G7 = SBA_BLUEPRINTS.zambian_language.G5

/** The official task blueprint for a subject + grade, or null if unknown. */
export function getSbaBlueprint(subject, grade) {
  const bySubject = SBA_BLUEPRINTS[subject]
  if (!bySubject) return null
  return bySubject[grade] || null
}

/** The maximum SBA mark for a subject + grade (the conversion divisor). */
export function getSbaGradeTotal(subject, grade) {
  const bp = getSbaBlueprint(subject, grade)
  return bp ? bp.total : 0
}

/* ── Mark conversion (ECZ formulas) ──────────────────────────────────── */

/**
 * Round to the nearest whole number, half up — matches the guidelines'
 * conversion table (1.25→1, 3.75→4, 7.5→8, 9.3→9, 9.6→10). The epsilon nudge
 * keeps exact x.5 fractions (e.g. 99/180×10 = 5.5 → 6) from being lost to
 * floating-point representation.
 */
export function roundSbaMark(value) {
  if (!Number.isFinite(value)) return 0
  return Math.round(value + 1e-9)
}

/**
 * Convert a learner's raw total for one grade to the 10%-per-grade SBA mark.
 * `obtained / total × 10`, clamped to 0–10. Returns both the precise value
 * (for display) and the rounded whole number that is recorded.
 */
export function convertSbaMark(obtained, total) {
  const o = Number(obtained)
  const tt = Number(total)
  if (!Number.isFinite(o) || !Number.isFinite(tt) || tt <= 0) {
    return { raw: 0, rounded: 0 }
  }
  const raw = (o / tt) * 10
  const clamped = Math.max(0, Math.min(10, raw))
  return {
    raw: Math.round(clamped * 100) / 100,
    rounded: Math.max(0, Math.min(10, roundSbaMark(clamped))),
  }
}

/**
 * The cumulative SBA mark entered on the ECZ OMES portal in Grade 7:
 * the sum of the three rounded per-grade marks (out of 30).
 */
export function combineFinalSbaMark({ g5 = 0, g6 = 0, g7 = 0 } = {}) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  return n(g5) + n(g6) + n(g7)
}

export const SBA_MAX_FINAL_MARK = 30
