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
 *   2. WhatsApp — via Twilio (audit A3 PR 3). Soft-fails when the
 *      TWILIO_* secrets aren't set, so this same cron file works in
 *      both pre-Twilio and post-Twilio states.
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
const {defineSecret} = require("firebase-functions/params");
const nodemailer = require("nodemailer");
const crypto = require("node:crypto");

const {aggregateProgress, ONE_DAY_MS} = require("./parentPortalShared");
const {
  TWILIO_SECRETS,
  isConfigured: isTwilioConfigured,
  normalizeToWhatsApp,
  sendWhatsAppDigest,
  buildWhatsAppDigestBody,
} = require("./twilioWhatsApp");

const REGION = "us-central1";
const WINDOW_DAYS = 7;
const MAX_SHARES_PER_RUN = 200;
const RESEND_GUARD_MS = 5 * ONE_DAY_MS;

// Re-use the existing email secrets — no new infrastructure.
const emailSmtpUser = defineSecret("EMAIL_SMTP_USER");
const emailSmtpPassword = defineSecret("EMAIL_SMTP_PASSWORD");

const SUBJECT_LABELS = {
  mathematics: "Maths",
  english: "English",
  science: "Science",
  "social-studies": "Social Studies",
  technology: "Technology",
  "home-economics": "Home Ec.",
  "expressive-arts": "Arts",
};

function subjectLabel(slug) {
  if (!slug) return "";
  return SUBJECT_LABELS[slug] || slug;
}

function buildEmailText({learnerName, learnerGrade, summary, subjectBreakdown, recentResults, shareUrl}) {
  const lines = [];
  lines.push(`Hi,`);
  lines.push("");
  lines.push(`Here is ${learnerName}'s ZedExams week${learnerGrade ? ` (Grade ${learnerGrade})` : ""}:`);
  lines.push("");
  if (summary.totalAttempts === 0) {
    lines.push(`${learnerName} hasn't practised this week. A quick reminder might help — they can sign in at https://zedexams.com.`);
  } else {
    lines.push(`• Quizzes done: ${summary.totalAttempts}`);
    if (summary.averagePercentage != null) {
      lines.push(`• Average score: ${summary.averagePercentage}%`);
    }
    lines.push(`• Day streak: ${summary.currentStreak}${summary.currentStreak > 0 ? " 🔥" : ""}`);
    if (subjectBreakdown.length > 0) {
      lines.push("");
      lines.push("By subject:");
      for (const row of subjectBreakdown) {
        const label = subjectLabel(row.subject);
        const avg = row.averagePercentage != null ? ` — avg ${row.averagePercentage}%` : "";
        lines.push(`  · ${label}: ${row.count}× quizzes${avg}`);
      }
    }
    if (recentResults.length > 0) {
      lines.push("");
      lines.push("Recent quizzes:");
      for (const r of recentResults.slice(0, 5)) {
        const label = r.quizTitle || subjectLabel(r.subject) || "Quiz";
        const pct = typeof r.percentage === "number" ? `${r.percentage}%` : "—";
        lines.push(`  · ${label}: ${pct}`);
      }
    }
  }
  lines.push("");
  lines.push(`Open the live progress page any time: ${shareUrl}`);
  lines.push("");
  lines.push("— ZedExams");
  return lines.join("\n");
}

