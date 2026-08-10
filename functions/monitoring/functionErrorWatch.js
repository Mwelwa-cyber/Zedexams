"use strict";

/**
 * Cloud Functions error monitoring — the I/O around
 * `functionErrorWatchCore.js`'s decisions.
 *
 * Reads Cloud Logging, keeps the between-runs state in Firestore, and routes
 * anything worth saying through the EXISTING `sendOpsAlert` channel (email
 * always, plus the opt-in webhook) rather than inventing a second one. That
 * channel is already real and already proven to ring — `sendTestOpsAlert` is
 * what caught #1991 — so "a real owner notification channel" is a wiring job
 * here, not a build.
 *
 * ## Why Cloud Logging and not Sentry
 *
 * Sentry is frontend-only in this repo: `Sentry.init` appears solely in
 * `src/utils/sentry.js` and nothing under `functions/` references it. On
 * 2026-08-09 Sentry reported zero errors across a window in which Cloud
 * Logging held 80. Sentry was not broken — it simply cannot see a Cloud
 * Function. Cloud Logging is the only place these errors exist.
 *
 * ## Fail-closed, loudly
 *
 * If the log query itself fails, this alerts. A monitor that cannot see is not
 * a monitor reporting "clean" — that is the precise shape of the failure it was
 * built to correct, one level up. Silence from this function must only ever
 * mean "there was nothing to say".
 *
 * ## No new heavy dependency
 *
 * `google-auth-library` is already present (firebase-admin depends on it) and
 * is now declared directly rather than borrowed transitively. The Logging REST
 * API is called with `fetch`; `@google-cloud/logging` would add a large client
 * for one `entries:list` call.
 */
// NO `firebase-functions`, and no `google-auth-library` at module load.
//
// The repo convention (see accountDeletionFlow.js) is that a module carrying
// decisions is unit-tested under the ROOT install, which has firebase-admin but
// not firebase-functions — so a top-level require of it makes the module
// untestable in the `Tests (Functions coverage)` job, which runs `npm ci` at the
// root only. The `onSchedule` builder therefore lives in index.js, which is also
// where Phase 5 wants every builder so the frozen-surface guard can read its
// options.
//
// `google-auth-library` is deferred for a second reason: it is only needed to
// actually query Cloud Logging, so requiring it at load would put it on the cold
// start of every instance — and cold-start cost is precisely what this incident
// was about.
const admin = require("firebase-admin");

const {sendOpsAlert} = require("../opsAlert");
const {decideAlerts, buildAlertMessage} = require("./functionErrorWatchCore");

/** Where the between-runs state lives. Server-only in firestore.rules. */
const STATE_DOC = "opsMonitorState/functionErrors";

/**
 * Proof that a run HAPPENED, separate from what it found.
 *
 * This watch's healthy output is silence, so a scheduled invocation that never
 * completes looks exactly like a quiet window — the query was built fail-closed
 * and the invocation was left fail-open. The heartbeat is what tells those
 * apart: stamped on every completion including a blind one, and watched by
 * `opsHeartbeatCheck`'s dead-man's switch (opsHeartbeatCore.js HEARTBEATS).
 *
 * A separate document from STATE_DOC on purpose — a blind run must record that
 * it ran without touching the streak counters and cooldowns, which it has no
 * fresh information about.
 */
const HEARTBEAT_DOC = "opsMonitorState/functionErrorsHeartbeat";

/**
 * How large a gap between runs is worth reporting. The schedule is 5 minutes;
 * past this the watch was NOT running, and whatever happened in the gap went
 * unobserved. Reported retroactively on the next successful run — the
 * dead-man's switch catches a watch that never comes back, this catches one
 * that does and names the window nobody was looking at.
 */
const GAP_ALERT_MS = 20 * 60_000;

/** How far back each run looks. Slightly wider than the schedule, so a late
 * log entry is not lost in the seam between two windows; the per-function
 * cooldown absorbs the resulting double-count. */
const WINDOW_MINUTES = 7;

const LOGGING_ENDPOINT = "https://logging.googleapis.com/v2/entries:list";
const SCOPE = "https://www.googleapis.com/auth/logging.read";

