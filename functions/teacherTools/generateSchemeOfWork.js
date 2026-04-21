/**
 * generateSchemeOfWork — HTTPS callable Cloud Function.
 *
 * Usage from client:
 *   const fn = httpsCallable(functions, 'generateSchemeOfWork');
 *   const result = await fn({
 *     grade: 'G5', subject: 'mathematics', term: 2, numberOfWeeks: 12,
 *     school: '...', teacherName: '...', language: 'english', instructions: ''
 *   });
 */

const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");

const {
  getAnthropicApiKey,
  getUserRole,
  isStaffRole,
  stripJsonFences,
} = require("../aiService");
const {callClaude, DEFAULT_MODEL} = require("./anthropicClient");

const {resolveCbcContext, KB_VERSION} = require("./cbcKnowledge");
const {validateSchemeOfWork} = require("./schemeOfWorkSchema");
const {PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt} =
  require("./schemeOfWorkPrompt");
const {assertAndIncrement} = require("./usageMeter");

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

function sanitizeInputs(raw = {}) {
  const str = (v, max) => (typeof v === "string" ?
    v.replace(/\u0000/g, "").trim().slice(0, max) : "");
  const num = (v, def) => (Number.isFinite(Number(v)) ? Number(v) : def);

  const grade = str(raw.grade, 10).toUpperCase().replace(/\s+/g, "");
  const subject = str(raw.subject, 40).toLowerCase().replace(/[^a-z_]/g, "_");
  const language = str(raw.language || "english", 20).toLowerCase();

  return {
    grade,
    subject,
    term: Math.min(3, Math.max(1, Math.round(num(raw.term, 1)))),
    numberOfWeeks: Math.min(15, Math.max(6, Math.round(num(raw.numberOfWeeks, 12)))),
    language: ALLOWED_LANGUAGES.has(language) ? language : "english",
    teacherName: str(raw.teacherName, 80),
    school: str(raw.school, 120),
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
  return errs;
}

function createGenerateSchemeOfWork(anthropicApiKeySecret) {
  return onCall(
    {secrets: [anthropicApiKeySecret], timeoutSeconds: 180, memory: "512MiB"},
    async (request) => {
      const uid = request.auth && request.auth.uid;
      if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
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

      // CBC context — scheme-of-work uses the broad grade+subject context,
      // not a specific topic, so we pass the term as the topic anchor.
      const {contextBlock, kbMatch, kbWarning} = await resolveCbcContext({
        grade: inputs.grade,
        subject: inputs.subject,
        topic: `Term ${inputs.term} overview`,
        subtopic: "",
      });

      const usage = await assertAndIncrement(uid, "scheme_of_work");

      const genRef = admin.firestore().collection("aiGenerations").doc();
      await genRef.set({
        ownerUid: uid,
        tool: "scheme_of_work",
        inputs,
        output: null,
        outputText: "",
        modelUsed: "claude-sonnet-4-5",
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
      let modelUsed = DEFAULT_MODEL;
      try {
        const response = await callClaude(apiKey, {
          systemPrompt: SYSTEM_PROMPT,
          cbcContextBlock: contextBlock,
          messages: [{role: "user", content: userPrompt}],
          maxTokens: 8000,   // schemes are long
          temperature: 0.3,
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
      } catch {
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

      const validation = validateSchemeOfWork(parsed);
      const scheme = validation.value;
      if (!validation.ok) {
        await genRef.update({
          status: "flagged",
          errorMessage: `Schema errors: ${validation.errors.join("; ")}`,
          output: scheme,
          outputText: String(raw || "").slice(0, 20000),
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
          tokensIn: Number(usageInfo.inputTokens || 0),
          tokensOut: Number(usageInfo.outputTokens || 0),
          modelUsed,
        });
        return {
          generationId: genRef.id,
          schemeOfWork: scheme,
          usage,
          warning: [
            "Some fields were incomplete — please review.",
            kbWarning,
          ].filter(Boolean).join(" "),
          kbGrounded: Boolean(kbMatch),
        };
      }

      const tokensIn = Number(usageInfo.inputTokens || 0);
      const tokensOut = Number(usageInfo.outputTokens || 0);
      const costUsdCents = Math.round(
        ((tokensIn / 1e6) * 300) + ((tokensOut / 1e6) * 1500),
      );
      await genRef.update({
        status: "complete",
        output: scheme,
        outputText: String(raw || "").slice(0, 20000),
        tokensIn,
        tokensOut,
        costUsdCents,
        modelUsed,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {
        generationId: genRef.id,
        schemeOfWork: scheme,
        usage,
        warning: kbWarning || null,
        kbGrounded: Boolean(kbMatch),
      };
    },
  );
}

module.exports = {createGenerateSchemeOfWork};
