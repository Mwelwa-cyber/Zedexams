/**
 * generateNotePictures — HTTPS callable Cloud Function.
 *
 * For each `picture` block at the END of a study note, generates an
 * appropriate illustration using Gemini 2.5 Flash Image (primary) with an
 * automatic OpenAI gpt-image-1 fallback. Uploads whichever succeeds to
 * Firebase Storage and writes the resulting URL back into the block in
 * Firestore.
 *
 * Client call pattern:
 *   const fn = httpsCallable(functions, 'generateNotePictures');
 *   const result = await fn({ noteId: 'abc123' });
 *   // result.data → { processed, succeeded, failed, skipped, results }
 *
 * Auth: admin or superAdmin only (this touches 200+ published notes and
 * can be expensive — keep it staff-internal rather than per-teacher).
 *
 * Design mirrors generateDiagram.js (auth gate, usageMeter, downloadToStorage)
 * and generateSlideNotes.js (per-block loop with fallback, continue-on-error).
 */

const crypto = require("crypto");
const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");

const {getUserRole} = require("../aiService");
const {callGeminiImage} = require("../geminiImageClient");
const {callOpenAIImage} = require("../openaiClient");

// Wrap the raw picture prompt with a style guide appropriate for young
// Zambian CBC learners. Applied identically to both providers so the
// Gemini → OpenAI fallback produces visually consistent images.
function buildIllustrationPrompt(rawPrompt) {
  const guard = [
    "Clean, colorful, friendly flat illustration suitable for a children's",
    "textbook for young Zambian learners. Simple shapes, bright primary",
    "colors, plain white background. No embedded text, labels, or watermarks",
    "in the image. No photorealism — cartoon/illustration style only.",
  ].join(" ");
  return `${guard}\n\n${rawPrompt}`;
}

// Shared Storage upload helper. Mirrors generateDiagram.downloadToStorage
// but always writes to `note-pictures/{uid}/{noteId}/<timestamp>-<hex>.png`
// so the admin can audit + clean up by note. Returns { url, sizeBytes }.
async function uploadToStorage(uid, noteId, buffer, mimeType, sourcePrompt) {
  const bucket = admin.storage().bucket();
  const ext = (mimeType || "image/png").includes("jpeg") ? "jpg" : "png";
  const filename =
    `note-pictures/${uid}/${noteId}/${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${ext}`;
  const file = bucket.file(filename);
  const downloadToken = crypto.randomUUID();

  try {
    await file.save(buffer, {
      resumable: false,
      contentType: mimeType || "image/png",
      metadata: {
        contentType: mimeType || "image/png",
        cacheControl: "public, max-age=31536000, immutable",
        metadata: {
          sourcePrompt: (sourcePrompt || "").slice(0, 500),
          generator: "generateNotePictures",
          generatedAt: new Date().toISOString(),
          firebaseStorageDownloadTokens: downloadToken,
        },
      },
    });
  } catch (err) {
    console.error("generateNotePictures storage save failed", {
      uid, noteId, filename, err,
    });
    throw new Error(
      `Storage save failed: ${err && err.message ? err.message : "unknown error"}`,
    );
  }

  const url =
    `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}` +
    `/o/${encodeURIComponent(filename)}?alt=media&token=${downloadToken}`;

  return {url, sizeBytes: buffer.length};
}

// Try Gemini first; on any failure fall through to OpenAI.
// Returns { url, sizeBytes, provider } on success; throws if both fail.
async function generateAndUpload({uid, noteId, prompt, geminiKey, openaiKey}) {
  const finalPrompt = buildIllustrationPrompt(prompt);

  // --- Gemini attempt ---
  if (geminiKey) {
    try {
      const {b64, mimeType} = await callGeminiImage(geminiKey, {prompt: finalPrompt});
      const buffer = Buffer.from(b64, "base64");
      const {url, sizeBytes} = await uploadToStorage(uid, noteId, buffer, mimeType, prompt);
      return {url, sizeBytes, provider: "gemini"};
    } catch (geminiErr) {
      console.warn("generateNotePictures: Gemini failed, falling back to OpenAI", {
        message: geminiErr?.message?.slice(0, 300),
      });
    }
  }

  // --- OpenAI fallback ---
  if (!openaiKey) {
    throw new Error(
      "Gemini unavailable and OPENAI_API_KEY is not configured — cannot generate image.",
    );
  }
  const {b64, model: usedModel} = await callOpenAIImage(openaiKey, {
    prompt: finalPrompt,
    size: "1024x1024",
    quality: "medium",
  });
  const buffer = Buffer.from(b64, "base64");
  const {url, sizeBytes} = await uploadToStorage(uid, noteId, buffer, "image/png", prompt);
  return {url, sizeBytes, provider: `openai/${usedModel || "gpt-image-1"}`};
}

