/**
 * functions/aiValidation/operationRegistry.js
 *
 * The single inventory of every AI operation in ZedExams and its response
 * contract (Prompt 14 §2 "audit all AI response paths" + §35 "model and prompt
 * versioning"). Pure — no firebase imports — so it runs under plain
 * `node functions/aiValidation/operationRegistry.test.js`.
 *
 * Each entry records what §2 asks a response path to document: the frontend
 * trigger, the Cloud Function, provider + model, prompt version, the expected
 * response type, the destination collection, the failure behaviour, and where
 * usage is charged. buildProvenance() stamps the version quadruple
 * (prompt/schema/validator/curriculum-catalogue) onto a persisted result so a
 * regression can be traced to the exact combination that produced it (§35).
 *
 * This registry is descriptive, not executive — it does not call anything. It's
 * the map the validation pipeline (and the /admin observability surface) reads
 * to know which contract applies to a given operation. Keep it in sync as AI
 * operations are added or their versions bump; the accompanying test asserts the
 * shape so a malformed/duplicate entry fails CI.
 */

const PROVIDERS = new Set(["anthropic", "openai", "gemini"]);
const RESPONSE_TYPES = new Set([
  "assessment", "quiz", "questions", "lesson_plan", "scheme_of_work",
  "worksheet", "homework", "notes", "flashcards", "rubric", "sba_task",
  "slide_notes", "extraction", "recommendation", "mapping", "marking_guide",
  "chat", "structured_import", "syllabus", "diagram", "answer", "revision",
]);

// The framework a curriculum operation is grounded in. "cbc" = the 2023 CBC
// syllabus; "obc" = the older 2013 outcomes-based syllabus; "n/a" for
// operations with no curriculum framing (chat, diagram, import).
const FRAMEWORKS = new Set(["cbc", "obc", "both", "n/a"]);

/**
 * @typedef {Object} OperationContract
 * @property {string} operation            Stable id, e.g. "generate_assessment".
 * @property {string} label                Human name.
 * @property {string} frontendTrigger      Where a user kicks it off.
 * @property {string} cloudFunction        The exported function name.
 * @property {string} provider             One of PROVIDERS.
 * @property {string} modelEnv             Env var that overrides the model.
 * @property {string} defaultModel         Model used when the env var is unset.
 * @property {string} promptVersion        Current prompt version id.
 * @property {string} schemaVersion        Current response-schema version.
 * @property {string} validatorVersion     Current validator version.
 * @property {string} responseType         One of RESPONSE_TYPES.
 * @property {string} framework            One of FRAMEWORKS.
 * @property {string} destination          Firestore collection the result lands in.
 * @property {boolean} draftFirst          Whether output is saved as a draft for review (§34).
 * @property {string} usageChargePoint     When usage settles.
 * @property {string} failureBehaviour     What happens on invalid output.
 * @property {boolean} idempotent          Wired through aiOperations (§33)?
 */

