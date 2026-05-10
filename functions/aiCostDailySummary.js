/**
 * Daily AI cost summary cron (audit B4 follow-up).
 *
 * Runs every day at 02:00 Africa/Lusaka. Reads yesterday's
 * aiUsage/{date} doc, compares it against the 7 days before, and:
 *   - Always writes an agentJobs/{id} rollup so /admin/agents
 *     surfaces the run (matches the existing dailyStreakReminders
 *     and nightlyQaSmoke pattern).
 *   - Emails the admin distribution list when yesterday's spend
 *     exceeded 2× the 7-day median — same anomaly threshold
 *     /admin/ai-costs uses for its health badge.
 *
 * Push complement to the existing pull-only dashboard. The dashboard
 * answers "what does today look like"; this cron answers "wake me
 * up if yesterday was bad".
 *
 * Re-uses the existing SMTP transport (mail.privateemail.com) and
 * ADMIN_EMAILS process env var — no new infra.
 */

const admin = require("firebase-admin");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {defineSecret} = require("firebase-functions/params");
const nodemailer = require("nodemailer");
const crypto = require("node:crypto");

const REGION = "us-central1";
const ANOMALY_MULTIPLIER = 2;
const HISTORY_DAYS = 7;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const emailSmtpUser = defineSecret("EMAIL_SMTP_USER");
const emailSmtpPassword = defineSecret("EMAIL_SMTP_PASSWORD");

