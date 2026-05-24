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
  // Per-task regeneration counter. Incremented by the dispatcher on
  // each terminal → 'regenerating' transition (admin re-queue). After
  // costGuard.MAX_REGENERATION_ATTEMPTS the dispatcher refuses to
  // re-run the chain — protects against tight regenerate loops
  // burning through the daily question quota. Capped at 20 in the
  // schema for an obvious upper bound.
  regenerationAttempts: z.number().int().min(0).max(20).optional(),
  // Optional admin-typed notes attached to a Regenerate / Edit
  // re-queue. The dispatcher pulls these into the version
  // snapshot's changeReason for audit context.
  regenerateNotes: z.string().max(4000).nullable().optional(),
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
  // Written by the dispatcher when a NEW artifact for the same
  // (grade, subject, topic, subtopic) gets approved + published.
  // The OLD published doc is demoted to 'superseded' so the
  // learner-facing list (filtered to status==published) never shows
  // duplicate entries for the same topic after a regenerate cycle.
  // Learners cannot read superseded docs (rule still requires
  // status==published). Admins keep visibility for audit.
  'superseded',
])

export const curriculumReferenceSchema = z.object({
  documentPath: z.string().min(1).max(500),
  competency: z.string().max(400),
  learningOutcome: z.string().max(400).nullable(),
  sourceVersion: z.string().max(80).nullable(),
}).strict()

// ── Content version history ─────────────────────────────────────────
//
// Append-only audit trail for every `aiGeneratedContent` doc. Records
// one row per change of consequence — generation, admin edit, admin
// re-queue ("regenerated"), approval, publication, rejection. Lets an
// admin compare the AI's first draft against the version that was
// ultimately approved + audit who decided + why.
//
// Hard rules enforced server-side:
//   - All writes happen via the dispatcher / runner / status-change
//     trigger (firestore.rules: write:false; only Cloud Functions with
//     the admin SDK can append).
//   - Read access is admin-only. Learners never see version history.
//   - Approved + published content is NEVER overwritten on its own
//     `aiGeneratedContent` doc; each transition appends a new version
//     row to `aiGeneratedContentVersions/{}` instead. A regenerate
//     creates a NEW `aiGeneratedContent` doc, leaving the old one
//     (and its full version history) preserved.

export const CONTENT_VERSION_CHANGE_TYPES = z.enum([
  // Written when the generator runner emits the artifact (version 1).
  'ai_generated',
  // Reserved for future in-place admin edits. Today admins re-queue
  // via "Edit" which creates a NEW content doc — no direct edits
  // happen yet, so this changeType is unused by current writers.
  'admin_edit',
  // Written when an admin re-queues an existing terminal task
  // (status moves from approved / rejected / needs_review → queued).
  // Documents that the content was deemed insufficient + replaced.
  'regenerated',
  // Written when an admin approves the linked task (task →
  // 'approved'). Snapshots the content at the moment of approval.
  'approved',
  // Written when the dispatcher flips the content doc to
  // 'published' (always after 'approved' for the same content).
  'published',
  // Written when an admin rejects the linked task.
  'rejected',
  // Written when the dispatcher demotes a previously-published doc
  // because a NEW artifact for the same (grade, subject, topic,
  // subtopic) just got approved + published. The OLD doc's content
  // field is unchanged; only its status flips to 'superseded'. The
  // version snapshot captures who superseded it (the new content id
  // lives in changeReason).
  'superseded',
])

export const aiGeneratedContentVersionWriteSchema = z.object({
  contentId: z.string().min(1).max(120),
  version: z.number().int().min(1).max(10_000),
  // Full content snapshot at the moment of the change. Allows two
  // versions to be diffed without re-reading the live `aiGeneratedContent`
  // doc (which only carries the latest state).
  content: z.object({}).passthrough(),
  // `changedBy` is one of:
  //   - 'agent:<agentId>' (e.g. 'agent:practiceQuiz') for generator writes
  //   - 'system' for dispatcher-driven status transitions
  //   - admin uid for in-place edits (when that future path lands)
  changedBy: z.string().min(1).max(120),
  changeType: CONTENT_VERSION_CHANGE_TYPES,
  // Optional admin note (e.g. "Section A Q3 had the wrong answer key").
  changeReason: z.string().max(800).nullable(),
  createdAt: timestampish,
}).strict()

