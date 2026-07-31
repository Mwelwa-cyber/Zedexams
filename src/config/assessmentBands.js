/**
 * Assessment bands — the pedagogical rules for each stage of the ladder.
 *
 * WHAT THIS FILE IS: the canonical DATA for the `assessmentBands` Firestore
 * collection, and the shape every consumer reads. It is the seed
 * (scripts/seed-assessment-bands.mjs writes these documents) and the
 * last-resort fallback when Firestore cannot be reached, so a studio never
 * dies because a collection is cold.
 *
 * WHAT THIS FILE IS NOT: a rule that a component or a prompt may restate. No
 * component decides which question types a grade may use, no prompt string
 * carries a reading level or a Bloom's spread — they read a resolved band. The
 * point is that a band can be corrected in Firestore, by a person, without a
 * deploy; keeping the seed here is what makes the collection reproducible, not
 * a second place to edit.
 *
 * Read through src/utils/assessmentBandService.js (client) or
 * functions/teacherTools/assessmentBands.js (server) — never imported directly
 * by a component.
 *
 * Pure — no React, no Firebase.
 */

import { ACTIVITY_IDS } from './questionActivities.js'

/** Band ids, in ladder order. Mirrored by educationLevels.js `band`. */
export const BAND_IDS = [
  'early_childhood', 'lower_primary', 'upper_primary',
  'junior_secondary', 'senior_secondary',
]

/**
 * The vocabulary a band's `questionTypes` draws from: every ACTIVITY the studio
 * can ask for (src/config/questionActivities.js). A band lists activities — what
 * the task is — not render structures; the registry owns the mapping from an
 * activity to the structure that carries it, and how honestly it does so.
 */
export const ALL_QUESTION_TYPES = ACTIVITY_IDS

/**
 * Difficulty tiers a blueprint allocates items across. Distinct from Bloom's
 * levels: Bloom's names the KIND of thinking, a tier names how demanding the
 * item is. A paper needs both — all-recall questions can still be hard, and an
 * analysis question can still be gentle.
 */
export const DIFFICULTY_TIERS = ['recall', 'understanding', 'analysis', 'challenge']

/**
 * The five bands.
 *
 * `readingRequirement` is the governing constraint, not a note: 'none' means a
 * learner who cannot yet read must still be able to answer every item, which is
 * why Early Childhood requires a figure or a teacher-read script on each one.
 *
 * `defaultDurations` / `markRanges` are keyed by the canonical assessment types
 * (paperTaxonomy.ASSESSMENT_TYPES). `bloomDistribution` sums to 1.
 */
