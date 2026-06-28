/**
 * Template Bank — Cloud Functions (Firestore trigger + interaction callable).
 *
 *   lessonPlanTemplateOnWrite  (onDocumentWritten 'aiGenerations/{genId}')
 *     Fires whenever a teacher saves/updates a lesson plan. It anonymises the
 *     plan, scores it, runs an AI review, and either CREATES a new template in
 *     `lessonPlanTemplates` or MERGES it into the existing template for the
 *     same curriculum coordinates (grade + subject + topic + subtopic). Teachers
 *     never publish manually — the bank fills itself.
 *     Pinned to africa-south1 to sit beside the (default) Firestore database
 *     (see CLAUDE.md — Firestore triggers must not make a cross-region hop).
 *
 *   recordTemplateInteraction  (onCall)
 *     Teacher-facing callable that increments a template's usage counter
 *     ("Use Template") or records a 1–5 rating. Writes go through the admin SDK
 *     because firestore.rules makes `lessonPlanTemplates` read-only for clients.
 *
 * Pure logic (anonymise / score / dedupe / merge) lives in
 * lessonPlanTemplateBank.js so it can be unit-tested under plain node.
 */

const admin = require("firebase-admin");
const {onDocumentWritten} = require("firebase-functions/v2/firestore");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {
  getAnthropicApiKey, getUserRole, isStaffRole, callAnthropic,
} = require("../aiService");
const {getActiveKbVersion} = require("./cbcKnowledge");
const {
  anonymizeLessonPlan,
  extractTemplateCoords,
  templateDedupeKey,
  extractKeywords,
  scoreTemplateDeterministic,
  meetsQualityFloor,
  buildPreview,
  buildTitle,
  mergeTemplateContent,
  shouldMerge,
} = require("./lessonPlanTemplateBank");

const TEMPLATES_COLLECTION = "lessonPlanTemplates";

// Eventarc trigger pinned to the Firestore region — see file header.
const TRIGGER_OPTS = {
  document: "aiGenerations/{genId}",
  region: "africa-south1",
  timeoutSeconds: 120,
  memory: "512MiB",
};

/** Pull the plan body out of a saved generation (studio `data` or pipeline `output`). */
function planFromGeneration(gen) {
  if (!gen || typeof gen !== "object") return null;
  const plan = gen.data && typeof gen.data === "object" ? gen.data :
    (gen.output && typeof gen.output === "object" ? gen.output : null);
  return plan;
}

/** Stable content signature so unrelated metadata updates don't re-run the bank. */
function contentSignature(plan) {
  try {
    return JSON.stringify(anonymizeLessonPlan(plan));
  } catch (err) {
    return "";
  }
}

async function isPaused() {
  try {
    const snap = await admin.firestore().doc("agentControl/templateBank").get();
    return snap.exists && snap.data() && snap.data().paused === true;
  } catch (err) {
    return false; // fail-open: a missing breaker never blocks the bank
  }
}

/**
 * Best-effort AI review of an anonymised template. Returns a refinement object
 * or null if the reviewer is unavailable / errors — callers fall back to the
 * deterministic score. Never throws.
 */
async function runTemplateAiReview(apiKey, {content, coords, deterministic}) {
  if (!apiKey) return null;
  try {
    const systemPrompt =
      "You are Cala, a Zambian CBC curriculum reviewer. You review reusable " +
      "lesson-plan TEMPLATES (no school/teacher identity) before they enter a " +
      "shared template bank. Judge curriculum alignment, completeness, accuracy, " +
      "teaching methodology, learner engagement, assessment quality, clarity and " +
      "resource quality. Reply ONLY with a single JSON object, no prose.";

    const userPrompt =
      `Curriculum coordinates: ${JSON.stringify({
        curriculum: coords.curriculum, grade: coords.grade, subject: coords.subject,
        topic: coords.topic, subtopic: coords.subtopic, competency: coords.competency,
      })}\n\n` +
      `Deterministic pre-score: ${deterministic.score}/100 ` +
      `(${JSON.stringify(deterministic.breakdown)}).\n\n` +
      `Template content:\n${JSON.stringify(content).slice(0, 12000)}\n\n` +
      "Return JSON: {\"approved\": boolean, \"curriculumAligned\": boolean, " +
      "\"qualityScore\": number 0-100, \"breakdown\": {\"curriculumAlignment\": number, " +
      "\"completeness\": number, \"accuracy\": number, \"methodology\": number, " +
      "\"engagement\": number, \"assessment\": number, \"clarity\": number, " +
      "\"resources\": number}, \"recommendations\": [up to 5 short strings], " +
      "\"outdated\": boolean}. Set approved=false only for plans that are " +
      "off-curriculum, factually wrong, or structurally incomplete.";

    const resp = await callAnthropic(apiKey, {
      systemPrompt,
      messages: [{role: "user", content: userPrompt}],
      maxTokens: 900,
      temperature: 0.2,
      json: true,
      track: {tool: "template_bank_review"},
    });

    const raw = resp && (resp.text || resp.content || resp);
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object") return null;

    const clampScore = (n, fallback) =>
      typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : fallback;

    return {
      approved: parsed.approved !== false,
      curriculumAligned: parsed.curriculumAligned !== false,
      outdated: parsed.outdated === true,
      qualityScore: clampScore(parsed.qualityScore, deterministic.score),
      breakdown: parsed.breakdown && typeof parsed.breakdown === "object" ?
        parsed.breakdown : deterministic.breakdown,
      recommendations: Array.isArray(parsed.recommendations) ?
        parsed.recommendations.filter((r) => typeof r === "string").slice(0, 5) : [],
    };
  } catch (err) {
    console.warn("[templateBank] AI review failed (using deterministic score)",
      (err && err.message) || err);
    return null;
  }
}