function buildEmailHtml({learnerName, learnerGrade, summary, subjectBreakdown, recentResults, shareUrl}) {
  const safe = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
    {"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"}[c]
  ));
  const subjectRows = subjectBreakdown.map((row) => {
    const avg = row.averagePercentage != null
      ? `<span style="color:#4B6280;">avg ${row.averagePercentage}%</span>`
      : "";
    return `<tr><td style="padding:6px 0;">${safe(subjectLabel(row.subject))}</td><td style="padding:6px 0;text-align:right;">${row.count}× &nbsp; ${avg}</td></tr>`;
  }).join("");
  const recentRows = recentResults.slice(0, 5).map((r) => {
    const label = safe(r.quizTitle || subjectLabel(r.subject) || "Quiz");
    const pct = typeof r.percentage === "number"
      ? `<strong>${r.percentage}%</strong>`
      : "—";
    return `<tr><td style="padding:6px 0;">${label}</td><td style="padding:6px 0;text-align:right;">${pct}</td></tr>`;
  }).join("");

  const noActivityBlock = summary.totalAttempts === 0 ? `
    <p style="margin:0 0 16px 0;color:#1A1F2E;font-size:15px;line-height:1.55;">
      ${safe(learnerName)} hasn't practised this week. A friendly reminder might help — they can pick up where they left off at
      <a href="https://zedexams.com" style="color:#059669;font-weight:bold;">zedexams.com</a>.
    </p>` : `
    <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 16px 0;">
      <tr>
        <td style="padding:8px 0;font-size:14px;color:#1A1F2E;">Quizzes done</td>
        <td style="padding:8px 0;text-align:right;font-size:14px;font-weight:bold;color:#1A1F2E;">${summary.totalAttempts}</td>
      </tr>
      ${summary.averagePercentage != null ? `
      <tr>
        <td style="padding:8px 0;font-size:14px;color:#1A1F2E;">Average score</td>
        <td style="padding:8px 0;text-align:right;font-size:14px;font-weight:bold;color:#1A1F2E;">${summary.averagePercentage}%</td>
      </tr>` : ""}
      <tr>
        <td style="padding:8px 0;font-size:14px;color:#1A1F2E;">Day streak</td>
        <td style="padding:8px 0;text-align:right;font-size:14px;font-weight:bold;color:#1A1F2E;">${summary.currentStreak}${summary.currentStreak > 0 ? " 🔥" : ""}</td>
      </tr>
    </table>
    ${subjectBreakdown.length > 0 ? `
      <p style="margin:16px 0 4px 0;font-size:11px;color:#4B6280;text-transform:uppercase;letter-spacing:1px;font-weight:bold;">By subject</p>
      <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 16px 0;font-size:14px;color:#1A1F2E;">
        ${subjectRows}
      </table>` : ""}
    ${recentRows ? `
      <p style="margin:16px 0 4px 0;font-size:11px;color:#4B6280;text-transform:uppercase;letter-spacing:1px;font-weight:bold;">Recent quizzes</p>
      <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 16px 0;font-size:14px;color:#1A1F2E;">
        ${recentRows}
      </table>` : ""}`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><title>ZedExams weekly progress</title></head>
<body style="margin:0;padding:0;background:#FDF6EC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" style="width:100%;border-collapse:collapse;">
    <tr><td style="padding:32px 16px;">
      <table role="presentation" style="max-width:520px;margin:0 auto;background:#fff;border-radius:18px;border:1px solid #E5E7EB;overflow:hidden;">
        <tr><td style="padding:24px 24px 16px 24px;">
          <p style="margin:0 0 4px 0;font-size:11px;color:#4B6280;text-transform:uppercase;letter-spacing:1px;font-weight:bold;">ZedExams · weekly progress</p>
          <h1 style="margin:0 0 4px 0;font-size:22px;color:#1A1F2E;">${safe(learnerName)}'s week</h1>
          <p style="margin:0 0 16px 0;font-size:13px;color:#4B6280;">${learnerGrade ? `Grade ${safe(learnerGrade)} · ` : ""}last 7 days</p>
          ${noActivityBlock}
          <p style="margin:24px 0 0 0;text-align:center;">
            <a href="${safe(shareUrl)}" style="display:inline-block;background:#059669;color:#fff;text-decoration:none;font-weight:bold;font-size:14px;padding:10px 18px;border-radius:999px;">Open progress page</a>
          </p>
        </td></tr>
        <tr><td style="padding:16px 24px 20px 24px;background:#FDF6EC;border-top:1px solid #E5E7EB;font-size:11px;color:#4B6280;line-height:1.5;">
          You're getting this email because ${safe(learnerName)} shared their ZedExams progress with you.
          To stop these emails, ask them to revoke the share link from their profile.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

