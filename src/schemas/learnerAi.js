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
