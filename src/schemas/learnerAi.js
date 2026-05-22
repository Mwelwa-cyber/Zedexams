/**
 * src/schemas/learnerAi.js
 *
 * Canonical Zod schemas + types for the learner-AI agent pipeline.
 * Single source of truth for all 10 collections; both client (SPA) and
 * server (Cloud Functions) import from here so the wire format can't
 * drift between writers and readers.
 *
 * The 10 collections this module owns:
 *
 *   1. aiAgentTasks          — the queue: every agent run starts here
 *   2. aiAgentLogs           — append-only audit log (NOT supervisor decisions)
 *   3. aiGeneratedContent    — published / draft AI artifacts for learners
 *   4. aiLiveAgentStates     — one doc per agent, heartbeat + current task
 *   5. aiTaskSteps           — flat step records (one row per agent run step)
 *   6. aiAgentControls       — circuit breaker per agent
 *   7. aiSupervisorLogs      — Supervisor's pass/reject decisions, separate
 *                              from aiAgentLogs because they're scarcer +
 *                              carry a confidence score
 *   8. curriculumUpdateReports — Curriculum Watcher's daily output
 *   9. assessmentStandards   — Zambian exam structure per grade × subject
 *  10. learnerWeaknessProfiles — per-learner weakness rollup
 *
 * Conventions:
 *   - Every schema exports a `*WriteSchema` (strict, used before writes)
 *     and the inferred type is consumed via JSDoc `@typedef`.
 *   - Status enums are exported as plain string-union Zod enums so
 *     UIs can iterate them for pills, filters, etc.
 *   - Timestamps are `z.unknown()` because client uses
 *     `serverTimestamp()` (a sentinel) while server uses
 *     `admin.firestore.FieldValue.serverTimestamp()` or `Timestamp`
 *     instances — both must validate.
 *
 * Type exports (via JSDoc @typedef + z.infer):
 *   AiAgentTask, AiAgentLog, AiGeneratedContent, AiLiveAgentState,
 *   AiTaskStep, AiAgentControl, AiSupervisorLog,
 *   CurriculumUpdateReport, AssessmentStandard, LearnerWeaknessProfile
 */

import { z } from 'zod'

// ── Timestamp ─────────────────────────────────────────────────────
// Accept anything truthy that smells like a timestamp. Firestore
// serverTimestamp() returns a sentinel; reads return a Timestamp object.
// Validate by presence here; deeper validation happens at the rules layer.
const timestampish = z.unknown().refine(v => v != null, {
  message: 'expected a timestamp value (serverTimestamp sentinel, Timestamp, or Date)',
})

// ── Shared enums hoisted above the schemas that reference them ─────
// ASSESSMENT_TYPES is declared again on assessmentStandardWriteSchema
// below — exports are deduplicated by JS, this is just the earliest
// position where aiAgentTaskWriteSchema can pin its assessmentType
// field to the same enum.
export const ASSESSMENT_TYPES = z.enum([
  'practice_quiz', 'topic_test', 'monthly_test', 'midterm_test',
  'end_of_term_test', 'composite_exam',
])

// ── 1. aiAgentTasks ───────────────────────────────────────────────

export const TASK_TYPES = z.enum([
  'practice_quiz',
  'exam_quiz',
  'notes',
  'study_tips',
  'weakness_analysis',
  'learner_feedback',
  'curriculum_update_check',
])

export const TASK_STATUSES = z.enum([
  'queued',
  'running',
  'thinking',
  'generating',
  'checking',
  'waiting',
  'completed',
  'passed_quality_check',
  'failed_quality_check',
  'needs_review',
  'approved',
  'published',
  'rejected',
  'regenerating',
  'error',
])

export const aiAgentTaskWriteSchema = z.object({
  taskType: TASK_TYPES,
  agentName: z.string().min(1).max(80),
  status: TASK_STATUSES,
  grade: z.string().max(8).nullable(),
  subject: z.string().max(80).nullable(),
  term: z.string().max(8).nullable(),
  topic: z.string().max(200).nullable(),
  subtopic: z.string().max(200).nullable(),
  lessonNumber: z.number().int().min(1).max(60).nullable(),
  // assessmentType is consumed by the Standards + Exam Quiz agents.
  // Other task types ignore it; it's nullable so practice_quiz / notes
  // / study_tips tasks don't have to set it. Pinned to the same
  // ASSESSMENT_TYPES enum used by assessmentStandards.
  assessmentType: ASSESSMENT_TYPES.nullable(),
  // Optional generator parameters bag — opaque to the task schema,
  // validated by each task type's own parameters schema (e.g.
  // practiceQuizParametersSchema below) inside the runner. Keeping this
  // generic on the task doc means new task types don't have to expand
  // aiAgentTaskWriteSchema every time. .optional() so older / simpler
  // task types can omit the field; .nullable() so callers can
  // explicitly set null when their type has no params.
  parameters: z.object({}).passthrough().nullable().optional(),
  startedAt: timestampish.nullable(),
  completedAt: timestampish.nullable(),
  resultContentId: z.string().max(120).nullable(),
  errorMessage: z.string().max(2000).nullable(),
  createdAt: timestampish,
  updatedAt: timestampish,
}).strict()

