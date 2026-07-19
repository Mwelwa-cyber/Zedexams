/**
 * Assessment export pipeline — effectful half.
 *
 * Callables:
 *   requestAssessmentExport   — compute the source hash, serve a cached export
 *                               if one exists, otherwise lease + generate +
 *                               upload once, and mint a short-lived download
 *                               ticket. Idempotent across clicks/tabs via a
 *                               Firestore lease.
 *   getAssessmentExportStatus — observe an in-flight/ready export (poll) and
 *                               mint a ticket when it's ready.
 *   prewarmAssessmentExports  — best-effort pre-generation after a save.
 *
 * HTTP:
 *   apiAssessmentDownload     — GET /downloads/assessments/:id/:type — validate
 *                               the ticket (or ID token), resolve the
 *                               SERVER-STORED storage path, and stream the
 *                               object from a zedexams.com origin. The raw
 *                               firebasestorage URL / download token is never
 *                               exposed to the client.
 *
 * Firestore trigger:
 *   reapAssessmentExportsOnDelete — cascade-delete export objects + state when
 *                                   an assessment is deleted (region matches
 *                                   the (default) DB: africa-south1).
 *
 * Structured logs carry assessmentId, exportType, assessmentVersion (the source
 * hash), cacheHit and the split durations — never question content, download
 * tokens or private file URLs.
 */

const {onCall, onRequest, HttpsError} = require("firebase-functions/v2/https");
const {onDocumentDeleted} = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

const {assertVerifiedAuth, assertDecodedVerified} = require("../authGuard");
const {getUserRole} = require("../aiService");
const {contentDispositionFor} = require("../downloadHeaders");
const {computeSourceHash} = require("./sourceHash");
const {buildExportFilename} = require("./exportFilename");
const core = require("./exportsCore");
const {buildServerPaperModel} = require("./renderModel");
const {fetchImages} = require("./imageFetch");

const TICKET_TTL_MS = 5 * 60 * 1000;
const EXPORT_STATE_COLLECTION = "assessmentExports";
const TICKET_COLLECTION = "downloadTickets";

/** now() indirection so tests can stay deterministic if needed. */
function nowMs() {
  return Date.now();
}

function isAdminRole(role) {
  return role === "admin" || role === "superAdmin";
}

/** Structured, PII-free log line. */
function logExport(evt, fields) {
  try {
    console.log(JSON.stringify({evt: `assessmentExport.${evt}`, ...fields}));
  } catch { /* logging must never throw */ }
}

/** Load an assessment doc + its ordered questions. One assessment read + one
 * subcollection read (batched by Firestore) — not one read per question. */
async function loadAssessment(db, assessmentId) {
  const snap = await db.collection("assessments").doc(assessmentId).get();
  if (!snap.exists) return null;
  return {id: snap.id, ...snap.data()};
}

async function loadQuestions(db, assessmentId) {
  const qSnap = await db.collection("assessments").doc(assessmentId)
    .collection("questions").orderBy("order", "asc").get();
  return qSnap.docs.map((d) => ({_id: d.id, ...d.data()}));
}

/** Render the export bytes for a resolved type. Returns { buffer, contentType }. */
async function renderExport(assessment, questions, typeCfg) {
  const model = buildServerPaperModel(assessment, questions, typeCfg.mode);
  const images = model.imageRefs.length
    ? await fetchImages(model.imageRefs.map((r) => r.url), admin)
    : {};
  const attribution = false; // server exports are the owner's own paper.
  if (typeCfg.format === "pdf") {
    const {buildAssessmentPdfBuffer} = require("./renderPdf");
    const buffer = await buildAssessmentPdfBuffer(assessment, questions, {mode: typeCfg.mode, attribution, images});
    return {buffer, contentType: core.PDF_CONTENT_TYPE};
  }
  const {buildAssessmentDocxBuffer} = require("./renderDocx");
  const buffer = await buildAssessmentDocxBuffer(assessment, questions, {mode: typeCfg.mode, attribution, images});
  return {buffer, contentType: core.DOCX_CONTENT_TYPE};
}

/** Mint a short-lived, owner-scoped download ticket for a ready object. */
async function mintTicket(db, {uid, assessmentId, exportType, storagePath, filename, contentType}) {
  const now = nowMs();
  const ref = await db.collection(TICKET_COLLECTION).add({
    kind: "assessment-export",
    uid,
    assessmentId,
    exportType,
    storagePath,
    filename,
    contentType,
    createdAt: admin.firestore.Timestamp.fromMillis(now),
    expiresAt: admin.firestore.Timestamp.fromMillis(now + TICKET_TTL_MS),
  });
  return ref.id;
}

