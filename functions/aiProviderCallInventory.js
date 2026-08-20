/**
 * Machine-readable inventory of every AUTHENTICATED, USER-INVOKABLE Cloud
 * Function that can reach a billable AI provider (Anthropic / OpenAI / Gemini /
 * gpt-image-1 / Google TTS / embeddings / vision-OCR). Each entry declares the
 * limiter that guards it. aiProviderCallInventory.test.js reads the source of
 * each entry and FAILS if a provider-backed surface has lost its burst limiter
 * — so a future provider-backed endpoint added without a limiter (or an
 * accidental removal) is caught in CI (B3 / OBS-005 coverage guard).
 *
 * `check` is the substring proving the limiter is wired in that file:
 *   - generators use assertGeneratorRateLimit(request, "<tool>")
 *   - callables use assertCallableRateLimit(request, {action:"<name>", …})
 *   - HTTP endpoints use assert/guardHttpRateLimit(… action:"<name>" …)
 * Add a new provider-backed endpoint → add its row here (or to EXEMPT with a
 * reason). There is no silent "covered because a sibling is".
 */

"use strict";

// file paths are relative to the functions/ directory.
const LIMITED = [
  // ── teacher-tool generators (assertGeneratorRateLimit, gen:<tool>) ────────
  {name: "generateLessonPlan", file: "teacherTools/generateLessonPlan.js", check: 'assertGeneratorRateLimit(request, "lesson_plan")'},
  {name: "generateWorksheet", file: "teacherTools/generateWorksheet.js", check: 'assertGeneratorRateLimit(request, "worksheet")'},
  {name: "generateFlashcards", file: "teacherTools/generateFlashcards.js", check: 'assertGeneratorRateLimit(request, "flashcards")'},
  {name: "generateSchemeOfWork", file: "teacherTools/generateSchemeOfWork.js", check: 'assertGeneratorRateLimit(request, "scheme_of_work")'},
  {name: "generateRubric", file: "teacherTools/generateRubric.js", check: 'assertGeneratorRateLimit(request, "rubric")'},
  {name: "generateNotes", file: "teacherTools/generateNotes.js", check: 'assertGeneratorRateLimit(request, "notes")'},
  {name: "generateVisualNotes", file: "teacherTools/generateSlideNotes.js", check: 'assertGeneratorRateLimit(request, "slide_notes")'},
  {name: "generateHomework", file: "teacherTools/generateHomework.js", check: 'assertGeneratorRateLimit(request, "homework")'},
  {name: "generateLessonActivities", file: "teacherTools/generateLessonActivities.js", check: 'assertGeneratorRateLimit(request, "lesson_activities")'},
  {name: "generateAssessment", file: "teacherTools/generateAssessment.js", check: 'assertGeneratorRateLimit(request, "assessment")'},
  {name: "generateSbaTask", file: "teacherTools/generateSbaTask.js", check: 'assertGeneratorRateLimit(request, "sba_task")'},
  {name: "generateQuiz", file: "teacherTools/generateQuiz.js", check: 'assertGeneratorRateLimit(request, "quiz")'},
  {name: "generateDiagram", file: "teacherTools/generateDiagram.js", check: 'assertGeneratorRateLimit(request, "diagram")'},
  {name: "generateNotePictures", file: "teacherTools/generateNotePictures.js", check: 'assertGeneratorRateLimit(request, "note_pictures")'},

  // ── other callables (assertCallableRateLimit, action:<name>) ─────────────
  {name: "generateNoteInsights", file: "noteAiHandlers.js", check: 'action: "generateNoteInsights"'},
  {name: "generateNoteSmart", file: "noteAiHandlers.js", check: 'action: "generateNoteSmart"'},
  {name: "verifyQuiz", file: "quizAiHandlers.js", check: 'action: "verifyQuiz"'},
  {name: "structureImportedQuiz", file: "quizAiHandlers.js", check: 'action: "structureImportedQuiz"'},
  {name: "structureScannedQuiz", file: "quizAiHandlers.js", check: 'action: "structureScannedQuiz"'},
  {name: "ocrNotePages", file: "noteAiHandlers.js", check: 'action: "ocrNotePages"'},
  {name: "autoLabelDiagram", file: "visualAiHandlers.js", check: 'action: "autoLabelDiagram"'},
  {
    name: "extractClassListPages",
    file: "visualAiHandlers.js",
    check: 'action: "extractClassListPages"',
  },
  {name: "checkShortAnswer", file: "quizAiHandlers.js", check: 'action: "checkShortAnswer"'},
  {name: "explainAnswer", file: "quizAiHandlers.js", check: 'action: "explainAnswer"'},
  {name: "editQuizQuestion", file: "quizAiHandlers.js", check: 'action: "editQuizQuestion"'},
  {name: "generateQuizQuestions", file: "quizAiHandlers.js", check: 'action: "generateQuizQuestions"'},
  {name: "suggestQuizAnswers", file: "quizAiHandlers.js", check: 'action: "suggestQuizAnswers"'},
  {name: "structureImportedNote", file: "noteAiHandlers.js", check: 'action: "structureImportedNote"'},
  {name: "classifyQuestionGrades", file: "agentOpsHandlers.js", check: 'action: "classifyQuestionGrades"'},
  {name: "nameBankPictures", file: "visualAiHandlers.js", check: 'action: "nameBankPictures"'},
  {name: "retryAgentJob", file: "agentOpsHandlers.js", check: 'action: "retryAgentJob"'},
  {name: "runDawnBriefing", file: "agentOpsHandlers.js", check: 'action: "runDawnBriefing"'},
  {name: "generateStudyPlan", file: "studentAgents.js", check: 'action: "generateStudyPlan"'},
  {name: "extractAssessmentFormat", file: "teacherTools/extractAssessmentFormat.js", check: 'action: "extractAssessmentFormat"'},
  {name: "importPastPaperQuestions", file: "teacherTools/pastPaperImport.js", check: 'action: "past-paper-import"'},
  {name: "analyzePaperLayout", file: "teacherTools/testPaperImport/layoutPass.js", check: 'action: "paper-layout"'},
  {name: "suggestAnswer", file: "teacherTools/suggestAnswer.js", check: 'action: "suggestAnswer"'},
  {name: "reviseQuestion", file: "teacherTools/reviseQuestion.js", check: 'action: "reviseQuestion"'},
  {name: "regenerateAssessmentQuestion", file: "teacherTools/regenerateAssessmentQuestion.js", check: 'action: "regenerateAssessmentQuestion"'},
  {name: "aiLessonCount", file: "teacherTools/lessonCount.js", check: 'action: "aiLessonCount"'},
  {name: "reviseLessonSection", file: "teacherTools/reviseLessonSection.js", check: 'action: "reviseLessonSection"'},
  {name: "studioGenerateLessonPlan", file: "teacherTools/studioLessonPlan.js", check: 'action: "studioGenerateLessonPlan"'},
  {name: "redrawTestPaperDiagram", file: "teacherTools/testPaperImport/redrawTestPaperDiagram.js", check: 'action: "redrawTestPaperDiagram"'},
  {name: "rebuildTableFromImage", file: "teacherTools/testPaperImport/rebuildTable.js", check: 'action: "rebuildTableFromImage"'},
  {name: "checkVisualSafety", file: "visualSafety.js", check: 'action: "checkVisualSafety"'},
  {name: "analyzeExamPaper", file: "teacherTools/examPaperLibrary.js", check: 'action: "analyzeExamPaper"'},
  {name: "synthesizeAssessmentFormat", file: "teacherTools/examPaperLibrary.js", check: 'action: "synthesizeAssessmentFormat"'},
  {name: "extractTopicsFromPdf", file: "teacherTools/extractTopicsFromPdf.js", check: 'action: "extractTopicsFromPdf"'},
  {name: "uploadCurriculumModule", file: "teacherTools/uploadCurriculumModule.js", check: 'action: "uploadCurriculumModule"'},
  {name: "getPlatformHealth", file: "agents/platformHealth.js", check: 'action: "getPlatformHealth"'},

  // ── HTTP endpoints (assert/guardHttpRateLimit) ───────────────────────────
  {name: "apiGenerateLessonPlan", file: "index.js", check: 'action: `stream_${tool}`'},
  {name: "apiGenerateWorksheet", file: "index.js", check: 'action: `stream_${tool}`'},
  {name: "apiTextToSpeech", file: "tts.js", check: "action: 'tts'"},
  {name: "getTtsControlRoom", file: "ttsAdmin.js", check: 'action: "getTtsControlRoom"'},
  {name: "setTtsOfferedVoices", file: "ttsAdmin.js", check: 'action: "setTtsOfferedVoices"'},
  {name: "previewTtsVoice", file: "ttsAdmin.js", check: 'action: "previewTtsVoice"'},
];