/** @typedef {import('zod').infer<typeof aiAgentTaskWriteSchema>} AiAgentTask */

// State-machine guard. The dispatcher uses this to refuse stale or
// illegal transitions before writing.
const TASK_TRANSITIONS = /** @type {const} */ ({
  queued:                  ['running', 'cancelled', 'error'],
  running:                 ['thinking', 'generating', 'checking', 'waiting', 'completed', 'error'],
  thinking:                ['generating', 'checking', 'waiting', 'error'],
  generating:              ['checking', 'passed_quality_check', 'failed_quality_check', 'error'],
  checking:                ['passed_quality_check', 'failed_quality_check', 'error'],
  waiting:                 ['running', 'error'],
  completed:               ['needs_review'],
  passed_quality_check:    ['needs_review', 'approved', 'published'],
  failed_quality_check:    ['regenerating', 'rejected'],
  needs_review:            ['approved', 'rejected', 'regenerating'],
  approved:                ['published'],
  published:               [],
  rejected:                ['regenerating'],
  regenerating:            ['running', 'error'],
  error:                   ['queued', 'rejected'],
})

export function canTransitionTaskStatus(from, to) {
  if (from === to) return true
  const allowed = TASK_TRANSITIONS[from]
  return Array.isArray(allowed) && allowed.includes(to)
}

// ── 2. aiAgentLogs ────────────────────────────────────────────────

export const LOG_SEVERITY = z.enum(['info', 'warning', 'error'])

export const aiAgentLogWriteSchema = z.object({
  taskId: z.string().min(1).max(120),
  agentName: z.string().min(1).max(80),
  action: z.string().min(1).max(80),
  message: z.string().max(2000),
  taskType: z.string().max(64),
  grade: z.string().max(8).nullable(),
  subject: z.string().max(80).nullable(),
  topic: z.string().max(200).nullable(),
  severity: LOG_SEVERITY,
  createdAt: timestampish,
}).strict()

/** @typedef {import('zod').infer<typeof aiAgentLogWriteSchema>} AiAgentLog */

// ── 3. aiGeneratedContent ─────────────────────────────────────────

export const GENERATED_CONTENT_TYPES = z.enum([
  'practice_quiz', 'exam_quiz', 'notes', 'study_tips', 'learner_feedback',
])

export const GENERATED_CONTENT_STATUSES = z.enum([
  'draft', 'needs_review', 'approved', 'published', 'rejected', 'regenerate_required',
])

export const curriculumReferenceSchema = z.object({
  documentPath: z.string().min(1).max(500),
  competency: z.string().max(400),
  learningOutcome: z.string().max(400).nullable(),
  sourceVersion: z.string().max(80).nullable(),
}).strict()

export const aiGeneratedContentWriteSchema = z.object({
  type: GENERATED_CONTENT_TYPES,
  source: z.literal('ai'),
  status: GENERATED_CONTENT_STATUSES,
  grade: z.string().min(1).max(8),
  subject: z.string().min(1).max(80),
  term: z.string().max(8),
  topic: z.string().max(200),
  subtopic: z.string().max(200),
  lessonNumber: z.number().int().min(1).max(60).nullable(),
  curriculumReference: curriculumReferenceSchema,
  // Content shape is type-specific — validate as an object of any shape
  // here, but the runner-level schemas under
  // functions/agents/learnerAi/schemas/* constrain per artifact.
  content: z.object({}).passthrough(),
  qualityCheck: z.object({}).passthrough(),
  zambianStandardsCheck: z.object({}).passthrough(),
  supervisorDecision: z.object({}).passthrough(),
  version: z.number().int().min(1),
  createdBy: z.literal('ai'),
  reviewedBy: z.string().max(120).nullable(),
  createdAt: timestampish,
  updatedAt: timestampish,
}).strict()

/** @typedef {import('zod').infer<typeof aiGeneratedContentWriteSchema>} AiGeneratedContent */

// ── 4. aiLiveAgentStates ──────────────────────────────────────────

export const LIVE_AGENT_STATUSES = z.enum([
  'idle', 'queued', 'running', 'thinking', 'generating', 'checking',
  'waiting', 'completed', 'failed', 'needs_review', 'approved', 'published',
])

