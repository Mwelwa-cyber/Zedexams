/**
 * generateFlashcards — HTTPS callable Cloud Function.
 *
 * Usage:
 *   const fn = httpsCallable(functions, 'generateFlashcards');
 *   const result = await fn({
 *     grade: 'G5', subject: 'mathematics', topic: 'Fractions',
 *     count: 15, difficulty: 'mixed', language: 'english', instructions: ''
 *   });
 *   // result.data -> { generationId, flashcards, usage, warning?, kbGrounded }
 */

const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");

const {
  getAnthropicApiKey,
  getUserRole,
  isStaffRole,
  stripJsonFences,
} = require("../aiService");
const {callClaude} = require("./anthropicClient");

const {resolveCbcContext, KB_VERSION} = require("./cbcKnowledge");
const {validateFlashcards} = require("./flashcardSchema");
const {PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt} =
  require("./flashcardPrompt");
const {assertAndIncrement} = require("./usageMeter");

const FLASHCARDS_MODEL = process.env.FLASHCARDS_MODEL || "claude-haiku-4-5";

const ALLOWED_GRADES = new Set([
  "ECE", "G1", "G2", "G3", "G4", "G5", "G6", "G7",
  "G8", "G9", "G10", "G11", "G12",
]);
const ALLOWED_SUBJECTS = new Set([
  "mathematics", "english", "integrated_science", "social_studies",
  "literacy", "zambian_language", "creative_and_technology_studies",
  "physical_education", "religious_education", "civic_education",
  "biology", "chemistry", "physics", "geography", "history",
]);
const ALLOWED_LANGUAGES = new Set([
  "english", "bemba", "nyanja", "tonga", "lozi", "kaonde", "lunda", "luvale",
]);
const ALLOWED_DIFFICULTIES = new Set(["easy", "medium", "hard", "mixed"]);

function sanitizeInputs(raw = {}) {
  const str = (v, max) => (typeof v === "string" ?
    v.replace(/\u0000/g, "").trim().slice(0, max) : "");
  const num = (v, def) => (Number.isFinite(Number(v)) ? Number(v) : def);

  const grade = str(raw.grade, 10).toUpperCase().replace(/\s+/g, "");
  const subject = str(raw.subject, 40).toLowerCase().replace(/[^a-z_]/g, "_");
  const language = str(raw.language || "english", 20).toLowerCase();
  const difficulty = str(raw.difficulty || "mixed", 10).toLowerCase();

  return {
    grade,
    subject,
    topic: str(raw.topic, 120),
    subtopic: str(raw.subtopic, 160),
    count: Math.min(40, Math.max(5, Math.round(num(raw.count, 15)))),
    difficulty: ALLOWED_DIFFICULTIES.has(difficulty) ? difficulty : "mixed",
    language: ALLOWED_LANGUAGES.has(language) ? language : "english",
    instructions: str(raw.instructions, 500),
  };
}

function validateInputs(inputs) {
  const errs = [];
  if (!inputs.grade || !ALLOWED_GRADES.has(inputs.grade)) {
    errs.push("Please select a grade from ECE–G12.");
  }
  if (!inputs.subject || !ALLOWED_SUBJECTS.has(inputs.subject)) {
    errs.push("Please select a supported subject.");
  }
  if (!inputs.topic) {
    errs.push("Please enter a topic.");
  }
  return errs;
}

