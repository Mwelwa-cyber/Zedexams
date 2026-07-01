/**
 * generateDiagram — HTTPS callable Cloud Function.
 *
 * Wraps the Recraft API to produce a black-and-white line-art diagram from
 * a teacher's text prompt, downloads it into Firebase Storage so the URL
 * is stable and CORS-safe, and returns the storage URL to the caller.
 *
 * Usage from client:
 *   const fn = httpsCallable(functions, 'generateDiagram');
 *   const result = await fn({
 *     prompt: 'A cross-section of human skin labelled epidermis, dermis, hypodermis',
 *     style: 'line_art', // optional
 *     size: '1365x1024', // optional
 *   });
 *   // result.data -> { url, prompt, sizeBytes, model }
 *
 * Architectural mirror of the other teacherTools callables — uses the
 * same auth gate (isStaffRole), the same usageMeter, and the same
 * Firebase Storage path layout as the Assessment Studio image upload.
 *
 * Cost note: Recraft charges ~$0.04 per 1024x1024 image; gpt-image-1
 * medium is ~$0.06. The usageMeter caps diagram generation per month per
 * plan (see PLAN_LIMITS below).
 *
 * Fallback (2026-06): when Recraft can't serve — balance ran dry mid
 * starter-pack, key revoked, outage — line-art requests automatically
 * fall back to OpenAI gpt-image-1 with the SAME B&W line-art prompt, so
 * teachers get a printable figure instead of an error. See the recraft
 * branch in runGenerateDiagram.
 */

const crypto = require("crypto");
const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");

const {getUserRole, isStaffRole} = require("../aiService");
const {assertAndIncrement} = require("./usageMeter");
const {callOpenAIImage} = require("../openaiClient");
const {generateKieImage, KieError} = require("../kieClient");

// Image providers the callable knows how to route to. Recraft is the
// default (B&W line art); OpenAI ('photoreal') is the realistic-photo
// upgrade; Kie ('kie') is the full-colour illustration upgrade.
const ALLOWED_PROVIDERS = new Set(["recraft", "openai", "kie"]);

// Recraft was decommissioned for this project (2026-06): the account is no
// longer funded, so calling it just burned a slow request that failed and fell
// back anyway. Every "recraft" (B&W line-art) request is now served directly by
// gpt-image-1 using the SAME line-art prompt — diagrams keep their clean
// printable look while all image spend moves to OpenAI, and the redraw skips
// the dead Recraft round-trip entirely. Set back to true (and re-fund
// RECRAFT_API_KEY) to re-enable Recraft.
const RECRAFT_ENABLED = false;

// Kie (full-colour illustration) is likewise disabled (2026-06): the owner
// consolidated all image generation onto OpenAI. Every "kie" request is now
// served by gpt-image-1 using the SAME colour-illustration prompt, so colour
// figures keep their bright flat look while all spend moves to OpenAI. Set back
// to true (and re-fund KIE_API_KEY) to re-enable the Kie provider.
const KIE_ENABLED = false;

// Per-request network deadlines. Without these a hung provider (Recraft, the
// OpenAI image API, or a stalled CDN download) blocks the await until the 300s
// FUNCTION timeout, at which point the platform KILLS the instance mid-await
// and returns a raw 500 — which the Firebase SDK surfaces to the client as the
// bare code name "internal" (the callable's own try/catch never runs). Bounding
// each call means a hang throws a clean error well inside the window: a slow
// Recraft falls over to OpenAI instead of taking the whole call down, and an
// exhausted chain surfaces a descriptive "took too long" instead of "internal".
// Worst-case fallback chain (Recraft→OpenAI→download) stays comfortably < 300s.
const RECRAFT_TIMEOUT_MS = 70000;
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

const RECRAFT_ENDPOINT = "https://external.api.recraft.ai/v1/images/generations";

const ALLOWED_STYLES = new Set([
  "line_art",            // vector_illustration / line_art — primary B&W
  "engraving",           // vector_illustration / engraving — denser line work
  "hand_drawn_outline",  // vector_illustration / hand_drawn_outline
  "isometric",           // vector_illustration / isometric — for diagrams
  "vector_illustration", // bare style, no substyle
]);

// Recraft size whitelist. Stuck to portrait/landscape sizes that match A4
// paper proportions (the rest of the studio renders at ~720pt width).
const ALLOWED_SIZES = new Set([
  "1024x1024",
  "1365x1024", // 4:3 landscape, fits inline diagrams nicely
  "1024x1365", // 3:4 portrait
  "1707x1024", // 5:3 panoramic
  "1024x1707", // 3:5 tall
]);

// Kie models take an aspect_ratio rather than a pixel size. Map our Recraft
// size whitelist onto the closest ratio the Kie image models support.
const KIE_ASPECT_BY_SIZE = {
  "1024x1024": "1:1",
  "1365x1024": "4:3",
  "1024x1365": "3:4",
  "1707x1024": "16:9", // 5:3 → nearest supported wide ratio
  "1024x1707": "9:16", // 3:5 → nearest supported tall ratio
};

