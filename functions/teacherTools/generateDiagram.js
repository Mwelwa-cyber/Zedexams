/**
 * generateDiagram — HTTPS callable Cloud Function.
 *
 * Produces a figure from a teacher's text prompt via OpenAI gpt-image-1,
 * downloads it into Firebase Storage so the URL is stable and CORS-safe, and
 * returns the storage URL to the caller.
 *
 * Usage from client:
 *   const fn = httpsCallable(functions, 'generateDiagram');
 *   const result = await fn({
 *     prompt: 'A cross-section of human skin labelled epidermis, dermis, hypodermis',
 *     provider: 'recraft', // optional — style selector (see ALLOWED_PROVIDERS)
 *     style: 'line_art',   // optional
 *     size: '1365x1024',   // optional
 *   });
 *   // result.data -> { url, prompt, sizeBytes, model }
 *
 * Architectural mirror of the other teacherTools callables — uses the
 * same auth gate (isStaffRole), the same usageMeter, and the same
 * Firebase Storage path layout as the Assessment Studio image upload.
 *
 * Cost note: gpt-image-1 medium is ~$0.06 per image. The usageMeter caps
 * diagram generation per month per plan (see PLAN_LIMITS in usageMeter.js).
 */

const crypto = require("crypto");
const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");

const {getUserRole, isStaffRole} = require("../aiService");
const {assertAndIncrement} = require("./usageMeter");
const {callOpenAIImage} = require("../openaiClient");

// Image providers the callable knows how to route to. These are request-time
// STYLE selectors, not distinct backends: 'recraft' = B&W line art, 'openai' =
// photoreal, 'kie' = full-colour illustration. Recraft and Kie were both
// decommissioned (2026-06/07) — their external clients + API-key secrets were
// removed and every request is now served by gpt-image-1 with a
// style-appropriate prompt, so the three names still pick the look while all
// image spend goes to OpenAI.
const ALLOWED_PROVIDERS = new Set(["recraft", "openai", "kie"]);

// Recraft (B&W line-art) was decommissioned (2026-06): the account is no longer
// funded and the RECRAFT_API_KEY secret + the direct HTTP integration were
// removed. Every "recraft" request is now served directly by gpt-image-1 using
// the SAME line-art prompt — diagrams keep their clean printable look while all
// image spend moves to OpenAI. To bring Recraft back you'd re-add the
// RECRAFT_API_KEY secret and a real provider branch here.
//
// Kie (full-colour illustration) was fully decommissioned (2026-07): the owner
// consolidated all image generation onto OpenAI and the KIE_API_KEY secret +
// the kieClient integration were removed. Every "kie" request is served by
// gpt-image-1 using the colour-illustration prompt below, so colour figures
// keep their bright flat look while all spend goes to OpenAI. To bring Kie back
// you'd re-add functions/kieClient.js, the KIE_API_KEY secret, and a real
// provider branch here.

// Per-request network deadline for the image download. Without it a stalled CDN
// download blocks the await until the 300s FUNCTION timeout, at which point the
// platform KILLS the instance mid-await and returns a raw 500 — surfaced to the
// client as the bare code name "internal" (the callable's own try/catch never
// runs). Bounding the download means a hang throws a clean, descriptive error
// well inside the window.
const IMAGE_DOWNLOAD_TIMEOUT_MS = 45000;