/** @typedef {import('zod').infer<typeof aiGeneratedContentVersionWriteSchema>} AiGeneratedContentVersionWrite */

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
  // Back-link to the source `aiAgentTasks/{}` doc. Powers the rule
  // branch that lets the teacher who queued the task preview the
  // draft before admin approval. Optional + nullable for older docs
  // written before the back-link landed.
  sourceTaskId: z.string().max(120).nullable().optional(),
  // Set by the dispatcher when a NEW artifact for the same
  // (grade, subject, topic, subtopic) gets approved + published.
  // Carries the new doc's id so the audit trail makes the
  // supersede relationship explicit.
  supersededBy: z.string().max(120).nullable().optional(),
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

// Upper bound on how many module manifest entries a single
// curriculumUpdateReports row can carry. Matches SOURCE_FILE_CAP in
// the watcher — if you raise one, raise the other.
const SOURCE_REPORT_MODULE_CAP = 50

export const TRUST_LEVELS = z.enum(['very_high', 'high', 'medium', 'low'])
export const CURRICULUM_UPDATE_TYPES = z.enum([
  'syllabus', 'syllabus_modules', 'exam_timetable', 'subject_structure',
  'grade_structure', 'assessment_format',
])
export const CURRICULUM_REPORT_STATUSES = z.enum([
  'pending_review', 'approved', 'rejected', 'applied', 'superseded',
])

// One row in the ingestion manifest the curriculum watcher attaches to
// each report. Documents the module that was staged into curriculum/
// + rag_chunks/ (or, when `skipped` is true, the reason the file was
// not ingested). The admin review UI renders these so a human can
// promote individual modules into the canonical cbcKnowledgeBase.
const ingestedModuleEntrySchema = z.object({
  docId: z.string().max(64).optional(),
  url: z.string().max(2000),
  kind: z.string().max(16).optional(),
  anchorText: z.string().max(400).optional().nullable(),
  grade: z.number().int().nullable().optional(),
  subject: z.string().max(80).nullable().optional(),
  term: z.number().int().nullable().optional(),
  topic: z.string().max(400).nullable().optional(),
  // Categorical doc type — admins filter the staged queue by this.
  // Detected by curriculumIngester.detectDocumentType().
  documentType: z.enum([
    'scheme_of_work', 'lesson_plan', 'assessment', 'teachers_guide',
    'learners_book', 'syllabus', 'module', 'unknown',
  ]).optional(),
  confidence: z.enum(['high', 'medium', 'low']).optional(),
  chunkCount: z.number().int().nonnegative().optional(),
  skipped: z.boolean().optional(),
  reason: z.string().max(200).optional(),
})

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
  // Optional ingestion fields populated when a crawlEnabled source
  // produced downloadable modules. Absent on detection-only sources.
  ingestedModules: z.array(ingestedModuleEntrySchema).max(SOURCE_REPORT_MODULE_CAP).optional(),
  ingestedModuleCount: z.number().int().nonnegative().optional(),
  ingestedSkippedCount: z.number().int().nonnegative().optional(),
  linksDiscovered: z.number().int().nonnegative().optional(),
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
  // Surfaces when the Curriculum Reader's fuzzy match (`reader.topic`)
  // landed on a different topic than what the requester asked for
  // (`task.topic`). Doesn't fail the chain by itself — flagged as
  // `minor` so admins reviewing low-confidence matches can decide.
  'topic_drift',
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
    topic_drift: z.enum(['pass', 'fail', 'skip']),
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

