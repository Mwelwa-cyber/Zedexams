/**
 * Phase 6, Slice 1 — the definitive record of every AI call site in the backend.
 *
 * ## What this file is for
 *
 * Phase 6's goal is that every generator runs through one observable, validated,
 * rate-limited and recoverable execution path. Before eleven refactors, the
 * repo needs an answer to "how many are there, and what does each one actually
 * have today" that is not a guess. The brief that opened this phase said
 * "the remaining eleven generators"; the scan says the number is different, in
 * both directions, which is exactly why the inventory comes first.
 *
 * ## The division of labour, and why it matters
 *
 * This file records only what a program CANNOT derive: what a call site is for,
 * who triggers it, what it produces, and whether a half-finished result can be
 * saved. Everything mechanical — does it reserve an operation, meter usage,
 * validate input, ground itself in the curriculum — is derived from the source
 * by `scanModelCallSites.js` and joined to these records by the test.
 *
 * Duplicating a derivable fact here would guarantee it goes stale, and a stale
 * inventory is worse than none: it reads exactly like an accurate one. So the
 * rule is that no field below can be answered by grepping.
 *
 * ## The three states, not two
 *
 * The headline finding. "Wired through aiOperations" is not one condition:
 *
 *   migrated    every clause of the migration contract holds. Entry is through
 *               `requireAndReserveAiOperation`, which refuses a missing or
 *               malformed key before usage charging, provider access or result
 *               creation; the result document IS the key; and the initiating
 *               UI surface holds a named operation lock, so the backend is not
 *               migrated in isolation from the double-click that motivated it.
 *
 *   partial     the reservation is written by hand rather than entered through
 *               the canonical helper. Where that guard was `isValidIdempotencyKey`,
 *               a request WITHOUT a key silently took the old unprotected path —
 *               auto-id document, no reservation, no record that protection was
 *               skipped. A stale cached client, a retry built before the key
 *               existed, or any direct callable invocation got the pre-Phase-5
 *               behaviour and nothing anywhere said so.
 *
 *   unmigrated  no reservation at all.
 *
 * `partial` is the state worth naming, because from the outside it is
 * indistinguishable from `migrated` — the tests pass, the happy path reserves,
 * the dashboards look right. It is counted as NOT satisfying the contract.
 *
 * Slice 2 (this change) emptied it: the five generators from #1861 now enter
 * through the canonical helper with their auto-id branches DELETED rather than
 * bypassed. 6 migrated, 0 partial, 20 unmigrated.
 */

/** How a call site is triggered and what it owes the user. */
export const CLASSES = Object.freeze({
  /** User presses a button, waits, and keeps the result. Phase 6's subject. */
  generator: 'generator',
  /** Autonomous: cron, Firestore trigger, or webhook. No waiting user. */
  agent: 'agent',
  /** Runs INSIDE another operation; never the reason a model call happens. */
  helper: 'helper',
  /** Conversational or marking; output is read once, not saved as a document. */
  assistant: 'assistant',
  /** One file hosting many entry points — must be split before it can migrate. */
  composite: 'composite',
})

/**
 * Migration order, following the brief's priority: teacher documents and
 * learner-facing content first, recommendation-shaped output last. `null` for
 * anything the contract does not apply to.
 */
export const TIERS = Object.freeze({
  1: 'Lesson plans and lesson content',
  2: 'Papers, quizzes and question generation',
  3: 'Notes and study content',
  4: 'Imports and OCR (teacher-authored content entering the system)',
  5: 'Images and figures',
  6: 'Revision and recommendation paths',
})

/**
 * A generator record.
 *
 * `clientModule` is the UI surface that initiates the generation — the
 * component holding the button, NOT the shared callable wrapper it goes
 * through. `src/utils/teacherTools.js` fronts most of these callables, but a
 * lock in a shared wrapper would be one lock for every tool at once; the lock
 * has to sit where the user's intent is expressed.
 *
 * It defaults to `null`, which FAILS the client-operation-lock clause. That is
 * the correct reading for an unmigrated generator: mapping the surface is part
 * of migrating it, and a null here says "not yet traced" rather than pretending
 * a lock might exist somewhere unexamined.
 */
