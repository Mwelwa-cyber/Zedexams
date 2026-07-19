/**
 * Pure decision logic + shape helpers for the assessment export pipeline.
 *
 * No firebase-admin / firebase-functions imports (the *Core.js convention) so
 * every rule here is exercised under plain `node functions/assessmentExports/
 * exportsCore.test.js`. The effectful halves — the Firestore lease transaction,
 * Storage streaming, the callable/onRequest handlers — live in the sibling
 * modules and delegate their decisions to the pure functions below.
 */

const DOCX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_CONTENT_TYPE = "application/pdf";

/**
 * The three public export types. `kind` is the field key on the export-state
 * doc; `format`/`mode` drive the renderer; `objectName` is the immutable file
 * name inside the per-hash Storage folder.
 */
const EXPORT_TYPES = {
  "paper-docx": {kind: "paperDocx", format: "docx", mode: "paper", objectName: "paper.docx"},
  "paper-pdf": {kind: "paperPdf", format: "pdf", mode: "paper", objectName: "paper.pdf"},
  "scheme-docx": {kind: "schemeDocx", format: "docx", mode: "scheme", objectName: "scheme.docx"},
};

/** Export types that are pre-generated when a paper is saved (the common ones). */
const PREWARM_EXPORT_TYPES = ["paper-docx"];

/** Status values an export-state entry can hold. */
const EXPORT_STATUSES = ["missing", "queued", "generating", "ready", "failed"];

/** A stale generation lease is reclaimable after this long (a crashed / timed-out
 * generator must never wedge the export forever). */
const LEASE_TTL_MS = 3 * 60 * 1000;

/** Cap on generation attempts before an export is reported as hard-failed. */
const MAX_ATTEMPTS = 4;

/** Validate + resolve a client-supplied export type. Returns the config or null. */
function resolveExportType(exportType) {
  const key = String(exportType || "").trim();
  return Object.prototype.hasOwnProperty.call(EXPORT_TYPES, key) ? {key, ...EXPORT_TYPES[key]} : null;
}

/** Content-Type header for an export format. */
function contentTypeForFormat(format) {
  return format === "pdf" ? PDF_CONTENT_TYPE : DOCX_CONTENT_TYPE;
}

/**
 * Build the immutable, versioned Storage object path for a ready export.
 * Shape: assessment-exports/{teacherUid}/{assessmentId}/{sourceHash}/{objectName}
 *
 * teacherUid / assessmentId / sourceHash are all server-derived (owner uid from
 * the assessment doc, hash computed server-side) — NEVER a client-supplied
 * path — which is what makes path traversal structurally impossible: the
 * segments are validated to a safe charset and the download endpoint only ever
 * reads the `storagePath` the server itself wrote.
 */
function buildStoragePath(teacherUid, assessmentId, sourceHash, objectName) {
  for (const [label, seg] of [["teacherUid", teacherUid], ["assessmentId", assessmentId], ["sourceHash", sourceHash]]) {
    if (!isSafeSegment(seg)) {
      throw new Error(`Unsafe ${label} segment for export storage path`);
    }
  }
  if (!/^[a-z0-9._-]+$/i.test(String(objectName || ""))) {
    throw new Error("Unsafe object name for export storage path");
  }
  return `assessment-exports/${teacherUid}/${assessmentId}/${sourceHash}/${objectName}`;
}

/** The per-hash folder prefix (used to sweep obsolete versions). */
function buildHashPrefix(teacherUid, assessmentId, sourceHash) {
  return `assessment-exports/${teacherUid}/${assessmentId}/${sourceHash}/`;
}

/** The per-assessment root prefix (all versions live under here). */
function buildAssessmentPrefix(teacherUid, assessmentId) {
  return `assessment-exports/${teacherUid}/${assessmentId}/`;
}

/**
 * Verify a server-stored path really is an export object for THIS assessment
 * and export type — defence-in-depth before the download endpoint streams it.
 * Shape: assessment-exports/{uid}/{assessmentId}/{hash}/{objectName}.
 * Independent of which uid owns it (an admin download resolves the owner's
 * path), so it validates structure, not identity.
 */
function isExportPathFor(storagePath, assessmentId, objectName) {
  const parts = String(storagePath || "").split("/");
  return parts.length === 5 &&
    parts[0] === "assessment-exports" &&
    isSafeSegment(parts[1]) &&
    parts[2] === String(assessmentId) &&
    isSafeSegment(parts[3]) &&
    parts[4] === String(objectName);
}

/** A Storage path segment must be a non-empty run of id-safe chars — no "/",
 * no "..", no whitespace — so it can't escape the export namespace. */
function isSafeSegment(seg) {
  const s = String(seg || "");
  return s.length > 0 && s.length <= 256 && /^[a-zA-Z0-9._-]+$/.test(s) && s !== "." && s !== "..";
}

/**
 * Decide what a request for `exportType` should do given the current export
 * state entry and the freshly-computed hash. Returns one of:
 *   { action: 'serve', ... }        — a ready object for this hash exists; stream it.
 *   { action: 'wait' }              — someone else holds a live generation lease.
 *   { action: 'generate' }          — nothing usable; caller should claim + build.
 * The caller performs the atomic lease claim in a transaction; this function
 * only classifies.
 */
