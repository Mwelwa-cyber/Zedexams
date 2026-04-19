/**
 * generateWorksheet — HTTPS callable Cloud Function.
 *
 * Usage from client:
 *   const fn = httpsCallable(functions, 'generateWorksheet');
 *   const result = await fn({
 *     grade: 'G5', subject: 'mathematics', topic: 'Fractions',
 *     count: 10, difficulty: 'mixed', durationMinutes: 30,
 *     language: 'english', includeAnswerKey: true, instructions: ''
 *   });
 *   // result.data -> { generationId, worksheet, usage, warning?, kbGrounded }
 *
 * Architectural mirror of generateLessonPlan — same flow, different
 * prompt/schema. Routes to Haiku by default since worksheets are smaller
 * than lesson plans and don't benefit from Sonnet's deeper reasoning.
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
const {validateWorksheet} = require("./worksheetSchema");
const {PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt} =
  require("./worksheetPrompt");
const {assertAndIncrement} = require("./usageMeter");

// Worksheet-specific model. Haiku is ~5× cheaper and plenty capable for
// structured Q&A generation. Teacher can override via an admin toggle later.
const WORKSHEET_MODEL = process.env.WORKSHEET_MODEL || "claude-haiku-4-5";

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
    count: Math.min(25, Math.max(3, Math.round(num(raw.count, 10)))),
    difficulty: ALLOWED_DIFFICULTIES.has(difficulty) ? difficulty : "mixed",
    durationMinutes: Math.min(120, Math.max(10, Math.round(num(raw.durationMinutes, 30)))),
    language: ALLOWED_LANGUAGES.has(language) ? language : "english",
    includeAnswerKey: raw.includeAnswerKey !== false,
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

function createGenerateWorksheet(anthropicApiKeySecret) {
  return onCall(
    {secrets: [anthropicApiKeySecret], timeoutSeconds: 120, memory: "512MiB"},
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

      // 1. Sanitise + validate inputs.
      const inputs = sanitizeInputs(request.data || {});
      const inputErrors = validateInputs(inputs);
      if (inputErrors.length > 0) {
        throw new HttpsError("invalid-argument", inputErrors.join(" "));
      }

      // 2. CBC context (with graceful fallback).
      const {contextBlock, kbMatch, kbWarning} = resolveCbcContext({
        grade: inputs.grade,
        subject: inputs.subject,
        topic: inputs.topic,
        subtopic: inputs.subtopic,
      });

      // 3. Enforce monthly quota.
      const usage = await assertAndIncrement(uid, "worksheet");

      // 4. Reserve generation doc.
      const genRef = admin.firestore().collection("aiGenerations").doc();
      await genRef.set({
        ownerUid: uid,
        tool: "worksheet",
        inputs,
        output: null,
        outputText: "",
        modelUsed: WORKSHEET_MODEL,
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

      // 5. Call Claude.
      let apiKey;
      try {
        apiKey = getAnthropicApiKey(anthropicApiKeySecret);
      } catch (err) {
        await genRef.update({status: "failed", errorMessage: "AI key missing"});
        throw err;
      }

      const userPrompt = buildUserPrompt(inputs, contextBlock);
      let raw = "";
      let usageInfo = {inputTokens: 0, outputTokens: 0};
      let modelUsed = WORKSHEET_MODEL;
      try {
        const response = await callClaude(apiKey, {
          systemPrompt: SYSTEM_PROMPT,
          messages: [{role: "user", content: userPrompt}],
          maxTokens: 4000,
          temperature: 0.4,
          model: WORKSHEET_MODEL,
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

      // 6. Parse JSON.
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

      // 7. Validate against schema.
      const validation = validateWorksheet(parsed);
      const worksheet = validation.value;
      if (!validation.ok) {
        await genRef.update({
          status: "flagged",
          errorMessage: `Schema errors: ${validation.errors.join("; ")}`,
          output: worksheet,
          outputText: String(raw || "").slice(0, 20000),
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
          tokensIn: Number(usageInfo.inputTokens || 0),
          tokensOut: Number(usageInfo.outputTokens || 0),
          modelUsed,
        });
        return {
          generationId: genRef.id,
          worksheet,
          usage,
          warning: [
            "Some fields were incomplete — please review carefully.",
            kbWarning,
          ].filter(Boolean).join(" "),
          kbGrounded: Boolean(kbMatch),
        };
      }

      // 8. Happy path.
      const tokensIn = Number(usageInfo.inputTokens || 0);
      const tokensOut = Number(usageInfo.outputTokens || 0);
      // Haiku 4.5 approx pricing: $1/M input, $5/M output (~5× cheaper than Sonnet).
      const costUsdCents = Math.round(
        ((tokensIn / 1e6) * 100) + ((tokensOut / 1e6) * 500),
      );
      await genRef.update({
        status: "complete",
        output: worksheet,
        outputText: String(raw || "").slice(0, 20000),
        tokensIn,
        tokensOut,
        costUsdCents,
        modelUsed,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {
        generationId: genRef.id,
        worksheet,
        usage,
        warning: kbWarning || null,
        kbGrounded: Boolean(kbMatch),
      };
    },
  );
}

module.exports = {createGenerateWorksheet};
