/**
 * Weekly parent digest cron (audit A3 PR 2 + PR 3).
 *
 * Every Sunday 09:00 Africa/Lusaka, fan out a progress summary to every
 * progressShares/{token} that:
 *   - has a parentEmail and/or parentPhone set
 *   - is not revoked
 *   - is not expired
 *   - has not had a digest sent (per channel) in the last 5 days —
 *     idempotency guard against double-sends if the cron retries
 *   - belongs to a learner who actually practised in the last 7 days
 *     (no point sending an empty digest)
 *
 * Two delivery channels run independently per share:
 *
 *   1. Email — via the existing SMTP transport (EMAIL_SMTP_USER /
 *      EMAIL_SMTP_PASSWORD). Same rig that sends password resets.
 *
 *   2. WhatsApp — via Meta WhatsApp Business Cloud API (audit A3 PR 3).
 *      Soft-fails when the META_WHATSAPP_* secrets aren't set, so this
 *      same cron file works in both pre-Meta and post-Meta states.
 *
 * Each channel has its own idempotency stamp on the share doc so a
 * brief SMTP outage can't suppress the WhatsApp send (and vice versa):
 *
 *   - lastWeeklyDigestSentAt           — email
 *   - lastWeeklyDigestWhatsAppSentAt   — whatsapp
 *
 * Audit log:
 *   - parentDigestEvents/{eventId}: one doc per send attempt with
 *     {token, learnerUid, channel, parentEmail?, parentPhone?,
 *      status, error?, sentAt}
 *
 * Caps:
 *   - At most 200 shares per run — if the install grows past that,
 *     split this into a Pub/Sub fan-out. SMTP also rate-limits us
 *     naturally so a hard cap keeps a single run inside the timeout.
 */

const admin = require("firebase-admin");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {assertVerifiedAuth} = require("./authGuard");
const {isAdminRole} = require("./aiService");
const {defineSecret} = require("firebase-functions/params");
// nodemailer is required lazily at its use site — see invoiceGenerator.js.

const {aggregateProgress} = require("./parentPortalShared");
const {
  WHATSAPP_SECRETS,
  isConfigured: isWhatsAppConfigured,
  normalizeToWhatsApp,
  sendWhatsAppDigest,
  buildWhatsAppDigestBody,
} = require("./metaWhatsApp");

// Pure decision/formatting logic lives in the Core module so it can be
// unit-tested under plain `node` with no Firebase/SMTP dependency.
const {
  WINDOW_DAYS,
  MAX_SHARES_PER_RUN,
  lastSentMillis,
  shouldSkipResend,
  shareGateReason,
  shouldSkipEmptyWeek,
  deriveLearnerInfo,
  buildShareUrl,
  resolveSenderDomain,
  normalizeRunnerTargetTokens,
  normalizeRequestTargetTokens,
  createRunSummary,
  rollupStatus,
  buildEmailPayload,
  buildWhatsAppSummaryLine,
  buildWhatsAppContentVariables,
} = require("./weeklyParentDigestCore");

const REGION = "us-central1";

// Re-use the existing email secrets — no new infrastructure.
const emailSmtpUser = defineSecret("EMAIL_SMTP_USER");
const emailSmtpPassword = defineSecret("EMAIL_SMTP_PASSWORD");

let cachedTransporter = null;
function getTransporter() {
  if (cachedTransporter) return cachedTransporter;
  const senderEmail = String(emailSmtpUser.value() || "").trim();
  if (!senderEmail) return null;
  // Lazy require, matching opsAlert.js — see the note in invoiceGenerator.js.
  const nodemailer = require("nodemailer");
  cachedTransporter = nodemailer.createTransport({
    host: "mail.privateemail.com",
    port: 587,
    secure: false,
    requireTLS: true,
    auth: {
      user: senderEmail,
      pass: emailSmtpPassword.value(),
    },
    tls: {
      minVersion: "TLSv1.2",
      servername: "mail.privateemail.com",
    },
  });
  return cachedTransporter;
}

/**
 * Pull the union of shares with a parentEmail or parentPhone. Two
 * queries because Firestore doesn't support OR across fields without
 * `in [...]`, and we don't want to scan every share unconditionally.
 *
 * Result is deduped by document id and capped at MAX_SHARES_PER_RUN.
 */