/** Delete obsolete export objects (any hash folder that isn't the current one). */
async function reapObsoleteVersions(bucket, teacherUid, assessmentId, keepHash) {
  try {
    const prefix = core.buildAssessmentPrefix(teacherUid, assessmentId);
    const keepPrefix = core.buildHashPrefix(teacherUid, assessmentId, keepHash);
    const [files] = await bucket.getFiles({prefix});
    const stale = files.filter((f) => !f.name.startsWith(keepPrefix));
    await Promise.all(stale.map((f) => f.delete().catch(() => {})));
    return stale.length;
  } catch {
    return 0;
  }
}

/**
 * Core generate-or-serve for one export type. Returns a result object with a
 * `status` the client can act on. Never throws for the "someone else is
 * generating" case — that returns { status: 'generating' }.
 */
async function ensureExport({db, bucket, uid, assessment, questions, typeCfg}) {
  const started = nowMs();
  const assessmentId = assessment.id;
  const teacherUid = assessment.createdBy;
  const sourceHash = computeSourceHash(assessment, questions);
  const stateRef = db.collection(EXPORT_STATE_COLLECTION).doc(assessmentId);
  const filename = buildExportFilename(assessment, typeCfg.format, typeCfg.mode);

  // 1. Fast path: is a ready object already cached for this hash?
  const stateSnap = await stateRef.get();
  const state = stateSnap.exists ? stateSnap.data() : {};
  const entry = state[typeCfg.kind] || null;
  const decision = core.classifyExportRequest(entry, sourceHash, nowMs());

  if (decision.action === "serve") {
    const ticket = await mintTicket(db, {uid, assessmentId, exportType: typeCfg.key,
      storagePath: decision.storagePath, filename, contentType: core.contentTypeForFormat(typeCfg.format)});
    logExport("serve", {assessmentId, exportType: typeCfg.key, assessmentVersion: sourceHash,
      cacheHit: true, totalDurationMs: nowMs() - started});
    return {status: "ready", exportType: typeCfg.key, filename,
      downloadPath: `/downloads/assessments/${assessmentId}/${typeCfg.key}`, ticket, cacheHit: true};
  }
  if (decision.action === "wait") {
    logExport("wait", {assessmentId, exportType: typeCfg.key, assessmentVersion: sourceHash, cacheHit: false});
    return {status: "generating", exportType: typeCfg.key, filename};
  }

  // 2. Claim the generation lease atomically (single generation across tabs).
  const claim = await db.runTransaction(async (tx) => {
    const s = await tx.get(stateRef);
    const cur = s.exists ? s.data() : {};
    const curEntry = cur[typeCfg.kind] || null;
    if (curEntry && curEntry.status === "ready" && curEntry.sourceHash === sourceHash && curEntry.storagePath) {
      return {claimed: false, serve: curEntry.storagePath};
    }
    if (!core.canClaimLease(curEntry, nowMs())) {
      return {claimed: false, serve: null};
    }
    const leaseEntry = core.buildLeaseEntry(curEntry, sourceHash, uid, nowMs());
    tx.set(stateRef, {ownerUid: teacherUid, [typeCfg.kind]: leaseEntry,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()}, {merge: true});
    return {claimed: true, leaseEntry};
  });

  if (!claim.claimed) {
    if (claim.serve) {
      const ticket = await mintTicket(db, {uid, assessmentId, exportType: typeCfg.key,
        storagePath: claim.serve, filename, contentType: core.contentTypeForFormat(typeCfg.format)});
      logExport("serve", {assessmentId, exportType: typeCfg.key, assessmentVersion: sourceHash,
        cacheHit: true, totalDurationMs: nowMs() - started});
      return {status: "ready", exportType: typeCfg.key, filename,
        downloadPath: `/downloads/assessments/${assessmentId}/${typeCfg.key}`, ticket, cacheHit: true};
    }
    return {status: "generating", exportType: typeCfg.key, filename};
  }

  // 3. Generate + upload (outside any transaction — this is the slow part).
  const genStart = nowMs();
  let buffer; let contentType;
  try {
    ({buffer, contentType} = await renderExport(assessment, questions, typeCfg));
  } catch (err) {
    await stateRef.set({[typeCfg.kind]: core.buildFailedEntry(claim.leaseEntry, sourceHash, "RENDER_ERROR")},
      {merge: true});
    logExport("fail", {assessmentId, exportType: typeCfg.key, assessmentVersion: sourceHash,
      cacheHit: false, failureCode: "RENDER_ERROR"});
    return {status: "failed", exportType: typeCfg.key, failureCode: "RENDER_ERROR"};
  }
  const generationDurationMs = nowMs() - genStart;

  const storagePath = core.buildStoragePath(teacherUid, assessmentId, sourceHash, typeCfg.objectName);
  const upStart = nowMs();
  try {
    await bucket.file(storagePath).save(buffer, {
      resumable: false,
      contentType,
      metadata: {cacheControl: "private, max-age=3600", metadata: {sourceHash, exportType: typeCfg.key}},
    });
  } catch (err) {
    await stateRef.set({[typeCfg.kind]: core.buildFailedEntry(claim.leaseEntry, sourceHash, "UPLOAD_ERROR")},
      {merge: true});
    logExport("fail", {assessmentId, exportType: typeCfg.key, assessmentVersion: sourceHash,
      cacheHit: false, failureCode: "UPLOAD_ERROR"});
    return {status: "failed", exportType: typeCfg.key, failureCode: "UPLOAD_ERROR"};
  }
  const uploadDurationMs = nowMs() - upStart;

  // 4. Record ready state, then prune obsolete versions (previous ready object
  //    is only removed AFTER the new one is durably ready).
  await stateRef.set({ownerUid: teacherUid,
    [typeCfg.kind]: core.buildReadyEntry(sourceHash, storagePath, buffer.length, nowMs())}, {merge: true});
  reapObsoleteVersions(bucket, teacherUid, assessmentId, sourceHash).catch(() => {});

  const ticket = await mintTicket(db, {uid, assessmentId, exportType: typeCfg.key,
    storagePath, filename, contentType});
  logExport("generate", {assessmentId, exportType: typeCfg.key, assessmentVersion: sourceHash,
    cacheHit: false, generationDurationMs, uploadDurationMs, sizeBytes: buffer.length,
    totalDurationMs: nowMs() - started});
  return {status: "ready", exportType: typeCfg.key, filename,
    downloadPath: `/downloads/assessments/${assessmentId}/${typeCfg.key}`, ticket, cacheHit: false};
}