// ── Quality Check Agent — verdict shape ───────────────────────────────
//
// NOT a Firestore collection. The verdict the Quality Check runner
// writes onto `aiGeneratedContent.qualityCheck` and reports back to
// the AI Supervisor via aiSupervisorLogs.
//
// Distinct from `standardsCheckVerdictSchema`: Standards Check verifies
// *curriculum alignment*, Quality Check verifies *content quality + safety*.
// They run in this order: generator → standardsCheck → qualityCheck.
//
// Status decision rule (mirrored in the runner):
//   any critical issue OR confidenceScore < 0.5 → 'failed'
//   confidenceScore < 0.8 OR any issues         → 'needs_review'
//   otherwise                                   → 'passed'
//
// requiresHumanReview:
//   true if artifactType === 'exam_quiz'  (rule: exam quizzes always
//                                         require admin review)
//   true if status !== 'passed'
//   true if confidenceScore < 0.8
//   false otherwise

export const QUALITY_CHECK_STATUSES = z.enum([
  'passed', 'failed', 'needs_review',
])

export const QUALITY_CHECK_ISSUE_SEVERITIES = z.enum([
  'critical', 'minor',
])

// Axes checked by the agent. Pinned as an enum so the admin UI can
// filter issues per axis. Per-artifact-type axes (`notes_*`,
// `tips_*`, `quiz_*`) only fire for their respective types; others
// are universal.
export const QUALITY_CHECK_AXES = z.enum([
  // Universal
  'required_fields',
  'completeness',
  'spelling_grammar',
  'topic_match',
  'grade_suitability',
  'difficulty_consistency',
  'diagram_required',
  'grounding',
  'ambiguity',
  // Quiz-specific
  'correct_answer_exists',
  'correct_answer_in_options',
  'duplicate_options',
  'options_too_similar',
  'single_correct_answer',
  'explanations_present',
  'explanation_matches_answer',
  // Exam-paper-specific
  'marks_allocation',
  'sections_present',
  'answer_key_complete',
  'marking_guide_present',
  // Notes-specific
  'notes_simple',
  'notes_length',
  'notes_match_topic',
  // Study-tips-specific
  'tips_useful',
  'tips_actionable',
])

export const qualityCheckIssueSchema = z.object({
  axis: QUALITY_CHECK_AXES,
  severity: QUALITY_CHECK_ISSUE_SEVERITIES,
  message: z.string().min(1).max(400),
  // Optional pointer into the artifact (e.g. "questions[3].options") so
  // admins can jump straight to the offending element.
  path: z.string().max(200).optional(),
}).strict()

/** @typedef {import('zod').infer<typeof qualityCheckIssueSchema>} QualityCheckIssue */

export const qualityCheckVerdictSchema = z.object({
  status: QUALITY_CHECK_STATUSES,
  confidenceScore: z.number().min(0).max(1),
  issues: z.array(qualityCheckIssueSchema).max(60),
  // Specific, actionable fixes — one per issue. The admin UI surfaces
  // these as a TODO list next to each issue.
  fixedSuggestions: z.array(z.string().min(1).max(400)).max(60),
  requiresHumanReview: z.boolean(),
  // Provenance + audit trail.
  modelUsed: z.string().max(80),
  artifactType: z.string().max(40),
  contentId: z.string().max(120),
  // Carried forward by the dispatcher so the auto-publish gate can
  // refuse anything that fails Quality Check, regardless of the
  // task status the dispatcher inferred.
  verifierVerdict: z.enum(['pass', 'fail', 'stub_no_llm_yet']),
  // Deterministic grounding result — kept for backward compat with
  // the pre-#543 Quality Check shape that callers may read.
  deterministicGroundingPass: z.boolean(),
  checkedAt: z.unknown().refine((v) => v != null, {
    message: 'checkedAt must be a timestamp value',
  }),
}).strict()

/** @typedef {import('zod').infer<typeof qualityCheckVerdictSchema>} QualityCheckVerdict */

