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
// nodemailer is required lazily in getTransporter() — see the note there.
const crypto = require("node:crypto");

const {
  getMonthlyBudgetUsd,
  getMonthToDateCostUsd,
  evaluateBudget,
  monthKeyUtc,
} = require("./aiCostTracking");
const {sumShardDocs, groupToolShards} = require("./shardedCounter");

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

/**
 * Read one day's totals by summing its shard docs (aiUsage/{date}/shards/*)
 * and folding in the legacy single-doc total for pre-migration days. Returns
 * null when the day has no data. Never throws.
 */
async function readDayRow(db, date) {
  const dayRef = db.collection("aiUsage").doc(date);
  const [legacy, shards] = await Promise.all([
    dayRef.get().catch(() => null),
    dayRef.collection("shards").get().catch(() => null),
  ]);
  const docs = [];
  if (legacy && legacy.exists) docs.push(legacy.data());
  if (shards) shards.forEach((s) => docs.push(s.data()));
  if (docs.length === 0) return null;
  return {...sumShardDocs(docs, {carry: ["date"]}), date};
}

/**
 * Top tools for a day, summed across the flattened tool shards
 * (aiUsage/{date}/toolShards/{tool}__{shard}) plus any legacy per-tool docs.
 * Sorted by cost desc, limited. Never throws.
 */
async function readTopTools(db, date, limit) {
  const dayRef = db.collection("aiUsage").doc(date);
  const [legacy, shards] = await Promise.all([
    dayRef.collection("tools").get().catch(() => ({docs: []})),
    dayRef.collection("toolShards").get().catch(() => ({docs: []})),
  ]);
  const docs = [];
  legacy.docs.forEach((d) => docs.push({tool: d.id, ...d.data()}));
  shards.docs.forEach((d) => docs.push(d.data()));
  return groupToolShards(docs).slice(0, limit);
}

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

// Recipients for the cost/budget emails: OPS_ALERT_EMAILS, falling back to
// ADMIN_EMAILS and then to the SMTP sender. Precedence and rationale live in
// functions/opsAlertRecipients.js — in short, telling the platform where to
// send an alert must not also decide who may hold admin.
const {resolveOpsAlertRecipients} = require("./opsAlertRecipients");

function getAdminEmails(fallbackSender) {
  return resolveOpsAlertRecipients({fallbackSender}).recipients;
}

/**
 * Email the admin list when month-to-date AI spend approaches (80%) or
 * reaches (100%) the configured monthly ceiling. No-op when the ceiling
 * is unset or spend is comfortably under it. Runs daily, so while spend
 * sits in the warn/over band the admin is nudged once a day.
 */
async function maybeSendBudgetAlert() {
  const budgetUsd = getMonthlyBudgetUsd();
  if (!budgetUsd) return;

  let monthCostUsd = 0;
  try {
    monthCostUsd = await getMonthToDateCostUsd();
  } catch (err) {
    console.warn("[aiCostDailySummary] month-to-date read failed", err);
    return;
  }

  const status = evaluateBudget({monthCostUsd, budgetUsd});
  if (!status.warning && !status.overBudget) return;

  const transporter = getTransporter();
  const senderEmail = String(emailSmtpUser.value() || "").trim();
  const adminEmails = getAdminEmails(senderEmail);
  if (!transporter || !senderEmail || adminEmails.length === 0) {
    console.warn(
        "[aiCostDailySummary] budget threshold crossed but email not configured",
        {monthCostUsd, budgetUsd, overBudget: status.overBudget},
    );
    return;
  }

  const month = monthKeyUtc();
  const pct = Math.round(status.ratio * 100);
  const senderDomain = senderEmail.split("@")[1] || "zedexams.com";
  const headline = status.overBudget ?
    "AI monthly budget REACHED — app AI calls are now paused" :
    "AI monthly budget at " + pct + "% — heads up";

  const text = [
    headline + ".",
    "",
    `Month (${month}) so far: ${fmtUsd(monthCostUsd)}`,
    `Ceiling:                ${fmtUsd(budgetUsd)}`,
    `Used:                   ${pct}%`,
    "",
    status.overBudget ?
      "App-side AI features are paused until next month or until an admin " +
      "raises AI_MONTHLY_BUDGET_USD." :
      "No action needed yet — this is an early warning.",
    "",
    "Note: this ceiling only covers the app's own Anthropic spend. " +
    "Claude Code / managed-agent (Opus) usage on the same key is governed " +
    "by the org spend limit in the Anthropic console, not by this alert.",
    "",
    "Dashboard: https://zedexams.com/admin/ai-costs",
    "",
    "— ZedExams ops",
  ].join("\n");

  const html = `<p><strong>${headline}.</strong></p>
<table role="presentation" style="border-collapse:collapse;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;">
  <tr><td style="padding:4px 12px 4px 0;color:#4B6280;">Month (${month}) so far</td><td style="padding:4px 0;font-weight:bold;">${fmtUsd(monthCostUsd)}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#4B6280;">Ceiling</td><td style="padding:4px 0;font-weight:bold;">${fmtUsd(budgetUsd)}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#4B6280;">Used</td><td style="padding:4px 0;font-weight:bold;">${pct}%</td></tr>
</table>
<p style="margin-top:16px;">${status.overBudget ?
    "App-side AI features are <strong>paused</strong> until next month or until an admin raises <code>AI_MONTHLY_BUDGET_USD</code>." :
    "No action needed yet — this is an early warning."}</p>
<p style="margin-top:16px;color:#4B6280;font-size:13px;">This ceiling only covers the app's own Anthropic spend. Claude Code / managed-agent (Opus) usage on the same key is governed by the org spend limit in the Anthropic console, not by this alert.</p>
<p style="margin-top:16px;">Dashboard: <a href="https://zedexams.com/admin/ai-costs">/admin/ai-costs</a></p>
<p style="color:#4B6280;">— ZedExams ops</p>`;

  try {
    await transporter.sendMail({
      from: `ZedExams ops <${senderEmail}>`,
      sender: senderEmail,
      to: adminEmails.join(", "),
      replyTo: senderEmail,
      subject: `[ZedExams] ${status.overBudget ? "AI budget reached" : "AI budget at " + pct + "%"} — ${month} (${fmtUsd(monthCostUsd)} / ${fmtUsd(budgetUsd)})`,
      text,
      html,
      messageId: `<ai-budget-${month}-${pct}-${crypto.randomUUID()}@${senderDomain}>`,
      headers: {"X-Auto-Response-Suppress": "All"},
    });
  } catch (err) {
    console.warn("[aiCostDailySummary] budget alert email failed", err);
  }
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
  const rows = (await Promise.all(dayKeys.map((k) => readDayRow(db, k))))
      .filter(Boolean);

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
      topTools = await readTopTools(db, yesterday, 5);
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

  // ── Monthly budget ceiling alert ──────────────────────────────
  // Independent of the relative anomaly check: warns at 80% of the
  // configured ceiling and alarms at 100% (when the gate has begun
  // pausing app-side AI). No-op unless AI_MONTHLY_BUDGET_USD is set.
  await maybeSendBudgetAlert();

  if (!anomaly) return;

  // ── Anomaly email ─────────────────────────────────────────────
  const transporter = getTransporter();
  const senderEmail = String(emailSmtpUser.value() || "").trim();
  const adminEmails = getAdminEmails(senderEmail);
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