let cachedTransporter = null;
function getTransporter() {
  if (cachedTransporter) return cachedTransporter;
  const senderEmail = String(emailSmtpUser.value() || "").trim();
  if (!senderEmail) return null;
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

async function deliverEmail({db, shareDoc, share, token, stats, learnerName, learnerGrade, shareUrl, senderEmail, senderDomain, transporter, now, summary}) {
  if (!transporter || !senderEmail) return;          // SMTP not configured
  if (!share.parentEmail) return;                    // no email recipient

  const lastSentMs = share.lastWeeklyDigestSentAt?.toMillis
      ? share.lastWeeklyDigestSentAt.toMillis()
      : 0;
  if (lastSentMs && (now - lastSentMs) < RESEND_GUARD_MS) {
    summary.skipped.email += 1;
    return;
  }

  const emailPayload = {
    from: `ZedExams <${senderEmail}>`,
    sender: senderEmail,
    to: share.parentEmail,
    replyTo: senderEmail,
    subject: `${learnerName}'s ZedExams week`,
    text: buildEmailText({
      learnerName, learnerGrade,
      summary: stats.summary,
      subjectBreakdown: stats.subjectBreakdown,
      recentResults: stats.recentResults,
      shareUrl,
    }),
    html: buildEmailHtml({
      learnerName, learnerGrade,
      summary: stats.summary,
      subjectBreakdown: stats.subjectBreakdown,
      recentResults: stats.recentResults,
      shareUrl,
    }),
    envelope: {
      from: senderEmail,
      to: [share.parentEmail],
    },
    messageId: `<weekly-digest-${token}-${crypto.randomUUID()}@${senderDomain}>`,
    headers: {
      "X-Auto-Response-Suppress": "All",
    },
  };

  try {
    await transporter.sendMail(emailPayload);
    await shareDoc.ref.update({
      lastWeeklyDigestSentAt: admin.firestore.FieldValue.serverTimestamp(),
    }).catch((err) => console.warn("[weeklyParentDigest] email stamp update failed", err));
    await logEvent(db, {
      token,
      learnerUid: share.learnerUid,
      channel: "email",
      parentEmail: share.parentEmail,
      status: "sent",
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

async function deliverWhatsApp({db, shareDoc, share, token, stats, learnerName, learnerGrade, shareUrl, twilioReady, now, summary}) {
  if (!share.parentPhone) return;                    // no phone recipient
  if (!twilioReady) return;                          // soft-fail when Twilio unset

  const lastSentMs = share.lastWeeklyDigestWhatsAppSentAt?.toMillis
      ? share.lastWeeklyDigestWhatsAppSentAt.toMillis()
      : 0;
  if (lastSentMs && (now - lastSentMs) < RESEND_GUARD_MS) {
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

  // Provide variables for an approved Twilio Content Template if one
  // is configured. Order is fixed: 1=name, 2=summaryLine, 3=shareUrl.
  const summaryLine = stats.summary.totalAttempts === 0
      ? "no quizzes this week"
      : `${stats.summary.totalAttempts} quizzes${stats.summary.averagePercentage != null ? `, avg ${stats.summary.averagePercentage}%` : ""}`;
  const contentVariables = {
    1: learnerName.slice(0, 60),
    2: summaryLine.slice(0, 120),
    3: shareUrl,
  };

  let result;
  try {
    result = await sendWhatsAppDigest({to: toAddress, body, contentVariables});
  } catch (err) {
    result = {status: "failed", error: String(err?.message || err).slice(0, 500)};
  }

  if (result.status === "sent") {
    await shareDoc.ref.update({
      lastWeeklyDigestWhatsAppSentAt: admin.firestore.FieldValue.serverTimestamp(),
    }).catch((err) => console.warn("[weeklyParentDigest] whatsapp stamp update failed", err));
    await logEvent(db, {
      token,
      learnerUid: share.learnerUid,
      channel: "whatsapp",
      parentPhone: String(share.parentPhone).slice(0, 30),
      status: "sent",
      twilioMessageSid: result.sid || null,
      twilioStatus: result.twilioStatus || null,
    });
    summary.sent.whatsapp += 1;
  } else if (result.status === "skipped") {
    summary.skipped.whatsapp += 1;
    // No audit row for the soft-fail case (twilio-not-configured) —
    // would just spam the collection during pre-rollout.
    if (result.reason && result.reason !== "twilio-not-configured") {
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

const weeklyParentDigest = onSchedule({
  schedule: "every sunday 09:00",
  timeZone: "Africa/Lusaka",
  region: REGION,
  timeoutSeconds: 540,
  memory: "512MiB",
  secrets: [emailSmtpUser, emailSmtpPassword, ...TWILIO_SECRETS],
}, async () => {
  const db = admin.firestore();
  const now = Date.now();
  const senderEmail = String(emailSmtpUser.value() || "").trim();
  const senderDomain = senderEmail.split("@")[1] || "zedexams.com";
  const transporter = getTransporter();
  const twilioReady = isTwilioConfigured();
  const summary = {
    sharesScanned: 0,
    sent: {email: 0, whatsapp: 0},
    skipped: {email: 0, whatsapp: 0, share: 0},
    failed: {email: 0, whatsapp: 0},
    errors: [],
    twilioReady,
    smtpReady: Boolean(transporter && senderEmail),
  };

  if (!summary.smtpReady && !twilioReady) {
    console.warn("[weeklyParentDigest] neither SMTP nor Twilio configured — nothing to do");
    return;
  }

  const shareDocs = await loadCandidateShares(db);
  if (shareDocs.length === 0) {
    console.info("[weeklyParentDigest] no parent-contact shares to process");
    return;
  }

  for (const shareDoc of shareDocs) {
    summary.sharesScanned += 1;
    const share = shareDoc.data() || {};
    const token = shareDoc.id;

    // Per-share gates that apply to BOTH channels.
    if (share.revokedAt) { summary.skipped.share += 1; continue; }
    if (share.expiresAt && share.expiresAt.toMillis() < now) { summary.skipped.share += 1; continue; }
    if (!share.parentEmail && !share.parentPhone) { summary.skipped.share += 1; continue; }

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
    if (stats.summary.totalAttempts === 0) {
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
    const learnerName = learner.displayName || "your learner";
    const learnerGrade = learner.grade ? String(learner.grade) : null;
    const shareUrl = `https://zedexams.com/parent/${token}`;

    // Run channels independently — one failing must not block the other.
    await Promise.all([
      deliverEmail({
        db, shareDoc, share, token, stats,
        learnerName, learnerGrade, shareUrl,
        senderEmail, senderDomain, transporter, now, summary,
      }),
      deliverWhatsApp({
        db, shareDoc, share, token, stats,
        learnerName, learnerGrade, shareUrl,
        twilioReady, now, summary,
      }),
    ]);
  }

  // Single rollup doc so /admin can see how many digests went out in
  // the run (matches the agentJobs pattern other crons use).
  const totalFailed = summary.failed.email + summary.failed.whatsapp;
  await db.collection("agentJobs").add({
    agentId: "weekly-parent-digest",
    department: "growth",
    status: totalFailed > 0 ? "awaiting_approval" : "done",
    input: {runType: "weekly-parent-digest", timezone: "Africa/Lusaka"},
    output: {digest: {...summary, errors: summary.errors.slice(0, 10)}},
    createdBy: "system",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }).catch((err) => console.warn("[weeklyParentDigest] rollup write failed", err));
});

module.exports = {weeklyParentDigest};
