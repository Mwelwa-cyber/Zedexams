/**
 * Callable Cloud Functions for the admin CBC KB editor — insert, update,
 * or delete a row of the Syllabi Studio data without mutating the source
 * JSON. Edits are stored as override docs under
 *   cbcKnowledgeBase/{version}/syllabusOverrides/{rowKey}
 * and applied at read time by syllabiCurriculumData.applyOverridesToRaw.
 *
 * Why a separate overrides collection instead of mutating the JSON:
 *   - The JSON is checked in. Mutating it from runtime would mean either
 *     committing through CI or writing into Hosting, neither of which
 *     Cloud Functions can do.
 *   - Overrides are versioned with the active KB pointer — flipping
 *     _meta.version isolates edits per syllabus generation.
 *   - Rolling back is one Firestore delete, not a git revert.
 */

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {assertVerifiedAuth} = require("../authGuard");
const {getUserRole, isAdminRole} = require("../aiService");
const admin = require("firebase-admin");
const {invalidateKbCache, getActiveKbVersion} = require("./cbcKnowledge");

const ALLOWED_CELLS = new Set([
  "TOPIC",
  "SUB-TOPIC",
  "SPECIFIC COMPETENCES",
  "LEARNING ACTIVITIES",
  "EXPECTED STANDARD",
]);

// SECURITY_ENDPOINT_AUDIT §4.6 — read the role from users/{uid}, the way every
// other admin callable does, instead of from the custom claim.
//
// The claim is DERIVED from that field (security/adminClaims.js writes it when a
// role is assigned) and only reaches a session on token refresh, which can be up
// to an hour later. So an admin promoted from the admin panel was locked out of
// this one editor until their token happened to roll — failing closed, never an
// escalation, but a confusing hour in which every other admin surface worked and
// the syllabus editor did not.
//
// isAdminRole rather than role === "admin": superAdmin is a strict superset
// everywhere in the app, and the helper exists because bare string comparisons
// here have locked out the project owner before.
async function requireAdmin(req) {
  const uid = await assertVerifiedAuth(req, "Sign in required.");
  const role = await getUserRole(uid);
  if (!isAdminRole(role)) {
    throw new HttpsError("permission-denied", "Admins only.");
  }
}

function buildRowKey(studioSubject, sheet, topic, subtopic) {
  return [studioSubject, sheet, topic || "", subtopic || ""]
      .map((p) => String(p || "").trim().toLowerCase().replace(/\s+/g, "_"))
      .join("||");
}

function sanitiseCells(cells) {
  const out = {};
  if (!cells || typeof cells !== "object") return out;
  for (const [k, v] of Object.entries(cells)) {
    if (!ALLOWED_CELLS.has(k)) continue;
    out[k] = String(v ?? "").slice(0, 4000);
  }
  return out;
}

// ── upsertSyllabusRow ──────────────────────────────────────────────────
// Updates an existing row (matched by studioSubject+sheet+topic+subtopic)
// OR inserts a brand-new one when `mode: 'insert'`.

exports.upsertSyllabusRow = onCall(
    {region: "us-central1", timeoutSeconds: 30},
    async (req) => {
      await requireAdmin(req);
      const data = req.data || {};
      const studioSubject = String(data.studioSubject || "").trim();
      const sheet = String(data.sheet || "").trim();
      const topic = String(data.topic || "").trim();
      const subtopic = String(data.subtopic || "").trim();
      const cells = sanitiseCells(data.cells);
      const mode = data.mode === "insert" ? "insert" : "update";

      if (!studioSubject || !sheet) {
        throw new HttpsError("invalid-argument",
            "studioSubject and sheet are required.");
      }
      if (mode === "update" && !topic && !subtopic) {
        throw new HttpsError("invalid-argument",
            "Updating a row needs at least one of topic or subtopic.");
      }
      if (!cells.TOPIC && !cells["SUB-TOPIC"] && Object.keys(cells).length === 0) {
        throw new HttpsError("invalid-argument", "cells cannot be empty.");
      }

      const version = await getActiveKbVersion();
      const db = admin.firestore();
      const id = buildRowKey(studioSubject, sheet,
          mode === "insert" ? (cells.TOPIC || topic) : topic,
          mode === "insert" ? (cells["SUB-TOPIC"] || subtopic) : subtopic);

      const payload = {
        id,
        studioSubject,
        sheet,
        topic: mode === "insert" ? (cells.TOPIC || topic || "") : topic,
        subtopic: mode === "insert" ?
          (cells["SUB-TOPIC"] || subtopic || "") :
          subtopic,
        cells,
        inserted: mode === "insert",
        deleted: false,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: req.auth.uid,
      };

      await db
          .collection("cbcKnowledgeBase")
          .doc(version)
          .collection("syllabusOverrides")
          .doc(id)
          .set(payload, {merge: true});

      invalidateKbCache();
      return {ok: true, id, mode};
    });

// ── deleteSyllabusRow ──────────────────────────────────────────────────
// Tombstones a row. For inserted rows the doc is hard-deleted; for
// base-JSON rows we store a `{deleted: true}` marker so the apply step
// can hide it from both the admin browser and the AI prompt resolver.

exports.deleteSyllabusRow = onCall(
    {region: "us-central1", timeoutSeconds: 30},
    async (req) => {
      await requireAdmin(req);
      const data = req.data || {};
      const studioSubject = String(data.studioSubject || "").trim();
      const sheet = String(data.sheet || "").trim();
      const topic = String(data.topic || "").trim();
      const subtopic = String(data.subtopic || "").trim();

      if (!studioSubject || !sheet) {
        throw new HttpsError("invalid-argument",
            "studioSubject and sheet are required.");
      }

      const version = await getActiveKbVersion();
      const db = admin.firestore();
      const id = buildRowKey(studioSubject, sheet, topic, subtopic);
      const ref = db
          .collection("cbcKnowledgeBase")
          .doc(version)
          .collection("syllabusOverrides")
          .doc(id);

      const existing = await ref.get();
      if (existing.exists && existing.data()?.inserted) {
        await ref.delete();
      } else {
        await ref.set({
          id,
          studioSubject,
          sheet,
          topic,
          subtopic,
          deleted: true,
          inserted: false,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: req.auth.uid,
        }, {merge: true});
      }

      invalidateKbCache();
      return {ok: true, id};
    });

// ── restoreSyllabusRow ─────────────────────────────────────────────────
// Removes a delete tombstone or a cell override, restoring the base
// JSON value. Hard-deletes the override doc.

exports.restoreSyllabusRow = onCall(
    {region: "us-central1", timeoutSeconds: 30},
    async (req) => {
      await requireAdmin(req);
      const data = req.data || {};
      const studioSubject = String(data.studioSubject || "").trim();
      const sheet = String(data.sheet || "").trim();
      const topic = String(data.topic || "").trim();
      const subtopic = String(data.subtopic || "").trim();

      if (!studioSubject || !sheet) {
        throw new HttpsError("invalid-argument",
            "studioSubject and sheet are required.");
      }

      const version = await getActiveKbVersion();
      const db = admin.firestore();
      const id = buildRowKey(studioSubject, sheet, topic, subtopic);
      await db
          .collection("cbcKnowledgeBase")
          .doc(version)
          .collection("syllabusOverrides")
          .doc(id)
          .delete();

      invalidateKbCache();
      return {ok: true, id};
    });