/**
 * The Cloud Logging filter.
 *
 * Both generations are covered: v2 functions run on Cloud Run
 * (`cloud_run_revision`, name in `service_name`), v1 functions report as
 * `cloud_function` (name in `function_name`). Watching only one would leave a
 * whole generation unmonitored — the same mistake the memory-floor guard made
 * before #2233.
 */
function buildFilter(sinceIso) {
  return [
    'resource.type=("cloud_run_revision" OR "cloud_function")',
    "severity>=ERROR",
    `timestamp>="${sinceIso}"`,
  ].join(" AND ");
}

/** Function name from either generation's label shape. */
function functionNameOf(entry) {
  const labels = entry?.resource?.labels ?? {};
  return labels.service_name || labels.function_name || "";
}

/** The human-readable message, whichever field carries it. */
function messageOf(entry) {
  if (typeof entry?.textPayload === "string") return entry.textPayload;
  const j = entry?.jsonPayload;
  if (j) return String(j.message ?? j.msg ?? JSON.stringify(j)).slice(0, 2000);
  if (entry?.protoPayload?.status?.message) return String(entry.protoPayload.status.message);
  return "";
}

/**
 * Fetch ERROR-and-above entries for the window. Throws on failure — the caller
 * turns that into an alert rather than a silent zero.
 */
