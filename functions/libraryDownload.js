/**
 * Server-generated library downloads — the reliable, Firebase-free, no-upload
 * way to download a saved studio document with the correct filename on EVERY
 * browser.
 *
 * Why this exists
 *   Browsers like DuckDuckGo / in-app WebViews drop the filename for a file
 *   generated inside the page (a blob: download), so the name has to arrive on
 *   an HTTP response header. Earlier attempts uploaded the rendered file to
 *   Firebase Storage (visible "from firebasestorage.googleapis.com" + an upload
 *   delay) or POSTed it back through an echo (fire-and-forget → silent failures).
 *
 *   The document is already saved server-side (aiGenerations/{id}), so we don't
 *   need to upload anything: a normal GET navigation to /api/teacher/download
 *   regenerates the .docx on the server and streams it with Content-Disposition.
 *   It downloads FROM zedexams.com, named correctly, with no client upload — and
 *   because it's a real navigation, a failure is VISIBLE (HTTP error) instead of
 *   silently dropping the download.
 *
 * Flow
 *   1. createLibraryDownloadTicket (callable, authenticated) verifies the caller
 *      owns the generation and mints a short-lived, unguessable ticket doc.
 *   2. The client navigates to /api/teacher/download?ticket=<id> (GET).
 *   3. apiLibraryDownload validates the ticket, regenerates the .docx, streams it.
 *   4. reapDownloadTickets sweeps expired tickets daily.
 *
 * The ticket id (a random Firestore doc id) is the bearer credential — the GET
 * can't carry a Firebase ID token — exactly like a Storage download token. It's
 * owner-scoped at mint time and expires in 5 minutes.
 */

const {onCall, onRequest, HttpsError} = require("firebase-functions/v2/https");
const {assertVerifiedAuth} = require("./authGuard");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const {contentDispositionFor, sanitizeFilename} = require("./downloadHeaders");

const TICKET_TTL_MS = 5 * 60 * 1000;
const DOCX_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// Tools this server path can currently render. Lesson plans first; others keep
// using the (working) client-side download until ported.
const SUPPORTED_TOOLS = new Set(["lesson_plan", "lesson-plan"]);

/**
 * Mint a short-lived download ticket for a generation the caller owns.
 * data: { generationId, format: 'docx', filename, attribution? }
 */
const createLibraryDownloadTicket = onCall(
  {region: "us-central1"},
  async (request) => {
    const uid = await assertVerifiedAuth(request);
    const data = request.data || {};
    const generationId = String(data.generationId || "");
    const format = String(data.format || "docx");
    if (!generationId) {
      throw new HttpsError("invalid-argument", "Missing generationId.");
    }
    if (format !== "docx") {
      throw new HttpsError("invalid-argument", "Only docx is supported.");
    }

    const db = admin.firestore();
    const snap = await db.collection("aiGenerations").doc(generationId).get();
    if (!snap.exists) {
      throw new HttpsError("not-found", "Document not found.");
    }
    const gen = snap.data();
    if (gen.ownerUid !== uid) {
      throw new HttpsError("permission-denied", "This isn't your document.");
    }
    if (!SUPPORTED_TOOLS.has(gen.tool)) {
      throw new HttpsError(
        "failed-precondition",
        "Server download isn't available for this document type yet.",
      );
    }

    const now = Date.now();
    const ref = await db.collection("downloadTickets").add({
      uid,
      generationId,
      format,
      filename: sanitizeFilename(data.filename, "Lesson Plan.docx"),
      attribution: Boolean(data.attribution),
      createdAt: admin.firestore.Timestamp.fromMillis(now),
      expiresAt: admin.firestore.Timestamp.fromMillis(now + TICKET_TTL_MS),
    });
    return {ticket: ref.id};
  },
);

/**
 * GET /api/teacher/download?ticket=<id> — validate, regenerate, stream.
 * A plain navigation, so the browser's download manager names the file from
 * Content-Disposition. Errors are returned as HTTP errors (visible), so the
 * client can fall back to its in-app download.
 */