function dateKey(offsetDays = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function fmtUsd(n) {
  return `$${(Number(n) || 0).toFixed(2)}`;
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

function getAdminEmails() {
  return (process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
}

const aiCostDailySummary = onSchedule({
  schedule: "every day 02:00",
  timeZone: "Africa/Lusaka",
  region: REGION,
  timeoutSeconds: 240,
  memory: "256MiB",
  secrets: [emailSmtpUser, emailSmtpPassword],
}, async () => {
  const db = admin.firestore();
  const start = Date.now();
  const yesterday = dateKey(-1);

  // Pull yesterday's doc + the previous 7 days for median.
  const dayKeys = [];
  for (let i = 1; i <= HISTORY_DAYS + 1; i += 1) {
    dayKeys.push(dateKey(-i));
  }
  const docs = await Promise.all(
      dayKeys.map((k) => db.collection("aiUsage").doc(k).get().catch(() => null)),
  );

  const rows = docs
      .filter((s) => s && s.exists)
      .map((s) => ({date: s.id, ...(s.data() || {})}));

  const yesterdayRow = rows.find((r) => r.date === yesterday);
  const historyRows = rows
      .filter((r) => r.date !== yesterday)
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .slice(-HISTORY_DAYS);

  const yesterdayCost = Number(yesterdayRow?.totalCostUsd || 0);
  const yesterdayCalls = Number(yesterdayRow?.callCount || 0);
  const historyCosts = historyRows.map((r) => Number(r.totalCostUsd || 0));
  const med = median(historyCosts);
  const sevenDayTotal = historyCosts.reduce((s, n) => s + n, 0) + yesterdayCost;

  const anomaly = med > 0.0001 && yesterdayCost > med * ANOMALY_MULTIPLIER;

  // ── Pull top tools / users so the email body is actionable ──
  let topTools = [];
  let topUsers = [];
  if (yesterdayRow) {
    try {
      const toolsSnap = await db
          .collection("aiUsage").doc(yesterday).collection("tools")
          .orderBy("costUsd", "desc")
          .limit(5)
          .get();
      topTools = toolsSnap.docs.map((d) => ({id: d.id, ...d.data()}));
    } catch (err) {
      console.warn("[aiCostDailySummary] tools read failed", err);
    }
    try {
      const usersSnap = await db
          .collection("aiUsage").doc(yesterday).collection("users")
          .orderBy("costUsd", "desc")
          .limit(5)
          .get();
      topUsers = usersSnap.docs.map((d) => ({id: d.id, ...d.data()}));
    } catch (err) {
      console.warn("[aiCostDailySummary] users read failed", err);
    }
  }

  const summary = {
    date: yesterday,
    totalCostUsd: yesterdayCost,
    callCount: yesterdayCalls,
    sevenDayMedian: med,
    sevenDayTotal,
    anomaly,
    topTools: topTools.map((t) => ({
      tool: t.tool || t.id,
      costUsd: Number(t.costUsd || 0),
      callCount: Number(t.callCount || 0),
    })),
    topUsers: topUsers.map((u) => ({
      uid: u.id,
      costUsd: Number(u.costUsd || 0),
      callCount: Number(u.callCount || 0),
    })),
  };

  // ── agentJobs rollup ──────────────────────────────────────────
  await db.collection("agentJobs").add({
    agentId: "ai-cost-daily-summary",
    department: "ops",
    status: anomaly ? "awaiting_approval" : "done",
    input: {runType: "ai-cost-daily-summary", date: yesterday},
    output: {summary},
    createdBy: "system",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    runMs: Date.now() - start,
  }).catch((err) => console.warn("[aiCostDailySummary] rollup write failed", err));

  if (!anomaly) return;

  // ── Anomaly email ─────────────────────────────────────────────
  const adminEmails = getAdminEmails();
  const transporter = getTransporter();
  const senderEmail = String(emailSmtpUser.value() || "").trim();
  if (!transporter || !senderEmail || adminEmails.length === 0) {
    console.warn("[aiCostDailySummary] anomaly detected but email not configured");
    return;
  }

  const senderDomain = senderEmail.split("@")[1] || "zedexams.com";
  const toolLines = summary.topTools
      .map((t) => `  · ${t.tool}: ${fmtUsd(t.costUsd)} (${t.callCount} calls)`)
      .join("\n") || "  · (no tool breakdown available)";
  const userLines = summary.topUsers
      .map((u) => `  · ${u.uid}: ${fmtUsd(u.costUsd)} (${u.callCount} calls)`)
      .join("\n") || "  · (no per-user breakdown available)";

  const text = [
    `AI cost anomaly — yesterday (${yesterday}) exceeded 2× the 7-day median.`,
    "",
    `Yesterday:    ${fmtUsd(yesterdayCost)}  (${yesterdayCalls} calls)`,
    `7-day median: ${fmtUsd(med)}`,
    `Threshold:    ${fmtUsd(med * ANOMALY_MULTIPLIER)} (2× median)`,
    `7-day total:  ${fmtUsd(sevenDayTotal)}`,
    "",
    "Top tools yesterday:",
    toolLines,
    "",
    "Top consumers yesterday (uids):",
    userLines,
    "",
    "Pull the live dashboard at /admin/ai-costs.",
    "",
    "— ZedExams ops",
  ].join("\n");

  const html = `<p><strong>AI cost anomaly</strong> — yesterday (${yesterday}) exceeded 2× the 7-day median.</p>
<table role="presentation" style="border-collapse:collapse;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;">
  <tr><td style="padding:4px 12px 4px 0;color:#4B6280;">Yesterday</td><td style="padding:4px 0;font-weight:bold;">${fmtUsd(yesterdayCost)} (${yesterdayCalls} calls)</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#4B6280;">7-day median</td><td style="padding:4px 0;font-weight:bold;">${fmtUsd(med)}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#4B6280;">Threshold (2× median)</td><td style="padding:4px 0;font-weight:bold;">${fmtUsd(med * ANOMALY_MULTIPLIER)}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#4B6280;">7-day total</td><td style="padding:4px 0;font-weight:bold;">${fmtUsd(sevenDayTotal)}</td></tr>
</table>
<p style="margin-top:16px;"><strong>Top tools yesterday:</strong></p>
<ul style="margin:0;padding-left:18px;font-size:14px;">
  ${summary.topTools.map((t) => `<li>${t.tool}: <strong>${fmtUsd(t.costUsd)}</strong> (${t.callCount} calls)</li>`).join("") || "<li><em>No tool breakdown available</em></li>"}
</ul>
<p style="margin-top:16px;"><strong>Top consumers (uids):</strong></p>
<ul style="margin:0;padding-left:18px;font-size:14px;font-family:ui-monospace,monospace;">
  ${summary.topUsers.map((u) => `<li>${u.uid}: <strong>${fmtUsd(u.costUsd)}</strong> (${u.callCount} calls)</li>`).join("") || "<li><em>No per-user breakdown available</em></li>"}
</ul>
<p style="margin-top:16px;">Pull the live dashboard at <a href="https://zedexams.com/admin/ai-costs">/admin/ai-costs</a>.</p>
<p style="color:#4B6280;">— ZedExams ops</p>`;

  try {
    await transporter.sendMail({
      from: `ZedExams ops <${senderEmail}>`,
      sender: senderEmail,
      to: adminEmails.join(", "),
      replyTo: senderEmail,
      subject: `[ZedExams] AI cost anomaly — ${yesterday} (${fmtUsd(yesterdayCost)}, ${(yesterdayCost / med).toFixed(1)}× median)`,
      text,
      html,
      messageId: `<ai-cost-anomaly-${yesterday}-${crypto.randomUUID()}@${senderDomain}>`,
      headers: {"X-Auto-Response-Suppress": "All"},
    });
  } catch (err) {
    console.warn("[aiCostDailySummary] anomaly email failed", err);
  }
});

module.exports = {aiCostDailySummary};
