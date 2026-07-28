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
 *     quizzes, today's daily-exam picks (re-running the idempotent
 *     autoPickDailyExams picker when the 05:00 cron missed), and the Google
 *     Play purchase-verification wiring (garbage-token probe against the
 *     Play Developer API); on failure asks Haiku for fixes and escalates
 *     (email + GitHub bug issue → Mendi), de-duplicated to once per failure
 *     per 24h.
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
 *
 * Pure decision logic (rollup shaping, status/notability decisions, the
 * audit accumulator, Dawn staleness checks) lives in ./cronCore.js; this
 * file owns the schedules, secrets, and Firestore/model/email I/O.
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
const {runMarshal} = require("./runners/marshal");
const {refreshFxRate} = require("../fxRate");
const {writeAgentRollup} = require("./rollups");
const {buildPublicStatus} = require("./publicStatusCore");
const {fetchSessionStatus, fetchBriefing, parseBriefing, isTerminalStatus} = require("./runners/dawn");
const {
  AUDIT_SAMPLE_SIZE,
  truncateErrorMessage,
  buildFailureJob,
  auditGenerations,
  buildQuillRollup,
  buildCalaAuditRollup,
  buildVigilRollup,
  buildTillRollup,
  buildEchoRollup,
  isContentGateRunNotable,
  buildContentGateRollup,
  buildCompassRollup,
  buildAnchorRollup,
  buildMarshalRollup,
  dawnRunStartMs,
  isDawnRunStale,
  dawnRecipient,
  buildDawnDoneUpdate,
  ECHO_DRAFT_SYSTEM_PROMPT,
  buildEchoDraftUserContent,
} = require("./cronCore");

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

// Vigil's playBilling probe needs the same Play service-account JSON that
// verifyGooglePlayPurchase uses (defineSecret is keyed by name — this IS that
// secret), so it can prove the purchase-verification wiring hourly instead of
// a paying customer discovering a broken config.
const googlePlaySaJson = defineSecret("GOOGLE_PLAY_SA_JSON");

// Recipients for ops alerts: OPS_ALERT_EMAILS, falling back to ADMIN_EMAILS and
// then to the SMTP sender account itself — the same EMAIL_SMTP_USER account Dawn
// and the daily cost summary send through — so an alert lands somewhere instead
// of being silently dropped ("SMTP or ADMIN_EMAILS not configured"). Callers
// pass the resolved sender because only they know which one their transport got.
// The precedence itself lives in functions/opsAlertRecipients.js, which also
// explains why the recipient list is no longer the admin allowlist.
const {resolveOpsAlertRecipients} = require("../opsAlertRecipients");

function getAdminEmails(fallbackSender) {
  return resolveOpsAlertRecipients({fallbackSender}).recipients;
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
    await db.collection("agentJobs").add(buildFailureJob({
      agentId: "quill",
      department: "qaEng",
      runType: "nightly-smoke",
      err,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      runMs: Date.now() - start,
    }));
    return;
  }

  await writeAgentRollup(db, admin.firestore.FieldValue,
      buildQuillRollup({report, runMs: Date.now() - start}));
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

  const summary = await auditGenerations({docs: snap.docs, runCala});

  await writeAgentRollup(db, admin.firestore.FieldValue,
      buildCalaAuditRollup({summary, runMs: Date.now() - start}));
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
    googlePlaySaJson,
  ],
};

