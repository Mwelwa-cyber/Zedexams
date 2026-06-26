/**
 * Server-side SBA taxonomy — the subset the generator runner needs to resolve
 * a (subject, grade, taskType) request into prompt labels, the marking style
 * and default marks.
 *
 * Mirrors src/config/sba.js (client). They must stay in sync — same pattern as
 * curriculum.js (client) vs cbcKnowledge.js (server). Dependency-free so the
 * functions test suite can exercise it directly.
 */

const SUBJECT_LABELS = {
  english: "English Language",
  zambian_language: "Zambian Languages",
  mathematics: "Mathematics",
  integrated_science: "Integrated Science",
  creative_and_technology_studies: "Creative & Technology Studies",
  social_studies: "Social Studies",
};

const GRADE_LABELS = {G5: "Grade 5", G6: "Grade 6", G7: "Grade 7"};

const CTS_COMPONENT_LABELS = {
  expressive_arts: "Expressive Arts",
  home_economics: "Home Economics",
  technology_studies: "Technology Studies",
};

const TASK_LABELS = {
  prepared_speech: "Prepared Speech",
  unprepared_speech: "Unprepared Speech",
  listening_comprehension: "Listening Comprehension",
  reading_aloud: "Reading Aloud",
  reading_comprehension: "Reading Comprehension",
  skimming_scanning: "Skimming & Scanning",
  interpretation_of_information: "Interpretation of Information",
  sequencing: "Sequencing",
  language_structures: "Language Structures",
  composition: "Composition",
  summary: "Summary",
  dictation: "Dictation",
  punctuation: "Punctuation",
  topic_task: "Topic Task",
  assignment: "Assignment",
  experiment: "Experiment",
  project: "Project",
  theory_test: "Theory Test",
  written: "Written Task",
  practical: "Practical Task",
  class_test: "Class Test",
  group_discussion: "Group Discussion",
  role_play: "Role Play",
  written_assignment: "Written Assignment",
  debate: "Debate",
};

// taskType → { marking, defaultMarks, group/skill, needsComponent }.
// `group` doubles as the language skill for English / Zambian Languages.
const LANGUAGE_TASKS = {
  prepared_speech: {marking: "oral_observation", defaultMarks: 10, skill: "Listening & Speaking"},
  unprepared_speech: {marking: "oral_observation", defaultMarks: 10, skill: "Listening & Speaking"},
  listening_comprehension: {marking: "answer_key", defaultMarks: 10, skill: "Listening & Speaking"},
  reading_aloud: {marking: "oral_observation", defaultMarks: 10, skill: "Reading"},
  reading_comprehension: {marking: "answer_key", defaultMarks: 10, skill: "Reading"},
  skimming_scanning: {marking: "answer_key", defaultMarks: 10, skill: "Reading"},
  interpretation_of_information: {marking: "answer_key", defaultMarks: 10, skill: "Reading"},
  sequencing: {marking: "answer_key", defaultMarks: 10, skill: "Writing"},
  language_structures: {marking: "answer_key", defaultMarks: 10, skill: "Writing"},
  composition: {marking: "criteria_rubric", defaultMarks: 10, skill: "Writing"},
  summary: {marking: "answer_key", defaultMarks: 10, skill: "Writing"},
  dictation: {marking: "answer_key", defaultMarks: 10, skill: "Writing"},
  punctuation: {marking: "answer_key", defaultMarks: 10, skill: "Writing"},
};

const TASK_META = {
  english: LANGUAGE_TASKS,
  zambian_language: LANGUAGE_TASKS,
  mathematics: {
    topic_task: {marking: "method_marks", defaultMarks: 20},
  },
  integrated_science: {
    assignment: {marking: "answer_key", defaultMarks: 10},
    experiment: {marking: "experiment_rubric", defaultMarks: 10},
    project: {marking: "project_rubric", defaultMarks: 10},
    theory_test: {marking: "answer_key", defaultMarks: 20},
  },
  creative_and_technology_studies: {
    written: {marking: "competence_rubric", defaultMarks: 10, needsComponent: true},
    practical: {marking: "competence_rubric", defaultMarks: 15, needsComponent: true},
    project: {marking: "project_rubric", defaultMarks: 20, needsComponent: true},
  },
  social_studies: {
    class_test: {marking: "answer_key", defaultMarks: 20},
    project: {marking: "criteria_rubric", defaultMarks: 20},
    group_discussion: {marking: "criteria_rubric", defaultMarks: 20},
    role_play: {marking: "criteria_rubric", defaultMarks: 20},
    written_assignment: {marking: "criteria_rubric", defaultMarks: 20},
    debate: {marking: "criteria_rubric", defaultMarks: 20},
  },
};

const BLOOM_LEVELS = new Set([
  "Knowledge", "Comprehension", "Application", "Analysis", "Synthesis", "Evaluation",
]);

function isSbaSubject(subject) {
  return Object.prototype.hasOwnProperty.call(SUBJECT_LABELS, subject);
}

function isSbaGrade(grade) {
  return Object.prototype.hasOwnProperty.call(GRADE_LABELS, grade);
}

/**
 * Resolve the metadata for a (subject, taskType) pair, or null if unknown.
 * @returns {null | {taskType, label, marking, defaultMarks, skill, needsComponent}}
 */
function resolveSbaTaskMeta(subject, taskType) {
  const bySubject = TASK_META[subject];
  if (!bySubject) return null;
  const meta = bySubject[taskType];
  if (!meta) return null;
  return {
    taskType,
    label: TASK_LABELS[taskType] || taskType,
    marking: meta.marking,
    defaultMarks: meta.defaultMarks,
    skill: meta.skill || "",
    needsComponent: Boolean(meta.needsComponent),
  };
}

/**
 * Map an SBA CTS component to the KB subject that holds its 2013 OBC syllabus.
 * CTS has no syllabus of its own; the 2013 OBC names the technical strand
 * "Design & Technology" (not "Technology Studies"), while Expressive Arts and
 * Home Economics map 1:1. Used to ground CTS tasks (and feed the studio's
 * topic picker) on the right 2013 syllabus.
 */
function ctsComponentToKbSubject(component) {
  return component === "technology_studies" ? "design_and_technology" : component;
}

module.exports = {
  SUBJECT_LABELS,
  GRADE_LABELS,
  CTS_COMPONENT_LABELS,
  TASK_LABELS,
  BLOOM_LEVELS,
  isSbaSubject,
  isSbaGrade,
  resolveSbaTaskMeta,
  ctsComponentToKbSubject,
};