/** @type {OperationContract[]} */
const OPERATIONS = [
  {
    operation: "generate_assessment",
    label: "Assessment Paper Studio — Create paper with AI",
    frontendTrigger: "CreatePaperModal (AssessmentStudio)",
    cloudFunction: "generateAssessment",
    provider: "anthropic",
    modelEnv: "ASSESSMENT_MODEL",
    defaultModel: "claude-sonnet-4-6",
    promptVersion: "assessment-v10",
    schemaVersion: "assessment-response-1.6",
    validatorVersion: "assessment-validator-1",
    responseType: "assessment",
    framework: "both",
    destination: "aiGenerations",
    draftFirst: true,
    usageChargePoint: "after-validated-result",
    failureBehaviour: "flagged-or-refunded; never saved public",
    idempotent: true,
  },
  {
    operation: "generate_quiz",
    label: "Quiz Studio — Generate quiz",
    frontendTrigger: "CreateQuizV2 (admin)",
    cloudFunction: "generateQuiz",
    provider: "anthropic",
    modelEnv: "ANTHROPIC_MODEL",
    defaultModel: "claude-sonnet-4-6",
    promptVersion: "quiz-v1",
    schemaVersion: "quiz-response-1",
    validatorVersion: "quiz-validator-1",
    responseType: "quiz",
    framework: "cbc",
    destination: "quizzes (draft)",
    draftFirst: true,
    usageChargePoint: "after-parse",
    failureBehaviour: "parse-recover then schema-validate; reject on fail",
    idempotent: false,
  },
  {
    operation: "generate_lesson_plan",
    label: "Lesson Plan Studio",
    frontendTrigger: "StudioCanvas (teacher)",
    cloudFunction: "generateLessonPlan / apiGenerateLessonPlan (SSE)",
    provider: "anthropic",
    modelEnv: "ANTHROPIC_MODEL",
    defaultModel: "claude-sonnet-4-6",
    promptVersion: "lesson-plan-v1",
    schemaVersion: "lesson-plan-response-1",
    validatorVersion: "lesson-plan-validator-1",
    responseType: "lesson_plan",
    framework: "both",
    destination: "aiGenerations",
    draftFirst: true,
    usageChargePoint: "after-parse",
    failureBehaviour: "schema-validate; flagged on fail",
    idempotent: false,
  },
  {
    operation: "generate_scheme_of_work",
    label: "Scheme of Work Studio",
    frontendTrigger: "SchemeOfWorkStudio (teacher)",
    cloudFunction: "generateSchemeOfWork",
    provider: "anthropic",
    modelEnv: "ANTHROPIC_MODEL",
    defaultModel: "claude-sonnet-4-6",
    promptVersion: "scheme-v1",
    schemaVersion: "scheme-response-1",
    validatorVersion: "scheme-validator-1",
    responseType: "scheme_of_work",
    framework: "both",
    destination: "aiGenerations",
    draftFirst: true,
    usageChargePoint: "after-parse",
    failureBehaviour: "schema + quality check; flagged on fail",
    idempotent: false,
  },
  {
    operation: "generate_worksheet",
    label: "Worksheet Studio",
    frontendTrigger: "WorksheetStudio (teacher)",
    cloudFunction: "generateWorksheet / apiGenerateWorksheet (SSE)",
    provider: "anthropic",
    modelEnv: "ANTHROPIC_MODEL",
    defaultModel: "claude-sonnet-4-6",
    promptVersion: "worksheet-v1",
    schemaVersion: "worksheet-response-1",
    validatorVersion: "worksheet-validator-1",
    responseType: "worksheet",
    framework: "cbc",
    destination: "aiGenerations",
    draftFirst: true,
    usageChargePoint: "after-parse",
    failureBehaviour: "schema-validate; flagged on fail",
    idempotent: false,
  },
  {
    operation: "generate_homework",
    label: "Homework Studio",
    frontendTrigger: "HomeworkStudio (teacher)",
    cloudFunction: "generateHomework",
    provider: "anthropic",
    modelEnv: "ANTHROPIC_MODEL",
    defaultModel: "claude-sonnet-4-6",
    promptVersion: "homework-v1",
    schemaVersion: "homework-response-1",
    validatorVersion: "homework-validator-1",
    responseType: "homework",
    framework: "cbc",
    destination: "aiGenerations",
    draftFirst: true,
    usageChargePoint: "after-parse",
    failureBehaviour: "schema-validate; flagged on fail",
    idempotent: false,
  },
  {
    operation: "generate_notes",
    label: "Notes Studio",
    frontendTrigger: "NotesStudio (teacher)",
    cloudFunction: "generateNotes",
    provider: "anthropic",
    modelEnv: "ANTHROPIC_MODEL",
    defaultModel: "claude-sonnet-4-6",
    promptVersion: "notes-v1",
    schemaVersion: "notes-response-1",
    validatorVersion: "notes-validator-1",
    responseType: "notes",
    framework: "cbc",
    destination: "aiGenerations",
    draftFirst: true,
    usageChargePoint: "after-parse",
    failureBehaviour: "schema-validate; flagged on fail",
    idempotent: false,
  },
  {
    operation: "generate_flashcards",
    label: "Flashcard Studio",
    frontendTrigger: "FlashcardStudio (teacher)",
    cloudFunction: "generateFlashcards",
    provider: "anthropic",
    modelEnv: "ANTHROPIC_MODEL",
    defaultModel: "claude-sonnet-4-6",
    promptVersion: "flashcard-v1",
    schemaVersion: "flashcard-response-1",
    validatorVersion: "flashcard-validator-1",
    responseType: "flashcards",
    framework: "cbc",
    destination: "aiGenerations",
    draftFirst: true,
    usageChargePoint: "after-parse",
    failureBehaviour: "schema-validate; flagged on fail",
    idempotent: false,
  },
  {
    operation: "generate_rubric",
    label: "Rubric Studio",
    frontendTrigger: "RubricStudio (teacher)",
    cloudFunction: "generateRubric",
    provider: "anthropic",
    modelEnv: "ANTHROPIC_MODEL",
    defaultModel: "claude-sonnet-4-6",
    promptVersion: "rubric-v1",
    schemaVersion: "rubric-response-1",
    validatorVersion: "rubric-validator-1",
    responseType: "rubric",
    framework: "cbc",
    destination: "aiGenerations",
    draftFirst: true,
    usageChargePoint: "after-parse",
    failureBehaviour: "schema-validate; flagged on fail",
    idempotent: false,
  },
  {
    operation: "generate_sba_task",
    label: "SBA Task Studio",
    frontendTrigger: "SbaTaskStudio (teacher)",
    cloudFunction: "generateSbaTask",
    provider: "anthropic",
    modelEnv: "ANTHROPIC_MODEL",
    defaultModel: "claude-sonnet-4-6",
    promptVersion: "sba-v1",
    schemaVersion: "sba-response-1",
    validatorVersion: "sba-validator-1",
    responseType: "sba_task",
    framework: "cbc",
    destination: "aiGenerations",
    draftFirst: true,
    usageChargePoint: "after-parse",
    failureBehaviour: "schema-validate; flagged on fail",
    idempotent: false,
  },
  {
    operation: "past_paper_import",
    label: "Past Paper Studio — import questions",
    frontendTrigger: "PastPaperStudio (admin)",
    cloudFunction: "importPastPaperQuestions",
    provider: "anthropic",
    modelEnv: "ANTHROPIC_MODEL",
    defaultModel: "claude-sonnet-4-6",
    promptVersion: "past-paper-import-v1",
    schemaVersion: "extraction-response-1",
    validatorVersion: "extraction-validator-1",
    responseType: "extraction",
    framework: "n/a",
    destination: "questionBank (pending_review)",
    draftFirst: true,
    usageChargePoint: "after-parse",
    failureBehaviour: "source-reconcile; missing/extra questions flagged",
    idempotent: false,
  },
  {
    operation: "structure_scanned_quiz",
    label: "Scanned-image (OCR) quiz import",
    frontendTrigger: "Scanned-image importer (quiz)",
    cloudFunction: "structureScannedQuiz",
    provider: "gemini",
    modelEnv: "GEMINI_MODEL",
    defaultModel: "gemini-2.0-flash",
    promptVersion: "scanned-quiz-v1",
    schemaVersion: "structured-import-response-1",
    validatorVersion: "structured-import-validator-1",
    responseType: "structured_import",
    framework: "n/a",
    destination: "quizzes (draft)",
    draftFirst: true,
    usageChargePoint: "after-parse",
    failureBehaviour: "parse-recover then schema-validate; reject on fail",
    idempotent: false,
  },
  {
    operation: "verify_quiz",
    label: "Quiz verification (Vex)",
    frontendTrigger: "QuizVerifyModal (quiz editor)",
    cloudFunction: "verifyQuiz",
    provider: "anthropic",
    modelEnv: "ANTHROPIC_MODEL",
    defaultModel: "claude-haiku-4-5-20251001",
    promptVersion: "vex-v1",
    schemaVersion: "verify-response-1",
    validatorVersion: "verify-validator-1",
    responseType: "revision",
    framework: "cbc",
    destination: "(none — returned to caller)",
    draftFirst: false,
    usageChargePoint: "synchronous; not charged",
    failureBehaviour: "structural checks first; model verdict advisory",
    idempotent: false,
  },
  {
    operation: "check_short_answer",
    label: "Short-answer marking",
    frontendTrigger: "Quiz runner (marking)",
    cloudFunction: "checkShortAnswer",
    provider: "openai",
    modelEnv: "OPENAI_MODEL",
    defaultModel: "gpt-4o-mini",
    promptVersion: "short-answer-v1",
    schemaVersion: "marking-response-1",
    validatorVersion: "marking-validator-1",
    responseType: "marking_guide",
    framework: "n/a",
    destination: "attempts (marks)",
    draftFirst: false,
    usageChargePoint: "after-parse",
    failureBehaviour: "clamp to valid marks; fail-safe on parse error",
    idempotent: false,
  },
];