export const aiLiveAgentStateWriteSchema = z.object({
  agentName: z.string().min(1).max(80),
  status: LIVE_AGENT_STATUSES,
  currentTaskId: z.string().max(120).nullable(),
  currentTask: z.string().max(200).nullable(),
  progress: z.number().min(0).max(100),
  grade: z.string().max(8).nullable(),
  subject: z.string().max(80).nullable(),
  term: z.string().max(8).nullable(),
  topic: z.string().max(200).nullable(),
  subtopic: z.string().max(200).nullable(),
  lastMessage: z.string().max(500).nullable(),
  updatedAt: timestampish,
}).strict()

/** @typedef {import('zod').infer<typeof aiLiveAgentStateWriteSchema>} AiLiveAgentState */

// ── 5. aiTaskSteps ────────────────────────────────────────────────

export const TASK_STEP_STATUSES = z.enum([
  'queued', 'running', 'completed', 'failed', 'skipped',
])

export const aiTaskStepWriteSchema = z.object({
  taskId: z.string().min(1).max(120),
  agentName: z.string().min(1).max(80),
  stepNumber: z.number().int().min(1).max(200),
  stepTitle: z.string().min(1).max(200),
  message: z.string().max(2000),
  status: TASK_STEP_STATUSES,
  progress: z.number().min(0).max(100),
  createdAt: timestampish,
}).strict()

/** @typedef {import('zod').infer<typeof aiTaskStepWriteSchema>} AiTaskStep */

// ── 6. aiAgentControls ────────────────────────────────────────────

export const aiAgentControlWriteSchema = z.object({
  enabled: z.boolean(),
  paused: z.boolean(),
  pauseReason: z.string().max(500).nullable(),
  updatedBy: z.string().min(1).max(120),
  updatedAt: timestampish,
}).strict()

/** @typedef {import('zod').infer<typeof aiAgentControlWriteSchema>} AiAgentControl */

// ── 7. aiSupervisorLogs ───────────────────────────────────────────

export const SUPERVISOR_ACTIONS = z.enum([
  'approved', 'rejected', 'sent_for_review', 'regenerate_required',
])

export const aiSupervisorLogWriteSchema = z.object({
  taskId: z.string().min(1).max(120),
  agentName: z.string().min(1).max(80),
  contentType: z.string().min(1).max(64),
  grade: z.string().min(1).max(8),
  subject: z.string().min(1).max(80),
  term: z.string().max(8),
  topic: z.string().max(200),
  subtopic: z.string().max(200),
  actionTaken: SUPERVISOR_ACTIONS,
  reason: z.string().max(2000),
  confidenceScore: z.number().min(0).max(1),
  checkedBy: z.literal('AI Supervisor Agent'),
  createdAt: timestampish,
}).strict()

/** @typedef {import('zod').infer<typeof aiSupervisorLogWriteSchema>} AiSupervisorLog */

// ── 8. curriculumUpdateReports ────────────────────────────────────

export const TRUST_LEVELS = z.enum(['very_high', 'high', 'medium', 'low'])
export const CURRICULUM_UPDATE_TYPES = z.enum([
  'syllabus', 'exam_timetable', 'subject_structure',
  'grade_structure', 'assessment_format',
])
export const CURRICULUM_REPORT_STATUSES = z.enum([
  'pending_review', 'approved', 'rejected', 'applied',
])

export const curriculumUpdateReportWriteSchema = z.object({
  sourceName: z.string().min(1).max(200),
  sourceUrl: z.string().url().max(500),
  trustLevel: TRUST_LEVELS,
  updateType: CURRICULUM_UPDATE_TYPES,
  affectedGrades: z.array(z.string().max(8)).max(20),
  affectedSubjects: z.array(z.string().max(80)).max(40),
  summary: z.string().max(2000),
  recommendation: z.string().max(2000),
  status: CURRICULUM_REPORT_STATUSES,
  checkedAt: timestampish,
  reviewedBy: z.string().max(120).nullable(),
  reviewedAt: timestampish.nullable(),
}).strict()

/** @typedef {import('zod').infer<typeof curriculumUpdateReportWriteSchema>} CurriculumUpdateReport */

// ── 9. assessmentStandards ────────────────────────────────────────

export const SCHOOL_LEVELS = z.enum([
  'primary', 'junior_secondary', 'senior_secondary',
])
// ASSESSMENT_TYPES is hoisted near the top of the file so
// aiAgentTaskWriteSchema can reference it.