function createGenerateFlashcards(anthropicApiKeySecret) {
  return onCall(
    {secrets: [anthropicApiKeySecret], timeoutSeconds: 90, memory: "512MiB"},
    async (request) => {
      const uid = request.auth && request.auth.uid;
      if (!uid) {
        throw new HttpsError("unauthenticated", "Please sign in.");
      }
      const role = await getUserRole(uid);
      if (!isStaffRole(role)) {
        throw new HttpsError(
          "permission-denied",
          "Teacher tools are available to approved teachers only.",
        );
      }

      const inputs = sanitizeInputs(request.data || {});
      const inputErrors = validateInputs(inputs);
      if (inputErrors.length > 0) {
        throw new HttpsError("invalid-argument", inputErrors.join(" "));
      }

      const {contextBlock, kbMatch, kbWarning} = await resolveCbcContext({
        grade: inputs.grade,
        subject: inputs.subject,
        topic: inputs.topic,
        subtopic: inputs.subtopic,
      });

      const usage = await assertAndIncrement(uid, "flashcards");

      const genRef = admin.firestore().collection("aiGenerations").doc();
      await genRef.set({
        ownerUid: uid,
        tool: "flashcards",
        inputs,
        output: null,
        outputText: "",
        modelUsed: FLASHCARDS_MODEL,
        promptVersion: PROMPT_VERSION,
        kbVersion: KB_VERSION,
        tokensIn: 0,
        tokensOut: 0,
        costUsdCents: 0,
        status: "generating",
        errorMessage: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        completedAt: null,
        teacherEdited: false,
        exportedFormats: [],
        visibility: "private",
      });

      let apiKey;
      try {
        apiKey = getAnthropicApiKey(anthropicApiKeySecret);
      } catch (err) {
        await genRef.update({status: "failed", errorMessage: "AI key missing"});
        throw err;
      }

      const userPrompt = buildUserPrompt(inputs);
      let raw = "";
      let usageInfo = {inputTokens: 0, outputTokens: 0};
      let modelUsed = FLASHCARDS_MODEL;
      try {
        const response = await callClaude(apiKey, {
          systemPrompt: SYSTEM_PROMPT,
          cbcContextBlock: contextBlock,
          messages: [{role: "user", content: userPrompt}],
          maxTokens: 3000,
          temperature: 0.4,
          model: FLASHCARDS_MODEL,
        });
        raw = response.text || "";
        usageInfo = response.usage || usageInfo;
        modelUsed = response.model || modelUsed;
      } catch (err) {
        await genRef.update({
          status: "failed",
          errorMessage: String(err && err.message || err).slice(0, 500),
        });
        throw err;
      }

      let parsed;
      try {
        parsed = JSON.parse(stripJsonFences(raw));
      } catch (err) {
        await genRef.update({
          status: "failed",
          errorMessage: "AI returned non-JSON output",
          outputText: String(raw || "").slice(0, 12000),
        });
        throw new HttpsError(
          "internal",
          "The AI returned an unexpected response. Please try again.",
        );
      }

      const validation = validateFlashcards(parsed);
      const flashcards = validation.value;
      if (!validation.ok) {
        await genRef.update({
          status: "flagged",
          errorMessage: `Schema errors: ${validation.errors.join("; ")}`,
          output: flashcards,
          outputText: String(raw || "").slice(0, 20000),
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
          tokensIn: Number(usageInfo.inputTokens || 0),
          tokensOut: Number(usageInfo.outputTokens || 0),
          modelUsed,
        });
        return {
          generationId: genRef.id,
          flashcards,
          usage,
          warning: [
            "Some cards were incomplete — please review.",
            kbWarning,
          ].filter(Boolean).join(" "),
          kbGrounded: Boolean(kbMatch),
        };
      }

      const tokensIn = Number(usageInfo.inputTokens || 0);
      const tokensOut = Number(usageInfo.outputTokens || 0);
      // Haiku 4.5 pricing: $1/M input, $5/M output.
      const costUsdCents = Math.round(
        ((tokensIn / 1e6) * 100) + ((tokensOut / 1e6) * 500),
      );
      await genRef.update({
        status: "complete",
        output: flashcards,
        outputText: String(raw || "").slice(0, 20000),
        tokensIn,
        tokensOut,
        costUsdCents,
        modelUsed,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {
        generationId: genRef.id,
        flashcards,
        usage,
        warning: kbWarning || null,
        kbGrounded: Boolean(kbMatch),
      };
    },
  );
}

module.exports = {createGenerateFlashcards};