async function loadCandidateShares(db) {
  const queries = [
    db.collection("progressShares")
        .where("parentEmail", "!=", null)
        .limit(MAX_SHARES_PER_RUN)
        .get()
        .catch((err) => {
          console.error("[weeklyParentDigest] parentEmail query failed", err);
          return null;
        }),
    db.collection("progressShares")
        .where("parentPhone", "!=", null)
        .limit(MAX_SHARES_PER_RUN)
        .get()
        .catch((err) => {
          console.error("[weeklyParentDigest] parentPhone query failed", err);
          return null;
        }),
  ];
  const [emailSnap, phoneSnap] = await Promise.all(queries);

  const seen = new Map();
  for (const snap of [emailSnap, phoneSnap]) {
    if (!snap || snap.empty) continue;
    for (const doc of snap.docs) {
      if (seen.size >= MAX_SHARES_PER_RUN) break;
      if (!seen.has(doc.id)) seen.set(doc.id, doc);
    }
  }
  return [...seen.values()];
}

async function logEvent(db, payload) {
  await db.collection("parentDigestEvents").add({
    ...payload,
    sentAt: admin.firestore.FieldValue.serverTimestamp(),
  }).catch((err) => console.warn("[weeklyParentDigest] audit log failed", err));
}

async function deliverEmail({db, shareDoc, share, token, stats, learnerName, learnerGrade, shareUrl, senderEmail, senderDomain, transporter, now, summary, force = false}) {
  if (!transporter || !senderEmail) return;          // SMTP not configured
  if (!share.parentEmail) return;                    // no email recipient

  const lastSentMs = lastSentMillis(share.lastWeeklyDigestSentAt);
  if (shouldSkipResend({lastSentMs, now, force})) {
    summary.skipped.email += 1;
    return;
  }

  const emailPayload = buildEmailPayload({
    senderEmail, senderDomain,
    parentEmail: share.parentEmail,
    token, learnerName, learnerGrade, stats, shareUrl,
  });

  try {
    await transporter.sendMail(emailPayload);
    // Skip the idempotency stamp on forced (admin-test) runs so a
    // Saturday verification doesn't push the next Sunday's send past
    // the 5-day guard for real parents.
    if (!force) {
      await shareDoc.ref.update({
        lastWeeklyDigestSentAt: admin.firestore.FieldValue.serverTimestamp(),
      }).catch((err) => console.warn("[weeklyParentDigest] email stamp update failed", err));
    }
    await logEvent(db, {
      token,
      learnerUid: share.learnerUid,
      channel: "email",
      parentEmail: share.parentEmail,
      status: "sent",
      forced: force || false,
    });
    summary.sent.email += 1;
  } catch (err) {
    console.error(`[weeklyParentDigest] email send failed for ${token}`, err);
    summary.failed.email += 1;
    summary.errors.push(`email/${token}: ${String(err?.message || err).slice(0, 160)}`);
    await logEvent(db, {
      token,
      learnerUid: share.learnerUid,
      channel: "email",
      parentEmail: share.parentEmail,
      status: "failed",
      error: String(err?.message || err).slice(0, 500),
    });
  }
}