const hourlyMonitor = onSchedule(HOURLY_MONITOR_OPTS, async () => {
  const db = admin.firestore();
  const start = Date.now();

  let report;
  try {
    report = await runMonitorChecks(db, {
      playSaJson: googlePlaySaJson.value() || process.env.GOOGLE_PLAY_SA_JSON || "",
    });
  } catch (err) {
    console.error("Vigil failed", err);
    await db.collection("agentJobs").add(buildFailureJob({
      agentId: "vigil",
      department: "qaEng",
      runType: "hourly-monitor",
      err,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      runMs: Date.now() - start,
    }));
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
        report.suggestionsError = truncateErrorMessage(err, 300);
      }
    }
    try {
      const smtpUser = String(emailSmtpUser.value() || "").trim();
      report.notified = await notifyFailures({
        db,
        report,
        smtpUser,
        smtpPass: emailSmtpPassword.value(),
        adminEmails: getAdminEmails(smtpUser),
        github: {
          repo: process.env.GITHUB_REPO || "Mwelwa-cyber/Zedexams",
          appId: String(githubAppId.value() || "").trim(),
          privateKey: githubAppPrivateKey.value() || "",
          installationId: String(githubAppInstallationId.value() || "").trim(),
          pat: String(githubBotToken.value() || "").trim(),
        },
      });
    } catch (err) {
      report.notifyError = truncateErrorMessage(err, 300);
    }
  }

  await writeAgentRollup(db, admin.firestore.FieldValue,
      buildVigilRollup({report, runMs: Date.now() - start}));

  // Publish the honest public status doc the /status page renders. Derived from
  // THIS real Vigil report (not shallow client probes), with per-component
  // streaks carried from the previous doc so recovery isn't declared on a
  // single lucky check. Best-effort: a failure here must not fail the monitor.
  try {
    const statusRef = db.collection("publicStatus").doc("current");
    const prevSnap = await statusRef.get();
    const prev = prevSnap.exists ? prevSnap.data() : null;
    const publicStatus = buildPublicStatus(report, prev, {nowMs: Date.now()});
    // Stamp with the server timestamp too so a client can cross-check freshness
    // even if the injected generatedAt is ever wrong.
    publicStatus.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    await statusRef.set(publicStatus, {merge: false});
  } catch (err) {
    console.error("[hourlyMonitor] publicStatus write failed", truncateErrorMessage(err, 300));
  }
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
    await db.collection("agentJobs").add(buildFailureJob({
      agentId: "till",
      department: "revenue",
      runType: "hourly-reconcile",
      err,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      runMs: Date.now() - start,
    }));
    return;
  }

  await writeAgentRollup(db, admin.firestore.FieldValue,
      buildTillRollup({summary, runMs: Date.now() - start}));
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
    try {
      const reply = await callAnthropic(apiKey, {
        systemPrompt: ECHO_DRAFT_SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: buildEchoDraftUserContent({kind, item}),
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
    await db.collection("agentJobs").add(buildFailureJob({
      agentId: "echo",
      department: "support",
      runType: "support-triage",
      err,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      runMs: Date.now() - start,
    }));
    return;
  }

  await writeAgentRollup(db, admin.firestore.FieldValue,
      buildEchoRollup({summary, runMs: Date.now() - start}));
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
    await db.collection("agentJobs").add(buildFailureJob({
      agentId: "pubo",
      department: "content",
      runType: "content-auto-publish",
      status: "done",
      err,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      runMs: Date.now() - start,
    }));
    return;
  }

  if (isContentGateRunNotable(summary)) {
    await db.collection("agentJobs").add(buildContentGateRollup({
      summary,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      runMs: Date.now() - start,
    }));
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
    await db.collection("agentJobs").add(buildFailureJob({
      agentId: "compass",
      department: "content",
      runType: "weekly-product-signal",
      err,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      runMs: Date.now() - start,
    }));
    return;
  }

  await writeAgentRollup(db, admin.firestore.FieldValue,
      buildCompassRollup({summary, runMs: Date.now() - start}));
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
    await db.collection("agentJobs").add(buildFailureJob({
      agentId: "anchor",
      department: "growth",
      runType: "weekly-retention-scan",
      err,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      runMs: Date.now() - start,
    }));
    return;
  }

  await writeAgentRollup(db, admin.firestore.FieldValue,
      buildAnchorRollup({summary, runMs: Date.now() - start}));
});

// Dawn — delivers an on-demand morning briefing once the Managed Agent has
// finished. The admin starts a run with the /admin/agents button (the
// runDawnBriefing callable writes dawnRuns/{sessionId} = status:'running'); this
// poller watches those docs, and when the session goes idle it pulls the
// briefing Dawn wrote, emails it, and saves it back onto the doc so the panel
// renders it inline. Cheap: nearly every run finds no in-flight briefing and
// returns after a single bounded query. A run that hangs past DAWN_STALE_MS is
// marked 'timeout' so it can't be polled forever.
const DAWN_DELIVERY_OPTS = {
  schedule: "every 5 minutes",
  timeZone: "Africa/Lusaka",
  region: "us-central1",
  timeoutSeconds: 120,
  memory: "256MiB",
  secrets: [anthropicApiKey, emailSmtpUser, emailSmtpPassword],
};

async function emailBriefing({to, subject, body}) {
  const senderEmail = String(emailSmtpUser.value() || "").trim();
  const senderPassword = emailSmtpPassword.value();
  if (!senderEmail || !senderPassword) {
    return {ok: false, reason: "smtp-not-configured"};
  }
  const nodemailer = require("nodemailer");
  const transporter = nodemailer.createTransport({
    host: "mail.privateemail.com",
    port: 587,
    secure: false,
    requireTLS: true,
    auth: {user: senderEmail, pass: senderPassword},
    tls: {minVersion: "TLSv1.2", servername: "mail.privateemail.com"},
  });
  await transporter.sendMail({
    from: `ZedExams <${senderEmail}>`,
    sender: senderEmail,
    to,
    replyTo: senderEmail,
    subject,
    text: body,
    headers: {"X-Auto-Response-Suppress": "All"},
  });
  return {ok: true};
}

