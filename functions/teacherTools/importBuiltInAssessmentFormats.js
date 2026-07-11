/**
 * importBuiltInAssessmentFormats — admin-only one-click migration.
 *
 * Copies every profile from assessmentFormatSeeds.FORMAT_PROFILES into
 * Firestore under cbcKnowledgeBase/{activeVersion}/assessmentFormats/*.
 * After the import, the admin CBC KB page treats them as fully editable
 * rows, so format wording can be tuned without a code deploy.
 *
 * Idempotent: re-running overwrites existing documents with the latest
 * in-code data. Use with care — re-running will clobber admin edits on
 * any profile that has the same ID as a built-in.
 */

const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {assertVerifiedAuth} = require("../authGuard");

const {getUserRole} = require("../aiService");
const {FORMAT_PROFILES} = require("./assessmentFormatSeeds");
const {
  validateFormatProfile,
  invalidateFormatCache,
} = require("./assessmentFormats");
const {getActiveKbVersion} = require("./cbcKnowledge");

exports.importBuiltInAssessmentFormats = onCall(
  {timeoutSeconds: 60, memory: "256MiB"},
  async (request) => {
    const uid = await assertVerifiedAuth(request, "Please sign in.");
    const role = await getUserRole(uid);
    if (role !== "admin") {
      throw new HttpsError("permission-denied", "Admin only.");
    }

    const db = admin.firestore();
    // Always write to the runtime-active version so admins importing the
    // seeds see them appear in whichever syllabus is currently active.
    const kbVersion = await getActiveKbVersion();
    const col = db.collection("cbcKnowledgeBase").doc(kbVersion)
      .collection("assessmentFormats");
    const now = admin.firestore.FieldValue.serverTimestamp();

    let written = 0;
    let skipped = 0;
    const batch = db.batch();
    for (const p of FORMAT_PROFILES) {
      const check = validateFormatProfile(p);
      if (!check.ok) {
        console.error("Seed format profile failed validation; skipping",
          {id: p.id, errors: check.errors});
        skipped += 1;
        continue;
      }
      batch.set(col.doc(check.value.id), {
        ...check.value,
        origin: "builtin_seed",
        updatedAt: now,
        importedAt: now,
      }, {merge: true});
      written += 1;
    }
    await batch.commit();

    // Invalidate the module-level cache so new generations see the
    // imported data immediately rather than waiting 60s.
    try {
      invalidateFormatCache();
    } catch {
      // Best effort.
    }

    return {
      ok: true,
      written,
      skipped,
      totalInCode: FORMAT_PROFILES.length,
      kbVersion,
    };
  },
);
