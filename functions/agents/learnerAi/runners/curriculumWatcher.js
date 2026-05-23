/**
 * Curriculum Update Checker Agent — v2 (live).
 *
 * Daily scheduled job that visits a SHORT, hardcoded whitelist of
 * trusted Zambian curriculum/exam sources and checks for changes by
 * comparing each page's SHA256 against the last-seen value. When a
 * page changes, the agent writes one curriculumUpdateReports doc
 * with status:'pending_review' for an admin to review.
 *
 * Hard rules (from the user spec + CLAUDE.md):
 *   - The internet is for UPDATE CHECKING ONLY. No fetches outside
 *     the TRUSTED_SOURCES whitelist (helper `assertWhitelisted`
 *     refuses any other URL).
 *   - Reports are pending_review by default. We NEVER auto-apply
 *     updates — applying an update means re-running Curriculum
 *     Replace Studio + the admin's existing activation flow.
 *   - The agent NEVER writes to cbcKnowledgeBase, aiGeneratedContent,
 *     quizzes, or any learner-facing collection. Only writes to
 *     curriculumUpdateReports + the per-source state doc.
 *
 * State persistence:
 *   settings/curriculumUpdateSourceState carries one entry per source:
 *     { sources: { '<sourceId>': { lastChecksum, lastCheckedAt,
 *                                  lastReportId, lastStatus } } }
 *   Stored in one doc so we don't need a new Firestore collection.
 *
 * Frequency gating:
 *   Each source declares its own check frequency (weekly | monthly).
 *   The runner skips sources still within their cooldown window so
 *   the daily-scheduled function is cheap on average.
 *
 * CI safety:
 *   - When the environment can't make outbound HTTP (sandbox, local
 *     dev, CI without secrets) the runner falls back to recording
 *     an `unreachable` outcome per source. No crash; no fabricated
 *     "update" reports.
 *   - `fetchSource` honours a 10s timeout + 2MB body cap.
 */

const crypto = require("crypto");
const admin = require("firebase-admin");
const {
  writeAgentLog, writeSupervisorLog, updateLiveAgentState, writeTaskStep,
} = require("../logger");
const {COLLECTIONS, TASK_STEP_STATUS, SEVERITY} = require("../v2Collections");
const {loadAutomationSettings} = require("../automationGate");

const AGENT_ID = "curriculumWatcher";
const SUPERVISOR_DISPLAY = "Curriculum Update Checker Agent";

// ── Trusted source registry (hardcoded) ─────────────────────────────
//
// One entry per official source. URLs are the canonical landing pages;
// admins can deepen coverage later by adding subpath entries. NEVER
// extend this list with non-official URLs — the privacy + correctness
// rules depend on the whitelist being short and verifiable.
//
// frequency: 'weekly' | 'monthly'. The runner uses this to skip a
// source whose cooldown hasn't elapsed.

const TRUSTED_SOURCES = Object.freeze([
  {
    id: "moe-zambia",
    name: "Ministry of General Education (Zambia)",
    url: "https://www.moe.gov.zm/",
    trustLevel: "very_high",
    updateType: "syllabus",
    affectedGrades: [],     // all
    affectedSubjects: [],   // all
    frequency: "weekly",
  },
  {
    id: "cdc-zambia",
    name: "Curriculum Development Centre (Zambia)",
    url: "https://www.cdc.gov.zm/",
    trustLevel: "very_high",
    updateType: "syllabus",
    affectedGrades: [],
    affectedSubjects: [],
    frequency: "monthly",
  },
  {
    id: "ecz-zambia",
    name: "Examinations Council of Zambia (ECZ)",
    url: "https://www.exams-council.org.zm/",
    trustLevel: "very_high",
    updateType: "exam_timetable",
    affectedGrades: ["7", "9", "12"],   // ECZ exam grades
    affectedSubjects: [],
    frequency: "weekly",
  },
]);

const FREQUENCY_MS = Object.freeze({
  weekly:  7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
});

const SOURCE_STATE_DOC = "settings/curriculumUpdateSourceState";

// ── Privacy guard ───────────────────────────────────────────────────

const ALLOWED_URLS = new Set(TRUSTED_SOURCES.map((s) => s.url));

function assertWhitelisted(url) {
  if (typeof url !== "string" || !ALLOWED_URLS.has(url)) {
    throw new Error(`refused_non_whitelisted_url:${String(url).slice(0, 80)}`);
  }
}

