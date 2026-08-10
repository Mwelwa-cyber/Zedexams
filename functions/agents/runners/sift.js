/**
 * Sift — server-side error watcher (the I/O half; decisions live in siftCore.js).
 *
 * Reads the last window of ERROR-severity Cloud Logging entries for this
 * project's Cloud Functions, groups them by function, and raises ONE ops alert
 * when a function is failing repeatedly. Answers #2230's second half: before
 * this, a function burning 40 errors/hour surfaced only if somebody happened to
 * open Cloud Logging.
 *
 * ## Auth
 *
 * Application Default Credentials — the function's own runtime service account,
 * with `roles/logging.viewer` (or Editor, which includes
 * `logging.logEntries.list`). No secret, no key file: the credential is the
 * identity the instance already runs as.
 *
 * `google-auth-library` is already a `functions/` dependency (googlePlayBilling
 * uses it), and the Logging REST API is one POST — so this adds NO new package.
 * That is deliberate: every v2 instance loads the whole of `functions/index.js`
 * at ~148 MiB RSS before serving a request, and growing that baseline is how
 * apiTrackVisit died in the first place.
 *
 * ## The one rule
 *
 * A failed read is reported as `unavailable`, never as "no errors". Silence
 * from a tool that cannot see is not evidence of health — that inference is
 * what the issue was actually about.
 */

const {
  WINDOW_MS,
  buildLogFilter,
  summarizeErrorEntries,
  assessErrors,
  offenderKey,
  shouldNotify,
  buildAlert,
} = require("./siftCore");

const LOGGING_ENTRIES_URL = "https://logging.googleapis.com/v2/entries:list";
const LOGGING_SCOPE = "https://www.googleapis.com/auth/logging.read";

/**
 * Cap the rows pulled per run. A function in a hard crash-loop can emit
 * thousands of lines an hour; we only need enough to establish "this is broken
 * and here is how", and the counts are reported as "at least N" when we hit the
 * cap rather than being quietly presented as a total.
 */
const MAX_ENTRIES = 1000;
const PAGE_SIZE = 500;
const FETCH_TIMEOUT_MS = 20_000;

/** Where Sift remembers what it has already alerted about. Server-only. */
const STATE_DOC = "agentState/sift";

/** The project this instance is running in, however the runtime spells it. */
function resolveProjectId() {
  return (
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    (() => {
      try {
        return JSON.parse(process.env.FIREBASE_CONFIG || "{}").projectId || "";
      } catch (_e) {
        return "";
      }
    })()
  );
}

/** ADC access token for the Logging read scope. */
async function getLoggingToken() {
  const {GoogleAuth} = require("google-auth-library");
  const auth = new GoogleAuth({scopes: [LOGGING_SCOPE]});
  const client = await auth.getClient();
  const {token} = await client.getAccessToken();
  if (!token) throw new Error("ADC returned no access token for logging.read");
  return token;
}

