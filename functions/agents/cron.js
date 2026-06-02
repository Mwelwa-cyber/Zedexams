/**
 * Scheduled Cloud Functions for the AI agent stack.
 *
 * Currently:
 *   - nightlyQaSmoke (Quill) — every day 02:00 Africa/Lusaka. Walks
 *     Firestore for stuck jobs and KB freshness; writes a summary
 *     `agentJobs` doc the dashboard surfaces.
 *   - weeklyCbcAlignmentAudit (Cala) — every Sunday 03:00 Africa/Lusaka.
 *     Samples up to 20 of the most recent `aiGenerations`, re-runs Cala
 *     on each, and writes a summary `agentJobs` doc with aggregate
 *     alignment results. Catches drift if the KB or prompts change.
 *   - hourlyMonitor (Vigil) — every hour. Checks pages, Firebase, images,
 *     and quizzes; on failure asks Haiku for fixes and escalates (email +
 *     GitHub bug issue → Mendi), de-duplicated to once per failure per 24h.
 */

const admin = require("firebase-admin");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {defineSecret} = require("firebase-functions/params");

const {runQuill} = require("./runners/quill");
const {runCala} = require("./runners/cala");
const {runMonitorChecks, suggestFixes, notifyFailures} = require("./runners/monitor");

// Vigil needs the Anthropic key for fix suggestions, the SMTP secrets for the
// alert email, and a GitHub token to file bug issues. defineSecret is keyed by
// name, so these are the same secrets already defined elsewhere; each channel
// degrades gracefully when its secret is unset.
const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY");
const emailSmtpUser = defineSecret("EMAIL_SMTP_USER");
const emailSmtpPassword = defineSecret("EMAIL_SMTP_PASSWORD");
const githubBotToken = defineSecret("GITHUB_BOT_TOKEN");

function getAdminEmails() {
  return (process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
}

const NIGHTLY_QA_OPTS = {
  schedule: "every day 02:00",
  timeZone: "Africa/Lusaka",
  region: "us-central1",
  timeoutSeconds: 300,
  memory: "256MiB",
};

const nightlyQaSmoke = onSchedule(NIGHTLY_QA_OPTS, async () => {
  const db = admin.firestore();
  const start = Date.now();

  let report;
  try {
    report = await runQuill();
  } catch (err) {
    console.error("Quill failed", err);
    await db.collection("agentJobs").add({
      agentId: "quill",
      department: "qaEng",
      status: "failed",
      input: {runType: "nightly-smoke"},
      error: String(err && err.message || err).slice(0, 500),
      createdBy: "system",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      runMs: Date.now() - start,
    });
    return;
  }

  await db.collection("agentJobs").add({
    agentId: "quill",
    department: "qaEng",
    status: report.ok ? "done" : "awaiting_approval",
    input: {runType: "nightly-smoke"},
    output: {quill: report},
    createdBy: "system",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    runMs: Date.now() - start,
  });
});

// Sunday early morning — sampling 20 recent aiGenerations gives us a
// trend signal without burning through budget. KB-only check, no LLM
// call, so this is essentially free.
const WEEKLY_AUDIT_OPTS = {
  schedule: "every sunday 03:00",
  timeZone: "Africa/Lusaka",
  region: "us-central1",
  timeoutSeconds: 300,
  memory: "256MiB",
};
const AUDIT_SAMPLE_SIZE = 20;

const weeklyCbcAlignmentAudit = onSchedule(WEEKLY_AUDIT_OPTS, async () => {
  const db = admin.firestore();
  const start = Date.now();

  const snap = await db.collection("aiGenerations")
    .orderBy("createdAt", "desc")
    .limit(AUDIT_SAMPLE_SIZE)
    .get()
    .catch(() => null);

  if (!snap || snap.empty) {
    await db.collection("agentJobs").add({
      agentId: "cala",
      department: "qaEng",
      status: "done",
      input: {runType: "weekly-cbc-audit"},
      output: {
        cala: {sampleSize: 0, note: "No aiGenerations found to audit."},
      },
      createdBy: "system",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      runMs: Date.now() - start,
    });
    return;
  }

  const findings = [];
  let aligned = 0;
  let drifted = 0;
  let errored = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data() || {};
    const inputs = data.inputs || {};
    const draft = data.output;
    if (!draft) {
      // Skip in-flight or failed generations.
      continue;
    }
    // Synthesize a minimal agentJobs-shaped doc for runCala to consume.
    const fakeJob = {
      input: {
        grade: inputs.grade,
        subject: inputs.subject,
        topic: inputs.topic,
        subtopic: inputs.subtopic,
      },
      output: {aria: {draft}},
    };
    try {
      const result = await runCala({job: fakeJob});
      if (result.aligned) aligned += 1; else drifted += 1;
      if (!result.aligned) {
        findings.push({
          generationId: docSnap.id,
          tool: data.tool || null,
          gaps: result.gaps,
          drift: result.drift,
        });
      }
    } catch (err) {
      errored += 1;
      findings.push({
        generationId: docSnap.id,
        tool: data.tool || null,
        error: String(err && err.message || err).slice(0, 200),
      });
    }
  }

  const summary = {
    sampleSize: snap.size,
    aligned,
    drifted,
    errored,
    findings: findings.slice(0, 50),
  };

  await db.collection("agentJobs").add({
    agentId: "cala",
    department: "qaEng",
    status: drifted > 0 || errored > 0 ? "awaiting_approval" : "done",
    input: {runType: "weekly-cbc-audit", sampleSize: snap.size},
    output: {cala: summary},
    createdBy: "system",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    runMs: Date.now() - start,
  });
});