// gpt-image-1 has its own size whitelist; map our Recraft sizes onto the
// closest equivalents. Used by both the explicit 'openai' provider and the
// Recraft→OpenAI fallback.
const OPENAI_SIZE_BY_RECRAFT_SIZE = {
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
// Both providers share the "no text labels" rule because the studio's
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
    // Kie's image models (Nano Banana, …) excel at bright, friendly colour
    // illustrations. They tend to inject captions, so the no-text rule is
    // stated emphatically — the studio's label-overlay editor adds labels.
    const guard = [
      "A clean, colourful flat illustration suitable for a school worksheet.",
      "Bright, friendly, simple shapes on a plain or white background.",
      "Absolutely no text, no words, no letters, no numbers, no labels,",
      "no captions and no watermarks anywhere in the image.",
    ].join(" ");
    return `${guard}\n\n${userPrompt}`;
  }
  // Recraft / default — B&W line art
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

function recraftStyleConfig(style) {
  // Recraft API accepts a top-level `style` and optional `substyle`. We
  // hard-pin to the vector_illustration family because raster styles look
  // bad printed in B&W on a school photocopier.
  switch (style) {
    case "engraving":
      return {style: "vector_illustration", substyle: "engraving"};
    case "hand_drawn_outline":
      return {style: "vector_illustration", substyle: "hand_drawn_outline"};
    case "isometric":
      return {style: "vector_illustration", substyle: "isometric"};
    case "vector_illustration":
      return {style: "vector_illustration"};
    case "line_art":
    default:
      return {style: "vector_illustration", substyle: "line_art"};
  }
}

async function fetchRecraftImage(apiKey, {finalPrompt, style, size}) {
  const styleConfig = recraftStyleConfig(style);
  const body = {
    prompt: finalPrompt,
    size,
    n: 1,
    response_format: "url",
    ...styleConfig,
  };
  const response = await fetchWithTimeout(RECRAFT_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }, RECRAFT_TIMEOUT_MS, "Recraft image");
  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    throw new HttpsError(
      "internal",
      `Recraft request failed (${response.status}): ${errBody.slice(0, 200)}`,
    );
  }
  const json = await response.json();
  const url = json && json.data && json.data[0] && json.data[0].url;
  if (!url) {
    throw new HttpsError("internal", "Recraft returned no image URL.");
  }
  return url;
}

// Recraft's CDN URLs expire and have CORS restrictions. We stream the PNG
// into Firebase Storage immediately so the studio gets a stable token URL
// that the preview + PDF + DOCX exporters can all read. Same flow for
// OpenAI — we accept the bytes directly there since the API returns
// b64 inline rather than a URL.
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