// ── State persistence ───────────────────────────────────────────────

async function loadSourceState() {
  try {
    const snap = await admin.firestore().doc(SOURCE_STATE_DOC).get();
    if (!snap.exists) return {sources: {}};
    return snap.data() || {sources: {}};
  } catch (err) {
    console.warn("[curriculumWatcher] state load failed", err && err.message);
    return {sources: {}};
  }
}

async function persistSourceState(state) {
  try {
    await admin.firestore().doc(SOURCE_STATE_DOC).set({
      ...state,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
  } catch (err) {
    console.warn("[curriculumWatcher] state persist failed", err && err.message);
  }
}

// ── HTTP fetch with size + time caps ────────────────────────────────

const FETCH_TIMEOUT_MS = 10_000;
const BODY_BYTE_CAP = 2 * 1024 * 1024; // 2 MB
const USER_AGENT = "ZedExams-CurriculumWatcher/1.0 (+https://zedexams.com)";

async function fetchSource(url) {
  assertWhitelisted(url);
  if (typeof fetch !== "function") {
    // CI / sandbox without global fetch — return unreachable.
    return {ok: false, reason: "fetch_unavailable_in_runtime"};
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {"User-Agent": USER_AGENT, "Accept": "text/html, */*;q=0.5"},
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res || !res.ok) {
      return {ok: false, reason: `http_${res ? res.status : "unknown"}`};
    }
    // Stream-read with byte cap so a huge response can't OOM us.
    const reader = res.body && typeof res.body.getReader === "function" ?
      res.body.getReader() : null;
    if (!reader) {
      const text = await res.text();
      const body = text.slice(0, BODY_BYTE_CAP);
      return {ok: true, body, etag: res.headers.get("etag") || null};
    }
    const chunks = [];
    let totalBytes = 0;
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      chunks.push(value);
      totalBytes += value.byteLength;
      if (totalBytes >= BODY_BYTE_CAP) break;
    }
    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const c of chunks) {
      combined.set(c.subarray(0, Math.min(c.byteLength, BODY_BYTE_CAP - offset)), offset);
      offset += c.byteLength;
      if (offset >= BODY_BYTE_CAP) break;
    }
    const body = new TextDecoder("utf-8", {fatal: false})
        .decode(combined.subarray(0, Math.min(offset, BODY_BYTE_CAP)));
    return {ok: true, body, etag: res.headers.get("etag") || null};
  } catch (err) {
    return {ok: false, reason: `fetch_error:${String(err && err.message || err).slice(0, 120)}`};
  } finally {
    clearTimeout(timer);
  }
}

// ── Diff + checksum ────────────────────────────────────────────────

function sha256Hex(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

/**
 * Heuristic summary of what changed. Without a full HTML diff parser
 * we offer a stable, low-noise message: bytes-changed, percentage
 * difference, and the first ~120 chars of the new body for context.
 * Admins use this + the sourceUrl + the report's checkedAt to decide
 * whether to open the source page manually.
 */
function summariseChange({source, oldBody, newBody}) {
  if (!oldBody) {
    return {
      summary: `First snapshot recorded for ${source.name}. ` +
        `${newBody.length} bytes. No prior baseline to compare against.`,
      recommendation: "Review the source manually to set the baseline; " +
        "future checks will diff against this snapshot.",
    };
  }
  const diff = Math.abs(newBody.length - oldBody.length);
  const pct = oldBody.length > 0 ?
    Math.round((diff / oldBody.length) * 100) : 100;
  const preview = newBody
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240);
  return {
    summary: `${source.name} page changed: ` +
      `${oldBody.length} → ${newBody.length} bytes (${pct}% size delta). ` +
      `Preview: "${preview.slice(0, 120)}…"`,
    recommendation: pct > 30 ?
      "LARGE delta. Review the source urgently — likely a syllabus or " +
        "exam-timetable update that needs reflecting in cbcKnowledgeBase + " +
        "approvedSyllabi." :
      "Small delta. Likely a minor edit — review and decide whether to " +
        "reflect in the curriculum.",
  };
}

// ── Per-source check ────────────────────────────────────────────────

/**
 * Skip-window helper. Sources declare a check frequency; the daily-
 * scheduled function calls this agent every day, but each source only
 * actually fetches when its window has elapsed.
 */
