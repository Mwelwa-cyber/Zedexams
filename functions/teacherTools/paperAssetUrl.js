"use strict";

/**
 * resolvePaperAssetUrl — staff-only callable that returns a tokened download
 * URL for a file belonging to a pastPapers doc.
 *
 * Why it exists: the Quiz Editor's "Crop from page" renders pages of the
 * uploaded source paper in the browser, which needs the file bytes. The
 * client first tries a direct Storage read (getDownloadURL under
 * storage.rules); in production that read was denied for an admin
 * (storage/unauthorized on papers/{ownerUid}/…), killing the whole flow even
 * though the caller is exactly who the feature is for. Client-side rules
 * evaluation depends on the caller's token claims, their users doc, and the
 * DEPLOYED rules version all agreeing — three things this admin-only workflow
 * has no business being coupled to. The server, with the admin SDK, is the
 * authority: it verifies the caller is staff, verifies the path is one the
 * paper doc itself declares, and returns the same URL shape getDownloadURL
 * produces (ensuring a Firebase download token exists on the object first).
 *
 * Security posture:
 *   - assertVerifiedAuth + isStaffRole (teacher/admin/superAdmin) — the same
 *     population storage.rules' isTeacherOrAdmin() arm intends to allow.
 *   - Path allow-list: only pdfPath / markSchemePath / assets[].path of the
 *     named paper (pure check in paperAssetUrlCore.js, node-tested). Never an
 *     arbitrary bucket path.
 *   - Rate-limited: page rendering asks once per file (the client caches);
 *     30/min per user is generous headroom, not a workload.
 *
 * The minted token is persisted on the object's metadata, so subsequent
 * requests (and the client SDK itself) reuse it — this does not create a new
 * grant class: anyone who could already obtain the file's download URL sees
 * the same token.
 */

const admin = require("firebase-admin");
const crypto = require("crypto");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {assertVerifiedAuth} = require("../authGuard");
const {assertCallableRateLimit} = require("../rateLimit");
const {getUserRole, isStaffRole} = require("../aiService");
const {isDeclaredPaperAssetPath, buildTokenedDownloadUrl} = require("./paperAssetUrlCore");

function createResolvePaperAssetUrl() {
  return onCall(async (request) => {
    const uid = await assertVerifiedAuth(request, "Please sign in.");
    const role = await getUserRole(uid);
    if (!isStaffRole(role)) {
      throw new HttpsError("permission-denied",
        "Teacher or admin access is required to open paper files.");
    }
    await assertCallableRateLimit(request, {action: "paper-asset-url", userPerMin: 30});

    const paperId = String(request.data && request.data.paperId || "").trim();
    const path = String(request.data && request.data.path || "").trim();
    if (!paperId || !path) {
      throw new HttpsError("invalid-argument", "paperId and path are required.");
    }

    const snap = await admin.firestore().doc(`pastPapers/${paperId}`).get();
    if (!snap.exists) {
      throw new HttpsError("not-found", "Past paper not found.");
    }
    if (!isDeclaredPaperAssetPath(snap.data(), path)) {
      throw new HttpsError("permission-denied",
        "That file does not belong to this paper.");
    }

    const bucket = admin.storage().bucket();
    const file = bucket.file(path);
    let metadata;
    try {
      [metadata] = await file.getMetadata();
    } catch (err) {
      if (err && (err.code === 404 || err.status === 404)) {
        throw new HttpsError("not-found", "The paper file is missing from storage.");
      }
      console.error("[resolvePaperAssetUrl] metadata read failed", {paperId, path, message: err && err.message});
      throw new HttpsError("internal", "Could not read the paper file.");
    }

    // Reuse the object's existing Firebase download token; mint + persist one
    // only when the object has none (uploads via the client SDK normally get
    // one automatically, but server-written or migrated files may not).
    let token = String(metadata && metadata.metadata &&
      metadata.metadata.firebaseStorageDownloadTokens || "").split(",")[0].trim();
    if (!token) {
      token = crypto.randomUUID();
      await file.setMetadata({metadata: {firebaseStorageDownloadTokens: token}});
    }

    return {url: buildTokenedDownloadUrl(bucket.name, path, token)};
  });
}

module.exports = {createResolvePaperAssetUrl};