export const assessmentStandardWriteSchema = z.object({
  country: z.literal('Zambia'),
  level: SCHOOL_LEVELS,
  grade: z.string().min(1).max(8),
  subject: z.string().min(1).max(80),
  assessmentType: ASSESSMENT_TYPES,
  structure: z.object({
    headerFields: z.array(z.string().max(200)).max(40),
    sections: z.array(z.object({}).passthrough()).max(40),
    instructions: z.array(z.string().max(500)).max(40),
    // Free-form because mark distribution shape varies by paper type.
    markDistribution: z.object({}).passthrough(),
    timeLimit: z.string().max(40),
  }).strict(),
  sourceReference: z.string().max(500),
  approvedByAdmin: z.boolean(),
  updatedAt: timestampish,
}).strict()

/** @typedef {import('zod').infer<typeof assessmentStandardWriteSchema>} AssessmentStandard */

// ── 10. learnerWeaknessProfiles ───────────────────────────────────

export const learnerWeaknessProfileWriteSchema = z.object({
  learnerId: z.string().min(1).max(120),
  grade: z.string().min(1).max(8),
  subject: z.string().min(1).max(80),
  // The free-form lists below are intentionally flexible: rollup shape
  // evolves as the Weakness Detection agent matures. Cap sizes so the
  // doc stays well under Firestore's 1 MiB ceiling.
  weakTopics: z.array(z.string().max(200)).max(200),
  weakSubtopics: z.array(z.string().max(200)).max(400),
  repeatedMistakes: z.array(z.object({}).passthrough()).max(200),
  recommendedNotes: z.array(z.string().max(200)).max(100),
  recommendedQuizzes: z.array(z.string().max(200)).max(100),
  lastUpdated: timestampish,
}).strict()

/** @typedef {import('zod').infer<typeof learnerWeaknessProfileWriteSchema>} LearnerWeaknessProfile */

// ── Curriculum Reader Agent — public output contract ─────────────────
//
// NOT a Firestore collection — this is the in-memory shape returned
// by `runCurriculumReader` to the dispatcher and stashed at
// `chainContext.curriculumReader` for every downstream agent to read.
// The slim audit slice persisted onto aiGeneratedContent.curriculumReference
// is curriculumReferenceSchema above; THIS schema is the richer
// runtime surface (competencies/learningOutcomes/keyConcepts/etc.).

export const CURRICULUM_READER_STATUSES = z.enum(['ok', 'needs_review'])
export const CURRICULUM_READER_MATCH_KINDS = z.enum(['subtopic_exact', 'topic_only'])

export const curriculumReaderCitedExcerptSchema = z.object({
  text: z.string().min(1).max(480),
  anchor: z.string().max(80),
}).strict()

export const curriculumReaderSourceChecksumSchema = z.object({
  storagePath: z.string().max(500),
  sha256: z.string().max(120),
}).strict()

export const curriculumReaderOutputSchema = z.object({
  // Echoed-back inputs so downstream agents can grab everything they
  // need off one object without re-reading the task doc.
  grade: z.string().min(1).max(8),
  subject: z.string().min(1).max(80),
  term: z.string().max(8).nullable(),
  topic: z.string().min(1).max(200),
  subtopic: z.string().max(200).nullable(),
  lessonNumber: z.number().int().min(1).max(60).nullable(),
  assessmentType: ASSESSMENT_TYPES.nullable(),

  // Structured curriculum context — what the user asked for.
  competencies: z.array(z.string().max(400)).max(40),
  learningOutcomes: z.array(z.string().max(400)).max(40),
  keyConcepts: z.array(z.string().max(200)).max(40),
  suggestedContent: z.array(z.string().max(400)).max(40),

  // Provenance of the source document this output was projected from.
  // documentPath is the Storage path of the approved syllabus; version
  // is the cbcKnowledgeBase version tag (KB_VERSION).
  curriculumDocumentPath: z.string().max(500),
  curriculumVersion: z.string().max(80),

  // 0..1, monotone in match quality. < 0.6 → status='needs_review'.
  // Formula documented on computeConfidenceScore() in the runner.
  confidenceScore: z.number().min(0).max(1),

  // Tri-state outcome flag. Hard errors return ok:false from the
  // runner — they never produce a CurriculumReaderOutput.
  status: CURRICULUM_READER_STATUSES,
  matchKind: CURRICULUM_READER_MATCH_KINDS,

  // Internal-but-typed: Quality Check consumes citedExcerpts to do
  // its deterministic substring-grounding pass; sourceChecksums prove
  // the bytes of the syllabus the Reader saw. The slim
  // aiGeneratedContent.curriculumReference audit field doesn't carry
  // these — only this in-memory object does.
  citedExcerpts: z.array(curriculumReaderCitedExcerptSchema).max(20),
  sourceChecksums: z.array(curriculumReaderSourceChecksumSchema).max(10),
  sourceDocId: z.string().max(120),
  moduleId: z.string().max(120),
}).strict()