const apiLibraryDownload = onRequest(
  {region: "us-central1", timeoutSeconds: 120, memory: "512MiB"},
  async (req, res) => {
    if (req.method !== "GET") {
      res.status(405).send("Use GET.");
      return;
    }
    const ticketId = String((req.query && req.query.ticket) || "");
    if (!ticketId) {
      res.status(400).send("Missing download ticket.");
      return;
    }

    try {
      const db = admin.firestore();
      // Single-use (SECURITY_ENDPOINT_AUDIT §4.4). The ticket id is a bearer
      // credential in a URL, so it can leak the ways URLs leak — a referrer, a
      // shared link, a screenshot — and until now it stayed usable for the whole
      // five-minute TTL.
      const claim = await claimDownloadTicket({db, ticketId, now: Date.now()});
      if (claim.reason === "missing") {
        // Covers both never-existed and already-used: the ticket is gone either
        // way, and telling a caller WHICH would confirm that a real download
        // happened.
        res.status(404).send("This download link is no longer valid. Please try again.");
        return;
      }
      if (claim.reason === "expired") {
        res.status(410).send("This download link has expired. Please try again.");
        return;
      }
      const ticket = claim.ticket;

      const gSnap = await db.collection("aiGenerations")
        .doc(ticket.generationId).get();
      if (!gSnap.exists) {
        res.status(404).send("Document not found.");
        return;
      }
      const gen = gSnap.data();
      // Re-check ownership against the generation (defence in depth).
      if (gen.ownerUid !== ticket.uid) {
        res.status(403).send("Forbidden.");
        return;
      }
      // The server pipeline stores the plan under `output`; the Lesson Plan
      // Studio stores it under `data` (Firestore rules forbid the studio
      // writing `output`). Both are the same validated lesson-plan JSON that
      // generateLessonPlanDocxBuffer consumes, so fall back to `data` —
      // otherwise studio-saved plans 422 here and the Word download fails.
      const plan = gen.output || gen.data;
      if (!plan || typeof plan !== "object") {
        res.status(422).send("This document can't be exported.");
        return;
      }

      const {generateLessonPlanDocxBuffer} =
        require("./teacherTools/lessonPlanDocx");
      const buffer = await generateLessonPlanDocxBuffer(plan, {
        attribution: Boolean(ticket.attribution),
      });

      res.set("Content-Type", DOCX_TYPE);
      res.set("Content-Disposition", contentDispositionFor(ticket.filename));
      res.set("X-Content-Type-Options", "nosniff");
      res.set("Cache-Control", "no-store");
      res.status(200).send(buffer);
    } catch (err) {
      console.error("[apiLibraryDownload] failed", err);
      res.status(500).send(
        "Could not generate the download. Please use the in-app download instead.",
      );
    }
  },
);

/**
 * Claim a download ticket: validate and CONSUME it in one transaction, so a
 * ticket is usable exactly once (SECURITY_ENDPOINT_AUDIT §4.4).
 *
 * The audit's wording was "delete the ticket on first successful stream". This
 * consumes it BEFORE the render instead, deliberately, because deleting after a
 * success does not actually make the ticket single-use: the .docx regeneration
 * takes real time, and two requests arriving inside that window would both read
 * a live ticket and both render. Claiming first closes that window — the delete
 * is the claim, and Firestore serialises it.
 *
 * The cost of claiming first is that a render failure burns the ticket. That is
 * the right trade here: minting is a cheap authenticated callable, the endpoint
 * already tells the caller to fall back to the in-app download on error, and a
 * spent ticket after a failed download is a retry, whereas a replayable one is
 * the finding.
 *
 * An expired ticket is deleted too — it is spent either way, and leaving it for
 * the daily reaper only widens the window in which a leaked id is worth trying.
 *
 * @returns {Promise<{ok: boolean, reason: ('claimed'|'missing'|'expired'), ticket: (object|null)}>}
 */
async function claimDownloadTicket({db, ticketId, now}) {
  const ref = db.collection("downloadTickets").doc(ticketId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return {ok: false, reason: "missing", ticket: null};
    const ticket = snap.data() || {};
    const expiresAt = ticket.expiresAt && ticket.expiresAt.toMillis
      ? ticket.expiresAt.toMillis()
      : 0;
    tx.delete(ref);
    if (!expiresAt || expiresAt < now) {
      return {ok: false, reason: "expired", ticket: null};
    }
    return {ok: true, reason: "claimed", ticket};
  });
}

/** Delete expired download tickets so the collection stays small. */
async function reapExpiredTickets(db, nowMs, limit = 500) {
  const snap = await db.collection("downloadTickets")
    .where("expiresAt", "<", admin.firestore.Timestamp.fromMillis(nowMs))
    .limit(limit)
    .get();
  let deleted = 0;
  const batch = db.batch();
  snap.forEach((doc) => {
    batch.delete(doc.ref);
    deleted += 1;
  });
  if (deleted > 0) await batch.commit();
  return deleted;
}

const reapDownloadTickets = onSchedule(
  {
    schedule: "every 6 hours",
    timeZone: "Africa/Lusaka",
    region: "us-central1",
    timeoutSeconds: 120,
    memory: "256MiB",
  },
  async () => {
    const db = admin.firestore();
    try {
      const deleted = await reapExpiredTickets(db, Date.now());
      console.log(`[reapDownloadTickets] deleted ${deleted} expired tickets`);
    } catch (err) {
      console.error("[reapDownloadTickets] failed", err);
    }
  },
);

module.exports = {
  createLibraryDownloadTicket,
  apiLibraryDownload,
  reapDownloadTickets,
  // Exported for tests only — not a Cloud Function. index.js binds the three
  // above; adding a key here changes no deployed export.
  claimDownloadTicket,
};