const g = (file, fields) => ({
  file, class: CLASSES.generator, clientModule: null, clientLockKey: null, ...fields,
})

/**
 * Every direct model call site under `functions/`.
 *
 * `state` is the CLAIM. The test proves it against the scan, in both
 * directions: a site whose code no longer matches its claim fails, and so does
 * a site that has quietly gained a reservation without anyone recording it.
 */
export const INVENTORY = Object.freeze([
  // ── Tier 1 · lesson plans and lesson content ──────────────────────────
  g('functions/teacherTools/generateLessonPlan.js', {
    tier: 1,
    state: 'unmigrated',
    entryPoint: 'generateLessonPlan (callable) + apiGenerateLessonPlan (SSE)',
    clientSurface: '/teacher/lesson-plans — studio/StudioCanvas.jsx',
    produces: 'A saved lesson plan document, exported to Word and PDF',
    incompleteResultSaveable: true,
    note: 'Two entry points for one generator, and the SSE one streams. A '
      + 'reservation has to cover both or the stream becomes the bypass.',
  }),
  g('functions/teacherTools/generateLessonActivities.js', {
    tier: 1,
    state: 'unmigrated',
    entryPoint: 'generateLessonActivities (callable)',
    clientSurface: 'Lesson plan studio — activity regeneration',
    produces: 'Activities appended into an existing lesson plan',
    incompleteResultSaveable: true,
  }),
  g('functions/teacherTools/studioLessonPlan.js', {
    clientModule: 'src/components/teacher/studio/LessonPlanStudio.jsx',
    clientLockKey: 'lesson-plan-studio:generate',
    tier: 1,
    state: 'migrated',
    entryPoint: 'studioGenerateLessonPlan (callable)',
    clientSurface: 'Lesson Plan Studio — LessonPlanStudio.jsx (V2 canvas path)',
    produces: 'A saved lesson plan document',
    incompleteResultSaveable: true,
    note: 'Returns its plan INLINE and validates the studio-built prompts, so '
      + 'the migration persists the result to aiGenerations/{idempotencyKey} for '
      + 'resume and factors the systemPrompt/userPrompt check into validateInputs. '
      + 'Its length-gate REPAIR call is a second door into the same callable and '
      + 'now carries its own minted key (the reservation refuses a keyless call).',
  }),
  g('functions/teacherTools/reviseLessonSection.js', {
    clientModule: 'src/components/teacher/studio/LessonPlanEditor.jsx',
    clientLockKey: 'lesson-section:revise',
    operationClass: 'transformation',
    tier: 1,
    state: 'migrated',
    entryPoint: 'reviseLessonSection (callable)',
    clientSurface: 'Lesson Plan Editor — per-section AI edit (LessonPlanEditor.jsx)',
    produces: 'One replaced section ({text}|{items}) of a lesson plan, preserving its curriculum',
    incompleteResultSaveable: false,
    note: 'A TRANSFORMATION: edits ONE section of an existing plan, so it '
      + 'PRESERVES the plan\'s curriculum via checkSourceCurriculum rather than '
      + 'grounding a fresh topic. Its curriculumMode previously DEFAULTED to CBC '
      + '(silent drift for a 2013 plan); the default is removed so the gate fails '
      + 'closed. Subject is contextual here (requireSubject:false). Returns text/'
      + 'items inline, persisted to aiGenerations/{idempotencyKey} for resume; '
      + 'this migration also closed an AI-006 refund gap.',
  }),

  // ── Tier 2 · papers, quizzes and question generation ──────────────────
  g('functions/teacherTools/generateAssessment.js', {
    clientModule: 'src/components/teacher/CreatePaperModal.jsx',
    clientLockKey: 'assessment-studio:create-paper:generate-full',
    tier: 2,
    state: 'migrated',
    entryPoint: 'generateAssessment (callable)',
    clientSurface: '/teacher/assessment-papers — CreatePaperModal.jsx',
    produces: 'A saved assessment paper, exported to Word and PDF',
    incompleteResultSaveable: false,
    note: 'The reference implementation. Every other migration should read '
      + 'like this one.',
  }),
  g('functions/teacherTools/generateQuiz.js', {
    tier: 2,
    state: 'unmigrated',
    entryPoint: 'generateQuiz (callable)',
    clientSurface: 'Admin CreateQuizV2.jsx',
    produces: 'Quiz questions written into the quiz editor',
    incompleteResultSaveable: true,
  }),
  g('functions/teacherTools/generateSbaTask.js', {
    clientModule: 'src/components/teacher/generate/SbaTaskStudio.jsx',
    clientLockKey: 'sba-studio:generate',
    tier: 2,
    state: 'migrated',
    entryPoint: 'generateSbaTask (callable)',
    clientSurface: '/teacher/generate/sba — SbaTaskStudio.jsx',
    produces: 'A saved SBA task document',
    incompleteResultSaveable: true,
  }),
  g('functions/teacherTools/regenerateAssessmentQuestion.js', {
    clientModule: 'src/components/teacher/AssessmentStudio.jsx',
    clientLockKey: 'assessment-studio:regenerate-question',
    tier: 2,
    state: 'migrated',
    entryPoint: 'regenerateAssessmentQuestion (callable)',
    clientSurface: 'Assessment Paper Studio — per-question regenerate (AssessmentStudio.jsx)',
    produces: 'One replaced question in a saved paper',
    incompleteResultSaveable: false,
    note: 'Returns its question INLINE, so unlike the document generators it '
      + 'persists the result to aiGenerations/{idempotencyKey} purely to make a '
      + 'duplicate/retry resume the same question rather than pay for a second '
      + 'rewrite — the first migration of an inline-return generator.',
  }),
  g('functions/teacherTools/generateWorksheet.js', {
    clientModule: 'src/features/worksheet/pages/WorksheetGenerator.jsx',
    clientLockKey: 'worksheet-studio:generate',
    tier: 2,
    state: 'migrated',
    entryPoint: 'generateWorksheet (callable) + apiGenerateWorksheet (SSE)',
    clientSurface: '/teacher/worksheets — WorksheetGenerator.jsx',
    produces: 'A saved worksheet, exported to Word and PDF',
    incompleteResultSaveable: true,
    note: 'The SSE endpoint is a second door into the same generator and does '
      + 'not carry the key at all.',
  }),
  g('functions/teacherTools/generateHomework.js', {
    clientModule: 'src/features/homework/pages/HomeworkStudio.jsx',
    clientLockKey: 'homework-studio:generate',
    tier: 2,
    state: 'migrated',
    entryPoint: 'generateHomework (callable)',
    clientSurface: '/teacher/homework — HomeworkStudio.jsx',
    produces: 'A saved homework document',
    incompleteResultSaveable: true,
  }),
  g('functions/teacherTools/generateRubric.js', {
    clientModule: 'src/features/rubric/pages/RubricGenerator.jsx',
    clientLockKey: 'rubric-studio:generate',
    tier: 2,
    state: 'migrated',
    entryPoint: 'generateRubric (callable)',
    clientSurface: '/teacher/rubrics — RubricGenerator.jsx',
    produces: 'A saved rubric',
    incompleteResultSaveable: true,
  }),
  g('functions/teacherTools/generateSchemeOfWork.js', {
    clientModule: 'src/components/teacher/generate/SchemeOfWorkGenerator.jsx',
    clientLockKey: 'scheme-studio:generate',
    tier: 2,
    state: 'migrated',
    entryPoint: 'generateSchemeOfWork (callable)',
    clientSurface: '/teacher/schemes-of-work — SchemeOfWorkGenerator.jsx',
    produces: 'A saved scheme of work, exported to Word and PDF',
    incompleteResultSaveable: true,
  }),

  // ── Tier 3 · notes and study content ──────────────────────────────────
  g('functions/teacherTools/generateNotes.js', {
    clientModule: 'src/features/teacherNotes/pages/NotesStudio.jsx',
    clientLockKey: 'notes-studio:generate',
    tier: 3,
    state: 'migrated',
    entryPoint: 'generateNotes (callable)',
    clientSurface: '/teacher/generate/notes — NotesStudio.jsx',
    produces: 'Saved notes, read by learners',
    incompleteResultSaveable: true,
    note: 'The from-plan path still reads a SOURCE lesson plan directly '
      + '(loadLessonPlan) — a separate artifact-resolution concern tracked in '
      + 'scanLessonPlanArtifactReads, orthogonal to this idempotency migration.',
  }),
  g('functions/teacherTools/generateFlashcards.js', {
    clientModule: 'src/features/flashcards/pages/FlashcardGenerator.jsx',
    clientLockKey: 'flashcards-studio:generate',
    tier: 3,
    state: 'migrated',
    entryPoint: 'generateFlashcards (callable)',
    clientSurface: '/teacher/flashcards — FlashcardGenerator.jsx',
    produces: 'A saved flashcard deck',
    incompleteResultSaveable: true,
  }),
  g('functions/teacherTools/generateSlideNotes.js', {
    tier: 3,
    state: 'unmigrated',
    entryPoint: 'generateSlideNotes (callable)',
    clientSurface: 'AdminVisualNotesGenerator.jsx',
    produces: 'Slide-shaped notes rendered in SlideNotesReader',
    incompleteResultSaveable: true,
  }),
  g('functions/noteInsights.js', {
    tier: 3,
    state: 'unmigrated',
    entryPoint: 'generateNoteInsights (callable)',
    clientSurface: 'Notes reader — insight panel',
    produces: 'Insights attached to a note',
    incompleteResultSaveable: false,
  }),
  g('functions/noteSmart.js', {
    tier: 3,
    state: 'unmigrated',
    entryPoint: 'generateNoteSmart (callable)',
    clientSurface: 'Notes Studio — smart authoring',
    produces: 'Note content written into the editor',
    incompleteResultSaveable: true,
  }),
  g('functions/studentAgents.js', {
    tier: 3,
    state: 'unmigrated',
    entryPoint: 'generateStudyPlan (callable)',
    clientSurface: 'Learner dashboard — study plan',
    produces: 'A saved study plan shown to a learner',
    incompleteResultSaveable: false,
  }),

  // ── Tier 4 · imports and OCR ──────────────────────────────────────────
  g('functions/teacherTools/pastPaperImport.js', {
    tier: 4,
    state: 'unmigrated',
    entryPoint: 'importPastPaperQuestions (callable)',
    clientSurface: 'PastPaperStudio (admin)',
    produces: 'Questions written into the Central Question Bank',
    incompleteResultSaveable: true,
    note: 'A duplicate import writes duplicate questions into the Master Bank, '
      + 'where Qix then reviews both.',
  }),
  g('functions/scannedQuizImport.js', {
    tier: 4,
    state: 'unmigrated',
    entryPoint: 'structureScannedQuiz (callable)',
    clientSurface: 'Quiz importer — scanned-image (OCR) path',
    produces: 'Structured quiz questions from a photographed paper',
    incompleteResultSaveable: true,
  }),
  g('functions/noteImport.js', {
    tier: 4,
    state: 'unmigrated',
    entryPoint: 'structureImportedNote (callable) + ocrNotePages',
    clientSurface: 'Notes Studio — document/OCR import',
    produces: 'Structured notes from an uploaded document',
    incompleteResultSaveable: true,
  }),
  g('functions/classList/extractClassList.js', {
    tier: 4,
    state: 'unmigrated',
    entryPoint: 'extractClassListPages (callable)',
    clientSurface: 'Class List — capture the pages of a written register',
    produces: 'Learner rows read from photographed class-list pages',
    // Nothing this call produces is written by the server: the rows go back
    // to the browser for a compulsory review and are saved from there. So a
    // duplicated call costs a second reading of the same pages and nothing
    // else — no duplicate learners, no duplicate documents. It is a real
    // charge to a teacher's daily allowance, which is why it is inventoried,
    // but it is the least damaging duplicate in this table.
    incompleteResultSaveable: false,
    note: 'Writes nothing. A duplicate call re-reads the same pages and the '
      + 'teacher reviews one set of rows either way.',
  }),

  // ── Tier 5 · images and figures ───────────────────────────────────────
  g('functions/teacherTools/generateDiagram.js', {
    tier: 5,
    state: 'unmigrated',
    entryPoint: 'generateDiagram (callable)',
    clientSurface: 'Assessment Paper Studio + admin VisualStudio',
    produces: 'A figure printed on a paper, stored in the picture bank',
    incompleteResultSaveable: false,
    note: 'gpt-image-1. The most expensive call per unit and the one a '
      + 'double-click most visibly duplicates — two near-identical figures '
      + 'land in the bank.',
  }),
  g('functions/teacherTools/generateNotePictures.js', {
    tier: 5,
    state: 'unmigrated',
    entryPoint: 'generateNotePictures (callable) + generateVisualNotes',
    clientSurface: 'Notes Studio + admin VisualStudio',
    produces: 'Illustrations stored in the picture bank',
    incompleteResultSaveable: false,
    note: 'The only generator with no usage meter at all — see the scan.',
  }),

  // ── Tier 6 · revision and recommendation ──────────────────────────────
  g('functions/teacherTools/reviseQuestion.js', {
    clientModule: 'src/components/teacher/AssessmentQuestionBlock.jsx',
    clientLockKey: 'assessment-question:revise',
    operationClass: 'transformation',
    tier: 6,
    state: 'migrated',
    entryPoint: 'reviseQuestion (callable)',
    clientSurface: 'Assessment Paper Studio — per-question revise (AssessmentQuestionBlock.jsx)',
    produces: 'A revised question, preserving the source curriculum + subject',
    incompleteResultSaveable: false,
    note: 'A TRANSFORMATION: it re-grades / re-tones an existing question, so it '
      + 'does not resolveCbcContext against a fresh topic; instead it PRESERVES '
      + 'the source curriculum via checkSourceCurriculum (fail-closed) and pins '
      + 'the prompt to it. Returns text inline, persisted to '
      + 'aiGenerations/{idempotencyKey} for resume. This migration also closed an '
      + 'AI-006 refund gap and a latent CBC-hard-coding bug.',
  }),
  g('functions/suggestQuizAnswers.js', {
    tier: 6,
    state: 'unmigrated',
    entryPoint: 'inline in index.js',
    clientSurface: 'Quiz editor — answer suggestion',
    produces: 'Suggested answers offered to an author',
    incompleteResultSaveable: false,
  }),
  g('functions/teacherTools/suggestAnswer.js', {
    clientModule: 'src/components/teacher/AssessmentQuestionBlock.jsx',
    clientLockKey: 'assessment-question:suggest-answer',
    operationClass: 'transformation',
    tier: 6,
    state: 'migrated',
    entryPoint: 'suggestAnswer (callable)',
    clientSurface: 'Assessment Paper Studio — per-question suggest answer (AssessmentQuestionBlock.jsx)',
    produces: 'A suggested answer, preserving the source curriculum + subject',
    incompleteResultSaveable: false,
    note: 'A TRANSFORMATION: it predicts the answer to an EXISTING question, so '
      + 'it preserves the source curriculum via checkSourceCurriculum '
      + '(fail-closed) rather than grounding a fresh topic. Has a Gemini-vision '
      + 'path for image questions; refund + failAiOperation settle only when the '
      + 'Claude fallback also throws. Result persisted to '
      + 'aiGenerations/{idempotencyKey}. Also closed an AI-006 refund gap and the '
      + 'CBC-hard-coded prompt.',
  }),

  // ── Composite: many entry points behind one file ──────────────────────
  {
    file: 'functions/index.js',
    class: CLASSES.composite,
    tier: null,
    state: 'unmigrated',
    entryPoint: 'generateQuizQuestions, structureImportedQuiz, ocrNotePages, '
      + 'classifyQuestionGrades, aiChat, apiAiChat, checkShortAnswer',
    clientSurface: 'several',
    produces: 'several',
    incompleteResultSaveable: true,
    note: 'The scanner reports this file once because it cannot see the seven '
      + 'entry points inside it, and neither can a reviewer. Splitting them '
      + 'into modules is a prerequisite for migrating any of them, and is the '
      + 'reason no tier is assigned yet.',
  },

  // ── Agents: autonomous, no waiting user ───────────────────────────────
  ...[
    ['functions/agents/cron.js', 'The scheduled ops/growth agents (Echo, Gate, Compass, Anchor, …)'],
    ['functions/agents/platformHealth.js', 'Platform health summarisation for Vigil'],
    ['functions/agents/questionReview.js', 'Qix — questionBank review trigger'],
    ['functions/agents/runners/monitor.js', 'Vigil — hourly monitor'],
    ['functions/agents/runners/reva.js', 'Reva — content review in the agentJobs pipeline'],
    ['functions/agents/runners/vex.js', 'Vex — synchronous quiz verification'],
  ].map(([file, note]) => ({
    file, class: CLASSES.agent, tier: null, state: 'out-of-scope', note,
    entryPoint: 'cron or Firestore trigger', clientSurface: 'none',
    produces: 'an agentJobs rollup or a review verdict',
    incompleteResultSaveable: false,
  })),

  // ── Helpers: run inside another operation ─────────────────────────────
  ...[
    ['functions/visualSafety.js', 'Safety gate applied to a generated image'],
    ['functions/pictureNaming.js', 'Auto-names a picture-bank asset after it is generated'],
    ['functions/teacherTools/gradeReclassifier.js', 'Re-derives a grade band for an imported question'],
    ['functions/teacherTools/lessonCount.js', 'Estimates a lesson count while planning a scheme'],
    ['functions/teacherTools/extractTopicsFromPdf.js', 'Syllabus ingestion (admin tooling)'],
    ['functions/teacherTools/extractAssessmentFormat.js', 'Derives a format seed from an uploaded paper'],
    ['functions/teacherTools/examPaperLibrary.js', 'analyzeExamPaper + synthesizeAssessmentFormat'],
    ['functions/teacherTools/templateBankFunctions.js', 'Lesson-plan template bank trigger'],
    ['functions/teacherTools/testPaperImport/layoutPass.js', 'Layout pass inside the paper importer'],
    ['functions/teacherTools/testPaperImport/rebuildTable.js', 'Table rebuild inside the paper importer'],
  ].map(([file, note]) => ({
    file, class: CLASSES.helper, tier: null, state: 'out-of-scope', note,
    entryPoint: 'called by another operation', clientSurface: 'none',
    produces: 'an intermediate value', incompleteResultSaveable: false,
  })),
])

/** Generators only — the set the migration contract applies to. */
export const GENERATORS = INVENTORY.filter((r) => r.class === CLASSES.generator)

/** Group the generators by migration tier, in order. */
export function byTier() {
  const out = new Map()
  for (const key of Object.keys(TIERS).map(Number).sort((a, b) => a - b)) {
    out.set(key, GENERATORS.filter((r) => r.tier === key))
  }
  return out
}

/** How many generators sit in each state. */
export function stateCounts() {
  const counts = { migrated: 0, partial: 0, unmigrated: 0 }
  for (const r of GENERATORS) counts[r.state] += 1
  return counts
}