/** @typedef {import('zod').infer<typeof curriculumReaderOutputSchema>} CurriculumReaderOutput */

// ── Collection ↔ schema map (use for generic validators / migrations) ─

export const COLLECTION_SCHEMAS = Object.freeze({
  aiAgentTasks:            aiAgentTaskWriteSchema,
  aiAgentLogs:             aiAgentLogWriteSchema,
  aiGeneratedContent:      aiGeneratedContentWriteSchema,
  aiLiveAgentStates:       aiLiveAgentStateWriteSchema,
  aiTaskSteps:             aiTaskStepWriteSchema,
  aiAgentControls:         aiAgentControlWriteSchema,
  aiSupervisorLogs:        aiSupervisorLogWriteSchema,
  curriculumUpdateReports: curriculumUpdateReportWriteSchema,
  assessmentStandards:     assessmentStandardWriteSchema,
  learnerWeaknessProfiles: learnerWeaknessProfileWriteSchema,
})

// ── Practice Quiz Generator Agent — content + parameters ─────────────
//
// NOT a Firestore collection. These schemas validate the structured
// quiz payload the Practice Quiz Generator produces (stored on
// aiGeneratedContent.content) and the parameters it accepts off
// aiAgentTasks.parameters. Imported by the SPA (when learners trigger
// generation, to pre-flight the params) and by the server runner.

export const QUIZ_QUESTION_TYPES = z.enum([
  'mcq', 'true_false', 'short_answer', 'matching',
])
export const QUIZ_DIFFICULTIES = z.enum(['easy', 'medium', 'hard'])
// 'mixed' is allowed on the params but each individual question must
// resolve to one of the three concrete levels above.
export const QUIZ_DIFFICULTY_PARAMS = z.enum(['easy', 'medium', 'hard', 'mixed'])
export const PRACTICE_QUIZ_MODES = z.enum([
  'topic', 'subtopic', 'lesson', 'revision',
])

export const matchingPairSchema = z.object({
  left: z.string().min(1).max(200),
  right: z.string().min(1).max(200),
}).strict()

export const practiceQuizQuestionSchema = z.object({
  questionText: z.string().min(1).max(800),
  questionType: QUIZ_QUESTION_TYPES,
  // For mcq/true_false: choice strings.
  // For short_answer:  [] (no options).
  // For matching:      [] (pairs live on `matchingPairs` below).
  options: z.array(z.string().min(1).max(200)).max(6),
  // For mcq:           the correct option text (must appear in options[]).
  // For true_false:    'True' | 'False'.
  // For short_answer:  the canonical answer string.
  // For matching:      [] (matchingPairs encodes the answer key).
  correctAnswer: z.string().max(400),
  matchingPairs: z.array(matchingPairSchema).max(8).optional(),
  explanation: z.string().min(1).max(800),
  difficulty: QUIZ_DIFFICULTIES,
  marks: z.number().int().min(1).max(10),
  // Curriculum echo — stamped by the runner from chainContext.curriculumReader
  // so each question is self-contained for the learner UI without a
  // second Firestore read.
  grade: z.string().min(1).max(8),
  subject: z.string().min(1).max(80),
  term: z.string().max(8).nullable(),
  topic: z.string().min(1).max(200),
  subtopic: z.string().max(200).nullable(),
  competency: z.string().max(400),
  learningOutcome: z.string().max(400).nullable(),
  // Grounding pointer — index into curriculumReader.citedExcerpts so
  // Quality Check can substring-match the question against the source.
  groundingIndex: z.number().int().min(0).max(50),
}).strict()

/** @typedef {import('zod').infer<typeof practiceQuizQuestionSchema>} PracticeQuizQuestion */

export const practiceQuizContentSchema = z.object({
  // Top-level metadata the learner UI can render without parsing questions.
  title: z.string().min(1).max(200),
  description: z.string().max(800),
  mode: PRACTICE_QUIZ_MODES,
  difficulty: QUIZ_DIFFICULTY_PARAMS,
  totalMarks: z.number().int().min(1).max(500),
  estimatedMinutes: z.number().int().min(1).max(180),
  questions: z.array(practiceQuizQuestionSchema).min(1).max(50),
  // Provenance — the LLM model that wrote this (or 'stub' for fallbacks
  // when ANTHROPIC_API_KEY is absent / disabled). Quality Check uses
  // this to decide whether the deterministic grounding pass is enough
  // or it also needs a Haiku nuance score.
  modelUsed: z.string().max(80),
  // Echo of the generator parameters, useful for filterable history
  // ("show me my last 10 lesson-2 revision quizzes").
  parametersUsed: z.object({}).passthrough(),
}).strict()