async function runGenerateDiagram({uid, rawInputs, recraftKey, openaiKey, kieKey, storageSubdir}) {
  const userPrompt = sanitizePrompt((rawInputs && rawInputs.prompt) || "");
  if (!userPrompt) {
    throw new HttpsError("invalid-argument", "Please describe the diagram you want to generate.");
  }

  // Provider routing. Default is recraft (B&W line-art); openai is the
  // photoreal upgrade. If 'openai' is requested but the key isn't
  // configured we fail fast — the studio should hide the toggle when
  // the key is missing, so reaching this branch means a bad request.
  const requestedProvider = String((rawInputs && rawInputs.provider) || "recraft").toLowerCase();
  const provider = ALLOWED_PROVIDERS.has(requestedProvider) ? requestedProvider : "recraft";
  if (provider === "openai" && !openaiKey) {
    throw new HttpsError(
      "failed-precondition",
      "Photoreal images are not available — admin needs to configure the OpenAI key.",
    );
  }
  // Kie (full-colour) is served by gpt-image-1 (Kie itself is disabled), so the
  // OpenAI key is what this path needs. If Kie is ever re-enabled it needs its
  // own key again.
  if (provider === "kie" && KIE_ENABLED && !kieKey) {
    throw new HttpsError(
      "failed-precondition",
      "Colour illustrations are not available — admin needs to configure the Kie API key.",
    );
  }
  if (provider === "kie" && !KIE_ENABLED && !openaiKey) {
    throw new HttpsError(
      "failed-precondition",
      "Image generation is not configured — admin needs to set the OpenAI key.",
    );
  }
  // Recraft (B&W line-art) is served by gpt-image-1 (Recraft itself is
  // disabled), so the OpenAI key is what this path actually needs. Only a
  // missing-everything config is fatal.
  if (provider === "recraft" && !openaiKey && !(RECRAFT_ENABLED && recraftKey)) {
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

  let storageSource;
  let modelId;
  let openaiSizeUsed = null;
  // The provider that actually produced the image — differs from the
  // requested provider when the Recraft→OpenAI fallback kicks in.
  let providerUsed = provider;
  if (provider === "kie" && KIE_ENABLED) {
    // Kie is asynchronous (create task → poll). generateKieImage handles
    // the polling and returns a CDN URL we then stream into Storage like
    // Recraft. Map our pixel size onto Kie's aspect_ratio + ask for 2K.
    const aspectRatio = KIE_ASPECT_BY_SIZE[size] || "4:3";
    try {
      const kieResult = await generateKieImage(kieKey, {
        prompt: finalPrompt,
        aspectRatio,
        extraInput: {resolution: "2K"},
        timeoutMs: 110000, // stay inside the 120s function timeout
      });
      storageSource = {url: kieResult.url};
      modelId = kieResult.model || "nano-banana-pro";
    } catch (err) {
      if (err instanceof KieError) {
        if (err.code === "no_key") {
          throw new HttpsError("failed-precondition", "Kie API key is not configured.");
        }
        if (err.code === "timeout") {
          throw new HttpsError("deadline-exceeded", "Image generation took too long. Please try again.");
        }
        if (err.status === 401 || err.status === 403) {
          throw new HttpsError("failed-precondition", "Kie key looks invalid — admin needs to rotate KIE_API_KEY in Firebase Secrets.");
        }
        if (err.status === 429) {
          throw new HttpsError("resource-exhausted", "Kie image API is rate-limited. Wait a moment and try again.");
        }
        throw new HttpsError("internal", `Kie image request failed: ${err.message}`);
      }
      throw err;
    }
  } else if (provider === "openai") {
    openaiSizeUsed = OPENAI_SIZE_BY_RECRAFT_SIZE[size] || "1536x1024";
    const {b64, model: usedModel} = await callOpenAIImage(openaiKey, {
      prompt: finalPrompt,
      size: openaiSizeUsed,
      quality: "medium",
    });
    storageSource = {bytes: Buffer.from(b64, "base64")};
    modelId = usedModel || "gpt-image-1";
  } else {
    // The remaining providers — recraft (B&W line art) and a disabled kie
    // (full colour) — are both served by gpt-image-1 using the prompt already
    // built for the requested provider, so each keeps its own look (line-art vs
    // colour) while billing to OpenAI. Recraft is tried first only if it has
    // been re-enabled; otherwise we go straight to gpt-image-1.
    let recraftFailure = null;
    if (provider === "recraft" && RECRAFT_ENABLED && recraftKey) {
      try {
        const recraftUrl = await fetchRecraftImage(recraftKey, {finalPrompt, style, size});
        storageSource = {url: recraftUrl};
        modelId = "recraft-v3";
      } catch (err) {
        recraftFailure = err;
      }
    }
    if (!storageSource) {
      // The key-presence gate above guarantees the OpenAI key is present here,
      // but guard anyway — `throw null` would reach clients as a bare INTERNAL
      // toast if that gate ever moves.
      if (!openaiKey) {
        throw recraftFailure ||
          new HttpsError("failed-precondition", "Image generation is not configured — admin needs to set the OpenAI key.");
      }
      console.warn("generateDiagram: serving via gpt-image-1", {
        uid,
        requested: provider,
        reason: recraftFailure ?
          String(recraftFailure.message || recraftFailure).slice(0, 300) :
          `${provider} routed to OpenAI`,
      });
      providerUsed = "openai";
      openaiSizeUsed = OPENAI_SIZE_BY_RECRAFT_SIZE[size] || "1536x1024";
      const {b64, model: usedModel} = await callOpenAIImage(openaiKey, {
        prompt: finalPrompt, // keeps the B&W line-art guard
        size: openaiSizeUsed,
        quality: "medium",
      });
      storageSource = {bytes: Buffer.from(b64, "base64")};
      modelId = usedModel || "gpt-image-1";
    }
  }

  const {url, sizeBytes} = await downloadToStorage(uid, storageSource, userPrompt, providerUsed, storageSubdir);

  // Log to a per-user history so teachers can see their generated diagrams
  // and we have an audit trail for cost reconciliation.
  try {
    await admin.firestore().collection("aiGenerationLog").add({
      uid,
      tool: "diagram",
      generator: providerUsed,
      // Cost reconciliation: mark images billed to OpenAI because Recraft
      // couldn't serve the original request.
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

function createGenerateDiagram(recraftApiKeySecret, openaiApiKeySecret, kieApiKeySecret) {
  const secrets = [];
  if (recraftApiKeySecret) secrets.push(recraftApiKeySecret);
  if (openaiApiKeySecret) secrets.push(openaiApiKeySecret);
  if (kieApiKeySecret) secrets.push(kieApiKeySecret);
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
      // usageMeter.js PLAN_LIMITS). Both providers count against the same
      // bucket — teachers shouldn't get double quota for picking photoreal.
      await assertAndIncrement(uid, "diagram");

      const recraftKey = recraftApiKeySecret ?
        (recraftApiKeySecret.value() || process.env.RECRAFT_API_KEY || "") :
        (process.env.RECRAFT_API_KEY || "");
      const openaiKey = openaiApiKeySecret
        ? (openaiApiKeySecret.value() || process.env.OPENAI_API_KEY || "")
        : (process.env.OPENAI_API_KEY || "");
      const kieKey = kieApiKeySecret
        ? (kieApiKeySecret.value() || process.env.KIE_API_KEY || "")
        : (process.env.KIE_API_KEY || "");
      try {
        return await runGenerateDiagram({uid, rawInputs: request.data, recraftKey, openaiKey, kieKey});
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