// Extracts the generation prompt from a picture block:
//   block.prompt (explicit AI prompt) → block.caption → block.lines joined.
function resolvePrompt(block) {
  if (block.prompt && String(block.prompt).trim()) {
    return String(block.prompt).trim().slice(0, 800);
  }
  if (block.caption && String(block.caption).trim()) {
    return String(block.caption).trim().slice(0, 800);
  }
  const lines = Array.isArray(block.lines) ?
    block.lines.filter(Boolean).join(" ").trim() : "";
  return lines.slice(0, 800);
}

async function runGenerateNotePictures({uid, noteId, geminiKey, openaiKey}) {
  const db = admin.firestore();
  const noteRef = db.collection("lessons").doc(noteId);
  const snap = await noteRef.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", `Note ${noteId} not found.`);
  }

  const note = snap.data() || {};
  const blocks = Array.isArray(note.blocks) ? note.blocks : [];

  // Only process `picture` blocks that don't already have a url.
  const targets = blocks
    .map((b, idx) => ({block: b, idx}))
    .filter(({block}) => block && block.type === "picture" && !block.url);

  if (targets.length === 0) {
    return {processed: 0, succeeded: 0, failed: 0, skipped: 0, results: []};
  }

  const results = [];
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const {block, idx} of targets) {
    const prompt = resolvePrompt(block);
    if (!prompt) {
      skipped += 1;
      results.push({idx, status: "skipped", reason: "no prompt or caption"});
      continue;
    }

    let url = null;
    let provider = null;
    let errorMsg = null;

    try {
      const result = await generateAndUpload({uid, noteId, prompt, geminiKey, openaiKey});
      url = result.url;
      provider = result.provider;
      succeeded += 1;
    } catch (err) {
      errorMsg = err && err.message ? err.message : String(err);
      console.error("generateNotePictures: block failed", {
        noteId, idx, prompt: prompt.slice(0, 80), err: errorMsg.slice(0, 300),
      });
      failed += 1;
    }

    if (url) {
      // Patch the single block inside the blocks array atomically using
      // arrayUnion is not suitable for indexed patches; we write the entire
      // updated blocks array. We re-read within each loop iteration in case
      // a concurrent write landed, but for a single admin running this tool
      // that is an acceptable simplification.
      const currentSnap = await noteRef.get();
      const currentBlocks = Array.isArray((currentSnap.data() || {}).blocks) ?
        (currentSnap.data() || {}).blocks : [];
      const updatedBlocks = currentBlocks.map((b, i) => {
        if (i === idx) return {...b, url};
        return b;
      });
      await noteRef.update({
        blocks: updatedBlocks,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      results.push({idx, status: "ok", provider, url});
    } else {
      results.push({idx, status: "failed", reason: errorMsg});
    }
  }

  return {
    processed: targets.length,
    succeeded,
    failed,
    skipped,
    results,
  };
}

function createGenerateNotePictures(geminiApiKeySecret, openaiApiKeySecret) {
  const secrets = [];
  if (geminiApiKeySecret) secrets.push(geminiApiKeySecret);
  if (openaiApiKeySecret) secrets.push(openaiApiKeySecret);

  return onCall(
    {
      secrets,
      region: "us-central1",
      timeoutSeconds: 540, // image generation is slow; 200+ notes can be long
      memory: "512MiB",
    },
    async (request) => {
      const uid = request.auth && request.auth.uid;
      if (!uid) {
        throw new HttpsError("unauthenticated", "Please sign in.");
      }

      // Admin-only: this tool generates images for every note at once and
      // can be expensive. isStaffRole (teacher + admin) is intentionally
      // narrowed to admin-only here.
      const role = await getUserRole(uid);
      if (role !== "admin" && role !== "superAdmin") {
        throw new HttpsError(
          "permission-denied",
          "Note picture generation is available to admins only.",
        );
      }

      const noteId = typeof request.data?.noteId === "string" ?
        request.data.noteId.trim() : "";
      if (!noteId) {
        throw new HttpsError("invalid-argument", "noteId is required.");
      }

      const geminiKey = geminiApiKeySecret ?
        (geminiApiKeySecret.value() || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "") :
        (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "");

      const openaiKey = openaiApiKeySecret ?
        (openaiApiKeySecret.value() || process.env.OPENAI_API_KEY || "") :
        (process.env.OPENAI_API_KEY || "");

      if (!geminiKey && !openaiKey) {
        throw new HttpsError(
          "failed-precondition",
          "No image generation key is configured. Set GEMINI_API_KEY or OPENAI_API_KEY.",
        );
      }

      try {
        return await runGenerateNotePictures({uid, noteId, geminiKey, openaiKey});
      } catch (err) {
        if (err instanceof HttpsError) throw err;
        console.error("generateNotePictures unexpected error", {uid, noteId, err});
        const detail = err && err.message ? err.message : "unknown error";
        throw new HttpsError("internal", `Picture generation failed: ${detail}`);
      }
    },
  );
}

module.exports = {createGenerateNotePictures, runGenerateNotePictures};