// fetch() with an AbortController deadline. Rejects with a tagged Error on
// timeout so callers can map it to a friendly HttpsError. The timer is always
// cleared so a fast response doesn't leak a pending handle.
async function fetchWithTimeout(url, options = {}, timeoutMs = 60000, label = "request") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {...options, signal: controller.signal});
  } catch (err) {
    if (err && err.name === "AbortError") {
      const timeoutErr = new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`);
      timeoutErr.code = "timeout";
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const ALLOWED_STYLES = new Set([
  "line_art",            // vector_illustration / line_art — primary B&W
  "engraving",           // vector_illustration / engraving — denser line work
  "hand_drawn_outline",  // vector_illustration / hand_drawn_outline
  "isometric",           // vector_illustration / isometric — for diagrams
  "vector_illustration", // bare style, no substyle
]);

// Size whitelist. Stuck to portrait/landscape sizes that match A4 paper
// proportions (the rest of the studio renders at ~720pt width).
const ALLOWED_SIZES = new Set([
  "1024x1024",
  "1365x1024", // 4:3 landscape, fits inline diagrams nicely
  "1024x1365", // 3:4 portrait
  "1707x1024", // 5:3 panoramic
  "1024x1707", // 3:5 tall
]);

// gpt-image-1 has its own size whitelist; map our canonical sizes onto the
// closest equivalents.
const OPENAI_SIZE_BY_CANONICAL_SIZE = {
  "1024x1024": "1024x1024",
  "1365x1024": "1536x1024",
  "1024x1365": "1024x1536",
  "1707x1024": "1536x1024",
  "1024x1707": "1024x1536",
};

function sanitizePrompt(raw = "") {
  return String(raw)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 800);
}

// Wrap the teacher's prompt with a provider-appropriate preamble so we get
// consistent printable images without making them learn prompt-engineering.
// Every provider shares the "no text labels" rule because the studio's
// label-overlay editor adds those separately (PR #430).
function buildFinalPrompt(userPrompt, provider) {
  if (provider === "openai") {
    const guard = [
      "A realistic, detailed photograph suitable for a school exam paper.",
      "Natural lighting, sharp focus, plain white background, no people,",
      "no text overlays, no watermarks. The student should be able to",
      "identify physical features clearly.",
    ].join(" ");
    return `${guard}\n\n${userPrompt}`;
  }
  if (provider === "kie") {
    // The 'kie' selector renders bright, friendly colour illustrations via
    // gpt-image-1 (Kie was decommissioned). gpt-image-1 tends to inject
    // captions, so the no-text rule is stated emphatically — the studio's
    // label-overlay editor adds labels.
    const guard = [
      "A clean, colourful flat illustration suitable for a school worksheet.",
      "Bright, friendly, simple shapes on a plain or white background.",
      "Absolutely no text, no words, no letters, no numbers, no labels,",
      "no captions and no watermarks anywhere in the image.",
    ].join(" ");
    return `${guard}\n\n${userPrompt}`;
  }
  // Recraft / default — B&W line art (rendered by gpt-image-1)
  const guard = [
    "Clean black-and-white line art on a white background.",
    "No shading, no colour, no gradients, no photorealism.",
    "Simple thin outlines suitable for printing on a school exam paper.",
    "Absolutely no text, no letters, no numbers, no words, no captions,",
    "and no label markers (no X, no arrows, no pointer lines) anywhere in",
    "the image — labels and leader lines are added separately by the studio.",
  ].join(" ");
  return `${guard}\n\n${userPrompt}`;
}

// Generated-image CDN URLs (and gpt-image-1's inline b64) need to land on a
// stable, CORS-safe origin. We stream the PNG into Firebase Storage immediately
// so the studio gets a stable token URL that the preview + PDF + DOCX exporters
// can all read. gpt-image-1 returns b64 inline, which we accept directly.
async function downloadToStorage(uid, source, promptForMeta, generator, subdir) {
  let buffer;
  if (source.bytes) {
    buffer = source.bytes;
  } else {
    let imgResponse;
    try {
      imgResponse = await fetchWithTimeout(
        source.url, {}, IMAGE_DOWNLOAD_TIMEOUT_MS, "Image download",
      );
    } catch (err) {
      if (err && err.code === "timeout") {
        throw new HttpsError(
          "deadline-exceeded",
          "Downloading the generated image took too long. Please try again.",
        );
      }
      throw err;
    }
    if (!imgResponse.ok) {
      throw new HttpsError(
        "internal",
        `Failed to download generated image (${imgResponse.status}).`,
      );
    }
    const arrayBuffer = await imgResponse.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
  }

  const bucket = admin.storage().bucket();
  // Callers may scope the image into their own folder (e.g. slide-notes decks
  // write to `slide-notes-images/{uid}/{deckId}`). Defaults to the Assessment
  // Studio path so existing callers are unchanged.
  const baseDir = (typeof subdir === "string" && subdir.trim()) ?
    subdir.replace(/^\/+|\/+$/g, "") :
    `assessment-images/${uid}/diagrams`;
  // A short random suffix avoids collisions when several images are generated
  // within the same millisecond (the slide-notes enrichment pass fires these
  // in small concurrent batches).
  const filename = `${baseDir}/${Date.now()}-${crypto.randomBytes(4).toString("hex")}.png`;
  const file = bucket.file(filename);

  // Mint a Firebase download token so the URL we return matches what
  // `getDownloadURL()` produces on the client. `file.getSignedUrl()` was
  // previously used here but it requires the runtime service account to
  // hold `iam.serviceAccounts.signBlob`, which Firebase Functions' default
  // SA does not have — failures surfaced as an "INTERNAL" toast because
  // the underlying error was a plain Error, not an HttpsError.
  const downloadToken = crypto.randomUUID();

  try {
    await file.save(buffer, {
      resumable: false,
      contentType: "image/png",
      metadata: {
        contentType: "image/png",
        cacheControl: "public, max-age=31536000, immutable",
        metadata: {
          sourcePrompt: promptForMeta.slice(0, 500),
          generator,
          generatedAt: new Date().toISOString(),
          firebaseStorageDownloadTokens: downloadToken,
        },
      },
    });
  } catch (err) {
    console.error("generateDiagram storage save failed", {uid, filename, err});
    throw new HttpsError(
      "internal",
      `Could not save generated image to storage: ${err && err.message ? err.message : "unknown error"}`,
    );
  }

  const downloadUrl =
    `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}` +
    `/o/${encodeURIComponent(filename)}?alt=media&token=${downloadToken}`;

  return {url: downloadUrl, sizeBytes: buffer.length};
}

async function runGenerateDiagram({uid, rawInputs, openaiKey, storageSubdir}) {
  const userPrompt = sanitizePrompt((rawInputs && rawInputs.prompt) || "");
  if (!userPrompt) {
    throw new HttpsError("invalid-argument", "Please describe the diagram you want to generate.");
  }

  // Provider routing — all three names are style selectors served by
  // gpt-image-1. 'recraft' (B&W line-art) is the default, 'openai' is photoreal,
  // 'kie' is full colour. Every path needs the OpenAI key, so a missing key is
  // the only fatal config error.
  const requestedProvider = String((rawInputs && rawInputs.provider) || "recraft").toLowerCase();
  const provider = ALLOWED_PROVIDERS.has(requestedProvider) ? requestedProvider : "recraft";
  if (!openaiKey) {
    throw new HttpsError(
      "failed-precondition",
      "Image generation is not configured — admin needs to set the OpenAI key.",
    );
  }

  const requestedStyle = String((rawInputs && rawInputs.style) || "line_art").toLowerCase();
  const style = ALLOWED_STYLES.has(requestedStyle) ? requestedStyle : "line_art";

  const requestedSize = String((rawInputs && rawInputs.size) || "1365x1024");
  const size = ALLOWED_SIZES.has(requestedSize) ? requestedSize : "1365x1024";

  const finalPrompt = buildFinalPrompt(userPrompt, provider);

  const openaiSizeUsed = OPENAI_SIZE_BY_CANONICAL_SIZE[size] || "1536x1024";
  const {b64, model: usedModel} = await callOpenAIImage(openaiKey, {
    track: {uid, tool: "diagram"},
    prompt: finalPrompt, // keeps the provider-specific style guard
    size: openaiSizeUsed,
    quality: "medium",
  });
  const storageSource = {bytes: Buffer.from(b64, "base64")};
  const modelId = usedModel || "gpt-image-1";
  // Everything is billed to OpenAI now that Recraft/Kie are decommissioned, so
  // the effective generator is always "openai". For recraft/kie requests we
  // record the requested selector as `fallbackFrom` so cost reconciliation and
  // the historical visualCostReport rows still line up.
  const providerUsed = "openai";

  const {url, sizeBytes} = await downloadToStorage(uid, storageSource, userPrompt, providerUsed, storageSubdir);

  // Log to a per-user history so teachers can see their generated diagrams
  // and we have an audit trail for cost reconciliation.
  try {
    await admin.firestore().collection("aiGenerationLog").add({
      uid,
      tool: "diagram",
      generator: providerUsed,
      // Cost reconciliation: images are billed to OpenAI even when a
      // recraft/kie style was requested (both selectors render on gpt-image-1).
      ...(providerUsed !== provider ? {fallbackFrom: provider} : {}),
      prompt: userPrompt,
      style,
      size: openaiSizeUsed || size,
      url,
      sizeBytes,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (logErr) {
    console.warn("aiGenerationLog write failed:", logErr);
  }

  return {
    url,
    prompt: userPrompt,
    sizeBytes,
    model: modelId,
    provider: providerUsed,
    style,
    size: openaiSizeUsed || size,
  };
}

function createGenerateDiagram(openaiApiKeySecret) {
  const secrets = [];
  if (openaiApiKeySecret) secrets.push(openaiApiKeySecret);
  return onCall(
    {secrets, timeoutSeconds: 120, memory: "512MiB"},
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
      // Per-month quota — reuses the same usageMeter pattern as the other
      // teacher AI tools. Tracked under the `diagram` tool key (added in
      // usageMeter.js PLAN_LIMITS). All providers count against the same
      // bucket — teachers shouldn't get double quota for picking a style.
      await assertAndIncrement(uid, "diagram");

      const openaiKey = openaiApiKeySecret
        ? (openaiApiKeySecret.value() || process.env.OPENAI_API_KEY || "")
        : (process.env.OPENAI_API_KEY || "");
      try {
        return await runGenerateDiagram({uid, rawInputs: request.data, openaiKey});
      } catch (err) {
        // Re-throw HttpsError so the client gets the structured code/message.
        // Any other thrown value would otherwise be coerced by the Functions
        // runtime into a bare {code:'internal', message:'INTERNAL'} payload,
        // which is what the "INTERNAL" toast was showing teachers.
        if (err instanceof HttpsError) throw err;
        console.error("generateDiagram unexpected error", {uid, err});
        const detail = err && err.message ? err.message : "unknown error";
        throw new HttpsError("internal", `Diagram generation failed: ${detail}`);
      }
    },
  );
}

module.exports = {createGenerateDiagram, runGenerateDiagram};