// ── AI Supervisor (final gatekeeper) — decision shape ────────────────
//
// NOT a Firestore collection. The decision the Supervisor Review agent
// writes onto `aiGeneratedContent.supervisorDecision` AFTER reviewing
// every upstream verdict (Curriculum Reader, Standards Check, Quality
// Check). Distinct from the orchestrator Supervisor (`runners/supervisor.js`)
// which runs FIRST and only plans the step graph; this verdict comes
// from the gatekeeper that runs LAST.
//
// Decision rules baked into the runner (mirrored on the SPA via Zod):
//   90-100% composite confidence + all checks pass
//     → 'approved'      (if task type + admin settings allow auto-publish)
//     → 'sent_for_review' (if auto-publish not allowed for this type)
//   70-89% composite confidence
//     → 'sent_for_review' (admin must decide)
//   50-69% composite confidence
//     → 'regenerate_required'
//   < 50% composite confidence
//     → 'rejected'
//
// Hard overrides (apply before the confidence band logic above):
//   - any qualityCheck.status === 'failed' AND confidence < 0.5 → 'rejected'
//   - any qualityCheck.status === 'failed' AND confidence ≥ 0.5 → 'regenerate_required'
//   - any standardsCheck.status === 'failed'                    → 'regenerate_required'
//   - taskType === 'exam_quiz'                                  → never 'approved'
//   - taskType === 'curriculum_update_check'                    → never 'approved'
//   - qualityCheck.requiresHumanReview === true                 → never 'approved'

export const SUPERVISOR_DECISIONS = z.enum([
  'approved', 'rejected', 'sent_for_review', 'regenerate_required',
])

export const SUPERVISOR_ADMIN_ACTIONS = z.enum([
  'none',                  // approved — nothing for admin to do
  'approve_or_reject',     // sent_for_review — pending admin decision
  'review_rejection',      // rejected — admin can override / re-queue
  'review_regeneration',   // regenerate_required — admin can re-queue or close
])

export const supervisorDecisionSchema = z.object({
  decision: SUPERVISOR_DECISIONS,
  // Short narrative explaining the decision so admins can sort the
  // queue without opening each artifact.
  reason: z.string().min(1).max(800),
  // Composite confidence — weighted average of the three upstream
  // confidence scores (reader, standardsCheck, qualityCheck). 0..1.
  confidenceScore: z.number().min(0).max(1),
  // Pinned admin-action enum (above). Maps the decision onto a
  // concrete UI affordance.
  requiredAdminAction: SUPERVISOR_ADMIN_ACTIONS,
  // Per-upstream-agent verdict snapshot — frozen at decision time so
  // a future re-read can audit how the call was made even if the
  // upstream verdict docs are later regenerated.
  upstreamVerdicts: z.object({
    curriculumReader: z.object({
      status: z.string().max(40),
      confidenceScore: z.number().min(0).max(1).nullable(),
      matchKind: z.string().max(40).nullable(),
    }).strict(),
    standardsCheck: z.object({
      status: z.string().max(40),
      confidenceScore: z.number().min(0).max(1).nullable(),
      zambianCurriculumFit: z.boolean(),
      zambianAssessmentFit: z.boolean(),
    }).strict(),
    qualityCheck: z.object({
      status: z.string().max(40),
      confidenceScore: z.number().min(0).max(1).nullable(),
      requiresHumanReview: z.boolean(),
      deterministicGroundingPass: z.boolean(),
    }).strict(),
  }).strict(),
  // Provenance + audit.
  modelUsed: z.string().max(80),
  artifactType: z.string().max(40),
  contentId: z.string().max(120),
  // Auto-publish settings snapshot at decision time so admins can
  // see "approved because settings.learnerAi.autoPublishPracticeQuizzes
  // was true on YYYY-MM-DD".
  autoPublishSettings: z.object({}).passthrough().nullable(),
  checkedAt: z.unknown().refine((v) => v != null, {
    message: 'checkedAt must be a timestamp value',
  }),
}).strict()

/** @typedef {import('zod').infer<typeof supervisorDecisionSchema>} SupervisorDecision */