const BY_OPERATION = new Map(OPERATIONS.map((op) => [op.operation, op]));

/** Look up the contract for an operation id, or null if unknown. */
function getOperationContract(operation) {
  return BY_OPERATION.get(operation) || null;
}

/** Every registered operation id. */
function listOperations() {
  return OPERATIONS.map((op) => op.operation);
}

/**
 * Validate a single contract's shape. Returns an array of problem strings
 * (empty === valid). Used by the test to fail CI on a malformed/incomplete
 * entry so the registry can't silently rot.
 */
function validateContract(op) {
  const problems = [];
  const required = [
    "operation", "label", "frontendTrigger", "cloudFunction", "provider",
    "promptVersion", "schemaVersion", "validatorVersion", "responseType",
    "framework", "destination", "usageChargePoint", "failureBehaviour",
  ];
  for (const key of required) {
    if (!op || typeof op[key] !== "string" || !op[key]) {
      problems.push(`missing/blank "${key}"`);
    }
  }
  if (op && !PROVIDERS.has(op.provider)) problems.push(`unknown provider "${op.provider}"`);
  if (op && !RESPONSE_TYPES.has(op.responseType)) problems.push(`unknown responseType "${op.responseType}"`);
  if (op && !FRAMEWORKS.has(op.framework)) problems.push(`unknown framework "${op.framework}"`);
  if (op && typeof op.draftFirst !== "boolean") problems.push(`draftFirst must be boolean`);
  if (op && typeof op.idempotent !== "boolean") problems.push(`idempotent must be boolean`);
  return problems;
}