function dueForCheck({source, sourceState, nowMs, overrideFrequency}) {
  let lastMs = 0;
  if (sourceState) {
    if (sourceState.lastCheckedAt && typeof sourceState.lastCheckedAt.toMillis === "function") {
      lastMs = sourceState.lastCheckedAt.toMillis();
    } else if (typeof sourceState.lastCheckedAtMs === "number") {
      lastMs = sourceState.lastCheckedAtMs;
    }
  }
  if (!lastMs) return true;
  // Admin override (from aiAutomationSettings.curriculumUpdateCheckFrequency)
  // wins over per-source defaults so admins can stretch every source
  // to monthly without redeploying.
  const freq = overrideFrequency || source.frequency;
  const window = FREQUENCY_MS[freq] || FREQUENCY_MS.weekly;
  return (nowMs - lastMs) >= window;
}

async function checkOneSource({source, sourceState, nowMs, overrideFrequency}) {
  if (!dueForCheck({source, sourceState, nowMs, overrideFrequency})) {
    return {sourceId: source.id, outcome: "skipped", reason: "cooldown", reportId: null};
  }

  const fetchResult = await fetchSource(source.url);
  if (!fetchResult.ok) {
    return {
      sourceId: source.id,
      outcome: "unreachable",
      reason: fetchResult.reason,
      reportId: null,
      checksum: null,
    };
  }

  const checksum = sha256Hex(fetchResult.body);
  const prior = sourceState && sourceState.lastChecksum;
  if (prior && prior === checksum) {
    return {
      sourceId: source.id, outcome: "unchanged", reason: null,
      reportId: null, checksum,
    };
  }

  // Changed (or first snapshot) — write a curriculumUpdateReports
  // doc. Admin must approve before applying.
  const {summary, recommendation} = summariseChange({
    source,
    oldBody: sourceState && sourceState.lastBodyHint,
    newBody: fetchResult.body,
  });
  const report = {
    sourceName: source.name,
    sourceUrl: source.url,
    trustLevel: source.trustLevel,
    updateType: source.updateType,
    affectedGrades: source.affectedGrades || [],
    affectedSubjects: source.affectedSubjects || [],
    summary,
    recommendation,
    status: "pending_review",
    checkedAt: admin.firestore.FieldValue.serverTimestamp(),
    reviewedBy: null,
    reviewedAt: null,
  };
  const ref = await admin.firestore()
      .collection(COLLECTIONS.CURRICULUM_REPORTS).add(report);

  // Supersede prior pending_review reports for the same source URL —
  // if the watcher ran twice for the same source without an admin
  // touching the first report, the OLD report is stale. Mirrors the
  // sibling-demote pattern dispatcher.js uses for aiGeneratedContent
  // when a fresh version is published. Best-effort: failure here
  // doesn't break the new report write.
  try {
    const siblings = await admin.firestore()
        .collection(COLLECTIONS.CURRICULUM_REPORTS)
        .where("sourceUrl", "==", source.url)
        .where("status", "==", "pending_review")
        .get();
    if (!siblings.empty) {
      const batch = admin.firestore().batch();
      let demoted = 0;
      for (const doc of siblings.docs) {
        if (doc.id === ref.id) continue;
        batch.update(doc.ref, {
          status: "superseded",
          supersededBy: ref.id,
          reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
          reviewedBy: "system:watcher",
        });
        demoted += 1;
      }
      if (demoted > 0) await batch.commit();
    }
  } catch (err) {
    console.warn("[curriculumWatcher] sibling supersede failed",
        err && err.message);
  }

  return {
    sourceId: source.id,
    outcome: prior ? "changed" : "first_snapshot",
    reason: null,
    reportId: ref.id,
    checksum,
    bodyHint: fetchResult.body.slice(0, 4000), // keep a short preview
  };
}

// ── Runner ──────────────────────────────────────────────────────────