// ── Notes Generator Agent — content + parameters ────────────────────
//
// NOT a Firestore collection. Validates the structured notes payload
// the Notes Generator writes onto aiGeneratedContent.content for
// taskType='notes' artifacts. Carries the user-required sections:
// shortExplanation, keyVocabulary, importantFacts, examples, summary,
// rememberThis, diagramSuggestions, quickRevision.
//
// Also carries a `body` field built by the runner that concatenates
// the structured pieces into one plain-text block. Quality Check v3
// reads `body` for its sentence-length / word-cap / topic-match
// checks, so notes from this generator pass through QC cleanly.

export const NOTES_DETAIL_LEVELS = z.enum(['brief', 'standard', 'detailed'])

export const notesVocabularyEntrySchema = z.object({
  term: z.string().min(1).max(120),
  definition: z.string().min(1).max(400),
}).strict()

export const notesExampleSchema = z.object({
  title: z.string().min(1).max(200),
  explanation: z.string().min(1).max(800),
}).strict()

export const notesContentSchema = z.object({
  title: z.string().min(1).max(200),
  // shortExplanation — 1-3 learner-friendly sentences introducing
  // the topic. Rendered at the top of the notes page.
  shortExplanation: z.string().min(1).max(800),
  keyVocabulary: z.array(notesVocabularyEntrySchema).min(0).max(15),
  importantFacts: z.array(z.string().min(1).max(400)).min(0).max(20),
  examples: z.array(notesExampleSchema).min(0).max(8),
  // Plain-language summary paragraph (≤ 600 chars). Distinct from
  // shortExplanation in that this rounds out the whole topic, not
  // just an intro.
  summary: z.string().min(1).max(800),
  // "Remember this" bullets — short imperative reminders.
  rememberThis: z.array(z.string().min(1).max(300)).min(0).max(10),
  // Optional diagram suggestions. The renderer surfaces these as a
  // sidebar TODO list ("Sketch a number line showing 1/2 and 1/4");
  // no images are stored on aiGeneratedContent — that's a future PR.
  diagramSuggestions: z.array(z.string().min(1).max(300)).min(0).max(8),
  // Quick revision bullets at the end of the notes page — the
  // learner's last-minute cheat sheet.
  quickRevision: z.array(z.string().min(1).max(300)).min(0).max(12),
  // Concatenated plain-text body, built by the runner from the
  // structured fields above. Quality Check v3's notes_simple /
  // notes_length / notes_match_topic axes read this field.
  body: z.string().min(1).max(20_000),
  // Curriculum echo — stamped server-side from chainContext.curriculumReader.
  grade: z.string().min(1).max(8),
  subject: z.string().min(1).max(80),
  term: z.string().max(8).nullable(),
  topic: z.string().min(1).max(200),
  subtopic: z.string().max(200).nullable(),
  competency: z.string().max(400),
  learningOutcome: z.string().max(400).nullable(),
  estimatedReadingMinutes: z.number().int().min(1).max(120),
  // Provenance — 'stub' when ANTHROPIC_API_KEY is absent.
  modelUsed: z.string().max(80),
  parametersUsed: z.object({}).passthrough(),
}).strict()

/** @typedef {import('zod').infer<typeof notesContentSchema>} NotesContent */

export const notesParametersSchema = z.object({
  detailLevel: NOTES_DETAIL_LEVELS.default('standard'),
  includeDiagrams: z.boolean().default(true),
  numExamples: z.number().int().min(1).max(8).default(3),
  numKeyVocabulary: z.number().int().min(1).max(15).default(5),
}).strict()

/** @typedef {import('zod').infer<typeof notesParametersSchema>} NotesParameters */

// ── Study Tips Agent — content + parameters ──────────────────────────
//
// NOT a Firestore collection. Validates the structured payload the
// Study Tips Generator writes onto aiGeneratedContent.content for
// taskType='study_tips' artifacts.
//
// Tips MUST be tied to real learner performance data — the runner
// reads learnerWeaknessProfiles/{learnerId} (or the explicit weakAreas
// supplied on task.parameters) and refuses to generate generic tips.
// Every tip.reason field traces back to one weakSignal entry.

export const STUDY_TIP_PRIORITIES = z.enum(['high', 'medium', 'low'])