/**
 * Build the provenance block to stamp on a persisted AI result (§35). Reads the
 * version quadruple from the registry so callers don't hard-code strings, and
 * lets the caller override any field it resolved at runtime (e.g. the actual
 * model the provider echoed, or the curriculum-catalogue version in force).
 *
 * @param {string} operation
 * @param {Object} [overrides]  e.g. {model, curriculumVersion, promptVersion}.
 * @returns {Object|null} provenance, or null for an unknown operation.
 */
function buildProvenance(operation, overrides = {}) {
  const contract = getOperationContract(operation);
  if (!contract) return null;
  return {
    operation: contract.operation,
    provider: contract.provider,
    model: overrides.model || contract.defaultModel,
    promptVersion: overrides.promptVersion || contract.promptVersion,
    schemaVersion: overrides.schemaVersion || contract.schemaVersion,
    validatorVersion: overrides.validatorVersion || contract.validatorVersion,
    curriculumVersion: overrides.curriculumVersion || null,
    responseType: contract.responseType,
    framework: overrides.framework || contract.framework,
  };
}

module.exports = {
  PROVIDERS,
  RESPONSE_TYPES,
  FRAMEWORKS,
  OPERATIONS,
  getOperationContract,
  listOperations,
  validateContract,
  buildProvenance,
};
