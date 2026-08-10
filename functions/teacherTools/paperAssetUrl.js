"use strict";

/**
 * resolvePaperAssetUrl — staff-only callable that returns a SHORT-LIVED V4
 * signed URL for a file belonging to a pastPapers doc.
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
 * paper doc itself declares, and signs a URL that expires.
 *
 * Security posture:
 *   - assertVerifiedAuth + isStaffRole (teacher/admin/superAdmin) — a strict
 *     SUBSET of who storage.rules already allows to read this path (staff ∪
 *     entitled learners ∪ the owning uid), so this grants no new access.
 *   - Two independent path checks, both required: the path must be canonical
 *     and inside papers/ (no traversal, no encoding tricks), AND it must be
 *     one the named paper doc declares. Never an arbitrary bucket path.
 *   - Rate-limited: page rendering asks once per file (the client caches);
 *     30/min per user is generous headroom, not a workload.
 *
 * WHY A SIGNED URL AND NOT A FIREBASE DOWNLOAD TOKEN
 * A `?alt=media&token=…` download URL NEVER EXPIRES — the token is a bearer
 * credential valid until someone explicitly revokes it, so anyone who later
 * obtains the URL (a log, a screenshot, a shared browser history) holds
 * permanent access to the file. That is an unacceptable trade for THIS
 * endpoint in particular, because the population it serves is by definition
 * the population Storage rules just denied. A V4 signed URL expires at a
 * stated time (10 minutes here), so a leaked URL stops being a credential.
 *
 * OPERATIONAL PREREQUISITE — READ BEFORE DEPLOYING
 * Signing from the Functions runtime uses the IAM `signBlob` API, because the
 * runtime service account has no local private key. It therefore requires
 * `iam.serviceAccounts.signBlob` on itself, normally via
 * `roles/iam.serviceAccountTokenCreator`:
 *
 *   SA="$(gcloud functions describe resolvePaperAssetUrl --gen2 \
 *          --region=us-central1 --format='value(serviceConfig.serviceAccountEmail)')"
 *   gcloud iam service-accounts add-iam-policy-binding "$SA" \
 *     --member="serviceAccount:$SA" \
 *     --role="roles/iam.serviceAccountTokenCreator"
 *
 * The default Functions SA does NOT hold this — `generateDiagram.js` used
 * `getSignedUrl()` here once and had to be moved to download tokens for
 * exactly this reason (see its comment at the downloadToken mint). If the
 * grant is missing this callable FAILS LOUDLY with a failed-precondition
 * naming the fix. It deliberately does NOT fall back to a download token:
 * silently handing out a permanent credential to work around a missing IAM
 * grant would defeat the entire reason this endpoint signs.
 */

const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {assertVerifiedAuth} = require("../authGuard");
const {assertCallableRateLimit} = require("../rateLimit");
const {getUserRole, isStaffRole} = require("../aiService");
const {
  DEFAULT_TTL_SECONDS,
  isCanonicalPaperAssetPath,
  classifyPaperAssetPath,
  resolveSignedUrlExpiry,
  buildFallbackLogEvent,
} = require("./paperAssetUrlCore");

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
    // Shape first, membership second. Checking the shape before touching
    // Firestore means a malformed path never reaches a lookup, and keeps the
    // traversal guard independent of whatever the paper doc happens to say.
    if (!isCanonicalPaperAssetPath(path)) {
      throw new HttpsError("invalid-argument", "That is not a valid paper file path.");
    }

    const snap = await admin.firestore().doc(`pastPapers/${paperId}`).get();
    if (!snap.exists) {
      throw new HttpsError("not-found", "Past paper not found.");
    }
    const assetKind = classifyPaperAssetPath(snap.data(), path);
    if (!assetKind) {
      throw new HttpsError("permission-denied",
        "That file does not belong to this paper.");
    }

    const file = admin.storage().bucket().file(path);
    // Existence is checked explicitly because getSignedUrl() will happily sign
    // a URL for an object that does not exist — the caller would get a link
    // that 404s at fetch time instead of a clean "the file is missing".
    // exists() is also all we need: no object metadata is read, so none can
    // leak into a log line.
    let present;
    try {
      [present] = await file.exists();
    } catch (err) {
      console.error("[resolvePaperAssetUrl] existence check failed",
        {paperId, assetKind, message: err && err.message});
      throw new HttpsError("internal", "Could not read the paper file.");
    }
    if (!present) {
      throw new HttpsError("not-found", "The paper file is missing from storage.");
    }

    let url;
    try {
      [url] = await file.getSignedUrl({
        version: "v4",
        action: "read",
        expires: resolveSignedUrlExpiry(Date.now(), DEFAULT_TTL_SECONDS),
      });
    } catch (err) {
      // Almost always the missing signBlob grant documented at the top of this
      // file. Surface it as failed-precondition (an operator fixes it) rather
      // than internal (an on-call engineer goes hunting), and never degrade to
      // a non-expiring download token.
      console.error("[resolvePaperAssetUrl] signing failed", {
        paperId,
        assetKind,
        message: err && err.message,
      });
      throw new HttpsError("failed-precondition",
        "Could not sign a link for the paper file. The Cloud Functions " +
        "service account needs roles/iam.serviceAccountTokenCreator on " +
        "itself to mint signed URLs.");
    }

    // The fallback succeeded, which means Storage rules DENIED a caller the
    // server considers staff. Record it: without this the workaround quietly
    // absorbs the rules/profile drift it exists to route around. Never logs
    // the URL, the object path, or any object metadata — see
    // buildFallbackLogEvent.
    console.log(JSON.stringify(buildFallbackLogEvent({
      callerUid: uid,
      callerRole: role,
      emailVerified: !!(request.auth && request.auth.token &&
        request.auth.token.email_verified),
      paperId,
      assetKind,
      ttlSeconds: DEFAULT_TTL_SECONDS,
    })));

    return {url, expiresInSeconds: DEFAULT_TTL_SECONDS};
  });
}

module.exports = {createResolvePaperAssetUrl};
