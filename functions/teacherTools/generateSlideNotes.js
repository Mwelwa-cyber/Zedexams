/**
 * generateVisualNotes — HTTPS callable Cloud Function.
 *
 * Produces a LEARNER-facing illustrated slide deck ("Chalkie-style" visual
 * notes) for a Zambian CBC topic, in two passes inside one call:
 *
 *   Pass 1 (text)   — Claude (Sonnet) emits the deck structure + a Recraft-ready
 *                     `imagePrompt` for every visual slide. No image URLs yet.
 *   Pass 2 (images) — for each imagePrompt, call the diagram generator
 *                     (Recraft line-art) and write the resulting Storage URL
 *                     back into the slide. Sequential + quota-gated so one
 *                     failed/over-quota image degrades to text-only rather than
 *                     failing the whole deck.
 *
 * Admin-only (isStaffRole). Writes a PRIVATE draft to `aiGenerations` with
 * `tool: 'slide_notes'`; a human publishes it into the learner-visible
 * `lessons` collection separately (direct admin flow — see the publish helper
 * in the Notes Studio).
 *
 * Cost note: ~10 images per deck × ~$0.04 (Recraft) ≈ $0.40/deck, paid once at
 * generation time, gated to admins.
 */

const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");

const {
  getAnthropicApiKey,
  getUserRole,
  isStaffRole,
} = require("../aiService");
const {callClaude} = require("./anthropicClient");

const {resolveCbcContext} = require("./cbcKnowledge");
const {validateSlideNotes, forEachImageTarget} = require("./slideNotesSchema");
const {PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt} =
  require("./slideNotesPrompt");
const {assertAndIncrement} = require("./usageMeter");
const {runGenerateDiagram} = require("./generateDiagram");

const SLIDE_NOTES_MODEL = process.env.SLIDE_NOTES_MODEL || "claude-sonnet-4-5";

// Recraft charges ~$0.04 per image; mirror that for the per-deck cost estimate.
const IMAGE_COST_CENTS = 4;

// Permissive top-level shape — validateSlideNotes() does the strict checking.
// Forcing tool use eliminates "AI returned non-JSON" parse failures.
const SLIDE_NOTES_TOOL_SCHEMA = {
  type: "object",
  description: "A learner-facing illustrated slide deck for a Zambian CBC topic.",
  additionalProperties: true,
  properties: {
    header: {type: "object", additionalProperties: true},
    slides: {type: "array", items: {type: "object", additionalProperties: true}},
  },
};

// Reuse the same allowlists the teacher-notes generator enforces.
const ALLOWED_GRADES = new Set([
  "ECE", "G1", "G2", "G3", "G4", "G5", "G6", "G7",
  "G8", "G9", "G10", "G11", "G12",
  "F1", "F2", "F3", "F4",
]);
const ALLOWED_SUBJECTS = new Set([
  "mathematics", "english", "integrated_science", "social_studies",
  "literacy", "numeracy", "cinyanja", "zambian_language",
  "creative_and_technology_studies",
  "physical_education", "religious_education", "civic_education",
  "biology", "chemistry", "physics", "geography", "history",
  "environmental_science", "technology_studies", "home_economics",
  "expressive_arts",
]);
const ALLOWED_LANGUAGES = new Set([
  "english", "bemba", "nyanja", "tonga", "lozi", "kaonde", "lunda", "luvale",
]);

function sanitizeInputs(raw = {}) {
  const s = (v, max) => (typeof v === "string" ?
    v.replace(/\u0000/g, "").trim().slice(0, max) : "");
  const grade = s(raw.grade, 10).toUpperCase().replace(/\s+/g, "");
  const subject = s(raw.subject, 40).toLowerCase().replace(/[^a-z_]/g, "_");
  const language = s(raw.language || "english", 20).toLowerCase();
  return {
    grade,
    subject,
    topic: s(raw.topic, 160),
    subtopic: s(raw.subtopic, 200),
    language: ALLOWED_LANGUAGES.has(language) ? language : "english",
    instructions: s(raw.instructions, 500),
  };
}