/** @typedef {import('zod').infer<typeof practiceQuizContentSchema>} PracticeQuizContent */

export const practiceQuizParametersSchema = z.object({
  numQuestions: z.number().int().min(1).max(50).default(10),
  difficulty: QUIZ_DIFFICULTY_PARAMS.default('mixed'),
  mode: PRACTICE_QUIZ_MODES.default('topic'),
  // For mode='revision' the runner consults learnerWeaknessProfiles to
  // pick weak topics; weakLearnerId is the learner whose profile to read.
  // Other modes ignore it. Optional (nullable) because most queue writes
  // won't supply it.
  weakLearnerId: z.string().max(120).nullable().default(null),
  // For mode='lesson', narrows generation to the specific KB lesson.
  // The runner will refuse the task if the resolver can't honor it.
  lessonNumber: z.number().int().min(1).max(60).nullable().default(null),
  // Allowed question types — defaults to all four. Lets a caller scope
  // a quiz to e.g. just MCQs for a primary-school audience.
  allowedQuestionTypes: z.array(QUIZ_QUESTION_TYPES).min(1).default(
    ['mcq', 'true_false', 'short_answer', 'matching'],
  ),
}).strict()

/** @typedef {import('zod').infer<typeof practiceQuizParametersSchema>} PracticeQuizParameters */

// ── Exam Quiz Generator Agent — content + parameters ─────────────────
//
// NOT a Firestore collection. Validates the formal Zambian school
// test paper the Exam Quiz Generator produces (stored on
// aiGeneratedContent.content for taskType='exam_quiz' artifacts).
//
// Three-section structure (Section A: MCQ, Section B: Short Answer,
// Section C: Structured Questions) matches the standard ECZ /
// internal school paper layout. Each section carries its own questions,
// per-question marks, and an answer-key entry. Printable header
// (school, grade, term, year, subject, learner name, date, time,
// total marks, instructions) is rendered once at the top.
//
// Hard rule: exam_quiz artifacts NEVER auto-publish. The dispatcher
// gate at functions/agents/learnerAi/dispatcher.js explicitly checks
// taskType === 'practice_quiz' before allowing auto-publish; this is
// enforced by a unit test (scripts/test-exam-quiz-generator.mjs).

export const EXAM_SECTION_IDS = z.enum(['A', 'B', 'C'])
// 'A' = Multiple Choice, 'B' = Short Answer, 'C' = Structured.
// Pinned as ASCII letters because the printable header uses them
// verbatim ("Section A — Multiple Choice (20 marks)").

export const EXAM_QUESTION_TYPES = z.enum([
  'mcq',            // Section A
  'short_answer',   // Section B
  'structured',     // Section C (multi-part)
])

// One sub-question inside a Section C structured item. A structured
// question carries 2-6 sub-parts (a), (b), (c), each with its own
// prompt, mark allocation, and answer-key entry.
export const examStructuredPartSchema = z.object({
  label: z.string().min(1).max(8),         // 'a', 'b', '(i)' etc.
  prompt: z.string().min(1).max(800),
  marks: z.number().int().min(1).max(20),
  expectedAnswer: z.string().min(1).max(800),
  markingPoints: z.array(z.string().max(300)).max(8),
}).strict()

export const examQuestionSchema = z.object({
  number: z.number().int().min(1).max(100),
  questionType: EXAM_QUESTION_TYPES,
  prompt: z.string().min(1).max(1200),
  // mcq: 4 distinct options, exactly one correctAnswer in options.
  // short_answer: options=[], correctAnswer is canonical answer.
  // structured: options=[], correctAnswer='' (parts carry the key).
  options: z.array(z.string().min(1).max(300)).max(6),
  correctAnswer: z.string().max(800),
  structuredParts: z.array(examStructuredPartSchema).max(6).optional(),
  marks: z.number().int().min(1).max(40),
  // Curriculum echo stamped server-side from chainContext.curriculumReader
  // — saves the LLM prompt tokens and keeps these immutable.
  grade: z.string().min(1).max(8),
  subject: z.string().min(1).max(80),
  term: z.string().max(8).nullable(),
  topic: z.string().min(1).max(200),
  subtopic: z.string().max(200).nullable(),
  competency: z.string().max(400),
  learningOutcome: z.string().max(400).nullable(),
  // Quality Check uses this index to substring-match each question
  // against curriculumReader.citedExcerpts.
  groundingIndex: z.number().int().min(0).max(50),
  // For Section C marking: structured items carry rubric criteria
  // here in addition to the per-part markingPoints.
  bloomsLevel: z.enum([
    'remember', 'understand', 'apply', 'analyze', 'evaluate', 'create',
  ]),
}).strict()