/** Assemble the stored template fields shared by create + merge. */
function assembleTemplateFields({content, coords, deterministic, review, curriculumVersion}) {
  const qualityScore = review ? review.qualityScore : deterministic.score;
  const qualityBreakdown = review ? review.breakdown : deterministic.breakdown;
  return {
    ...coords,
    dedupeKey: templateDedupeKey(coords),
    keywords: extractKeywords(content, coords),
    title: buildTitle(coords),
    preview: buildPreview(content),
    content,
    qualityScore,
    qualityBreakdown,
    aiRecommendations: review ? review.recommendations : [],
    curriculumAligned: review ? review.curriculumAligned : true,
    status: review && review.outdated ? "outdated" : "active",
    curriculumVersion: curriculumVersion || "",
  };
}

async function processGeneration(genId, gen, apiKey) {
  const plan = planFromGeneration(gen);
  if (!plan) return;

  // Skip plans that were themselves created FROM a template — re-feeding them
  // would just bounce the same content back through the bank.
  if (gen.meta && gen.meta.fromTemplateId) return;

  if (await isPaused()) return;

  const content = anonymizeLessonPlan(plan);
  const coords = extractTemplateCoords(plan, gen.inputs || {}, gen.meta || {});
  const deterministic = scoreTemplateDeterministic(content);

  // Don't pollute the bank with half-finished drafts.
  if (!meetsQualityFloor(deterministic)) return;
  if (!coords.subject || !coords.topic) return;

  const db = admin.firestore();
  const dedupeKey = templateDedupeKey(coords);
  const FieldValue = admin.firestore.FieldValue;
  const curriculumVersion = await getActiveKbVersion().catch(() => "");

  const existingSnap = await db.collection(TEMPLATES_COLLECTION)
    .where("dedupeKey", "==", dedupeKey).limit(1).get();

  // ── New template ──────────────────────────────────────────────────────
  if (existingSnap.empty) {
    const review = await runTemplateAiReview(apiKey, {content, coords, deterministic});
    if (review && review.approved === false) return; // AI rejected it outright

    const fields = assembleTemplateFields({content, coords, deterministic, review, curriculumVersion});
    await db.collection(TEMPLATES_COLLECTION).add({
      ...fields,
      version: 1,
      usageCount: 0,
      ratingSum: 0,
      ratingCount: 0,
      ratingAvg: 0,
      contributorCount: 1,
      sourceGenerationIds: [genId],
      revisionHistory: [{
        version: 1,
        reason: "Created from a teacher lesson plan",
        qualityScore: fields.qualityScore,
        sourceGenerationId: genId,
        at: new Date().toISOString(),
      }],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return;
  }

  // ── Existing template — merge the strongest ideas, or just count it ────
  const doc = existingSnap.docs[0];
  const existing = doc.data();
  const existingScore = typeof existing.qualityScore === "number" ? existing.qualityScore : 0;
  const existingContent = existing.content || {};

  const alreadyCounted = Array.isArray(existing.sourceGenerationIds) &&
    existing.sourceGenerationIds.includes(genId);

  if (!shouldMerge(existingScore, deterministic.score, existingContent, content)) {
    // No improvement — record the contribution (provenance + popularity) only.
    if (!alreadyCounted) {
      await doc.ref.update({
        contributorCount: FieldValue.increment(1),
        sourceGenerationIds: FieldValue.arrayUnion(genId),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    return;
  }

  const mergedContent = mergeTemplateContent(existingContent, content, existingScore, deterministic.score);
  const mergedDeterministic = scoreTemplateDeterministic(mergedContent);
  const review = await runTemplateAiReview(apiKey, {content: mergedContent, coords, deterministic: mergedDeterministic});
  if (review && review.approved === false) return;

  const fields = assembleTemplateFields({
    content: mergedContent, coords, deterministic: mergedDeterministic, review, curriculumVersion,
  });
  const nextVersion = (typeof existing.version === "number" ? existing.version : 1) + 1;
  const history = Array.isArray(existing.revisionHistory) ? existing.revisionHistory.slice(-19) : [];
  history.push({
    version: nextVersion,
    reason: "Merged stronger ideas from another teacher's plan",
    qualityScore: fields.qualityScore,
    sourceGenerationId: genId,
    at: new Date().toISOString(),
  });

  await doc.ref.update({
    ...fields,
    version: nextVersion,
    revisionHistory: history,
    ...(alreadyCounted ? {} : {
      contributorCount: FieldValue.increment(1),
      sourceGenerationIds: FieldValue.arrayUnion(genId),
    }),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

function createLessonPlanTemplateOnWrite(anthropicApiKeySecret) {
  return onDocumentWritten(
    {...TRIGGER_OPTS, secrets: [anthropicApiKeySecret]},
    async (event) => {
      try {
        const after = event.data && event.data.after;
        if (!after || !after.exists) return; // deletes don't create templates
        const gen = after.data();
        // Only the full studio-saved lesson plan carries the plan body.
        if (!gen || gen.tool !== "lesson_plan") return;
        if (gen.status && gen.status !== "complete") return;

        const plan = planFromGeneration(gen);
        if (!plan) return;

        // Re-run only when the teaching content actually changed.
        const before = event.data.before;
        if (before && before.exists) {
          const prevPlan = planFromGeneration(before.data());
          if (prevPlan && contentSignature(prevPlan) === contentSignature(plan)) return;
        }

        let apiKey = null;
        try {
          apiKey = getAnthropicApiKey(anthropicApiKeySecret);
        } catch (err) {
          apiKey = null; // AI review optional — deterministic path still runs
        }

        await processGeneration(event.params.genId, gen, apiKey);
      } catch (err) {
        // Never let the bank break a teacher's save flow.
        console.error("[templateBank] lessonPlanTemplateOnWrite failed",
          (err && err.message) || err);
      }
    },
  );
}

// ── recordTemplateInteraction (use / rate) ───────────────────────────────

function createRecordTemplateInteraction() {
  return onCall({timeoutSeconds: 30, memory: "256MiB"}, async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");

    const role = await getUserRole(uid);
    if (!isStaffRole(role)) {
      throw new HttpsError("permission-denied", "Template Bank is for approved teachers.");
    }

    const data = request.data || {};
    const templateId = typeof data.templateId === "string" ? data.templateId.slice(0, 128) : "";
    const action = data.action === "rate" ? "rate" : "use";
    if (!templateId) throw new HttpsError("invalid-argument", "templateId is required.");

    const db = admin.firestore();
    const ref = db.collection(TEMPLATES_COLLECTION).doc(templateId);
    const FieldValue = admin.firestore.FieldValue;

    if (action === "use") {
      await ref.update({usageCount: FieldValue.increment(1)})
        .catch(() => {
          throw new HttpsError("not-found", "Template not found.");
        });
      return {ok: true, action: "use"};
    }

    // action === "rate" — one rating per teacher, stored in a sub-doc so a
    // teacher re-rating replaces (not double-counts) their score.
    const rating = Math.round(Number(data.rating));
    if (!(rating >= 1 && rating <= 5)) {
      throw new HttpsError("invalid-argument", "rating must be 1–5.");
    }

    await db.runTransaction(async (tx) => {
      const tplSnap = await tx.get(ref);
      if (!tplSnap.exists) throw new HttpsError("not-found", "Template not found.");
      const ratingRef = ref.collection("ratings").doc(uid);
      const prevSnap = await tx.get(ratingRef);
      const prev = prevSnap.exists ? Number(prevSnap.data().rating) || 0 : 0;

      const tpl = tplSnap.data();
      let sum = (Number(tpl.ratingSum) || 0) - prev + rating;
      let count = (Number(tpl.ratingCount) || 0) + (prevSnap.exists ? 0 : 1);
      if (count < 0) count = 0;
      if (sum < 0) sum = 0;
      const avg = count > 0 ? Math.round((sum / count) * 10) / 10 : 0;

      tx.set(ratingRef, {rating, uid, at: FieldValue.serverTimestamp()}, {merge: true});
      tx.update(ref, {ratingSum: sum, ratingCount: count, ratingAvg: avg});
    });

    return {ok: true, action: "rate", rating};
  });
}

module.exports = {
  createLessonPlanTemplateOnWrite,
  createRecordTemplateInteraction,
  // exported for tests / reuse
  runTemplateAiReview,
  planFromGeneration,
  contentSignature,
  assembleTemplateFields,
  TEMPLATES_COLLECTION,
};