function validateInputs(inputs) {
  const errs = [];
  if (!inputs.grade || !ALLOWED_GRADES.has(inputs.grade)) {
    errs.push("Please select a valid grade.");
  }
  if (!inputs.subject || !ALLOWED_SUBJECTS.has(inputs.subject)) {
    errs.push("Please select a supported subject.");
  }
  if (!inputs.topic) {
    errs.push("Please provide a topic.");
  }
  return errs;
}

/**
 * Pass 2 — turn every slide's imagePrompt into an illustration. Sequential and
 * quota-gated: a single failure leaves that slide text-only; hitting the
 * monthly image quota stops further generation but keeps the deck.
 *
 * Mutates `deck` in place. Returns generation stats.
 */
async function enrichDeckImages({uid, deckId, deck, recraftKey}) {
  const targets = [];
  forEachImageTarget(deck, (t) => targets.push(t));

  let generated = 0;
  let failed = 0;
  let quotaReached = false;
  const subdir = `slide-notes-images/${uid}/${deckId}`;

  for (const target of targets) {
    // Stop entirely once the monthly image quota is exhausted.
    try {
      await assertAndIncrement(uid, "slide_notes_images");
    } catch (err) {
      if (err instanceof HttpsError && err.code === "failed-precondition") {
        quotaReached = true;
        break;
      }
      throw err;
    }

    try {
      const {url} = await runGenerateDiagram({
        uid,
        rawInputs: {
          prompt: target.imagePrompt,
          style: "line_art",
          size: "1365x1024",
          provider: "recraft",
        },
        recraftKey,
        storageSubdir: subdir,
      });
      target.imageUrl = url || "";
      if (url) generated += 1; else failed += 1;
    } catch (err) {
      // One bad image shouldn't sink the deck — leave it text-only.
      console.warn("slide-notes image generation failed", {
        deckId,
        message: err && err.message,
      });
      failed += 1;
    }
  }

  return {requested: targets.length, generated, failed, quotaReached};
}