/** Shared authz preamble for the callables. Returns { db, uid, assessment, questions }. */
async function authorizeAndLoad(request, {needQuestions = true} = {}) {
  const uid = await assertVerifiedAuth(request);
  const data = request.data || {};
  const assessmentId = String(data.assessmentId || "");
  if (!assessmentId) throw new HttpsError("invalid-argument", "Missing assessmentId.");
  const db = admin.firestore();
  const assessment = await loadAssessment(db, assessmentId);
  const role = await getUserRole(uid);
  const authz = core.authorizeAssessmentAccess({assessment, uid, isAdmin: isAdminRole(role)});
  if (!authz.ok) {
    if (authz.code === "not-found") throw new HttpsError("not-found", "Assessment not found.");
    if (authz.code === "unauthenticated") throw new HttpsError("unauthenticated", "Please sign in.");
    throw new HttpsError("permission-denied", "You don't have access to this assessment.");
  }
  const questions = needQuestions ? await loadQuestions(db, assessmentId) : [];
  return {db, uid, assessment, questions};
}

const requestAssessmentExport = onCall(
  {region: "us-central1", timeoutSeconds: 300, memory: "1GiB"},
  async (request) => {
    const {db, uid, assessment, questions} = await authorizeAndLoad(request);
    const typeCfg = core.resolveExportType(request.data?.exportType);
    if (!typeCfg) throw new HttpsError("invalid-argument", "Unknown export type.");
    if (!questions.length) throw new HttpsError("failed-precondition", "This paper has no questions to export.");
    const bucket = admin.storage().bucket();
    return ensureExport({db, bucket, uid, assessment, questions, typeCfg});
  },
);

