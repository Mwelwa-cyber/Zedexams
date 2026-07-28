/**
 * Pure decision logic for the weekly parent digest
 * (weeklyParentDigest.js keeps the cron/callable wiring, Firestore
 * reads/writes and the SMTP/WhatsApp sends, and delegates here).
 *
 * Constraint: this module must stay dependency-free apart from Node
 * builtins — no firebase-admin / firebase-functions / nodemailer — so
 * weeklyParentDigestCore.test.js runs under plain `node` with only the
 * repo-root node_modules present.
 */

const crypto = require("node:crypto");

// Mirrors parentPortalShared.js's ONE_DAY_MS (that module pulls in
// firebase-admin, which this dependency-free core must not require).
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const WINDOW_DAYS = 7;
const MAX_SHARES_PER_RUN = 200;
const RESEND_GUARD_MS = 5 * ONE_DAY_MS;

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

/**
 * Millis of a per-channel idempotency stamp — a Firestore Timestamp in
 * production, but only its `toMillis` shape is relied on here.
 */
function lastSentMillis(stampField) {
  return stampField?.toMillis ? stampField.toMillis() : 0;
}

/** The 5-day per-channel resend guard (bypassed by forced runs). */
function shouldSkipResend({lastSentMs, now, force = false}) {
  return Boolean(!force && lastSentMs && (now - lastSentMs) < RESEND_GUARD_MS);
}

/**
 * Per-share gates that apply to BOTH channels. Returns a skip reason
 * ("revoked" | "expired" | "no-contact") or null when the share passes.
 */
function shareGateReason(share, now) {
  if (share.revokedAt) return "revoked";
  if (share.expiresAt && share.expiresAt.toMillis() < now) return "expired";
  if (!share.parentEmail && !share.parentPhone) return "no-contact";
  return null;
}

/**
 * Empty-week gate: don't pester parents when there's literally no
 * activity. Manual triggers can override via force=true.
 */
function shouldSkipEmptyWeek(stats, force = false) {
  return stats.summary.totalAttempts === 0 && !force;
}

function deriveLearnerInfo(learner) {
  return {
    learnerName: learner.displayName || "your learner",
    learnerGrade: learner.grade ? String(learner.grade) : null,
  };
}

function buildShareUrl(token) {
  return `https://zedexams.com/parent/${token}`;
}

function resolveSenderDomain(senderEmail) {
  return String(senderEmail || "").split("@")[1] || "zedexams.com";
}

/**
 * Token normalization for the runner's targetTokens option — trimmed,
 * uppercased, bounded at 10 to keep manual triggers cheap and bounded.
 */
function normalizeRunnerTargetTokens(targetTokens) {
  return targetTokens
      .filter((t) => typeof t === "string" && t.trim())
      .map((t) => t.trim().toUpperCase())
      .slice(0, 10);
}

/** Request-shape normalization for the admin callable's targetTokens. */
function normalizeRequestTargetTokens(rawTokens) {
  return Array.isArray(rawTokens)
      ? rawTokens.filter((t) => typeof t === "string").slice(0, 10)
      : null;
}

/** Initial per-run rollup counters. */
function createRunSummary({whatsAppReady, smtpReady, force, runType}) {
  return {
    sharesScanned: 0,
    sent: {email: 0, whatsapp: 0},
    skipped: {email: 0, whatsapp: 0, share: 0},
    failed: {email: 0, whatsapp: 0},
    errors: [],
    whatsAppReady,
    smtpReady,
    force,
    runType,
  };
}

/** agentJobs rollup status for a finished run. */
function rollupStatus(summary) {
  const totalFailed = summary.failed.email + summary.failed.whatsapp;
  return totalFailed > 0 ? "awaiting_approval" : "done";
}

/**
 * Nodemailer payload for one digest email. Pure apart from the random
 * Message-ID suffix (injectable for tests via `randomUUID`).
 */
function buildEmailPayload({senderEmail, senderDomain, parentEmail, token, learnerName, learnerGrade, stats, shareUrl, randomUUID = crypto.randomUUID}) {
  return {
    from: `ZedExams <${senderEmail}>`,
    sender: senderEmail,
    to: parentEmail,
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
      to: [parentEmail],
    },
    messageId: `<weekly-digest-${token}-${randomUUID()}@${senderDomain}>`,
    headers: {
      "X-Auto-Response-Suppress": "All",
    },
  };
}

/**
 * Variables for an approved Meta Message Template. Order is fixed:
 * 1=name, 2=summaryLine, 3=shareUrl — the template body must use
 * {{1}}, {{2}}, {{3}} in that order.
 */
function buildWhatsAppSummaryLine(summary) {
  return summary.totalAttempts === 0
      ? "no quizzes this week"
      : `${summary.totalAttempts} quizzes${summary.averagePercentage != null ? `, avg ${summary.averagePercentage}%` : ""}`;
}

function buildWhatsAppContentVariables({learnerName, summaryLine, shareUrl}) {
  return {
    1: learnerName.slice(0, 60),
    2: summaryLine.slice(0, 120),
    3: shareUrl,
  };
}

module.exports = {
  ONE_DAY_MS,
  WINDOW_DAYS,
  MAX_SHARES_PER_RUN,
  RESEND_GUARD_MS,
  SUBJECT_LABELS,
  subjectLabel,
  buildEmailText,
  buildEmailHtml,
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
};
