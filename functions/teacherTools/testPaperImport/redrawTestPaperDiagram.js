/**
 * redrawTestPaperDiagram — resolve a single detected figure from a Test Paper
 * Studio photo import according to the teacher's chosen handling option.
 *
 * This is stage 4-5 of the import pipeline: Claude has already understood the
 * paper and described each figure (diagramBrief consumes that), and the teacher
 * has picked one of the five Diagram Handling Options in the review screen. This
 * function carries out that choice:
 *
 *   keep_original / clean_original / remove
 *       → no image generation. clean_original is handled IN THE BROWSER by the
 *         diagramClean pixel pipeline (the chooser uploads the cleaned PNG and
 *         never calls this function), so the server path only runs as a fallback
 *         when client-side canvas cleaning is unavailable — it keeps the
 *         original honestly (cleaned:false) rather than pretending.
 *   redraw / replace
 *       → LIBRARY FIRST: search the ZedExams Diagram Library for a matching
 *         black-and-white figure and reuse it (no AI cost). Only if nothing
 *         matches do we generate a fresh diagram from the structured brief, then
 *         save it back to the library (staged) for the next paper.
 *
 * The pure brief/scoring/metadata logic lives in diagramBrief.js. The model
 * call, Firestore library read/write and Storage live behind injected `deps`
 * so the orchestration unit-tests with no network (see
 * redrawTestPaperDiagram.test.js).
 */

const {
  HANDLING_IDS,
  buildDiagramPrompt,
  buildLibraryQuery,
  pickReusableDiagram,
  buildLibraryMetadata,
} = require("./diagramBrief");

function httpsError(code, message) {
  try {
    const {HttpsError} = require("firebase-functions/v2/https");
    return new HttpsError(code, message);
  } catch {
    return Object.assign(new Error(message), {code});
  }
}

/**
 * @param {object} args
 * @param {string} args.uid
 * @param {object} args.detected   structured detected-diagram description
 * @param {string} args.handling   one of DIAGRAM_HANDLING_OPTIONS ids
 * @param {object} args.context    { subject, grade, topic, subtopic }
 * @param {string} [args.originalUrl] storage URL of the cropped photo figure
 * @param {boolean} [args.forceNew] skip library reuse and always generate
 * @param {object} deps
 * @param {Function} deps.searchLibrary  async (query) => candidate[]
 * @param {Function} deps.generateImage  async ({prompt,style,size}) => {url,...}
 * @param {Function} [deps.saveToLibrary] async (metadata) => {id} | void
 */
async function runRedrawTestPaperDiagram(args, deps = {}) {
  const {uid, detected, handling, context = {}, originalUrl = null, forceNew = false} = args || {};
  if (!detected || typeof detected !== "object") {
    throw httpsError("invalid-argument", "No diagram description was provided.");
  }
  if (!HANDLING_IDS.has(handling)) {
    throw httpsError("invalid-argument", `Unknown diagram handling option: ${handling}.`);
  }

  // Non-generating options resolve immediately.
  if (handling === "remove") {
    return {action: "removed", url: null, source: "none"};
  }
  if (handling === "keep_original" || handling === "clean_original") {
    return {
      action: handling === "clean_original" ? "kept_clean" : "kept_original",
      url: originalUrl || null,
      source: "original",
      // Be honest: there is no automated raster-cleanup pass yet, so
      // "clean original" keeps the scanned figure. Surface that so the UI can
      // hint the teacher to redraw if they want a crisp version.
      ...(handling === "clean_original" ? {cleaned: false} : {}),
    };
  }

  // redraw / replace — library-first, then generate.
  const query = buildLibraryQuery(detected, context);

  if (!forceNew && typeof deps.searchLibrary === "function") {
    try {
      const candidates = await deps.searchLibrary(query);
      const match = pickReusableDiagram(candidates, query);
      if (match) {
        return {
          action: "reused",
          url: match.picture.url,
          source: "library",
          pictureId: match.picture.id || null,
          score: match.score,
        };
      }
    } catch (err) {
      // A library lookup failure must never block generation.
      console.warn("[redrawTestPaperDiagram] library search failed", {
        message: err?.message?.slice(0, 200),
      });
    }
  }

  if (typeof deps.generateImage !== "function") {
    throw httpsError("internal", "Diagram generation is not configured.");
  }
  const brief = buildDiagramPrompt(detected, context);
  const generated = await deps.generateImage(brief);
  const url = generated && generated.url;
  if (!url) {
    throw httpsError("internal", "The AI returned no diagram. Please try again.");
  }

  // Save back to the library for reuse — best-effort, never fatal.
  let savedToLibrary = false;
  let pictureId = null;
  if (typeof deps.saveToLibrary === "function") {
    try {
      const metadata = buildLibraryMetadata(detected, context, {
        url,
        prompt: brief.prompt,
        storagePath: generated.storagePath,
      });
      const saved = await deps.saveToLibrary(metadata);
      savedToLibrary = true;
      pictureId = (saved && saved.id) || null;
    } catch (err) {
      console.warn("[redrawTestPaperDiagram] library save failed", {
        message: err?.message?.slice(0, 200),
      });
    }
  }

  return {
    action: handling === "replace" ? "replaced" : "redrawn",
    url,
    source: "generated",
    prompt: brief.prompt,
    style: brief.style,
    size: brief.size,
    sizeBytes: generated.sizeBytes || 0,
    savedToLibrary,
    pictureId,
    uid: uid || null,
  };
}

