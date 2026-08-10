"use strict";

/**
 * paperAssetUrlCore — the PURE half of the resolvePaperAssetUrl callable.
 *
 * The callable mints a SHORT-LIVED V4 signed URL for an uploaded past-paper
 * file so the admin Quiz Editor's "Crop from page" (and the paper/mark-scheme
 * reference links) keep working even when a direct client-side Storage read is
 * denied by rules (storage/unauthorized) — the server is the authority on who
 * is staff, so the client's rules evaluation stops being a single point of
 * failure for an admin-only workflow.
 *
 * This module owns the decisions that are testable without Firebase:
 *
 *   1. Is the requested path SHAPED like a paper asset (canonical, no
 *      traversal, inside the papers/ tree)?
 *   2. Is it actually a file THIS pastPapers doc declares?
 *   3. How long may the signed URL live?
 *   4. What may the fallback's audit event contain?
 *
 * (1) and (2) are separate on purpose and the callable requires BOTH. (2)
 * alone is already strict equality, so traversal cannot match a declared path
 * today — but (2) trusts strings written into the paper doc, and (1) is what
 * keeps that trust bounded if the doc is ever wrong. Writes to pastPapers are
 * admin-only (firestore.rules), so this is defence in depth rather than a
 * live hole; it is also the check that stops a future refactor to prefix
 * matching from turning the allow-list into a bucket-wide read.
 */

// Every paper file the studio writes lives under this prefix:
//   papers/{ownerUid}/{paperId}/{kind}-{name}      (pastPapers.js uploadPaperPdf)
//   papers/{ownerUid}/{paperId}/assets/{i}-{name}  (pastPapers.js uploadPaperAsset)
//   papers/{ownerUid}/{paperId}/figures/{id}-{ts}  (paperFigureAttach.js)
const PAPER_PATH_PREFIX = "papers/";

// Storage object names may be up to 1024 bytes; anything longer cannot be a
// real object, so it is a malformed request rather than a miss.
const MAX_PATH_LENGTH = 1024;

// The signed URL must outlive a page render and a click, and nothing more.
// Ten minutes sits in the middle of the agreed 5–15 minute band.
const MIN_TTL_SECONDS = 5 * 60;
const MAX_TTL_SECONDS = 15 * 60;
const DEFAULT_TTL_SECONDS = 10 * 60;

/**
 * True when `path` is a canonical, traversal-free object name inside the
 * papers/ tree. Rejects — deliberately, and before any allow-list lookup:
 *
 *   - absolute paths and anything outside papers/
 *   - "." / ".." segments, empty segments (`//`), and a trailing slash
 *   - backslashes, which some downstream normalisers fold into separators
 *   - percent-encoding, because declared paths are stored VERBATIM by the
 *     studio's uploaders and never encoded — a `%` here can therefore only be
 *     an attempt to smuggle a separator or a traversal past this check
 *   - control characters, including NUL (classic truncation trick)
 */
function isCanonicalPaperAssetPath(path) {
  if (typeof path !== "string" || !path) return false;
  if (path.length > MAX_PATH_LENGTH) return false;
  if (/[\u0000-\u001f\u007f]/.test(path)) return false;
  if (path.includes("\\")) return false;
  if (path.includes("%")) return false;
  if (!path.startsWith(PAPER_PATH_PREFIX)) return false;
  const segments = path.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) return false;
  // papers/{ownerUid}/{...at least one more} — the prefix alone is a folder.
  return segments.length >= 3;
}

/**
 * Which field of the paper doc declares `path`, or null when none does.
 * Strict string equality — no prefix matching, no normalisation — because the
 * declared paths were written verbatim by the studio's own uploaders.
 *
 * The returned kind is also what the audit event records, so the log says
 * WHICH file was served without reproducing the object path.
 *
 * @returns {"pdf"|"markScheme"|"asset"|null}
 */