async function postJson(url, {token, body, fetchImpl = fetch, timeoutMs = FETCH_TIMEOUT_MS}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : {};
    } catch (_e) {
      json = null;
    }
    if (!res.ok) {
      const detail = (json && json.error && json.error.message) || text.slice(0, 200);
      throw new Error(`logging entries:list ${res.status}: ${detail}`);
    }
    return json || {};
  } catch (err) {
    // Rewrite our own abort into an honest timeout — undici reports it as the
    // opaque "This operation was aborted." (same fix as monitor.js).
    if (err && (err.name === "AbortError" || ctrl.signal.aborted)) {
      throw new Error(`logging entries:list timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read up to MAX_ENTRIES ERROR entries in the window. Throws on failure — the
 * caller turns that into `unavailable`, which is an alertable state.
 *
 * @returns {Promise<{entries: object[], truncated: boolean}>}
 */
async function fetchErrorEntries({
  projectId,
  sinceIso,
  getToken = getLoggingToken,
  fetchImpl = fetch,
} = {}) {
  if (!projectId) throw new Error("no project id available to query logs for");
  const token = await getToken();
  const filter = buildLogFilter({sinceIso});

  const entries = [];
  let pageToken;
  do {
    const body = {
      resourceNames: [`projects/${projectId}`],
      filter,
      orderBy: "timestamp desc",
      pageSize: PAGE_SIZE,
    };
    if (pageToken) body.pageToken = pageToken;
    const page = await postJson(LOGGING_ENTRIES_URL, {token, body, fetchImpl});
    for (const e of page.entries || []) entries.push(e);
    pageToken = page.nextPageToken;
  } while (pageToken && entries.length < MAX_ENTRIES);

  return {
    entries: entries.slice(0, MAX_ENTRIES),
    truncated: entries.length >= MAX_ENTRIES,
  };
}

/** Read Sift's per-key alert memory. Never throws — a lost memory re-alerts. */
async function readAlertState(db) {
  try {
    const snap = await db.doc(STATE_DOC).get();
    const data = (snap.exists && snap.data()) || {};
    return data.keys || {};
  } catch (err) {
    console.warn("[sift] could not read alert state:", err && err.message);
    return {};
  }
}

/**
 * Run one sweep.
 *
 * Structure mirrors Vigil: deterministic checks, alert only on a real finding,
 * de-duplicated per key per 24h. No LLM — a count of errors by function does
 * not need a model to interpret, and the alert must work when Anthropic is down.
 *
 * @param {object} args
 * @param {object} args.db          Firestore (admin SDK)
 * @param {Function} [args.notify]  sendOpsAlert-shaped; injected in tests
 * @param {number} [args.now]
 * @returns {Promise<object>} the report the rollup carries
 */
async function runSift({
  db,
  notify,
  now = Date.now(),
  windowMs = WINDOW_MS,
  fetchEntries = fetchErrorEntries,
  projectId = resolveProjectId(),
} = {}) {
  const sinceIso = new Date(now - windowMs).toISOString();

  let summary = null;
  let unavailable = null;
  let truncated = false;
  try {
    const read = await fetchEntries({projectId, sinceIso});
    truncated = read.truncated;
    summary = summarizeErrorEntries(read.entries);
  } catch (err) {
    unavailable = String((err && err.message) || err);
  }

  const assessment = assessErrors({summary, unavailable});
  const report = {
    windowMs,
    sinceIso,
    projectId,
    truncated,
    ok: assessment.ok,
    severity: assessment.severity,
    total: assessment.total,
    unavailable: assessment.unavailable,
    offenders: assessment.offenders,
    notified: [],
    suppressed: [],
  };

  if (assessment.ok) return report;

  // One alert per run, but dedupe per FINDING: a run whose every offender is
  // still inside its cooldown sends nothing, while a newly-broken function in
  // the same run still gets through.
  const state = await readAlertState(db);
  const keys = assessment.unavailable ?
    [{key: "unavailable", severity: assessment.severity}] :
    assessment.offenders.map((o) => ({key: offenderKey(o), severity: o.severity}));

  const fresh = [];
  for (const k of keys) {
    const decision = shouldNotify({severity: k.severity, previous: state[k.key], now});
    if (decision.notify) fresh.push({...k, reason: decision.reason});
    else report.suppressed.push(k.key);
  }

  if (!fresh.length) return report;

  const {title, lines} = buildAlert({assessment, windowMs, projectId});
  if (truncated) {
    lines.push("", `(Entry cap reached — counts are at least this, not exactly.)`);
  }

  const send = notify || require("../../opsAlert").sendOpsAlert;
  try {
    const result = await send({title, lines, severity: assessment.severity});
    report.delivery = {
      delivered: Boolean(result && result.delivered),
      channels: (result && result.channels) || null,
    };
  } catch (err) {
    // Best-effort, like every other alert path — a failed send must not lose
    // the rollup, which is the second place this surfaces (/admin/agents).
    report.delivery = {delivered: false, error: String((err && err.message) || err).slice(0, 200)};
  }

  // Only record keys we actually attempted, so a send that threw before
  // reaching either channel does not start a 24h silence about a live problem.
  if (report.delivery && report.delivery.delivered) {
    const update = {};
    for (const k of fresh) {
      update[`keys.${k.key}`] = {severity: k.severity, notifiedAtMs: now};
      report.notified.push(k.key);
    }
    try {
      await db.doc(STATE_DOC).set({keys: {}}, {merge: true});
      await db.doc(STATE_DOC).update(update);
    } catch (err) {
      console.warn("[sift] could not persist alert state:", err && err.message);
    }
  }

  return report;
}

module.exports = {
  STATE_DOC,
  MAX_ENTRIES,
  resolveProjectId,
  fetchErrorEntries,
  runSift,
};
