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
 *   - hourlyRevenueReconcile (Till) — every hour. Re-queries Lenco for
 *     stale "pending" payments and finishes what a dropped webhook missed:
 *     activates paid-but-stuck buyers, closes failed ones. All writes go
 *     through the existing idempotent activation path, so it can never
 *     double-grant. Writes an agentJobs rollup the dashboard surfaces.
 *   - supportTriage (Echo) — every 2 hours. Sweeps new feedback AND the
 *     otherwise-invisible public contactMessages, classifies + prioritises
 *     each, and drafts a reply (Haiku when a key is set, a templated
 *     acknowledgement otherwise). Drafts only — never sends. Writes the
 *     triage back onto each doc + an agentJobs rollup.
 *   - contentAutoPublish (gate) — every 30 min. Auto-approves content jobs
 *     stuck at awaiting_approval that pass a strict bar (Cala aligned, no
 *     gaps, Reva "approve"), which fires the existing Pubo trigger and
 *     publishes them. OFF unless agentControl/content.autoPublish === true.
 *   - weeklyProductSignal (Compass) — Mondays 06:00. Aggregates recent quiz
 *     and exam attempts into a ranked "what to build next" backlog (which
 *     grade/subject areas have demand but weak mastery). Deterministic, no
 *     LLM. Writes an agentJobs rollup the dashboard + Dawn surface.
 *   - weeklyRetentionScan (Anchor) — Mondays 07:00. Finds learners who were
 *     engaged then went quiet 14–45 days ago and surfaces the highest-value
 *     ones to win back, with a drafted nudge. Read-only — does not message
 *     learners. Writes an agentJobs rollup.
 */

const admin = require("firebase-admin");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {defineSecret} = require("firebase-functions/params");

const {runQuill} = require("./runners/quill");
const {runCala} = require("./runners/cala");
const {runMonitorChecks, suggestFixes, notifyFailures} = require("./runners/monitor");
const {reconcilePendingPayments} = require("./runners/till");
const {runEchoTriage, templateReply} = require("./runners/echo");
const {runContentGate} = require("./runners/gate");
const {runCompass} = require("./runners/compass");
const {runAnchor} = require("./runners/anchor");

// Vigil needs the Anthropic key for fix suggestions, the SMTP secrets for the
// alert email, and GitHub credentials to file bug issues. For GitHub it prefers
// a GitHub App (App id + private key + installation id → a no-expiry-to-babysit
// installation token) and falls back to a PAT. defineSecret is keyed by name,
// so shared secrets are the same ones defined elsewhere; each channel degrades
// gracefully when its secret is unset.
const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY");
const emailSmtpUser = defineSecret("EMAIL_SMTP_USER");
const emailSmtpPassword = defineSecret("EMAIL_SMTP_PASSWORD");
const githubBotToken = defineSecret("GITHUB_BOT_TOKEN");
const githubAppId = defineSecret("GITHUB_APP_ID");
const githubAppPrivateKey = defineSecret("GITHUB_APP_PRIVATE_KEY");
const githubAppInstallationId = defineSecret("GITHUB_APP_INSTALLATION_ID");

// Till needs the Lenco API token to query authoritative payment status, and
// the SMTP secrets so a recovered activation can still send its receipt
// (mirrors the secrets the Lenco webhook/poll already use in index.js).
const lencoApiKey = defineSecret("LENCO_API_KEY");

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
  secrets: [
    anthropicApiKey, emailSmtpUser, emailSmtpPassword,
    githubBotToken, githubAppId, githubAppPrivateKey, githubAppInstallationId,
  ],
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
        github: {
          repo: process.env.GITHUB_REPO || "Mwelwa-cyber/Zedexams",
          appId: String(githubAppId.value() || "").trim(),
          privateKey: githubAppPrivateKey.value() || "",
          installationId: String(githubAppInstallationId.value() || "").trim(),
          pat: String(githubBotToken.value() || "").trim(),
        },
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

// Till — hourly payment reconciliation. Cheap: most runs find no stale
// pending payments and make zero Lenco calls. Only spends a Lenco lookup
// per genuinely-stuck pending payment, and only writes through the existing
// idempotent activation path (no double-grant possible). Hourly keeps a
// paid-but-stuck buyer waiting at most ~1 hour instead of indefinitely.
const HOURLY_RECONCILE_OPTS = {
  schedule: "every 1 hours",
  timeZone: "Africa/Lusaka",
  region: "us-central1",
  timeoutSeconds: 300,
  memory: "256MiB",
  secrets: [lencoApiKey, emailSmtpUser, emailSmtpPassword],
};