const getAssessmentExportStatus = onCall(
  {region: "us-central1", timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const {db, uid, assessment, questions} = await authorizeAndLoad(request);
    const typeCfg = core.resolveExportType(request.data?.exportType);
    if (!typeCfg) throw new HttpsError("invalid-argument", "Unknown export type.");
    const sourceHash = computeSourceHash(assessment, questions);
    const stateSnap = await db.collection(EXPORT_STATE_COLLECTION).doc(assessment.id).get();
    const entry = (stateSnap.exists ? stateSnap.data() : {})[typeCfg.kind] || null;
    const decision = core.classifyExportRequest(entry, sourceHash, nowMs());
    const filename = buildExportFilename(assessment, typeCfg.format, typeCfg.mode);
    if (decision.action === "serve") {
      const ticket = await mintTicket(db, {uid, assessmentId: assessment.id, exportType: typeCfg.key,
        storagePath: decision.storagePath, filename, contentType: core.contentTypeForFormat(typeCfg.format)});
      return {status: "ready", exportType: typeCfg.key, filename,
        downloadPath: `/downloads/assessments/${assessment.id}/${typeCfg.key}`, ticket, cacheHit: true};
    }
    if (decision.action === "wait") return {status: "generating", exportType: typeCfg.key, filename};
    if (core.isHardFailed(entry, sourceHash)) {
      return {status: "failed", exportType: typeCfg.key, failureCode: entry.failureCode || "GENERATION_FAILED"};
    }
    return {status: "missing", exportType: typeCfg.key, filename};
  },
);

const prewarmAssessmentExports = onCall(
  {region: "us-central1", timeoutSeconds: 300, memory: "1GiB"},
  async (request) => {
    const {db, uid, assessment, questions} = await authorizeAndLoad(request);
    if (!questions.length) return {ok: true, warmed: []};
    const bucket = admin.storage().bucket();
    const warmed = [];
    for (const key of core.PREWARM_EXPORT_TYPES) {
      const typeCfg = core.resolveExportType(key);
      try {
        const r = await ensureExport({db, bucket, uid, assessment, questions, typeCfg});
        warmed.push({exportType: key, status: r.status});
      } catch (err) {
        logExport("prewarm.fail", {assessmentId: assessment.id, exportType: key});
      }
    }
    return {ok: true, warmed};
  },
);

/* ─────────────────────────  branded download endpoint  ───────────────────── */

function parseDownloadPath(pathname) {
  // Accept /downloads/assessments/:id/:type (Hosting rewrites /downloads/** here)
  const m = String(pathname || "").match(/\/assessments\/([^/]+)\/([^/?]+)/);
  if (!m) return null;
  return {assessmentId: decodeURIComponent(m[1]), exportType: decodeURIComponent(m[2])};
}

/** Extract an ID token from an Authorization: Bearer header or __session cookie. */
function extractIdToken(req) {
  const auth = req.headers.authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (m) return m[1].trim();
  const cookie = req.headers.cookie || "";
  const cm = /(?:^|;\s*)__session=([^;]+)/.exec(cookie);
  return cm ? decodeURIComponent(cm[1]) : null;
}

async function streamObject(res, bucket, storagePath, {contentType, filename, sourceHash}) {
  const file = bucket.file(storagePath);
  const [exists] = await file.exists();
  if (!exists) {
    res.status(404).send("This export is no longer available. Please re-open the paper and download again.");
    return;
  }
  let sizeBytes = 0;
  try {
    const [meta] = await file.getMetadata();
    sizeBytes = Number(meta.size || 0);
  } catch { /* size is optional */ }

  // Headers BEFORE streaming.
  res.set("Content-Type", contentType);
  res.set("Content-Disposition", contentDispositionFor(filename));
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Cache-Control", "private, max-age=3600, no-transform");
  if (sizeBytes) res.set("Content-Length", String(sizeBytes));
  if (sourceHash) res.set("ETag", `"${sourceHash}"`);
  res.status(200);

  const stream = file.createReadStream();
  // Support client cancellation/disconnect — stop reading from Storage.
  const onClose = () => { try { stream.destroy(); } catch { /* already gone */ } };
  res.on("close", onClose);
  stream.on("error", (err) => {
    console.error("[apiAssessmentDownload] stream error", err?.message || err);
    if (!res.headersSent) res.status(500);
    try { res.end(); } catch { /* noop */ }
  });
  stream.pipe(res);
}