async function runCurriculumWatcher({task} = {task: {id: `scheduled-${Date.now()}`}}) {
  const taskId = task && task.id || `scheduled-${Date.now()}`;

  await updateLiveAgentState(AGENT_ID, {
    agentName: SUPERVISOR_DISPLAY,
    status: "running", currentTaskId: taskId,
    currentTask: `Check ${TRUSTED_SOURCES.length} trusted sources`,
    progress: 0,
    lastMessage: "Loading per-source state",
  });
  await writeTaskStep({
    taskId, agentName: AGENT_ID, stepNumber: 1,
    stepTitle: "Curriculum update scan",
    message: `Visiting ${TRUSTED_SOURCES.length} trusted Zambian sources`,
    status: TASK_STEP_STATUS.RUNNING, progress: 25,
  });

  const state = await loadSourceState();
  const sourcesState = state.sources || {};
  const nowMs = Date.now();

  // Admin override for per-source frequency. Loaded once per run so
  // the value is stable across all sources within a single scan.
  const automationSettings = await loadAutomationSettings();
  const overrideFrequency = automationSettings &&
    typeof automationSettings.curriculumUpdateCheckFrequency === "string" ?
    automationSettings.curriculumUpdateCheckFrequency : null;

  const outcomes = [];
  const newState = {sources: {...sourcesState}};

  for (const source of TRUSTED_SOURCES) {
    const out = await checkOneSource({
      source, sourceState: sourcesState[source.id], nowMs, overrideFrequency,
    });
    outcomes.push(out);

    // Update state for this source (whether or not it changed).
    const existing = sourcesState[source.id] || {};
    const nextEntry = {
      ...existing,
      lastCheckedAtMs: nowMs,
      lastCheckedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastOutcome: out.outcome,
    };
    if (out.checksum) {
      nextEntry.lastChecksum = out.checksum;
      // Body hint persisted only when present (i.e. we actually fetched).
      if (out.bodyHint) nextEntry.lastBodyHint = out.bodyHint;
    }
    if (out.reportId) nextEntry.lastReportId = out.reportId;
    newState.sources[source.id] = nextEntry;

    await writeAgentLog({
      taskId, agentName: SUPERVISOR_DISPLAY,
      action: "source_check",
      message: `${source.id}: ${out.outcome}` +
        (out.reportId ? ` (report=${out.reportId})` : "") +
        (out.reason ? ` (${out.reason})` : ""),
      taskType: "curriculum_update_check",
      grade: null, subject: null, topic: null,
      severity: out.outcome === "changed" || out.outcome === "first_snapshot" ?
        SEVERITY.WARNING : SEVERITY.INFO,
    });
  }

  await persistSourceState(newState);

  // Per-run Supervisor log so admins can see the run summary without
  // opening each per-source log row.
  const changedCount = outcomes.filter((o) =>
    o.outcome === "changed" || o.outcome === "first_snapshot").length;
  const unreachableCount = outcomes.filter((o) => o.outcome === "unreachable").length;
  await writeSupervisorLog({
    taskId, agentName: SUPERVISOR_DISPLAY,
    contentType: "curriculum_update_scan",
    grade: "", subject: "", term: "",
    topic: "", subtopic: "",
    actionTaken: changedCount > 0 ? "sent_for_review" : "sent_for_review",
    reason: `Checked ${TRUSTED_SOURCES.length} sources: ` +
      `${changedCount} changed, ${unreachableCount} unreachable, ` +
      `${outcomes.filter((o) => o.outcome === "unchanged").length} unchanged, ` +
      `${outcomes.filter((o) => o.outcome === "skipped").length} skipped.`,
    confidenceScore: changedCount === 0 ? 1 : 0.5,
  });

  await writeTaskStep({
    taskId, agentName: AGENT_ID, stepNumber: 1,
    stepTitle: "Curriculum update scan",
    message: `${changedCount} change(s) detected, ${unreachableCount} unreachable`,
    status: TASK_STEP_STATUS.COMPLETED, progress: 100,
  });
  await updateLiveAgentState(AGENT_ID, {
    status: "completed", currentTaskId: null, progress: 100,
    lastMessage: `${changedCount} change(s) detected`,
  });

  return {
    ok: true,
    outcomes,
    changedCount, unreachableCount,
    reportIds: outcomes.filter((o) => o.reportId).map((o) => o.reportId),
  };
}

module.exports = {
  runCurriculumWatcher,
  // Pure helpers exported for unit tests + admin tooling.
  TRUSTED_SOURCES,
  FREQUENCY_MS,
  SOURCE_STATE_DOC,
  ALLOWED_URLS,
  assertWhitelisted,
  sha256Hex,
  summariseChange,
  dueForCheck,
  AGENT_ID,
  SUPERVISOR_DISPLAY,
};