async function deliverWhatsApp({db, shareDoc, share, token, stats, learnerName, learnerGrade, shareUrl, whatsAppReady, now, summary, force = false}) {
  if (!share.parentPhone) return;                    // no phone recipient
  if (!whatsAppReady) return;                          // soft-fail when Meta WhatsApp unset

  const lastSentMs = lastSentMillis(share.lastWeeklyDigestWhatsAppSentAt);
  if (shouldSkipResend({lastSentMs, now, force})) {
    summary.skipped.whatsapp += 1;
    return;
  }

  const toAddress = normalizeToWhatsApp(share.parentPhone);
  if (!toAddress) {
    summary.skipped.whatsapp += 1;
    await logEvent(db, {
      token,
      learnerUid: share.learnerUid,
      channel: "whatsapp",
      parentPhone: String(share.parentPhone).slice(0, 30),
      status: "skipped",
      error: "phone-malformed",
    });
    return;
  }

  const body = buildWhatsAppDigestBody({
    learnerName, learnerGrade,
    summary: stats.summary,
    subjectBreakdown: stats.subjectBreakdown,
    shareUrl,
  });

  // Provide variables for an approved Meta Message Template if one
  // is configured (META_WHATSAPP_TEMPLATE_NAME). Order is fixed:
  // 1=name, 2=summaryLine, 3=shareUrl. The template body must use
  // {{1}}, {{2}}, {{3}} in that order.
  const summaryLine = buildWhatsAppSummaryLine(stats.summary);
  const contentVariables = buildWhatsAppContentVariables({learnerName, summaryLine, shareUrl});

  let result;
  try {
    result = await sendWhatsAppDigest({to: toAddress, body, contentVariables});
  } catch (err) {
    result = {status: "failed", error: String(err?.message || err).slice(0, 500)};
  }

  if (result.status === "sent") {
    // Same rationale as the email stamp — forced (admin-test) runs
    // don't bump the idempotency clock so Sunday's tick still fires.
    if (!force) {
      await shareDoc.ref.update({
        lastWeeklyDigestWhatsAppSentAt: admin.firestore.FieldValue.serverTimestamp(),
      }).catch((err) => console.warn("[weeklyParentDigest] whatsapp stamp update failed", err));
    }
    await logEvent(db, {
      token,
      learnerUid: share.learnerUid,
      channel: "whatsapp",
      parentPhone: String(share.parentPhone).slice(0, 30),
      status: "sent",
      // Meta returns a `wamid.…` ID per outbound message. Field name
      // is provider-agnostic so a future swap (or A/B between Meta
      // and a fallback) doesn't change the schema.
      whatsAppMessageId: result.messageId || null,
      whatsAppMessageStatus: result.messageStatus || null,
      forced: force || false,
    });
    summary.sent.whatsapp += 1;
  } else if (result.status === "skipped") {
    summary.skipped.whatsapp += 1;
    // No audit row for the soft-fail case (meta-not-configured) —
    // would just spam the collection during pre-rollout.
    if (result.reason && result.reason !== "meta-not-configured") {
      await logEvent(db, {
        token,
        learnerUid: share.learnerUid,
        channel: "whatsapp",
        parentPhone: String(share.parentPhone).slice(0, 30),
        status: "skipped",
        error: result.reason,
      });
    }
  } else {
    summary.failed.whatsapp += 1;
    summary.errors.push(`whatsapp/${token}: ${(result.error || "unknown").slice(0, 160)}`);
    await logEvent(db, {
      token,
      learnerUid: share.learnerUid,
      channel: "whatsapp",
      parentPhone: String(share.parentPhone).slice(0, 30),
      status: "failed",
      httpStatus: result.httpStatus || null,
      error: (result.error || "unknown").slice(0, 500),
    });
  }
}

/**
 * Reusable digest runner — same body powers both the Sunday cron and
 * the admin-only manual trigger.
 *
 * Options (all optional):
 *   - runType:        free-form label that lands in agentJobs.input.runType.
 *                     Defaults to "weekly-parent-digest".
 *   - createdBy:      string written to agentJobs.createdBy. The cron
 *                     uses "system"; the manual trigger uses the admin uid.
 *   - force:          when true, both channels bypass the 5-day idempotency
 *                     stamp. Useful for verifying Meta WhatsApp wiring
 *                     without waiting for the next cron tick.
 *   - targetTokens:   when set, the runner only processes those share
 *                     tokens (rather than the full union of email/phone
 *                     candidates). Other gates (revoked / expired / empty
 *                     week / no-contact) still apply.
 */