// Provider-backed endpoints that intentionally carry NO per-user burst limiter.
// The auto-discovery guard (aiEndpointDiscovery.js) excludes crons/triggers by
// KIND, but any provider-backed CALLABLE/HTTP surface that is deliberately not
// rate-limited must be listed here BY ITS EXACT EXPORT NAME with a reason —
// otherwise the guard fails it as unclassified. `name` is matched against the
// discovered export name; the extra descriptive rows document trigger/cron
// families for humans (matched by name is not required for those — kind already
// exempts them).
const EXEMPT = [
  // The one provider-backed HTTP surface with no per-user limiter: it is not an
  // authenticated user endpoint. Its own controls are the X-Hub-Signature-256
  // HMAC (fail-closed once the secret is set), per-message-id dedupe, and the
  // agentControl/bonga.paused kill-switch.
  {name: "apiWhatsAppWebhook", reason: "Meta webhook (HMAC-verified), not an authenticated user surface; Meta msg-id dedupe + kill-switch"},

  // Provider-backed Firestore triggers / cron families — excluded from the
  // user-burstable requirement by KIND (onDocument*/onSchedule have no client
  // entry point). Listed for documentation only.
  {name: "questionReviewOnWrite", reason: "Firestore trigger (Qix) on questionBank writes"},
  {name: "lessonPlanTemplateOnWrite", reason: "Firestore trigger"},
  {name: "agentJobsOnCreate", reason: "Firestore trigger (agent dispatcher)"},
  {name: "scheduled agents (Vigil/Marshal/Echo/Gate/Dawn/…)", reason: "cron; no user entry point"},
];

module.exports = {LIMITED, EXEMPT};