async function fetchErrorEntries({projectId, sinceIso, auth, fetchImpl = fetch, pageSize = 500}) {
  // Deferred require: see the module header.
  const {GoogleAuth} = require("google-auth-library");
  const client = auth ?? new GoogleAuth({scopes: [SCOPE]});
  const token = await client.getAccessToken();
  const accessToken = typeof token === "string" ? token : token?.token;
  if (!accessToken) throw new Error("could not obtain an access token for Cloud Logging");

  const res = await fetchImpl(LOGGING_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      resourceNames: [`projects/${projectId}`],
      filter: buildFilter(sinceIso),
      orderBy: "timestamp desc",
      pageSize,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Cloud Logging entries:list ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  return (data.entries ?? []).map((e) => ({
    functionName: functionNameOf(e),
    message: messageOf(e),
    severity: e.severity,
    timestamp: e.timestamp,
  }));
}

/**
 * One monitoring pass.
 *
 * `injectedEntries` exists for the synthetic test, and is the reason that test
 * is worth anything: it runs THIS function, with the real decision logic, the
 * real state document and the real alert channel. A synthetic test that built
 * its own message and sent it directly would prove the mailer works and
 * nothing about whether an actual OOM would reach anyone.
 *
 * @param {object} [deps]
 * @return {Promise<object>} A summary for the caller/logs.
 */
async function runFunctionErrorWatch(deps = {}) {
  const db = deps.db ?? admin.firestore();
  const now = deps.now ?? Date.now();
  const alertFn = deps.sendOpsAlert ?? sendOpsAlert;
  const projectId = deps.projectId ?? process.env.GCLOUD_PROJECT ?? "";
  const stateRef = db.doc(deps.stateDoc ?? STATE_DOC);
  const heartbeatRef = db.doc(deps.heartbeatDoc ?? HEARTBEAT_DOC);

  // Read BEFORE the run so a gap is measured against the previous completion.
  let previousRunAt = null;
  try {
    const hb = await heartbeatRef.get();
    const prev = hb.exists ? Date.parse(hb.data()?.checkedAt ?? "") : NaN;
    if (Number.isFinite(prev)) previousRunAt = prev;
  } catch { /* no heartbeat yet, or unreadable — treated as "no previous run" */ }

  /** Stamp the run. `checkedAt` is one of opsHeartbeatCore's TS_FIELDS. */
  const stampHeartbeat = async (outcome) => {
    try {
      await heartbeatRef.set({
        checkedAt: new Date(now).toISOString(),
        outcome,
      }, {merge: true});
    } catch (err) {
      console.error("[functionErrorWatch] heartbeat write failed:", err?.message || err);
    }
  };

  const sinceIso = new Date(now - WINDOW_MINUTES * 60_000).toISOString();

  let entries;
  let queryFailed = null;
  if (deps.injectedEntries) {
    entries = deps.injectedEntries;
  } else {
    try {
      entries = await (deps.fetchErrorEntries ?? fetchErrorEntries)({
        projectId, sinceIso, auth: deps.auth, fetchImpl: deps.fetchImpl,
      });
    } catch (err) {
      queryFailed = err?.message || String(err);
      entries = [];
    }
  }

  // A monitor that cannot see must say so. Reporting "0 errors" here would be
  // the same false green that let 80 errors pass unnoticed.
  if (queryFailed) {
    await alertFn({
      title: "Cloud Functions monitoring is BLIND",
      severity: "critical",
      lines: [
        "The error watch could not read Cloud Logging, so this run checked nothing.",
        `Reason: ${queryFailed}`,
        "Treat backend health as UNKNOWN until this is fixed — not as healthy.",
        "Likely causes: the functions service account lacks roles/logging.viewer,",
        "or the Logging API is disabled for the project.",
      ],
      smtpUser: process.env.EMAIL_SMTP_USER,
      smtpPassword: process.env.EMAIL_SMTP_PASSWORD,
      opsAlertEmails: process.env.OPS_ALERT_EMAILS,
      adminEmails: process.env.ADMIN_EMAILS,
      webhookUrl: process.env.OPS_ALERT_WEBHOOK_URL,
    });
    await stampHeartbeat("blind");
    return {ok: false, blind: true, reason: queryFailed};
  }

  const prevSnap = await stateRef.get().catch(() => null);
  const state = prevSnap?.exists ? prevSnap.data() : {};

  const {alerts, nextState, summary} = decideAlerts({entries, state, now});
  const message = buildAlertMessage(alerts, summary);

  if (message) {
    await alertFn({
      ...message,
      smtpUser: process.env.EMAIL_SMTP_USER,
      smtpPassword: process.env.EMAIL_SMTP_PASSWORD,
      opsAlertEmails: process.env.OPS_ALERT_EMAILS,
      adminEmails: process.env.ADMIN_EMAILS,
      webhookUrl: process.env.OPS_ALERT_WEBHOOK_URL,
    });
  }

  await stateRef.set(nextState, {merge: false});

  // A gap means this watch was NOT running, and nothing observed the functions
  // during it. Reported on the run that comes back, naming the window, because
  // "the alerts were quiet" and "nobody was listening" are the same silence
  // until someone says which it was.
  const gapMs = previousRunAt == null ? null : now - previousRunAt;
  if (gapMs != null && gapMs > GAP_ALERT_MS) {
    await alertFn({
      title: "Cloud Functions monitoring had a COVERAGE GAP",
      severity: "warning",
      lines: [
        `The error watch did not run between ${new Date(previousRunAt).toISOString()} ` +
        `and ${new Date(now).toISOString()} (${Math.round(gapMs / 60000)} minutes).`,
        "It is running again now, and this window was not checked — any function",
        "that failed during it produced no alert.",
        "Cloud Logging still holds those entries; the gap is in the watching, not the data.",
      ],
      smtpUser: process.env.EMAIL_SMTP_USER,
      smtpPassword: process.env.EMAIL_SMTP_PASSWORD,
      opsAlertEmails: process.env.OPS_ALERT_EMAILS,
      adminEmails: process.env.ADMIN_EMAILS,
      webhookUrl: process.env.OPS_ALERT_WEBHOOK_URL,
    });
  }

  await stampHeartbeat(message ? "alerted" : "clean");

  console.log(`[functionErrorWatch] ${JSON.stringify({
    ...summary, alerts: alerts.length, gapMinutes: gapMs == null ? null : Math.round(gapMs / 60000),
  })}`);
  return {ok: true, alerted: Boolean(message), alerts, summary, gapMs};
}

module.exports = {
  runFunctionErrorWatch,
  HEARTBEAT_DOC,
  GAP_ALERT_MS,
  fetchErrorEntries,
  buildFilter,
  functionNameOf,
  messageOf,
  STATE_DOC,
  WINDOW_MINUTES,
};
