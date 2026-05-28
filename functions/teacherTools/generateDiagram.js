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
 * Cost note: Recraft charges ~$0.04 per 1024x1024 image. The usageMeter
 * caps diagram generation per month per plan (see PLAN_LIMITS below).
 */

const crypto = require("crypto");
const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");

const {getUserRole, isStaffRole} = require("../aiService");
const {assertAndIncrement} = require("./usageMeter");
const {callOpenAIImage} = require("../openaiClient");

// Image providers the callable knows how to route to. Recraft is the
// default; OpenAI ('photoreal') is the optional photoreal upgrade.
const ALLOWED_PROVIDERS = new Set(["recraft", "openai"]);

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
  // Recraft / default — B&W line art
  const guard = [
    "Clean black-and-white line art on a white background.",
    "No shading, no colour, no gradients, no photorealism.",
    "Simple thin outlines suitable for printing on a school exam paper.",
    "No text labels in the image — labels will be added separately.",
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
  const response = await fetch(RECRAFT_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
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
    const imgResponse = await fetch(source.url);
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

async function runGenerateDiagram({uid, rawInputs, recraftKey, openaiKey, storageSubdir}) {
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
  if (provider === "recraft" && !recraftKey) {
    throw new HttpsError("failed-precondition", "Recraft API key is not configured.");
  }

  const requestedStyle = String((rawInputs && rawInputs.style) || "line_art").toLowerCase();
  const style = ALLOWED_STYLES.has(requestedStyle) ? requestedStyle : "line_art";

  const requestedSize = String((rawInputs && rawInputs.size) || "1365x1024");
  const size = ALLOWED_SIZES.has(requestedSize) ? requestedSize : "1365x1024";

  const finalPrompt = buildFinalPrompt(userPrompt, provider);

  let storageSource;
  let modelId;
  let openaiSizeUsed = null;
  if (provider === "openai") {
    // gpt-image-1 uses its own size whitelist; map our Recraft default
    // (1365x1024 landscape) onto its closest equivalent (1536x1024).
    const sizeMap = {
      "1024x1024": "1024x1024",
      "1365x1024": "1536x1024",
      "1024x1365": "1024x1536",
      "1707x1024": "1536x1024",
      "1024x1707": "1024x1536",
    };
    openaiSizeUsed = sizeMap[size] || "1536x1024";
    const {b64, model: usedModel} = await callOpenAIImage(openaiKey, {
      prompt: finalPrompt,
      size: openaiSizeUsed,
      quality: "medium",
    });
    storageSource = {bytes: Buffer.from(b64, "base64")};
    modelId = usedModel || "gpt-image-1";
  } else {
    const recraftUrl = await fetchRecraftImage(recraftKey, {finalPrompt, style, size});
    storageSource = {url: recraftUrl};
    modelId = "recraft-v3";
  }

  const {url, sizeBytes} = await downloadToStorage(uid, storageSource, userPrompt, provider, storageSubdir);

  // Log to a per-user history so teachers can see their generated diagrams
  // and we have an audit trail for cost reconciliation.
  try {
    await admin.firestore().collection("aiGenerationLog").add({
      uid,
      tool: "diagram",
      generator: provider,
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
    provider,
    style,
    size: openaiSizeUsed || size,
  };
}

function createGenerateDiagram(recraftApiKeySecret, openaiApiKeySecret) {
  const secrets = [recraftApiKeySecret];
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
      // usageMeter.js PLAN_LIMITS). Both providers count against the same
      // bucket — teachers shouldn't get double quota for picking photoreal.
      await assertAndIncrement(uid, "diagram");

      const recraftKey = recraftApiKeySecret.value() || process.env.RECRAFT_API_KEY || "";
      const openaiKey = openaiApiKeySecret
        ? (openaiApiKeySecret.value() || process.env.OPENAI_API_KEY || "")
        : (process.env.OPENAI_API_KEY || "");
      try {
        return await runGenerateDiagram({uid, rawInputs: request.data, recraftKey, openaiKey});
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