export const ASSESSMENT_BAND_SEED = {
  early_childhood: {
    id: 'early_childhood',
    label: 'Early Childhood',
    levels: ['nursery', 'reception'],
    reading: {
      requirement: 'none',
      note: 'The learner is not expected to read anything. Every item carries a figure the learner responds to, or a script the teacher reads aloud.',
      maxWordsPerItem: 0,
      vocabulary: 'spoken, everyday words the child already uses at home',
    },
    questionTypes: [
      'picture_identification', 'circling', 'picture_matching', 'counting',
      'tracing', 'colouring', 'sorting',
    ],
    structure: {
      oneTaskPerInstruction: true,
      requiresFigureOrScript: true,
      teacherScript: true,
      answerSpace: 'oversized',
      maxItems: 10,
      sections: false,
      notes: [
        'One instruction asks for exactly one thing.',
        'Answer space is oversized — a young child writes large and imprecisely.',
        'A teacher-administered script is generated alongside the worksheet, giving the exact words to read for every item.',
      ],
    },
    instructionFormality: 'spoken',
    minFigureSizeMm: 45,
    // The brief's difficulty tiers. Defaults to a mixed paper (~30% recall,
    // ~40% understanding/application, ~20% analysis, ~10% challenge) and is
    // tuned per stage — a Nursery paper carries no analysis tier at all. A
    // teacher may override the mix per paper before generating.
    difficultyMix: { recall: 0.6, understanding: 0.4, analysis: 0, challenge: 0 },
    bloomDistribution: { remember: 0.6, understand: 0.4 },
    defaultDurations: {
      topic_test: 15, weekly_test: 15, mid_term: 20, end_of_term: 20,
      mock_exam: 20, examination: 20, final_exam: 20,
    },
    markRanges: {
      topic_test: [5, 10], weekly_test: [5, 10], mid_term: [10, 15],
      end_of_term: [10, 20], mock_exam: [10, 20], examination: [10, 20],
      final_exam: [10, 20],
    },
  },

  lower_primary: {
    id: 'lower_primary',
    label: 'Grades 1–4',
    levels: ['grade-1', 'grade-2', 'grade-3', 'grade-4'],
    reading: {
      requirement: 'short',
      note: 'Short sentences in familiar vocabulary. The reading load is capped so the paper tests the subject, not the learner’s reading speed.',
      maxWordsPerItem: 25,
      maxWordsPerPaper: 350,
      vocabulary: 'short, familiar words the class already uses',
    },
    questionTypes: [
      'multiple_choice', 'true_false', 'fill_blanks', 'matching',
      'short_answer', 'picture_matching', 'counting',
    ],
    structure: {
      mcqOptionCount: 3,
      figuresWhereTheyAidComprehension: true,
      answerSpace: 'large-lines',
      maxItems: 25,
      sections: false,
      notes: [
        'Three options on a multiple-choice question, not four.',
        'Writing lines are large — a Grade 2 hand needs the room.',
        'Include a picture wherever it helps the learner understand what is being asked.',
        'Word problems stay to one step, set in something the child has seen.',
      ],
    },
    instructionFormality: 'simple',
    minFigureSizeMm: 40,
    // The brief's difficulty tiers. Defaults to a mixed paper (~30% recall,
    // ~40% understanding/application, ~20% analysis, ~10% challenge) and is
    // tuned per stage — a Nursery paper carries no analysis tier at all. A
    // teacher may override the mix per paper before generating.
    difficultyMix: { recall: 0.4, understanding: 0.4, analysis: 0.15, challenge: 0.05 },
    bloomDistribution: { remember: 0.45, understand: 0.35, apply: 0.2 },
    defaultDurations: {
      topic_test: 30, weekly_test: 30, mid_term: 40, end_of_term: 60,
      mock_exam: 60, examination: 60, final_exam: 60,
    },
    markRanges: {
      topic_test: [10, 20], weekly_test: [10, 20], mid_term: [20, 30],
      end_of_term: [30, 50], mock_exam: [30, 50], examination: [30, 50],
      final_exam: [30, 50],
    },
  },

  upper_primary: {
    id: 'upper_primary',
    label: 'Grades 5–7',
    levels: ['grade-5', 'grade-6', 'grade-7'],
    reading: {
      requirement: 'grade-level',
      note: 'Grade-level vocabulary. Subject words are used once the syllabus has introduced them.',
      maxWordsPerItem: 60,
      vocabulary: 'grade-level, including subject words the syllabus has taught',
    },
    questionTypes: [
      'multiple_choice', 'true_false', 'short_answer', 'fill_blanks', 'matching',
      'structured', 'calculation', 'diagram_labelling', 'table_completion',
      'comprehension',
    ],
    structure: {
      mcqOptionCount: 4,
      answerSpace: 'lines',
      maxItems: 50,
      sections: true,
      examBlueprintPreset: 'grade-7-exam',
      notes: [
        'Four options on a multiple-choice question.',
        'Structured questions use (a), (b), (c) with marks shown per part.',
        'The Grade 7 examination blueprint is available as a preset.',
      ],
    },
    instructionFormality: 'standard',
    minFigureSizeMm: 35,
    // The brief's difficulty tiers. Defaults to a mixed paper (~30% recall,
    // ~40% understanding/application, ~20% analysis, ~10% challenge) and is
    // tuned per stage — a Nursery paper carries no analysis tier at all. A
    // teacher may override the mix per paper before generating.
    difficultyMix: { recall: 0.3, understanding: 0.4, analysis: 0.2, challenge: 0.1 },
    bloomDistribution: { remember: 0.3, understand: 0.3, apply: 0.25, analyse: 0.15 },
    defaultDurations: {
      topic_test: 40, weekly_test: 30, mid_term: 60, end_of_term: 90,
      mock_exam: 90, examination: 90, final_exam: 90,
    },
    markRanges: {
      topic_test: [20, 30], weekly_test: [15, 25], mid_term: [30, 50],
      end_of_term: [50, 80], mock_exam: [50, 100], examination: [50, 100],
      final_exam: [50, 100],
    },
  },

  junior_secondary: {
    id: 'junior_secondary',
    label: 'Forms 1–2',
    levels: ['form-1', 'form-2'],
    reading: {
      requirement: 'subject-terminology',
      note: 'Subject terminology is introduced and expected. Command words carry their examination meanings.',
      maxWordsPerItem: 120,
      vocabulary: 'subject register, with terms defined when first assessed',
    },
    questionTypes: [
      'multiple_choice', 'true_false', 'short_answer', 'fill_blanks', 'matching',
      'structured', 'calculation', 'diagram_labelling', 'table_completion',
      'comprehension', 'multi_step_calculation', 'data_interpretation', 'essay',
    ],
    structure: {
      mcqOptionCount: 4,
      answerSpace: 'lines',
      maxItems: 60,
      sections: true,
      sectionScheme: 'A/B',
      marksPerSubQuestion: true,
      notes: [
        'Section A and Section B, each with its own instruction.',
        'Every sub-question shows its own marks.',
        'Multi-step calculations split marks across method and answer.',
      ],
    },
    instructionFormality: 'formal',
    minFigureSizeMm: 30,
    // The brief's difficulty tiers. Defaults to a mixed paper (~30% recall,
    // ~40% understanding/application, ~20% analysis, ~10% challenge) and is
    // tuned per stage — a Nursery paper carries no analysis tier at all. A
    // teacher may override the mix per paper before generating.
    difficultyMix: { recall: 0.25, understanding: 0.4, analysis: 0.25, challenge: 0.1 },
    bloomDistribution: { remember: 0.25, understand: 0.3, apply: 0.25, analyse: 0.2 },
    defaultDurations: {
      topic_test: 40, weekly_test: 40, mid_term: 60, end_of_term: 120,
      mock_exam: 120, examination: 120, final_exam: 120,
    },
    markRanges: {
      topic_test: [20, 40], weekly_test: [20, 30], mid_term: [40, 60],
      end_of_term: [60, 100], mock_exam: [60, 100], examination: [60, 100],
      final_exam: [60, 100],
    },
  },

  senior_secondary: {
    id: 'senior_secondary',
    label: 'Forms 3–6',
    // Form 6 is the second CBC A-Level year. It has no A-Level syllabus on file
    // and no band rules of its own, so it is governed by the senior-secondary
    // band — the closest correct pedagogy, and the alternative (leaving a rung
    // of the ladder unclaimed) is what a paper generator would crash on.
    levels: ['form-3', 'form-4', 'form-5', 'form-6'],
    reading: {
      requirement: 'full',
      note: 'The full subject register, at examination standard.',
      maxWordsPerItem: 250,
      vocabulary: 'full subject register, no glossing',
    },
    questionTypes: [
      'multiple_choice', 'short_answer', 'structured', 'calculation',
      'multi_step_calculation', 'data_interpretation', 'essay',
      'extended_response', 'case_study', 'graph_interpretation', 'practical',
      'comprehension', 'diagram_labelling', 'table_completion',
    ],
    structure: {
      mcqOptionCount: 4,
      answerSpace: 'lines',
      maxItems: 60,
      sections: true,
      sectionScheme: 'A/B',
      marksPerSubQuestion: true,
      compulsoryAndOptionalGroups: true,
      fullExamBlueprint: true,
      notes: [
        'Full examination blueprint: compulsory questions plus optional groups ("Answer any THREE questions from this section").',
        'The formal instruction set is printed in full, including "Do not open this paper until you are told to do so."',
        'Extended responses and essays are marked against stated criteria.',
      ],
    },
    instructionFormality: 'examination',
    minFigureSizeMm: 30,
    // The brief's difficulty tiers. Defaults to a mixed paper (~30% recall,
    // ~40% understanding/application, ~20% analysis, ~10% challenge) and is
    // tuned per stage — a Nursery paper carries no analysis tier at all. A
    // teacher may override the mix per paper before generating.
    difficultyMix: { recall: 0.2, understanding: 0.35, analysis: 0.3, challenge: 0.15 },
    bloomDistribution: {
      remember: 0.2, understand: 0.25, apply: 0.25, analyse: 0.2, evaluate: 0.1,
    },
    defaultDurations: {
      topic_test: 60, weekly_test: 40, mid_term: 90, end_of_term: 150,
      mock_exam: 150, examination: 150, final_exam: 180,
    },
    markRanges: {
      topic_test: [25, 50], weekly_test: [20, 40], mid_term: [50, 75],
      end_of_term: [75, 100], mock_exam: [75, 100], examination: [75, 100],
      final_exam: [75, 100],
    },
  },
}