/** @typedef {import('zod').infer<typeof examQuestionSchema>} ExamQuestion */

export const examSectionSchema = z.object({
  id: EXAM_SECTION_IDS,
  title: z.string().min(1).max(120),           // "Section A — Multiple Choice"
  instructions: z.string().max(800),
  marks: z.number().int().min(1).max(200),     // section total marks
  // Section A typically MCQs (5-30), B short answers (3-15),
  // C structured (2-8). Limits below are generous upper bounds.
  questions: z.array(examQuestionSchema).min(1).max(50),
}).strict()

/** @typedef {import('zod').infer<typeof examSectionSchema>} ExamSection */

// Printable paper header — every field rendered once at the top of
// the exam, exactly as a Zambian school paper expects.
export const examPaperHeaderSchema = z.object({
  schoolName: z.string().max(200),
  grade: z.string().min(1).max(8),
  term: z.string().max(8),
  year: z.number().int().min(2020).max(2099),
  subject: z.string().min(1).max(80),
  paperName: z.string().max(200),              // optional, e.g. "Paper 1"
  learnerNameLabel: z.string().max(80),        // label, not a value
  dateLabel: z.string().max(80),
  timeLabel: z.string().max(80),
  totalMarks: z.number().int().min(1).max(500),
  timeAllowed: z.string().min(1).max(80),      // e.g. "2 hours 30 minutes"
  instructions: z.array(z.string().min(1).max(400)).min(1).max(12),
}).strict()

/** @typedef {import('zod').infer<typeof examPaperHeaderSchema>} ExamPaperHeader */

// Answer key + marking guide. Mirrors `questions` in section order
// but is kept separate so the printable paper (header + sections) can
// render without leaking answers.
export const examAnswerKeyEntrySchema = z.object({
  sectionId: EXAM_SECTION_IDS,
  questionNumber: z.number().int().min(1).max(100),
  // For MCQ: the correct option letter (A/B/C/D) AND the option text.
  // For short_answer: the canonical answer.
  // For structured: a structured object encoded as JSON string in
  // `answer`, with each part's expected answer + marking points.
  answer: z.string().min(1).max(2000),
  marks: z.number().int().min(1).max(40),
  markingNotes: z.string().max(800),
}).strict()

export const examQuizContentSchema = z.object({
  header: examPaperHeaderSchema,
  sections: z.array(examSectionSchema).min(1).max(5),
  answerKey: z.array(examAnswerKeyEntrySchema).min(1).max(150),
  // Free-form marking-guide narrative (rubric criteria, awarding
  // policy, half-mark rules). Rendered as a final page of the
  // teacher's copy of the paper.
  markingGuide: z.string().min(1).max(4000),
  // Provenance — same convention as practiceQuizContentSchema. 'stub'
  // when the LLM was unavailable.
  modelUsed: z.string().max(80),
  parametersUsed: z.object({}).passthrough(),
  standardsUsed: z.object({}).passthrough().nullable(),
}).strict()

/** @typedef {import('zod').infer<typeof examQuizContentSchema>} ExamQuizContent */

// Exam quiz generation parameters — drives section sizing, total
// marks, time limit. Allowed assessmentTypes match v2Collections
// ASSESSMENT_TYPES; the runner refuses to generate without one.
export const examQuizParametersSchema = z.object({
  assessmentType: ASSESSMENT_TYPES,
  // Year/school appear on the printed paper. Defaults provided by
  // the runner if absent (current year, schoolName='').
  year: z.number().int().min(2020).max(2099).optional(),
  schoolName: z.string().max(200).default(''),
  paperName: z.string().max(200).default(''),
  // Section sizing — defaults match a typical Zambian end-of-term
  // junior-secondary paper (20 MCQ + 8 short + 3 structured = ~60
  // marks). Caller may override per assessmentType.
  sectionASize: z.number().int().min(1).max(30).default(20),
  sectionBSize: z.number().int().min(1).max(20).default(8),
  sectionCSize: z.number().int().min(1).max(10).default(3),
  totalMarks: z.number().int().min(1).max(500).default(60),
  timeAllowed: z.string().min(1).max(80).default('1 hour 30 minutes'),
}).strict()

/** @typedef {import('zod').infer<typeof examQuizParametersSchema>} ExamQuizParameters */