// Vigil — hourly health sweep. Runs the deterministic checks for free; only
// spends Anthropic tokens (Haiku) to suggest fixes when something fails.
const HOURLY_MONITOR_OPTS = {
  schedule: "every 1 hours",
  timeZone: "Africa/Lusaka",
  region: "us-central1",
  timeoutSeconds: 300,
  memory: "256MiB",
  secrets: [anthropicApiKey, emailSmtpUser, emailSmtpPassword, githubBotToken],
};

const hourlyMonitor = onSchedule(HOURLY_MONITOR_OPTS, async () => {
  const db = admin.firestore();
  const start = Date.now();

  let report;
  try {
    report = await runMonitorChecks(db);
  } catch (err) {
    console.error("Vigil failed", err);
    await db.collection("agentJobs").add({
      agentId: "vigil",
      department: "qaEng",
      status: "failed",
      input: {runType: "hourly-monitor"},
      error: String(err && err.message || err).slice(0, 500),
      createdBy: "system",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      runMs: Date.now() - start,
    });
    return;
  }

  // Only on failure: ask Haiku for fixes, then escalate (email + bug issue),
  // de-duplicated so an unresolved problem is raised at most once per 24h.
  if (!report.ok) {
    const apiKey = anthropicApiKey.value() || process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      try {
        report.suggestions = await suggestFixes(apiKey, report);
      } catch (err) {
        report.suggestionsError = String(err && err.message || err).slice(0, 300);
      }
    }
    try {
      report.notified = await notifyFailures({
        db,
        report,
        smtpUser: String(emailSmtpUser.value() || "").trim(),
        smtpPass: emailSmtpPassword.value(),
        adminEmails: getAdminEmails(),
        githubToken: String(githubBotToken.value() || "").trim(),
        githubRepo: process.env.GITHUB_REPO || "Mwelwa-cyber/Zedexams",
      });
    } catch (err) {
      report.notifyError = String(err && err.message || err).slice(0, 300);
    }
  }

  await db.collection("agentJobs").add({
    agentId: "vigil",
    department: "qaEng",
    status: report.ok ? "done" : "awaiting_approval",
    input: {runType: "hourly-monitor"},
    output: {vigil: report},
    createdBy: "system",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    runMs: Date.now() - start,
  });
});

module.exports = {nightlyQaSmoke, weeklyCbcAlignmentAudit, hourlyMonitor};