function classifyPaperAssetPath(paper, path) {
  if (!paper || typeof paper !== "object") return null;
  if (typeof path !== "string" || !path) return null;
  if (paper.pdfPath === path) return "pdf";
  if (paper.markSchemePath === path) return "markScheme";
  const assets = Array.isArray(paper.assets) ? paper.assets : [];
  const hit = assets.some((a) => a && typeof a === "object" && a.path === path);
  return hit ? "asset" : null;
}

/**
 * True when `path` is one of the Storage paths this paper doc declares.
 */
function isDeclaredPaperAssetPath(paper, path) {
  return classifyPaperAssetPath(paper, path) !== null;
}

/**
 * Resolve the absolute expiry (ms since epoch) for a signed URL.
 * Throws on a TTL outside the agreed band rather than silently clamping: a
 * caller asking for a day-long URL has misunderstood what this endpoint is,
 * and quietly issuing a 15-minute one would hide that.
 */
function resolveSignedUrlExpiry(nowMs, ttlSeconds = DEFAULT_TTL_SECONDS) {
  if (!Number.isFinite(nowMs) || nowMs <= 0) {
    throw new Error("resolveSignedUrlExpiry: nowMs must be a positive number");
  }
  if (!Number.isFinite(ttlSeconds) ||
      ttlSeconds < MIN_TTL_SECONDS || ttlSeconds > MAX_TTL_SECONDS) {
    throw new Error(
      `resolveSignedUrlExpiry: ttlSeconds must be between ${MIN_TTL_SECONDS} ` +
      `and ${MAX_TTL_SECONDS}, got ${ttlSeconds}`,
    );
  }
  return nowMs + ttlSeconds * 1000;
}

// The ONLY keys the fallback audit event may carry. This is an allow-list
// rather than a denylist because the failure being guarded against is someone
// later adding `url`, `token`, or a spread of the object's metadata to "make
// debugging easier" — a denylist would not have a name for the field that had
// not been invented yet. buildFallbackLogEvent builds the object from exactly
// these keys and the test asserts the key set, so a new field fails CI until
// it is justified here.
const FALLBACK_EVENT_KEYS = Object.freeze([
  "event",
  "callerUid",
  "callerRole",
  "emailVerified",
  "paperId",
  "assetKind",
  "ttlSeconds",
]);

const FALLBACK_EVENT_NAME = "paper_asset_url_fallback_used";

/**
 * Build the structured event emitted when the server fallback SUCCEEDS.
 *
 * Why it exists: the fallback restores access without explaining the denial
 * that triggered it. Left silent, it would quietly absorb the rules/profile
 * drift it was built to work around, and the underlying problem would never
 * be noticed again. So every success is recorded with exactly the fields that
 * identify the drift — who was denied, what role their profile says they
 * hold, whether their token was verified — and none that identify the file's
 * contents or grant access to it.
 *
 * Deliberately absent: the signed URL, any download token, the object path,
 * and the object's Storage metadata (size, contentType, custom metadata).
 * `assetKind` says which of the paper's files was served, which is what a
 * reader actually needs, without reproducing a credential or an object name.
 */
function buildFallbackLogEvent({
  callerUid,
  callerRole,
  emailVerified,
  paperId,
  assetKind,
  ttlSeconds,
}) {
  return {
    event: FALLBACK_EVENT_NAME,
    callerUid: String(callerUid || ""),
    callerRole: String(callerRole || ""),
    emailVerified: emailVerified === true,
    paperId: String(paperId || ""),
    assetKind: String(assetKind || ""),
    ttlSeconds: Number(ttlSeconds) || 0,
  };
}

module.exports = {
  PAPER_PATH_PREFIX,
  MIN_TTL_SECONDS,
  MAX_TTL_SECONDS,
  DEFAULT_TTL_SECONDS,
  FALLBACK_EVENT_KEYS,
  FALLBACK_EVENT_NAME,
  isCanonicalPaperAssetPath,
  classifyPaperAssetPath,
  isDeclaredPaperAssetPath,
  resolveSignedUrlExpiry,
  buildFallbackLogEvent,
};