export const studyTipWeakSignalSchema = z.object({
  // What kind of weakness this signal came from. 'profile' = from
  // learnerWeaknessProfiles; 'attempt' = from a specific failed quiz
  // attempt; 'parameter' = explicitly passed in by the caller.
  source: z.enum(['profile', 'attempt', 'parameter']),
  // The weak target — topic or subtopic.
  topic: z.string().min(1).max(200),
  subtopic: z.string().max(200).nullable(),
  // Optional explanation pulled from repeatedMistakes (e.g.
  // "confused arteries with veins").
  mistakeNote: z.string().max(400).nullable(),
}).strict()

export const studyTipSchema = z.object({
  // The tip itself — actionable, starts with an imperative verb.
  // Quality Check v3's `tips_actionable` axis enforces this.
  tip: z.string().min(1).max(300),
  // The reason ties the tip back to a weakness signal so admins +
  // learners can see why the tip was offered.
  reason: z.string().min(1).max(400),
  // Pointer at the weak target the tip addresses.
  topic: z.string().min(1).max(200),
  subtopic: z.string().max(200).nullable(),
  priority: STUDY_TIP_PRIORITIES,
  // 2-15 minutes — how long this single tip's activity takes.
  estimatedMinutes: z.number().int().min(2).max(60),
}).strict()

/** @typedef {import('zod').infer<typeof studyTipSchema>} StudyTip */

export const studyTipRecommendedQuizSchema = z.object({
  topic: z.string().min(1).max(200),
  subtopic: z.string().max(200).nullable(),
  focus: z.string().min(1).max(400),
  // Suggested generator parameters the practice-quiz generator can
  // honour if the learner clicks "Try this quiz next" — numQuestions
  // + difficulty hint based on the weakness severity.
  numQuestions: z.number().int().min(3).max(20),
  difficulty: z.enum(['easy', 'medium', 'hard', 'mixed']),
}).strict()

export const studyTipRevisionDaySchema = z.object({
  day: z.number().int().min(1).max(14),
  focus: z.string().min(1).max(200),
  activity: z.string().min(1).max(400),
  estimatedMinutes: z.number().int().min(5).max(120),
}).strict()

export const studyTipsContentSchema = z.object({
  title: z.string().min(1).max(200),
  // Encouraging-but-honest opener. Sets the tone — never sugar-coats
  // a poor performance but never demoralises.
  feedback: z.string().min(1).max(800),
  tips: z.array(studyTipSchema).min(1).max(15),
  recommendedNotes: z.array(z.string().min(1).max(300)).max(10),
  recommendedQuizzes: z.array(studyTipRecommendedQuizSchema).max(6),
  // Day-by-day revision plan, ordered by day. Optional in shape but
  // the runner produces it by default.
  revisionPlan: z.array(studyTipRevisionDaySchema).max(14),
  // Snapshot of the weakness signals consumed — kept on the artifact
  // so admins can audit which performance data shaped the tips.
  weakSignalsUsed: z.array(studyTipWeakSignalSchema).max(40),
  // Curriculum echo — stamped server-side from chainContext.curriculumReader.
  grade: z.string().min(1).max(8),
  subject: z.string().min(1).max(80),
  term: z.string().max(8).nullable(),
  topic: z.string().min(1).max(200),
  subtopic: z.string().max(200).nullable(),
  // Learner this artifact targets. Mirrors task.parameters.weakLearnerId
  // so admin queue filters by learner work.
  learnerId: z.string().max(120),
  modelUsed: z.string().max(80),
  parametersUsed: z.object({}).passthrough(),
}).strict()

/** @typedef {import('zod').infer<typeof studyTipsContentSchema>} StudyTipsContent */

