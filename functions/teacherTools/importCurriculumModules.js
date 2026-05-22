/**
 * importCurriculumModules — admin-only bulk import of lesson-level
 * curriculum modules.
 *
 * Accepts { modules: [ ... ] } — a parsed JSON array. Every row is validated
 * authoritatively with validateCurriculumModule (the same validator the
 * resolver trusts). Valid rows are written to
 *   cbcKnowledgeBase/{KB_VERSION}/topics/{topicId}/lessons/{moduleId}
 * with merge:true so re-running is idempotent. Invalid rows are skipped and
 * reported per-row so the admin can fix and re-upload.
 *
 * A minimal parent topic stub is upserted (merge:true) so the topic shows up
 * in the admin Knowledge Base list — merge:true preserves any existing rich
 * topic fields (subtopics/outcomes/etc.).
 */

const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");

const {getUserRole} = require("../aiService");
const {validateCurriculumModule, buildModuleId} =
  require("./curriculumModuleSchema");
const {invalidateKbCache, getActiveKbVersion} = require("./cbcKnowledge");

const MAX_MODULES = 2000;

function slug(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "").slice(0, 60);
}

// Must match buildTopicId() in importBuiltInCbcTopics.js and
// src/utils/adminCbcKbService.js so modules attach to the right topic card.
function buildTopicId(grade, subject, topic) {
  const g = slug(grade);
  const s = slug(subject);
  const t = slug(topic);
  if (!g || !s || !t) return null;
  return `${g}-${s}-${t}`;
}

exports.importCurriculumModules = onCall(
    {timeoutSeconds: 120, memory: "256MiB"},
    async (request) => {
      const uid = request.auth && request.auth.uid;
      if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
      const role = await getUserRole(uid);
      if (role !== "admin") {
        throw new HttpsError("permission-denied", "Admin only.");
      }

      const rows = request.data && request.data.modules;
      if (!Array.isArray(rows) || rows.length === 0) {
        throw new HttpsError(
            "invalid-argument",
            "Provide a non-empty `modules` array.",
        );
      }
      if (rows.length > MAX_MODULES) {
        throw new HttpsError(
            "invalid-argument",
            `Too many modules in one import (max ${MAX_MODULES}).`,
        );
      }

      const db = admin.firestore();
      const now = admin.firestore.FieldValue.serverTimestamp();
      const BATCH_SIZE = 400;
      // Always write into the runtime-active version so a bulk import lands
      // on whichever syllabus is currently in use.
      const kbVersion = await getActiveKbVersion();

      let written = 0;
      const errors = [];
      const seenTopics = new Set();
      let batch = db.batch();
      let inBatch = 0;

      const flush = async () => {
        if (inBatch > 0) {
          await batch.commit();
          batch = db.batch();
          inBatch = 0;
        }
      };

      for (let i = 0; i < rows.length; i += 1) {
        const {ok, value, errors: rowErrors} =
          validateCurriculumModule(rows[i]);
        if (!ok) {
          errors.push({row: i, errors: rowErrors || ["invalid"]});
          continue;
        }

        const topicId = buildTopicId(value.grade, value.subject, value.topic);
        const moduleId = buildModuleId(value.subtopic, value.term);
        if (!topicId || !moduleId) {
          errors.push({
            row: i,
            errors: ["could not derive a stable topic/sub-topic id"],
          });
          continue;
        }

        const topicRef = db.collection("cbcKnowledgeBase").doc(kbVersion)
            .collection("topics").doc(topicId);

        // Minimal parent topic stub — merge:true keeps existing rich fields.
        if (!seenTopics.has(topicId)) {
          seenTopics.add(topicId);
          batch.set(topicRef, {
            id: topicId,
            grade: value.grade,
            subject: value.subject,
            term: value.term,
            topic: value.topic,
            origin: "module_import",
            updatedAt: now,
          }, {merge: true});
          inBatch += 1;
        }

        batch.set(
            topicRef.collection("lessons").doc(moduleId),
            {...value, id: moduleId, topicId, origin: "bulk_import",
              updatedAt: now, importedAt: now},
            {merge: true},
        );
        inBatch += 1;
        written += 1;

        if (inBatch >= BATCH_SIZE) await flush();
      }

      await flush();

      try {
        invalidateKbCache();
      } catch {
        // best effort — cache self-heals after its 60s TTL
      }

      return {
        ok: true,
        written,
        skipped: errors.length,
        totalSubmitted: rows.length,
        errors: errors.slice(0, 50),
        kbVersion,
      };
    },
);