/**
 * Validate a band document — used by the seed script before it writes, and by
 * the readers before they trust a document someone has edited in Firestore. A
 * band that fails validation is refused rather than half-applied, so a typo in
 * the console cannot quietly widen what a Nursery paper may contain.
 *
 * @returns {string[]} problems; empty means valid
 */
export function validateBand(band) {
  const problems = []
  if (!band || typeof band !== 'object') return ['band is not an object']
  if (!BAND_IDS.includes(band.id)) problems.push(`unknown band id "${band.id}"`)
  if (!Array.isArray(band.questionTypes) || band.questionTypes.length === 0) {
    problems.push('questionTypes must be a non-empty array')
  } else {
    for (const type of band.questionTypes) {
      if (!ALL_QUESTION_TYPES.includes(type)) problems.push(`unknown question type "${type}"`)
    }
  }
  if (!band.reading || typeof band.reading.requirement !== 'string') {
    problems.push('reading.requirement is required')
  }
  const dist = band.bloomDistribution
  if (!dist || typeof dist !== 'object') {
    problems.push('bloomDistribution is required')
  } else {
    const sum = Object.values(dist).reduce((n, v) => n + (Number(v) || 0), 0)
    // Floating-point tolerance, not a licence to be approximately right.
    if (Math.abs(sum - 1) > 0.001) problems.push(`bloomDistribution must sum to 1 (got ${sum})`)
  }
  const mix = band.difficultyMix
  if (!mix || typeof mix !== 'object') {
    problems.push('difficultyMix is required')
  } else {
    const sum = Object.values(mix).reduce((n, v) => n + (Number(v) || 0), 0)
    if (Math.abs(sum - 1) > 0.001) problems.push(`difficultyMix must sum to 1 (got ${sum})`)
    for (const tier of Object.keys(mix)) {
      if (!DIFFICULTY_TIERS.includes(tier)) problems.push(`unknown difficulty tier "${tier}"`)
    }
  }
  if (!Number.isFinite(Number(band.minFigureSizeMm))) {
    problems.push('minFigureSizeMm must be a number')
  }
  return problems
}
