/**
 * checkVisualSafety — on-demand AI safety/accuracy review for a generated
 * Visual Studio image (brief item 11).
 *
 * A teacher clicks "Check image" after generating; this sends the picture to
 * Claude (Haiku vision — cheap) with the grade/subject/topic context and asks
 * whether it is classroom-suitable: age-appropriate, on-topic, correctly
 * spelled labels, anatomically/scientifically plausible, and printable in
 * black and white. Returns a structured verdict the studio surfaces as a
 * warning. It is NOT run automatically on every generation — the teacher opts
 * in, so there is no per-image cost surprise.
 *
 * Mirrors the verifyQuiz callable: staff-only, daily-limited, Anthropic via the
 * shared callAnthropic. The prompt-build + parse helpers are pure so they can
 * be unit-tested under plain `node`.
 */

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {assertVerifiedAuth} = require("./authGuard");
const {
  callAnthropic, getUserRole, isStaffRole, assertDailyLimit, getAnthropicApiKey,
} = require("./aiService");
const {
  SAFETY_MODEL, SAFETY_SYSTEM_PROMPT, buildSafetyUserPrompt, parseSafetyResult,
} = require("./visualSafetyCore");

// Only our own Storage bucket images are fetched server-side (SSRF guard).
const ALLOWED_IMAGE_HOST = /^https:\/\/firebasestorage\.googleapis\.com\//i;
const ALLOWED_MEDIA = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // ~5 MB cap on what we base64 to the model

async function fetchImageAsBase64(imageUrl) {
  const resp = await fetch(imageUrl);
  if (!resp.ok) {
    throw new HttpsError("invalid-argument", `Could not load the image (${resp.status}).`);
  }
  // Reject oversized objects BEFORE buffering them into memory. Firebase
  // Storage always returns Content-Length, so this catches the OOM/timeout case
  // up front; the post-read check below is a backstop for chunked responses.
  const declaredLen = Number(resp.headers.get("content-length") || 0);
  if (declaredLen > MAX_IMAGE_BYTES) {
    throw new HttpsError("invalid-argument", "Image is too large to check (over 5 MB).");
  }
  const declared = String(resp.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const mediaType = ALLOWED_MEDIA.has(declared) ? declared : "image/png";
  const buf = Buffer.from(await resp.arrayBuffer());
  if (!buf.length) throw new HttpsError("invalid-argument", "The image was empty.");
  if (buf.length > MAX_IMAGE_BYTES) {
    throw new HttpsError("invalid-argument", "Image is too large to check (over 5 MB).");
  }
  return {data: buf.toString("base64"), mediaType};
}

async function runVisualSafety({rawInputs, apiKey}) {
  const imageUrl = String((rawInputs && rawInputs.imageUrl) || "").trim();
  if (!imageUrl) throw new HttpsError("invalid-argument", "No image to check.");
  if (!ALLOWED_IMAGE_HOST.test(imageUrl)) {
    throw new HttpsError(
      "invalid-argument",
      "Only images saved in ZedExams can be checked. Save the picture first, then check it.",
    );
  }
  const {data, mediaType} = await fetchImageAsBase64(imageUrl);
  const context = (rawInputs && rawInputs.context) || {};
  const messages = [{
    role: "user",
    content: [
      {type: "image", source: {type: "base64", media_type: mediaType, data}},
      {type: "text", text: buildSafetyUserPrompt(context)},
    ],
  }];
  const text = await callAnthropic(apiKey, {
    systemPrompt: SAFETY_SYSTEM_PROMPT,
    messages,
    maxTokens: 500,
    temperature: 0.1,
    model: SAFETY_MODEL,
  });
  return parseSafetyResult(text);
}

function createCheckVisualSafety(anthropicApiKeySecret) {
  return onCall(
    {secrets: [anthropicApiKeySecret], region: "us-central1", timeoutSeconds: 60, memory: "512MiB"},
    async (request) => {
      await assertVerifiedAuth(request);
      const role = await getUserRole(request.auth.uid);
      if (!isStaffRole(role)) {
        throw new HttpsError("permission-denied", "Only teachers and admins can check images.");
      }
      await assertDailyLimit(request.auth.uid, role, "checkVisualSafety");
      const apiKey = getAnthropicApiKey(anthropicApiKeySecret);
      try {
        return await runVisualSafety({rawInputs: request.data, apiKey});
      } catch (err) {
        if (err instanceof HttpsError) throw err;
        console.error("checkVisualSafety error", {uid: request.auth.uid, err});
        throw new HttpsError("internal", "The safety check failed. Please try again.");
      }
    },
  );
}

module.exports = {
  createCheckVisualSafety,
  runVisualSafety,
};