export const studyTipsParametersSchema = z.object({
  // Required — the runner refuses if not set.
  weakLearnerId: z.string().min(1).max(120),
  maxTips: z.number().int().min(3).max(15).default(6),
  includeRevisionPlan: z.boolean().default(true),
  planDurationDays: z.number().int().min(3).max(14).default(7),
  // Optional explicit weak-areas seed — bypasses the
  // learnerWeaknessProfiles lookup when set. Useful for one-off
  // catch-up plans an admin queues for a learner whose profile
  // hasn't been built yet.
  weakAreas: z.array(z.object({
    topic: z.string().min(1).max(200),
    subtopic: z.string().max(200).nullable().optional(),
    mistakeNote: z.string().max(400).nullable().optional(),
  })).max(20).optional(),
}).strict()

/** @typedef {import('zod').infer<typeof studyTipsParametersSchema>} StudyTipsParameters */

// ── Learner Feedback Agent — content + parameters ───────────────────
//
// NOT a Firestore collection. Validates the structured feedback the
// Learner Feedback Generator writes onto aiGeneratedContent.content
// for taskType='learner_feedback' artifacts. One artifact per
// completed quiz attempt.
//
// Rules baked into the schema + runner:
//   - Feedback is tied to ONE specific attempt (attemptId required).
//   - Feedback consumes learnerWeaknessProfiles + the attempt's own
//     topicScores — NEVER guessed.
//   - Tone is honest+encouraging; no fake praise, no shaming. The
//     runner's structured-stub fallback enforces this in deterministic
//     output; the LLM prompt enforces it for live output; the Quality
//     Check + Standards Check agents verify it on the way through.

export const FEEDBACK_TONES = z.enum([
  // Tone label echoed onto the artifact so admins can see what
  // posture the agent took. Picked deterministically from the score.
  'celebratory',     // ≥ 85%
  'positive',        // 70-84%
  'balanced',        // 50-69%
  'supportive',      // 30-49%
  'gentle',          // < 30%
])

export const feedbackCorrectiveExplanationSchema = z.object({
  topic: z.string().min(1).max(200),
  subtopic: z.string().max(200).nullable(),
  // What the learner likely got wrong + a short, age-appropriate
  // explanation of the correct concept. Keeps the misconception
  // bound to a real topic (no "guess what you got wrong" prose).
  whatToCorrect: z.string().min(1).max(400),
  briefExplanation: z.string().min(1).max(600),
}).strict()

export const feedbackRecommendedQuizSchema = z.object({
  topic: z.string().min(1).max(200),
  subtopic: z.string().max(200).nullable(),
  focus: z.string().min(1).max(400),
  numQuestions: z.number().int().min(3).max(15),
  difficulty: z.enum(['easy', 'medium', 'hard', 'mixed']),
}).strict()

export const learnerFeedbackContentSchema = z.object({
  // Display title — e.g. "Your Fractions quiz results".
  title: z.string().min(1).max(200),
  // Honest score block — score / outOf / percentage so the UI can
  // render either fraction or percentage without recomputing.
  score: z.object({
    score: z.number().min(0).max(1000),
    outOf: z.number().min(1).max(1000),
    percentage: z.number().min(0).max(100),
  }).strict(),
  tone: FEEDBACK_TONES,
  // Encouraging-but-honest opener — the "Good work. You scored 7/10."
  // line from the spec example.
  encouragingMessage: z.string().min(1).max(600),
  // Strengths — topics the learner did well on (≥ 70% on this
  // attempt). Empty array is valid when the learner scored low
  // everywhere; the runner does not invent strengths.
  strengths: z.array(z.string().min(1).max(200)).max(10),
  // Weak areas — topics under 70% on this attempt OR from the
  // weakness profile. Same no-fabrication rule.
  weakAreas: z.array(z.string().min(1).max(200)).max(10),
  correctiveExplanations: z.array(feedbackCorrectiveExplanationSchema).max(8),
  recommendedNotes: z.array(z.string().min(1).max(300)).max(6),
  recommendedQuizzes: z.array(feedbackRecommendedQuizSchema).max(4),
  // One actionable study tip — verb-led, specific to a weak area.
  // Optional when there are no weak areas (rare — learner aced it).
  studyTip: z.string().max(300).nullable(),
  // Curriculum echo (from the quiz the attempt came from).
  grade: z.string().min(1).max(8),
  subject: z.string().min(1).max(80),
  term: z.string().max(8).nullable(),
  topic: z.string().min(1).max(200),
  subtopic: z.string().max(200).nullable(),
  // Audit linkage — the attempt this feedback is about + the
  // learner it's addressed to. Used by the dashboard query
  // ("show me my feedback for attempt X").
  learnerId: z.string().max(120),
  attemptId: z.string().max(120),
  quizId: z.string().max(120),
  modelUsed: z.string().max(80),
  parametersUsed: z.object({}).passthrough(),
}).strict()