const hourlyRevenueReconcile = onSchedule(HOURLY_RECONCILE_OPTS, async () => {
  const db = admin.firestore();
  const start = Date.now();
  const apiKey = (lencoApiKey.value() || process.env.LENCO_API_KEY || "").trim();

  let summary;
  try {
    const {getCollectionStatus} = require("../lencoService");
    const {activateSubscriptionFromPayment, markPaymentFailed} =
      require("../subscriptionActivation");
    summary = await reconcilePendingPayments({
      db,
      apiKey,
      getCollectionStatus,
      activate: activateSubscriptionFromPayment,
      markFailed: markPaymentFailed,
      emailSecrets: {
        senderEmail: String(emailSmtpUser.value() || "").trim(),
        senderPassword: emailSmtpPassword.value(),
      },
    });
  } catch (err) {
    console.error("Till failed", err);
    await db.collection("agentJobs").add({
      agentId: "till",
      department: "revenue",
      status: "failed",
      input: {runType: "hourly-reconcile"},
      error: String(err && err.message || err).slice(0, 500),
      createdBy: "system",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      runMs: Date.now() - start,
    });
    return;
  }

  // Surface notable runs (recovered money or errors needing a human) at the
  // top of the dashboard; quiet "nothing to do" runs are just logged.
  const notable = summary.recovered.length > 0 || summary.errors.length > 0;
  await db.collection("agentJobs").add({
    agentId: "till",
    department: "revenue",
    status: notable ? "awaiting_approval" : "done",
    input: {runType: "hourly-reconcile"},
    output: {till: summary},
    createdBy: "system",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    runMs: Date.now() - start,
  });
});

// Echo — support triage every 2 hours. Sweeps new feedback + the invisible
// public contact form, classifies/prioritises, and drafts a reply (Haiku when
// a key is set, free template otherwise). Drafts only — it never sends. Cheap:
// it only touches items it hasn't processed yet (echoProcessedAt guards it), so
// most runs after the first do little or nothing.
const SUPPORT_TRIAGE_OPTS = {
  schedule: "every 2 hours",
  timeZone: "Africa/Lusaka",
  region: "us-central1",
  timeoutSeconds: 300,
  memory: "256MiB",
  secrets: [anthropicApiKey],
};

const supportTriage = onSchedule(SUPPORT_TRIAGE_OPTS, async () => {
  const db = admin.firestore();
  const start = Date.now();
  const apiKey = anthropicApiKey.value() || process.env.ANTHROPIC_API_KEY || "";

  // Draft a short, on-brand reply with Haiku when a key is present; fall back
  // to a templated acknowledgement otherwise (free, still useful).
  async function draftReply({kind, item}) {
    if (!apiKey) return templateReply({kind, item});
    const {callAnthropic} = require("../aiService");
    const data = item.data || {};
    const systemPrompt =
      "You are a warm, concise support agent for ZedExams, a CBC learning " +
      "platform for Zambian learners, teachers and parents. Draft a reply " +
      "(under 110 words) to the message below. Be specific to what they said, " +
      "acknowledge their point, never promise refunds or timelines you can't " +
      "be sure of, and sign off as 'The ZedExams Team'. Plain text only — no " +
      "subject line, no preamble.";
    const who = data.name ? `Name: ${data.name}\n` : "";
    try {
      const reply = await callAnthropic(apiKey, {
        systemPrompt,
        messages: [{
          role: "user",
          content: `${who}Category: ${kind}\nMessage:\n${String(data.message || "").slice(0, 1200)}`,
        }],
        model: "claude-haiku-4-5-20251001",
        maxTokens: 300,
        temperature: 0.3,
        track: {tool: "supportTriage"},
      });
      return (reply && String(reply).trim()) || templateReply({kind, item});
    } catch (err) {
      // Surface the model error to runEchoTriage, which falls back to the
      // template — a bad LLM call must never drop the support item.
      throw err;
    }
  }

  let summary;
  try {
    summary = await runEchoTriage({db, draftReply});
  } catch (err) {
    console.error("Echo failed", err);
    await db.collection("agentJobs").add({
      agentId: "echo",
      department: "support",
      status: "failed",
      input: {runType: "support-triage"},
      error: String(err && err.message || err).slice(0, 500),
      createdBy: "system",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      runMs: Date.now() - start,
    });
    return;
  }

  // Anything triaged (or errored) is something a human should glance at and
  // send; a quiet run with no new messages is just logged.
  const notable = summary.processed > 0 || summary.errors.length > 0;
  await db.collection("agentJobs").add({
    agentId: "echo",
    department: "support",
    status: notable ? "awaiting_approval" : "done",
    input: {runType: "support-triage"},
    output: {echo: summary},
    createdBy: "system",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    runMs: Date.now() - start,
  });
});