function classifyExportRequest(entry, currentHash, nowMs) {
  const e = entry || {};
  if (e.status === "ready" && e.sourceHash === currentHash && e.storagePath) {
    return {action: "serve", storagePath: e.storagePath};
  }
  if ((e.status === "generating" || e.status === "queued") && e.sourceHash === currentHash) {
    const leaseLive = typeof e.leaseExpiresAt === "number" && e.leaseExpiresAt > nowMs;
    if (leaseLive) return {action: "wait"};
  }
  return {action: "generate"};
}

/**
 * Is this entry a permanent failure the client should be shown a retry for
 * (rather than silently spinning)? Hard-failed = failed status at the same hash
 * with attempts exhausted.
 */
function isHardFailed(entry, currentHash) {
  const e = entry || {};
  return e.status === "failed" && e.sourceHash === currentHash && Number(e.attemptCount || 0) >= MAX_ATTEMPTS;
}

/**
 * Build the export-state entry to write when claiming a generation lease.
 * Preserves attemptCount growth so runaway retries eventually hard-fail. Never
 * clears a previous `storagePath`/`sourceHash` of a DIFFERENT ready version —
 * the caller keeps the old ready object live until the new one succeeds.
 */
function buildLeaseEntry(prevEntry, currentHash, ownerId, nowMs) {
  const prev = prevEntry || {};
  const sameHashAttempts = prev.sourceHash === currentHash ? Number(prev.attemptCount || 0) : 0;
  return {
    status: "generating",
    sourceHash: currentHash,
    generationOwner: ownerId,
    leaseExpiresAt: nowMs + LEASE_TTL_MS,
    attemptCount: sameHashAttempts + 1,
    // Carry the previously-ready object forward so a failed regeneration can
    // fall back to it (Phase 3 "preserve the previous ready version").
    readyStoragePath: prev.status === "ready" ? prev.storagePath || null : (prev.readyStoragePath || null),
    readySourceHash: prev.status === "ready" ? prev.sourceHash || null : (prev.readySourceHash || null),
  };
}

/** Whether the caller may claim the lease: no live lease held by someone else. */
function canClaimLease(entry, nowMs) {
  const e = entry || {};
  if (e.status !== "generating" && e.status !== "queued") return true;
  const leaseLive = typeof e.leaseExpiresAt === "number" && e.leaseExpiresAt > nowMs;
  return !leaseLive; // reclaim an expired/crashed lease
}

/** The ready-state entry written after a successful generation + upload. */
function buildReadyEntry(currentHash, storagePath, sizeBytes, nowMs) {
  return {
    status: "ready",
    sourceHash: currentHash,
    storagePath,
    sizeBytes: Number(sizeBytes || 0),
    generatedAt: nowMs,
    failureCode: null,
    generationOwner: null,
    leaseExpiresAt: null,
  };
}

/**
 * The entry written when generation fails. Preserves the previous ready object
 * (readyStoragePath) so downloads of the last-good export keep working, and
 * keeps attemptCount so repeated failures eventually hard-fail.
 */
function buildFailedEntry(prevLeaseEntry, currentHash, failureCode) {
  const prev = prevLeaseEntry || {};
  const readyPath = prev.readyStoragePath || null;
  const readyHash = prev.readySourceHash || null;
  return {
    // If a previous ready version survives we keep it usable but flag the newer
    // hash as failed; the client can still download the old one.
    status: readyPath ? "ready" : "failed",
    sourceHash: readyPath ? readyHash : currentHash,
    storagePath: readyPath,
    failedHash: currentHash,
    failureCode: String(failureCode || "GENERATION_FAILED"),
    attemptCount: Number(prev.attemptCount || 0),
    generationOwner: null,
    leaseExpiresAt: null,
  };
}

/**
 * Decide whether the caller is authorised to download/generate this
 * assessment's exports. Owner (createdBy) or admin only. Deleted / missing
 * assessments are not authorised. Returns { ok, code } where code maps to an
 * HTTP status on the download endpoint.
 */
function authorizeAssessmentAccess({assessment, uid, isAdmin}) {
  if (!uid) return {ok: false, code: "unauthenticated"};
  if (!assessment) return {ok: false, code: "not-found"};
  if (assessment.deleted === true || assessment.isDeleted === true) {
    return {ok: false, code: "not-found"};
  }
  if (isAdmin) return {ok: true};
  if (assessment.createdBy && assessment.createdBy === uid) return {ok: true};
  return {ok: false, code: "forbidden"};
}

/** Map an internal authz/status code to an HTTP status for the endpoint. */
function httpStatusForCode(code) {
  switch (code) {
    case "unauthenticated": return 401;
    case "forbidden": return 403;
    case "not-found": return 404;
    case "not-ready": return 409;
    case "rate-limited": return 429;
    case "bad-request": return 400;
    default: return 500;
  }
}

module.exports = {
  DOCX_CONTENT_TYPE,
  PDF_CONTENT_TYPE,
  EXPORT_TYPES,
  PREWARM_EXPORT_TYPES,
  EXPORT_STATUSES,
  LEASE_TTL_MS,
  MAX_ATTEMPTS,
  resolveExportType,
  contentTypeForFormat,
  buildStoragePath,
  buildHashPrefix,
  buildAssessmentPrefix,
  isSafeSegment,
  isExportPathFor,
  classifyExportRequest,
  isHardFailed,
  buildLeaseEntry,
  canClaimLease,
  buildReadyEntry,
  buildFailedEntry,
  authorizeAssessmentAccess,
  httpStatusForCode,
};
