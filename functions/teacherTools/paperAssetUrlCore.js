"use strict";

/**
 * paperAssetUrlCore — the PURE half of the resolvePaperAssetUrl callable.
 *
 * The callable mints a tokened download URL for an uploaded past-paper file so
 * the admin Quiz Editor's "Crop from page" (and the paper/mark-scheme
 * reference links) keep working even when a direct client-side Storage read is
 * denied by rules (storage/unauthorized) — the server is the authority on who
 * is staff, so the client's rules evaluation stops being a single point of
 * failure for an admin-only workflow.
 *
 * This module owns the one security-relevant decision that is testable
 * without Firebase: is the requested Storage path actually a file belonging
 * to this pastPapers doc? The callable NEVER mints a URL for an arbitrary
 * path — only for a path the paper itself declares (pdfPath, markSchemePath,
 * or an assets[] entry), so a staff token cannot be used to token-ify
 * unrelated bucket objects.
 */

/**
 * True when `path` is one of the Storage paths this paper doc declares.
 * Strict string equality — no prefix matching, no normalisation — because the
 * declared paths were written verbatim by the studio's own uploaders.
 */
function isDeclaredPaperAssetPath(paper, path) {
  if (!paper || typeof paper !== "object") return false;
  if (typeof path !== "string" || !path) return false;
  if (paper.pdfPath === path) return true;
  if (paper.markSchemePath === path) return true;
  const assets = Array.isArray(paper.assets) ? paper.assets : [];
  return assets.some((a) => a && typeof a === "object" && a.path === path);
}

/**
 * Build the same URL shape the client SDK's getDownloadURL() returns, from a
 * bucket name + object path + Firebase download token. Mirrors the
 * generateDiagram precedent (functions/teacherTools/generateDiagram.js) —
 * this project deliberately uses download tokens, NOT file.getSignedUrl(),
 * because the default runtime service account lacks iam signBlob.
 */
function buildTokenedDownloadUrl(bucketName, path, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/` +
    `${encodeURIComponent(path)}?alt=media&token=${token}`;
}

module.exports = {isDeclaredPaperAssetPath, buildTokenedDownloadUrl};