// Content auto-publish gate — every 30 minutes. Publishes verified content
// that's stuck waiting for a human approver. OFF by default: it only acts when
// agentControl/content.autoPublish === true, and even then only on jobs that
// clear the strict Cala+Reva bar. Writes a rollup only when it actually
// publishes something (or errors) — quiet otherwise.
const CONTENT_GATE_OPTS = {
  schedule: "every 30 minutes",
  timeZone: "Africa/Lusaka",
  region: "us-central1",
  timeoutSeconds: 120,
  memory: "256MiB",
};

const contentAutoPublish = onSchedule(CONTENT_GATE_OPTS, async () => {
  const db = admin.firestore();
  const start = Date.now();

  let config = {};
  try {
    const snap = await db.collection("agentControl").doc("content").get();
    if (snap.exists) config = snap.data() || {};
  } catch (err) {
    console.warn("[contentAutoPublish] could not read agentControl/content", err?.message);
  }

  let summary;
  try {
    summary = await runContentGate({db, config});
  } catch (err) {
    console.error("Content gate failed", err);
    await db.collection("agentJobs").add({
      agentId: "pubo",
      department: "content",
      status: "done",
      input: {runType: "content-auto-publish"},
      error: String(err && err.message || err).slice(0, 500),
      createdBy: "system",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      runMs: Date.now() - start,
    });
    return;
  }

  // Only log a run that actually published something (or errored). A quiet
  // sweep — disabled, or nothing clean to publish — writes nothing, so this
  // doesn't spam the dashboard every 30 minutes.
  if (summary.autoApproved.length > 0 || summary.errors.length > 0) {
    await db.collection("agentJobs").add({
      agentId: "pubo",
      department: "content",
      status: "done",
      input: {runType: "content-auto-publish"},
      output: {gate: summary},
      createdBy: "system",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      runMs: Date.now() - start,
    });
  }
});

// Compass — weekly product signal (Mondays 06:00 Africa/Lusaka). Aggregates
// the last two weeks of quiz/exam attempts into a ranked build backlog. Pure
// arithmetic over bounded reads — no LLM, no secrets, ~free.
const PRODUCT_SIGNAL_OPTS = {
  schedule: "every monday 06:00",
  timeZone: "Africa/Lusaka",
  region: "us-central1",
  timeoutSeconds: 300,
  memory: "256MiB",
};

const weeklyProductSignal = onSchedule(PRODUCT_SIGNAL_OPTS, async () => {
  const db = admin.firestore();
  const start = Date.now();

  let summary;
  try {
    summary = await runCompass({db});
  } catch (err) {
    console.error("Compass failed", err);
    await db.collection("agentJobs").add({
      agentId: "compass",
      department: "content",
      status: "failed",
      input: {runType: "weekly-product-signal"},
      error: String(err && err.message || err).slice(0, 500),
      createdBy: "system",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      runMs: Date.now() - start,
    });
    return;
  }

  // A backlog (or an error) is something to act on; an empty week is just logged.
  const notable = summary.backlog.length > 0 || summary.errors.length > 0;
  await db.collection("agentJobs").add({
    agentId: "compass",
    department: "content",
    status: notable ? "awaiting_approval" : "done",
    input: {runType: "weekly-product-signal", windowDays: summary.windowDays},
    output: {compass: summary},
    createdBy: "system",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    runMs: Date.now() - start,
  });
});

// Anchor — weekly retention scan (Mondays 07:00 Africa/Lusaka). Surfaces
// lapsed-but-recoverable learners. Read-only; bounded date-range query over
// learnerStats. No LLM, no secrets, ~free.
const RETENTION_SCAN_OPTS = {
  schedule: "every monday 07:00",
  timeZone: "Africa/Lusaka",
  region: "us-central1",
  timeoutSeconds: 300,
  memory: "256MiB",
};

const weeklyRetentionScan = onSchedule(RETENTION_SCAN_OPTS, async () => {
  const db = admin.firestore();
  const start = Date.now();

  let summary;
  try {
    summary = await runAnchor({db});
  } catch (err) {
    console.error("Anchor failed", err);
    await db.collection("agentJobs").add({
      agentId: "anchor",
      department: "growth",
      status: "failed",
      input: {runType: "weekly-retention-scan"},
      error: String(err && err.message || err).slice(0, 500),
      createdBy: "system",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      runMs: Date.now() - start,
    });
    return;
  }

  const notable = summary.atRisk > 0 || summary.errors.length > 0;
  await db.collection("agentJobs").add({
    agentId: "anchor",
    department: "growth",
    status: notable ? "awaiting_approval" : "done",
    input: {runType: "weekly-retention-scan"},
    output: {anchor: summary},
    createdBy: "system",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    runMs: Date.now() - start,
  });
});

module.exports = {
  nightlyQaSmoke,
  weeklyCbcAlignmentAudit,
  hourlyMonitor,
  hourlyRevenueReconcile,
  supportTriage,
  contentAutoPublish,
  weeklyProductSignal,
  weeklyRetentionScan,
};