/** @typedef {import('zod').infer<typeof learnerFeedbackContentSchema>} LearnerFeedbackContent */

export const learnerFeedbackParametersSchema = z.object({
  // Both REQUIRED — feedback is tied to ONE specific attempt.
  learnerId: z.string().min(1).max(120),
  attemptId: z.string().min(1).max(120),
  // Optional: how many corrective explanations to include. Defaults
  // to all weak areas, capped at 8 by the content schema.
  maxCorrectiveExplanations: z.number().int().min(1).max(8).default(4),
}).strict()

/** @typedef {import('zod').infer<typeof learnerFeedbackParametersSchema>} LearnerFeedbackParameters */

// ── Automation rules + scheduling ────────────────────────────────────
//
// New as of the Automation Rules PR. Lives at aiAutomationSettings/global
// (separate from the existing settings/global.learnerAi.* per-task
// auto-publish flags — those stay where they are per the user's
// chosen split: keep both docs side-by-side).
//
// `requireAdminApprovalForExamQuizzes` + `requireAdminApprovalForCurriculumUpdates`
// are pinned to literal `true` — the dispatcher refuses to load a
// settings doc whose Zod parse fails, so an admin editing the doc
// via the Firestore Console can't silently flip these off.
//
// `enabledGrades` + `enabledSubjects` default to []. Empty array =
// allow all (backwards-compatible: a freshly-created doc keeps
// existing flows working). Non-empty = whitelist.

export const CURRICULUM_UPDATE_FREQUENCIES = z.enum(['weekly', 'monthly'])

export const aiAutomationSettingsWriteSchema = z.object({
  enabled: z.boolean(),
  maxQuestionsPerDay: z.number().int().min(0).max(10_000),
  maxQuizzesPerDay: z.number().int().min(0).max(1_000),
  // Mirrored copies of the existing settings/global.learnerAi.* fields.
  // Optional — the dispatcher's shouldAutoPublish still reads the
  // canonical location; these are exposed here purely so admin tooling
  // that loads only this doc can render the matching toggles in the
  // same view. Never required for dispatch.
  autoPublishPracticeQuizzes: z.boolean().optional(),
  autoPublishNotes: z.boolean().optional(),
  // Hard-rule pins — must be literal true. Zod rejects any other value.
  requireAdminApprovalForExamQuizzes: z.literal(true),
  requireAdminApprovalForCurriculumUpdates: z.literal(true),
  curriculumUpdateCheckFrequency: CURRICULUM_UPDATE_FREQUENCIES,
  enabledGrades: z.array(z.string().max(8)).max(20).default([]),
  enabledSubjects: z.array(z.string().max(80)).max(40).default([]),
  updatedAt: timestampish,
  updatedBy: z.string().min(1).max(120),
}).strict()

/** @typedef {import('zod').infer<typeof aiAutomationSettingsWriteSchema>} AiAutomationSettings */

// Single counter doc per UTC day. Server-only writes via
// FieldValue.increment from _stubFactory. The admin UI reads it via
// onSnapshot to render a live "today: X / cap" indicator.
export const aiUsageDailyWriteSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  questionsGenerated: z.number().int().min(0),
  quizzesGenerated: z.number().int().min(0),
  artifactsGenerated: z.number().int().min(0),
  updatedAt: timestampish,
}).strict()

/** @typedef {import('zod').infer<typeof aiUsageDailyWriteSchema>} AiUsageDaily */

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