/**
 * Callable factory. Mirrors createGenerateDiagram's auth + secrets wiring and
 * reuses runGenerateDiagram for the actual image generation so the B&W guard,
 * Recraft→OpenAI fallback and Storage upload all behave identically.
 */
function createRedrawTestPaperDiagram(recraftApiKeySecret, openaiApiKeySecret, kieApiKeySecret) {
  const {onCall, HttpsError} = require("firebase-functions/v2/https");
  const admin = require("firebase-admin");
  const {getUserRole, isStaffRole} = require("../../aiService");
  const {assertAndIncrement} = require("../usageMeter");
  const {runGenerateDiagram} = require("../generateDiagram");

  const secrets = [recraftApiKeySecret];
  if (openaiApiKeySecret) secrets.push(openaiApiKeySecret);
  if (kieApiKeySecret) secrets.push(kieApiKeySecret);

  // Image generation (Recraft/OpenAI/Kie) — especially the Kie async
  // submit-then-poll path — can run well past a minute. At the old 120s ceiling
  // a slow generation was KILLED by the platform mid-await, which returns a raw
  // 500 the Firebase SDK surfaces to the client as the bare code name
  // "internal" (the try/catch below never runs because the process is aborted).
  // Give it room to finish (300s) and more memory — GCF couples CPU to memory,
  // so 1GiB roughly doubles CPU and speeds the image encode/upload too.
  return onCall(
    {secrets, timeoutSeconds: 300, memory: "1GiB"},
    async (request) => {
      const uid = request.auth && request.auth.uid;
      if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");

      const data = request.data || {};
      const handling = String(data.handling || "");

      // Everything that can fault — the role lookup, the quota meter, the image
      // secrets and the model call — runs inside this guard so a transient
      // failure surfaces as a descriptive error instead of the bare "internal"
      // a raw throw before the try used to produce. Only the generating options
      // ever touch the image secrets or a quota slot.
      try {
        const role = await getUserRole(uid);
        if (!isStaffRole(role)) {
          throw new HttpsError(
            "permission-denied",
            "Teacher tools are available to approved teachers only.",
          );
        }

        // Only the generating options consume a diagram quota slot — keeping,
        // cleaning or removing the original costs nothing.
        const generates = handling === "redraw" || handling === "replace";
        if (generates) await assertAndIncrement(uid, "diagram");

        const db = admin.firestore();

        const deps = {
          // Reuse-first: read a bounded set of ACTIVE library pictures, prefer
          // ones in the same subject, and let pickReusableDiagram score them.
          searchLibrary: async (query) => {
            let ref = db.collection("pictureBank").where("status", "==", "active");
            if (query.subject) {
              // Query both the subject bucket and the generic bucket.
              const [subjSnap, genSnap] = await Promise.all([
                ref.where("subject", "==", query.subject).limit(40).get(),
                ref.where("subject", "==", "_generic").limit(20).get(),
              ]);
              return [...subjSnap.docs, ...genSnap.docs].map((doc) => ({id: doc.id, ...doc.data()}));
            }
            const snap = await ref.limit(40).get();
            return snap.docs.map((doc) => ({id: doc.id, ...doc.data()}));
          },
          generateImage: async (brief) => {
            // Read the image-provider secrets lazily, only when we actually
            // generate, so the keep/clean/remove paths never touch .value().
            const recraftKey = recraftApiKeySecret.value() || process.env.RECRAFT_API_KEY || "";
            const openaiKey = openaiApiKeySecret ?
              (openaiApiKeySecret.value() || process.env.OPENAI_API_KEY || "") :
              (process.env.OPENAI_API_KEY || "");
            const kieKey = kieApiKeySecret ?
              (kieApiKeySecret.value() || process.env.KIE_API_KEY || "") :
              (process.env.KIE_API_KEY || "");
            return runGenerateDiagram({
              uid,
              rawInputs: {prompt: brief.prompt, style: brief.style, size: brief.size},
              recraftKey,
              openaiKey,
              kieKey,
            });
          },
          saveToLibrary: async (metadata) => {
            const docRef = await db.collection("pictureBank").add({
              ...metadata,
              createdBy: uid,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            return {id: docRef.id};
          },
        };

        return await runRedrawTestPaperDiagram(
          {
            uid,
            detected: data.detected,
            handling,
            context: data.context || {},
            originalUrl: data.originalUrl || null,
            forceNew: Boolean(data.forceNew),
          },
          deps,
        );
      } catch (err) {
        if (err instanceof HttpsError) throw err;
        console.error("redrawTestPaperDiagram unexpected error", {uid, err});
        const detail = err && err.message ? err.message : "unknown error";
        throw new HttpsError("internal", `Diagram redraw failed: ${detail}`);
      }
    },
  );
}

module.exports = {runRedrawTestPaperDiagram, createRedrawTestPaperDiagram};