async function runSlideNotes({uid, rawInputs, apiKey, recraftKey}) {
  const inputs = sanitizeInputs(rawInputs || {});

  const inputErrors = validateInputs(inputs);
  if (inputErrors.length > 0) {
    throw new HttpsError("invalid-argument", inputErrors.join(" "));
  }

  const {contextBlock, kbMatch, kbWarning, kbVersion} = await resolveCbcContext({
    grade: inputs.grade,
    subject: inputs.subject,
    topic: inputs.topic,
    subtopic: inputs.subtopic,
    ownerUid: uid,
  });

  const usage = await assertAndIncrement(uid, "slide_notes");

  const genRef = admin.firestore().collection("aiGenerations").doc();
  await genRef.set({
    ownerUid: uid,
    tool: "slide_notes",
    inputs,
    output: null,
    outputText: "",
    modelUsed: SLIDE_NOTES_MODEL,
    promptVersion: PROMPT_VERSION,
    kbVersion,
    tokensIn: 0,
    tokensOut: 0,
    costUsdCents: 0,
    imageCount: 0,
    status: "generating",
    errorMessage: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    completedAt: null,
    teacherEdited: false,
    exportedFormats: [],
    visibility: "private",
  });

  const userPrompt = buildUserPrompt(inputs);

  let parsed = null;
  let raw = "";
  let usageInfo = {inputTokens: 0, outputTokens: 0};
  let modelUsed = SLIDE_NOTES_MODEL;
  try {
    const response = await callClaude(apiKey, {
      systemPrompt: SYSTEM_PROMPT,
      cbcContextBlock: contextBlock,
      messages: [{role: "user", content: userPrompt}],
      maxTokens: 6000,
      temperature: 0.5,
      model: SLIDE_NOTES_MODEL,
      mode: "tool",
      toolName: "emit_slide_notes",
      toolDescription:
        "Emit the complete learner slide deck as a single structured object. " +
        "Do not include any prose or commentary outside this tool call.",
      toolInputSchema: SLIDE_NOTES_TOOL_SCHEMA,
    });
    parsed = response.parsed;
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

  const validation = validateSlideNotes(parsed);
  const deck = validation.value;

  const tokensIn = Number(usageInfo.inputTokens || 0);
  const tokensOut = Number(usageInfo.outputTokens || 0);
  // Sonnet pricing: ~$3/M input, $15/M output.
  const textCostCents = Math.round(
    ((tokensIn / 1e6) * 300) + ((tokensOut / 1e6) * 1500),
  );

  // If the deck structure is unusable, flag and bail before spending on images.
  if (!validation.ok || !deck || !Array.isArray(deck.slides) || deck.slides.length === 0) {
    await genRef.update({
      status: "flagged",
      errorMessage: `Schema errors: ${(validation.errors || []).join("; ")}`,
      output: deck || null,
      outputText: String(raw || "").slice(0, 20000),
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      tokensIn,
      tokensOut,
      costUsdCents: textCostCents,
      modelUsed,
    });
    return {
      generationId: genRef.id,
      deck,
      usage,
      warning: [
        "The deck structure was incomplete — please review.",
        kbWarning,
      ].filter(Boolean).join(" "),
      kbGrounded: Boolean(kbMatch),
    };
  }

  // Pass 2 — generate illustrations. Degrades gracefully on failure/quota.
  let imageStats = {requested: 0, generated: 0, failed: 0, quotaReached: false};
  try {
    imageStats = await enrichDeckImages({
      uid,
      deckId: genRef.id,
      deck,
      recraftKey,
    });
  } catch (err) {
    // Unexpected enrichment error — keep the text deck, note the problem.
    console.error("slide-notes enrichment crashed", {deckId: genRef.id, err});
  }

  const imageCostCents = imageStats.generated * IMAGE_COST_CENTS;

  const imageWarnings = [];
  if (imageStats.quotaReached) {
    imageWarnings.push(
      "Monthly image quota reached — some slides were left without illustrations.",
    );
  }
  if (imageStats.failed > 0) {
    imageWarnings.push(
      `${imageStats.failed} illustration(s) could not be generated.`,
    );
  }

  await genRef.update({
    status: "complete",
    output: deck,
    outputText: String(raw || "").slice(0, 20000),
    tokensIn,
    tokensOut,
    costUsdCents: textCostCents + imageCostCents,
    imageCount: imageStats.generated,
    modelUsed,
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    generationId: genRef.id,
    deck,
    usage,
    imageStats,
    warning: [kbWarning, ...imageWarnings].filter(Boolean).join(" ") || null,
    kbGrounded: Boolean(kbMatch),
  };
}

function createGenerateSlideNotes(anthropicApiKeySecret, recraftApiKeySecret) {
  const secrets = [anthropicApiKeySecret];
  if (recraftApiKeySecret) secrets.push(recraftApiKeySecret);
  return onCall(
    // Images run sequentially, so allow the full 5-minute ceiling for a
    // 10-image deck. 512MiB is plenty (we stream PNGs, never hold many).
    {secrets, timeoutSeconds: 300, memory: "512MiB"},
    async (request) => {
      const uid = request.auth && request.auth.uid;
      if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
      const role = await getUserRole(uid);
      if (!isStaffRole(role)) {
        throw new HttpsError(
          "permission-denied",
          "Visual notes are available to approved staff only.",
        );
      }
      const apiKey = getAnthropicApiKey(anthropicApiKeySecret);
      const recraftKey = recraftApiKeySecret ?
        (recraftApiKeySecret.value() || process.env.RECRAFT_API_KEY || "") :
        (process.env.RECRAFT_API_KEY || "");
      try {
        return await runSlideNotes({uid, rawInputs: request.data, apiKey, recraftKey});
      } catch (err) {
        if (err instanceof HttpsError) throw err;
        console.error("generateVisualNotes unexpected error", {uid, err});
        const detail = err && err.message ? err.message : "unknown error";
        throw new HttpsError("internal", `Visual notes generation failed: ${detail}`);
      }
    },
  );
}

module.exports = {createGenerateSlideNotes, runSlideNotes, enrichDeckImages};
