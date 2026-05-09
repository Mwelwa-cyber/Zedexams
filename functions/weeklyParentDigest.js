/**
 * Weekly parent digest cron (audit A3 PR 2).
 *
 * Every Sunday 09:00 Africa/Lusaka, fan out an email summary to every
 * progressShares/{token} that:
 *   - has a parentEmail set
 *   - is not revoked
 *   - is not expired
 *   - has not had a digest sent in the last 5 days (idempotency
 *     guard against double-sends if the cron retries)
 *   - belongs to a learner who actually practised in the last 7 days
 *     (no point sending an empty digest)
 *
 * SMS / WhatsApp delivery is intentionally out of scope here — those
 * require a Meta Business API or Twilio account that's a separate
 * setup decision. Email uses the same SMTP transport already wired
 * for password reset (mail.privateemail.com / EMAIL_SMTP_*).
 *
 * Audit log:
 *   - parentDigestEvents/{eventId}: one doc per send attempt with
 *     {token, learnerUid, parentEmail, status, error?, sentAt}
 *
 * Idempotency:
 *   - On successful send we stamp lastWeeklyDigestSentAt on the
 *     progressShares doc. The next cron pass uses that field to skip.
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

const weeklyParentDigest = onSchedule({
  schedule: "every sunday 09:00",
  timeZone: "Africa/Lusaka",
  region: REGION,
  timeoutSeconds: 540,
  memory: "512MiB",
  secrets: [emailSmtpUser, emailSmtpPassword],
}, async () => {
  const db = admin.firestore();
  const now = Date.now();
  const senderEmail = String(emailSmtpUser.value() || "").trim();
  const senderDomain = senderEmail.split("@")[1] || "zedexams.com";
  const transporter = getTransporter();
  const summary = {sharesScanned: 0, sent: 0, skipped: 0, failed: 0, errors: []};

  if (!transporter || !senderEmail) {
    console.warn("[weeklyParentDigest] SMTP not configured — skipping run");
    return;
  }

  // Pull the most recent active shares with parentEmail set. Cap to
  // MAX_SHARES_PER_RUN per run; growing past that splits naturally.
  const sharesSnap = await db.collection("progressShares")
      .where("parentEmail", "!=", null)
      .limit(MAX_SHARES_PER_RUN)
      .get()
      .catch((err) => {
        console.error("[weeklyParentDigest] shares query failed", err);
        return null;
      });

  if (!sharesSnap || sharesSnap.empty) {
    console.info("[weeklyParentDigest] no parent-contact shares to process");
    return;
  }

  for (const shareDoc of sharesSnap.docs) {
    summary.sharesScanned += 1;
    const share = shareDoc.data() || {};
    const token = shareDoc.id;

    try {
      // Skip revoked / expired
      if (share.revokedAt) { summary.skipped += 1; continue; }
      if (share.expiresAt && share.expiresAt.toMillis() < now) { summary.skipped += 1; continue; }
      if (!share.parentEmail) { summary.skipped += 1; continue; }

      // Idempotency: skip if we sent within the last 5 days
      const lastSentMs = share.lastWeeklyDigestSentAt?.toMillis ? share.lastWeeklyDigestSentAt.toMillis() : 0;
      if (lastSentMs && (now - lastSentMs) < RESEND_GUARD_MS) {
        summary.skipped += 1;
        continue;
      }

      // Aggregate the past 7 days
      const stats = await aggregateProgress(db, share.learnerUid, {windowDays: WINDOW_DAYS});

      // Don't pester parents when there's literally no activity.
      // (Empty-week emails train recipients to ignore us.)
      if (stats.summary.totalAttempts === 0) {
        summary.skipped += 1;
        continue;
      }

      // Learner display name
      const learnerSnap = await db.collection("users").doc(share.learnerUid).get();
      const learner = learnerSnap.exists ? (learnerSnap.data() || {}) : {};
      const learnerName = learner.displayName || "your learner";
      const learnerGrade = learner.grade ? String(learner.grade) : null;
      const shareUrl = `https://zedexams.com/parent/${token}`;

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

      await transporter.sendMail(emailPayload);

      // Stamp the doc + audit row. Both best-effort — a stamp failure
      // is recoverable (the worst case is we send a duplicate next week).
      await shareDoc.ref.update({
        lastWeeklyDigestSentAt: admin.firestore.FieldValue.serverTimestamp(),
      }).catch((err) => console.warn("[weeklyParentDigest] stamp update failed", err));

      await db.collection("parentDigestEvents").add({
        token,
        learnerUid: share.learnerUid,
        parentEmail: share.parentEmail,
        status: "sent",
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
      }).catch((err) => console.warn("[weeklyParentDigest] audit log failed", err));

      summary.sent += 1;
    } catch (err) {
      console.error(`[weeklyParentDigest] send failed for ${token}`, err);
      summary.failed += 1;
      summary.errors.push(String(err?.message || err).slice(0, 200));
      // Audit a failure too so support can tell the user when a digest
      // was dropped on the floor.
      await db.collection("parentDigestEvents").add({
        token,
        learnerUid: share.learnerUid,
        parentEmail: share.parentEmail,
        status: "failed",
        error: String(err?.message || err).slice(0, 500),
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
      }).catch(() => {/* ignore */});
    }
  }

  // Optional: write a single rollup doc so /admin can see how many
  // digests went out in the run (matches the agentJobs pattern other
  // crons use).
  await db.collection("agentJobs").add({
    agentId: "weekly-parent-digest",
    department: "growth",
    status: summary.failed > 0 ? "awaiting_approval" : "done",
    input: {runType: "weekly-parent-digest", timezone: "Africa/Lusaka"},
    output: {digest: {...summary, errors: summary.errors.slice(0, 10)}},
    createdBy: "system",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }).catch((err) => console.warn("[weeklyParentDigest] rollup write failed", err));
});

module.exports = {weeklyParentDigest};