const apiAssessmentDownload = onRequest(
  {region: "us-central1", timeoutSeconds: 120, memory: "512MiB", cors: false},
  async (req, res) => {
    if (req.method !== "GET") { res.status(405).send("Use GET."); return; }
    const parsed = parseDownloadPath(req.path || req.url);
    if (!parsed) { res.status(400).send("Invalid download link."); return; }
    const typeCfg = core.resolveExportType(parsed.exportType);
    if (!typeCfg) { res.status(400).send("Unknown export type."); return; }

    const db = admin.firestore();
    const bucket = admin.storage().bucket();
    const ticketId = String((req.query && req.query.t) || "");

    try {
      // ── Path A: short-lived download ticket (the branded-URL happy path) ──
      if (ticketId) {
        const tSnap = await db.collection(TICKET_COLLECTION).doc(ticketId).get();
        if (!tSnap.exists) { res.status(404).send("This download link is no longer valid. Please try again."); return; }
        const t = tSnap.data();
        const expiresAt = t.expiresAt?.toMillis ? t.expiresAt.toMillis() : 0;
        if (!expiresAt || expiresAt < nowMs()) { res.status(410).send("This download link has expired. Please try again."); return; }
        if (t.kind !== "assessment-export" || t.assessmentId !== parsed.assessmentId || t.exportType !== parsed.exportType) {
          res.status(403).send("Forbidden."); return;
        }
        // Never trust a client path: storagePath was written by the server at
        // mint time. Defence-in-depth — confirm it still sits inside THIS
        // ticket-owner's export namespace for THIS assessment before streaming.
        if (!core.isExportPathFor(t.storagePath, parsed.assessmentId, typeCfg.objectName)) {
          res.status(403).send("Forbidden."); return;
        }
        await streamObject(res, bucket, t.storagePath, {
          contentType: t.contentType || core.contentTypeForFormat(typeCfg.format),
          filename: t.filename || buildExportFilename({}, typeCfg.format, typeCfg.mode),
        });
        return;
      }

      // ── Path B: a verified Firebase ID token (Authorization / __session) ──
      const idToken = extractIdToken(req);
      if (!idToken) { res.status(401).send("Sign in to download this file."); return; }
      let decoded;
      try {
        decoded = await admin.auth().verifyIdToken(idToken);
        await assertDecodedVerified(decoded);
      } catch { res.status(401).send("Your session has expired. Please sign in again."); return; }

      const assessment = await loadAssessment(db, parsed.assessmentId);
      const role = await getUserRole(decoded.uid);
      const authz = core.authorizeAssessmentAccess({assessment, uid: decoded.uid, isAdmin: isAdminRole(role)});
      if (!authz.ok) { res.status(core.httpStatusForCode(authz.code)).send(authz.code === "not-found" ? "Not found." : "Forbidden."); return; }

      const questions = await loadQuestions(db, parsed.assessmentId);
      const sourceHash = computeSourceHash(assessment, questions);
      const stateSnap = await db.collection(EXPORT_STATE_COLLECTION).doc(parsed.assessmentId).get();
      const entry = (stateSnap.exists ? stateSnap.data() : {})[typeCfg.kind] || null;
      const decision = core.classifyExportRequest(entry, sourceHash, nowMs());
      if (decision.action !== "serve") { res.status(409).send("This export isn't ready yet. Please try again in a moment."); return; }

      await streamObject(res, bucket, decision.storagePath, {
        contentType: core.contentTypeForFormat(typeCfg.format),
        filename: buildExportFilename(assessment, typeCfg.format, typeCfg.mode),
        sourceHash,
      });
    } catch (err) {
      console.error("[apiAssessmentDownload] failed", err?.message || err);
      if (!res.headersSent) res.status(500).send("Could not fetch the download. Please try again.");
    }
  },
);

/* ────────────────────────  cleanup on assessment delete  ──────────────────── */

const reapAssessmentExportsOnDelete = onDocumentDeleted(
  {document: "assessments/{assessmentId}", region: "africa-south1"},
  async (event) => {
    const assessmentId = event.params.assessmentId;
    const before = event.data?.data() || {};
    const teacherUid = before.createdBy;
    const db = admin.firestore();
    try {
      if (teacherUid) {
        const bucket = admin.storage().bucket();
        const prefix = core.buildAssessmentPrefix(teacherUid, assessmentId);
        const [files] = await bucket.getFiles({prefix});
        await Promise.all(files.map((f) => f.delete().catch(() => {})));
      }
      await db.collection(EXPORT_STATE_COLLECTION).doc(assessmentId).delete().catch(() => {});
    } catch (err) {
      console.error("[reapAssessmentExportsOnDelete] failed", err?.message || err);
    }
  },
);

module.exports = {
  requestAssessmentExport,
  getAssessmentExportStatus,
  prewarmAssessmentExports,
  apiAssessmentDownload,
  reapAssessmentExportsOnDelete,
  // exported for tests
  parseDownloadPath,
  extractIdToken,
  ensureExport,
};