async function runWeeklyDigest({
  runType = "weekly-parent-digest",
  createdBy = "system",
  force = false,
  targetTokens = null,
} = {}) {
  const db = admin.firestore();
  const now = Date.now();
  const senderEmail = String(emailSmtpUser.value() || "").trim();
  const senderDomain = resolveSenderDomain(senderEmail);
  const transporter = getTransporter();
  const whatsAppReady = isWhatsAppConfigured();
  const summary = createRunSummary({
    whatsAppReady,
    smtpReady: Boolean(transporter && senderEmail),
    force,
    runType,
  });

  if (!summary.smtpReady && !whatsAppReady) {
    console.warn("[weeklyParentDigest] neither SMTP nor Meta WhatsApp configured — nothing to do");
    return summary;
  }

  let shareDocs;
  if (Array.isArray(targetTokens) && targetTokens.length > 0) {
    // Direct fetches when an admin asks for specific tokens. Bounded
    // at 10 to keep manual triggers cheap and bounded.
    const tokens = normalizeRunnerTargetTokens(targetTokens);
    const fetched = await Promise.all(
        tokens.map((token) => db.collection("progressShares").doc(token).get()
            .catch((err) => {
              console.warn(`[weeklyParentDigest] target token fetch failed: ${token}`, err);
              return null;
            })),
    );
    shareDocs = fetched.filter((snap) => snap && snap.exists);
  } else {
    shareDocs = await loadCandidateShares(db);
  }

  if (shareDocs.length === 0) {
    console.info("[weeklyParentDigest] no parent-contact shares to process");
    return summary;
  }

  for (const shareDoc of shareDocs) {
    summary.sharesScanned += 1;
    const share = shareDoc.data() || {};
    const token = shareDoc.id;

    // Per-share gates that apply to BOTH channels.
    if (shareGateReason(share, now)) { summary.skipped.share += 1; continue; }

    let stats;
    try {
      stats = await aggregateProgress(db, share.learnerUid, {windowDays: WINDOW_DAYS});
    } catch (err) {
      console.error(`[weeklyParentDigest] aggregateProgress failed for ${token}`, err);
      summary.skipped.share += 1;
      continue;
    }

    // Don't pester parents when there's literally no activity. Empty-
    // week messages train recipients to ignore us across both channels.
    // Manual triggers can override this gate via force=true so an admin
    // can prove the WhatsApp path without waiting for fresh quiz attempts.
    if (shouldSkipEmptyWeek(stats, force)) {
      summary.skipped.share += 1;
      continue;
    }

    let learner = {};
    try {
      const learnerSnap = await db.collection("users").doc(share.learnerUid).get();
      learner = learnerSnap.exists ? (learnerSnap.data() || {}) : {};
    } catch (err) {
      console.warn(`[weeklyParentDigest] learner lookup failed for ${share.learnerUid}`, err);
    }
    const {learnerName, learnerGrade} = deriveLearnerInfo(learner);
    const shareUrl = buildShareUrl(token);

    // Run channels independently — one failing must not block the other.
    await Promise.all([
      deliverEmail({
        db, shareDoc, share, token, stats,
        learnerName, learnerGrade, shareUrl,
        senderEmail, senderDomain, transporter, now, summary, force,
      }),
      deliverWhatsApp({
        db, shareDoc, share, token, stats,
        learnerName, learnerGrade, shareUrl,
        whatsAppReady, now, summary, force,
      }),
    ]);
  }

  // Single rollup doc so /admin can see how many digests went out in
  // the run (matches the agentJobs pattern other crons use).
  await db.collection("agentJobs").add({
    agentId: "weekly-parent-digest",
    department: "growth",
    status: rollupStatus(summary),
    input: {runType, timezone: "Africa/Lusaka", force, targetTokens: targetTokens || null},
    output: {digest: {...summary, errors: summary.errors.slice(0, 10)}},
    createdBy,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }).catch((err) => console.warn("[weeklyParentDigest] rollup write failed", err));

  return summary;
}

const weeklyParentDigest = onSchedule({
  schedule: "every sunday 09:00",
  timeZone: "Africa/Lusaka",
  region: REGION,
  timeoutSeconds: 540,
  memory: "512MiB",
  secrets: [emailSmtpUser, emailSmtpPassword, ...WHATSAPP_SECRETS],
}, async () => {
  await runWeeklyDigest({runType: "weekly-parent-digest", createdBy: "system"});
});

/**
 * Manual trigger — admin-only. Re-uses runWeeklyDigest with optional
 * force and targetTokens so an admin can verify the WhatsApp wiring
 * without waiting for Sunday's cron tick.
 *
 * Request shape (all optional):
 *   { force?: boolean, targetTokens?: string[] }
 *
 * Returns the summary so the admin can see exactly how many sends went
 * out per channel and what (if anything) failed.
 */
const triggerWeeklyParentDigest = onCall({
  region: REGION,
  timeoutSeconds: 540,
  memory: "512MiB",
  secrets: [emailSmtpUser, emailSmtpPassword, ...WHATSAPP_SECRETS],
}, async (request) => {
  const uid = await assertVerifiedAuth(request, "Sign in required.");

  const db = admin.firestore();
  const userSnap = await db.collection("users").doc(uid).get();
  const role = userSnap.exists ? (userSnap.data()?.role || "") : "";
  if (!isAdminRole(role)) {
    throw new HttpsError("permission-denied", "Admin only.");
  }

  const force = Boolean(request.data?.force);
  const targetTokens = normalizeRequestTargetTokens(request.data?.targetTokens);

  const summary = await runWeeklyDigest({
    runType: "manual-admin-trigger",
    createdBy: uid,
    force,
    targetTokens,
  });

  return summary;
});

module.exports = {
  weeklyParentDigest,
  triggerWeeklyParentDigest,
  runWeeklyDigest,
};