const deliverDawnBriefings = onSchedule(DAWN_DELIVERY_OPTS, async () => {
  const db = admin.firestore();
  const apiKey = (anthropicApiKey.value() || process.env.ANTHROPIC_API_KEY || "").trim();

  let snap;
  try {
    // Equality-only filter (no orderBy) so this needs no composite index. The
    // runDawnBriefing callable enforces a single in-flight run, so there's
    // normally ≤1 match here; limit(5) is just a defensive cap.
    snap = await db.collection("dawnRuns")
        .where("status", "==", "running")
        .limit(5)
        .get();
  } catch (err) {
    console.error("Dawn delivery: dawnRuns query failed", err);
    return;
  }
  if (snap.empty) return; // nothing in flight — the common case.

  const now = Date.now();
  for (const doc of snap.docs) {
    const run = doc.data();
    const sessionId = run.sessionId || doc.id;
    const startedMs = dawnRunStartMs(run, now);

    try {
      const status = await fetchSessionStatus({fetchImpl: fetch, apiKey, sessionId});

      if (!isTerminalStatus(status)) {
        // Still working. Give up on a run that has hung well past a normal ~10
        // min so a stuck session doesn't get polled indefinitely.
        if (isDawnRunStale({startedMs, now})) {
          await doc.ref.update({
            status: "timeout",
            lastStatus: status,
            finishedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        } else {
          await doc.ref.update({lastStatus: status});
        }
        continue;
      }

      // Terminal — collect the briefing. The Files index can lag a beat behind
      // the session going idle, so a missing file isn't fatal until STALE_MS.
      const briefing = await fetchBriefing({fetchImpl: fetch, apiKey, sessionId});
      if (!briefing) {
        if (isDawnRunStale({startedMs, now})) {
          await doc.ref.update({
            status: "error",
            error: "Dawn finished but wrote no briefing file.",
            finishedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
        continue;
      }

      const {subject, body} = parseBriefing(briefing.text);
      let emailError = null;
      const to = dawnRecipient(run);
      if (to) {
        try {
          const sent = await emailBriefing({to, subject, body});
          if (!sent.ok) emailError = sent.reason;
        } catch (err) {
          emailError = truncateErrorMessage(err, 300);
        }
      } else {
        emailError = "no-recipient";
      }

      await doc.ref.update(buildDawnDoneUpdate({
        subject,
        body,
        briefing,
        to,
        emailError,
        finishedAt: admin.firestore.FieldValue.serverTimestamp(),
      }));
    } catch (err) {
      console.error(`Dawn delivery: session ${sessionId} failed`, err);
      // Don't wedge a run on a transient API hiccup — only fail it out once it
      // is clearly stuck.
      if (isDawnRunStale({startedMs, now})) {
        await doc.ref.update({
          status: "error",
          error: truncateErrorMessage(err, 300),
          finishedAt: admin.firestore.FieldValue.serverTimestamp(),
        }).catch(() => {});
      }
    }
  }
});

// Marshal — operations supervisor (every hour). Confirms each scheduled agent
// actually ran within its window, and surfaces stuck jobs, tripped breakers and
// recent failures, into a single company-health verdict. Deterministic, no LLM,
// no secrets — a handful of indexed reads. Writes an agentJobs rollup
// (awaiting_approval when something is wrong) the /admin/company HQ surfaces.
const SUPERVISOR_OPTS = {
  schedule: "every 1 hours",
  timeZone: "Africa/Lusaka",
  region: "us-central1",
  timeoutSeconds: 120,
  memory: "256MiB",
};

const hourlyAgentSupervisor = onSchedule(SUPERVISOR_OPTS, async () => {
  const db = admin.firestore();
  const start = Date.now();

  let report;
  try {
    report = await runMarshal({db});
  } catch (err) {
    console.error("Marshal failed", err);
    await db.collection("agentJobs").add(buildFailureJob({
      agentId: "marshal",
      department: "qaEng",
      runType: "hourly-supervisor",
      err,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      runMs: Date.now() - start,
    }));
    return;
  }

  await writeAgentRollup(db, admin.firestore.FieldValue,
      buildMarshalRollup({report, runMs: Date.now() - start}));
});

// Daily FX refresh (treasury). Fetches the ZMW/USD rate once a day and writes
// it to settings/fxRate so the budget governor + /admin/company read a fresh,
// cached rate without ever making a live network call. Range-checked before
// it's written; a bad fetch leaves the last good rate untouched. No agentJobs
// rollup — the settings/fxRate doc (with source + fetchedAt + lastError) is the
// record. Cheap: one HTTP GET + one write per day.
const FX_REFRESH_OPTS = {
  schedule: "every day 05:00",
  timeZone: "Africa/Lusaka",
  region: "us-central1",
  timeoutSeconds: 60,
  memory: "256MiB",
};

const dailyFxRefresh = onSchedule(FX_REFRESH_OPTS, async () => {
  const db = admin.firestore();
  const result = await refreshFxRate({db});
  if (result.ok) {
    console.log(`[fxRate] updated ZMW/USD = ${result.zmwPerUsd}`);
  } else {
    console.warn(`[fxRate] refresh failed: ${result.error}`);
  }
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
  deliverDawnBriefings,
  hourlyAgentSupervisor,
  dailyFxRefresh,
};