// ── Zambian Curriculum & Exam Standards CHECK Agent — verdict shape ─
//
// NOT a Firestore collection. This is the verdict the verification
// agent writes onto `aiGeneratedContent.zambianStandardsCheck` after
// running its alignment checks. Distinct from the reference-data
// Standards Agent (which supplies `chainContext.standards` BEFORE
// the generator runs) — the verification agent runs AFTER the
// generator and reports back to the AI Supervisor with this verdict.
//
// Status decision rule (must match the runner's implementation):
//   confidenceScore ≥ 0.80  AND zero critical issues → 'passed'
//   confidenceScore ≥ 0.50  OR  only minor issues   → 'needs_review'
//   otherwise (≥ 1 critical issue OR confidence < 0.50) → 'failed'

export const STANDARDS_CHECK_STATUSES = z.enum([
  'passed', 'failed', 'needs_review',
])

export const STANDARDS_CHECK_ISSUE_SEVERITIES = z.enum([
  'critical', 'minor',
])

// Axes the agent checks against — pinned as an enum so the issues[]
// surface is filterable in the admin UI.
export const STANDARDS_CHECK_AXES = z.enum([
  'grade', 'subject', 'term', 'topic', 'subtopic', 'competency',
  'learning_outcome', 'language', 'age_suitability', 'paper_structure',
  'marks_allocation', 'instructions', 'sections', 'foreign_content',
])

export const standardsCheckIssueSchema = z.object({
  axis: STANDARDS_CHECK_AXES,
  severity: STANDARDS_CHECK_ISSUE_SEVERITIES,
  message: z.string().min(1).max(400),
  // Optional pointer into the artifact (e.g. "sections[0].questions[3]")
  // so admins can jump straight to the offending element. Free-form
  // path string keeps this agnostic of the artifact shape.
  path: z.string().max(200).optional(),
}).strict()

/** @typedef {import('zod').infer<typeof standardsCheckIssueSchema>} StandardsCheckIssue */

export const standardsCheckVerdictSchema = z.object({
  status: STANDARDS_CHECK_STATUSES,
  confidenceScore: z.number().min(0).max(1),
  // Per-axis verdicts so the admin UI can render a checklist without
  // re-parsing the free-form issues[] array. Each axis is 'pass' |
  // 'fail' | 'skip' (skip used when the check is N/A for this artifact
  // type, e.g. paper_structure for a notes artifact).
  checks: z.object({
    grade: z.enum(['pass', 'fail', 'skip']),
    subject: z.enum(['pass', 'fail', 'skip']),
    term: z.enum(['pass', 'fail', 'skip']),
    topic: z.enum(['pass', 'fail', 'skip']),
    subtopic: z.enum(['pass', 'fail', 'skip']),
    competency: z.enum(['pass', 'fail', 'skip']),
    learning_outcome: z.enum(['pass', 'fail', 'skip']),
    language: z.enum(['pass', 'fail', 'skip']),
    age_suitability: z.enum(['pass', 'fail', 'skip']),
    paper_structure: z.enum(['pass', 'fail', 'skip']),
    marks_allocation: z.enum(['pass', 'fail', 'skip']),
    instructions: z.enum(['pass', 'fail', 'skip']),
    sections: z.enum(['pass', 'fail', 'skip']),
    foreign_content: z.enum(['pass', 'fail', 'skip']),
  }).strict(),
  issues: z.array(standardsCheckIssueSchema).max(40),
  recommendations: z.array(z.string().min(1).max(400)).max(20),
  zambianCurriculumFit: z.boolean(),
  zambianAssessmentFit: z.boolean(),
  // Provenance — 'deterministic' when the agent ran without LLM (CI /
  // no-key path); model id when Haiku was consulted for the language
  // + age axes.
  modelUsed: z.string().max(80),
  // Mirror of the artifact type the verdict refers to.
  artifactType: z.string().max(40),
  // Tied to the aiGeneratedContent doc this verdict is attached to.
  contentId: z.string().max(120),
  checkedAt: z.unknown().refine((v) => v != null, {
    message: 'checkedAt must be a timestamp value',
  }),
}).strict()

/** @typedef {import('zod').infer<typeof standardsCheckVerdictSchema>} StandardsCheckVerdict */

/**
 * Parse-or-throw helper. Returns the validated doc body; throws ZodError
 * on bad shape. Use immediately before any addDoc / setDoc / update.
 */
export function validateWrite(collectionName, body) {
  const schema = COLLECTION_SCHEMAS[collectionName]
  if (!schema) {
    throw new Error(`learnerAi schemas: unknown collection "${collectionName}"`)
  }
  return schema.parse(body)
}

/**
 * Safe-parse variant. Returns { success, data, error } — never throws.
 * Useful when you want a structured failure rather than an exception.
 */
export function safeValidateWrite(collectionName, body) {
  const schema = COLLECTION_SCHEMAS[collectionName]
  if (!schema) {
    return { success: false, error: new Error(`unknown collection "${collectionName}"`) }
  }
  return schema.safeParse(body)
}
