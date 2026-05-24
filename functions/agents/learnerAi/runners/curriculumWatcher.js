/**
 * Curriculum Update Checker + Ingester Agent — v3.
 *
 * Daily scheduled job that visits a SHORT, hardcoded whitelist of
 * trusted Zambian curriculum/exam sources, detects changes by
 * comparing each page's SHA256 against the last-seen value, and —
 * when a page is new or has changed — discovers, downloads, parses,
 * embeds, and stages curriculum modules into the same `curriculum/*`
 * and `rag_chunks/*` collections the manual `npm run cbc:ingest`
 * script populates. The teacher-tool generators read those via
 * `resolveCbcContext()` so new modules flow into lesson plans,
 * worksheets, and quizzes the moment the agent stores them.
 *
 * Hard rules (from the user spec + CLAUDE.md):
 *   - Outbound HTTP is restricted to the hostname allowlist
 *     (`ALLOWED_HOSTS`). `assertWhitelisted(url)` refuses anything
 *     outside it. The list is hardcoded in this file — never
 *     accept a URL from user input or another collection.
 *   - The agent NEVER writes to cbcKnowledgeBase. Promotion of an
 *     ingested curriculum doc into the canonical KB (the dropdowns
 *     the SPA uses) still requires an admin click in the KB editor.
 *   - The agent NEVER writes to aiGeneratedContent or quizzes. Only
 *     curriculum/, rag_chunks/, curriculumUpdateReports, and the
 *     per-source state doc.
 *   - `curriculumUpdateReports` rows are always created with
 *     status:'pending_review' so the existing admin review UI keeps
 *     working as a manifest of what landed.
 *
 * State persistence:
 *   settings/curriculumUpdateSourceState carries one entry per source:
 *     { sources: { '<sourceId>': { lastChecksum, lastCheckedAt,
 *                                  lastReportId, lastStatus,
 *                                  lastIngestedModules } } }
 *
 * Frequency gating:
 *   Each source declares its own check frequency (weekly | monthly).
 *   The runner skips sources still within their cooldown window.
 *
 * CI / sandbox safety:
 *   - `if (typeof fetch !== 'function')` short-circuit: when global
 *     fetch isn't available (older Node, locked-down CI), the runner
 *     records `unreachable` for every source instead of crashing.
 *   - 10s timeout + 2MB body cap per fetch.
 *   - Per-run cap on total downloaded bytes + files (see
 *     RUN_BYTE_CAP / RUN_FILE_CAP).
 *   - 1s delay between sub-fetches inside a single source to be
 *     polite to the upstream server.
 */

const crypto = require("crypto");
const admin = require("firebase-admin");
const {
  writeAgentLog, writeSupervisorLog, updateLiveAgentState, writeTaskStep,
} = require("../logger");
const {COLLECTIONS, TASK_STEP_STATUS, SEVERITY} = require("../v2Collections");
const {loadAutomationSettings} = require("../automationGate");
const ingester = require("./curriculumIngester");

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
    crawlEnabled: false,
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
    crawlEnabled: false,
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
    crawlEnabled: false,
  },
  {
    id: "cdc-repository",
    name: "CDC Curriculum Repository (Zambia)",
    url: "https://library.cdcrepository.info/",
    trustLevel: "very_high",
    updateType: "syllabus_modules",
    affectedGrades: [],
    affectedSubjects: [],
    frequency: "weekly",
    // Crawl one level deep into same-host links to pick up
    // syllabus PDFs and module download pages.
    crawlEnabled: true,
  },
  {
    id: "moe-edu-zm-syllabi",
    name: "Ministry of Education — Syllabus Index (edu.gov.zm)",
    url: "https://www.edu.gov.zm/?page_id=1142",
    trustLevel: "very_high",
    updateType: "syllabus_modules",
    affectedGrades: [],
    affectedSubjects: [],
    frequency: "weekly",
    crawlEnabled: true,
  },
]);

const FREQUENCY_MS = Object.freeze({
  weekly:  7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
});

const SOURCE_STATE_DOC = "settings/curriculumUpdateSourceState";

// ── Privacy guard ───────────────────────────────────────────────────
//
// Two-tier allowlist:
//   ALLOWED_URLS  — exact landing-page URLs the watcher checksums.
//                   Cheap to validate, preserves the original
//                   "no random URL ever" guarantee for checksumming.
//   ALLOWED_HOSTS — hostnames the *ingester* may follow same-host
//                   links into. Strictly broader than ALLOWED_URLS,
//                   but never accepts a hostname that isn't already
//                   declared in TRUSTED_SOURCES. Crawl-enabled sources
//                   opt in via `crawlEnabled: true` so existing
//                   change-detection-only sources don't accidentally
//                   start downloading sub-pages.

const ALLOWED_URLS = new Set(TRUSTED_SOURCES.map((s) => s.url));

const ALLOWED_HOSTS = new Set(
    TRUSTED_SOURCES
        .map((s) => {
          try { return new URL(s.url).hostname.toLowerCase(); }
          catch { return null; }
        })
        .filter(Boolean),
);

function assertWhitelisted(url) {
  if (typeof url !== "string" || !url) {
    throw new Error(`refused_non_whitelisted_url:${String(url).slice(0, 80)}`);
  }
  if (ALLOWED_URLS.has(url)) return;
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    throw new Error(`refused_non_whitelisted_url:${url.slice(0, 80)}`);
  }
  if (!ALLOWED_HOSTS.has(host)) {
    throw new Error(`refused_non_whitelisted_url:${url.slice(0, 80)}`);
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

// Per-run global caps. The crawler tracks downloads against these so a
// runaway link-soup page can't blow up an agent invocation.
const RUN_BYTE_CAP = 100 * 1024 * 1024;   // 100 MB combined per run
const RUN_FILE_CAP = 200;                  // 200 sub-fetches per run
const SOURCE_FILE_CAP = 50;                // 50 sub-fetches per source
const POLITE_DELAY_MS = 1000;              // 1s between same-source fetches

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

/**
 * Like fetchSource but returns the raw bytes (Buffer) — needed for
 * PDF/DOCX downloads where decoding to UTF-8 would corrupt the file.
 * Same time + size caps + whitelist guard as fetchSource.
 */
async function fetchBinary(url) {
  assertWhitelisted(url);
  if (typeof fetch !== "function") {
    return {ok: false, reason: "fetch_unavailable_in_runtime"};
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {"User-Agent": USER_AGENT, "Accept": "*/*"},
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res || !res.ok) {
      return {ok: false, reason: `http_${res ? res.status : "unknown"}`};
    }
    const ab = await res.arrayBuffer();
    const capped = ab.byteLength > BODY_BYTE_CAP ?
      ab.slice(0, BODY_BYTE_CAP) : ab;
    return {
      ok: true,
      buffer: Buffer.from(capped),
      byteLength: capped.byteLength,
      contentType: res.headers.get("content-type") || "",
    };
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

// ── Ingestion (download + parse + embed + stage) ────────────────────

async function sleep(ms) {
  if (ms <= 0) return;
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * One module: download → parse → classify → chunk → embed → build
 * Firestore docs. Returns `{ curriculumDoc, ragDocs, meta }` on
 * success. Skips politely on size cap / missing parser / fetch error
 * and returns `{ skipped: true, reason }` so the caller can log it.
 */
async function ingestOneModule({source, link, runBudget}) {
  if (runBudget.bytesUsed >= RUN_BYTE_CAP || runBudget.filesUsed >= RUN_FILE_CAP) {
    return {skipped: true, reason: "run_budget_exhausted"};
  }
  let fetched;
  if (link.kind === "html") {
    const r = await fetchSource(link.url);
    if (!r.ok) return {skipped: true, reason: r.reason};
    fetched = {buffer: null, text: r.body, byteLength: r.body.length};
  } else {
    const r = await fetchBinary(link.url);
    if (!r.ok) return {skipped: true, reason: r.reason};
    fetched = {buffer: r.buffer, text: null, byteLength: r.byteLength};
  }
  runBudget.bytesUsed += fetched.byteLength;
  runBudget.filesUsed += 1;

  const parsed = await ingester.parseDocument(
      link.kind === "html" ? fetched.text : fetched.buffer,
      link.kind,
  );
  if (parsed.unsupported || parsed.error) {
    return {skipped: true,
      reason: parsed.reason || parsed.error || "parse_unsupported"};
  }
  if (!parsed.text || parsed.text.length < 200) {
    return {skipped: true, reason: "parse_text_too_short"};
  }

  const classification = ingester.classifyModule({
    url: link.url,
    anchorText: link.anchorText,
    headings: parsed.headings,
    firstChars: parsed.text.slice(0, 4000),
  });

  const chunks = ingester.chunkText(parsed.text);
  if (chunks.length === 0) {
    return {skipped: true, reason: "no_chunks"};
  }

  const apiKey = process.env.OPENAI_API_KEY || null;
  const embedded = await ingester.embedChunks(chunks, apiKey);

  const meta = {
    sourceId: source.id,
    sourceName: source.name,
    sourceUrl: link.url,
    kind: link.kind,
    anchorText: link.anchorText,
    grade: classification.grade,
    subject: classification.subject,
    term: classification.term,
    topic: classification.topic,
    confidence: classification.confidence,
    byteLength: fetched.byteLength,
    chunkCount: embedded.length,
  };
  const curriculumDoc = ingester.buildCurriculumDoc(meta);
  const ragDocs = ingester.buildRagChunkDocs(curriculumDoc.id, embedded, meta);
  return {curriculumDoc, ragDocs, meta};
}

/**
 * Walk a source's landing-page body for sub-page links, fetch each
 * up to SOURCE_FILE_CAP, persist successful ingests as `curriculum/*`
 * and `rag_chunks/*` docs, and return a manifest the caller attaches
 * to the curriculumUpdateReports row.
 */
async function ingestSource({source, body, runBudget}) {
  if (!source.crawlEnabled) {
    return {modules: [], skippedCrawl: true};
  }
  const links = ingester.discoverModuleLinks(body, source.url);
  // Only follow same-host links (ALLOWED_HOSTS will accept them via
  // assertWhitelisted, but cross-host links would throw).
  const sourceHost = (() => {
    try { return new URL(source.url).hostname.toLowerCase(); }
    catch { return ""; }
  })();
  const sameHost = links.filter((l) => {
    try { return new URL(l.url).hostname.toLowerCase() === sourceHost; }
    catch { return false; }
  });
  const cap = Math.min(sameHost.length, SOURCE_FILE_CAP);

  const modulesManifest = [];
  const db = admin.firestore();

  for (let i = 0; i < cap; i++) {
    const link = sameHost[i];
    if (runBudget.bytesUsed >= RUN_BYTE_CAP || runBudget.filesUsed >= RUN_FILE_CAP) {
      break;
    }
    if (i > 0) await sleep(POLITE_DELAY_MS);

    let outcome;
    try {
      outcome = await ingestOneModule({source, link, runBudget});
    } catch (err) {
      modulesManifest.push({
        url: link.url, kind: link.kind, anchorText: link.anchorText,
        skipped: true, reason: `ingest_error:${(err && err.message || "").slice(0, 120)}`,
      });
      continue;
    }
    if (outcome.skipped) {
      modulesManifest.push({
        url: link.url, kind: link.kind, anchorText: link.anchorText,
        skipped: true, reason: outcome.reason,
      });
      continue;
    }

    // Persist. curriculum doc is keyed deterministically (sha256 of
    // sourceUrl) so re-runs overwrite cleanly. rag_chunks are batched.
    try {
      await db.collection("curriculum").doc(outcome.curriculumDoc.id).set({
        ...outcome.curriculumDoc.data,
        importedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});

      const ragBatchSize = 400;
      for (let j = 0; j < outcome.ragDocs.length; j += ragBatchSize) {
        const slice = outcome.ragDocs.slice(j, j + ragBatchSize);
        const batch = db.batch();
        for (const c of slice) {
          batch.set(db.collection("rag_chunks").doc(c.id), {
            ...c.data,
            ingested_at: admin.firestore.FieldValue.serverTimestamp(),
          }, {merge: true});
        }
        await batch.commit();
      }

      modulesManifest.push({
        docId: outcome.curriculumDoc.id,
        url: link.url,
        kind: link.kind,
        anchorText: link.anchorText,
        grade: outcome.meta.grade,
        subject: outcome.meta.subject,
        term: outcome.meta.term,
        topic: outcome.meta.topic,
        confidence: outcome.meta.confidence,
        chunkCount: outcome.meta.chunkCount,
      });
    } catch (err) {
      modulesManifest.push({
        url: link.url, kind: link.kind, anchorText: link.anchorText,
        skipped: true,
        reason: `persist_error:${(err && err.message || "").slice(0, 120)}`,
      });
    }
  }

  return {
    modules: modulesManifest,
    linksDiscovered: links.length,
    linksAttempted: cap,
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

async function checkOneSource({source, sourceState, nowMs, overrideFrequency, runBudget}) {
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

  // Changed (or first snapshot) — ingest first so the report carries
  // the module manifest, then write the report.
  let ingestResult = {modules: [], linksDiscovered: 0, linksAttempted: 0};
  if (source.crawlEnabled && runBudget) {
    try {
      ingestResult = await ingestSource({
        source, body: fetchResult.body, runBudget,
      });
    } catch (err) {
      console.warn("[curriculumWatcher] ingestSource threw",
          err && err.message);
      ingestResult.error = String(err && err.message || err).slice(0, 200);
    }
  }
  const ingestedOk = ingestResult.modules.filter((m) => !m.skipped).length;
  const ingestedSkipped = ingestResult.modules.filter((m) => m.skipped).length;

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
    // Ingestion manifest — the staged modules teachers' generators
    // can already see via resolveCbcContext()'s RAG path. The admin
    // review UI surfaces this so a human can promote (or reject)
    // individual modules into the canonical cbcKnowledgeBase.
    ingestedModules: ingestResult.modules,
    ingestedModuleCount: ingestedOk,
    ingestedSkippedCount: ingestedSkipped,
    linksDiscovered: ingestResult.linksDiscovered || 0,
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
    ingestedModuleCount: ingestedOk,
    ingestedSkippedCount: ingestedSkipped,
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
  // Run-level budget shared across all sources for this invocation.
  // Mutated by ingestOneModule as it downloads files.
  const runBudget = {bytesUsed: 0, filesUsed: 0};

  for (const source of TRUSTED_SOURCES) {
    const out = await checkOneSource({
      source, sourceState: sourcesState[source.id], nowMs,
      overrideFrequency, runBudget,
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
    if (typeof out.ingestedModuleCount === "number") {
      nextEntry.lastIngestedModuleCount = out.ingestedModuleCount;
    }
    newState.sources[source.id] = nextEntry;

    await writeAgentLog({
      taskId, agentName: SUPERVISOR_DISPLAY,
      action: "source_check",
      message: `${source.id}: ${out.outcome}` +
        (out.reportId ? ` (report=${out.reportId})` : "") +
        (out.ingestedModuleCount ? ` (ingested=${out.ingestedModuleCount})` : "") +
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
  const ingestedTotal = outcomes.reduce((n, o) =>
    n + (o.ingestedModuleCount || 0), 0);
  await writeSupervisorLog({
    taskId, agentName: SUPERVISOR_DISPLAY,
    contentType: "curriculum_update_scan",
    grade: "", subject: "", term: "",
    topic: "", subtopic: "",
    actionTaken: changedCount > 0 ? "sent_for_review" : "sent_for_review",
    reason: `Checked ${TRUSTED_SOURCES.length} sources: ` +
      `${changedCount} changed, ${unreachableCount} unreachable, ` +
      `${outcomes.filter((o) => o.outcome === "unchanged").length} unchanged, ` +
      `${outcomes.filter((o) => o.outcome === "skipped").length} skipped. ` +
      `Ingested ${ingestedTotal} module(s) into curriculum/ + rag_chunks/. ` +
      `Run budget: ${runBudget.filesUsed}/${RUN_FILE_CAP} files, ` +
      `${(runBudget.bytesUsed / 1024 / 1024).toFixed(1)}/${RUN_BYTE_CAP / 1024 / 1024} MB.`,
    confidenceScore: changedCount === 0 ? 1 : 0.5,
  });

  await writeTaskStep({
    taskId, agentName: AGENT_ID, stepNumber: 1,
    stepTitle: "Curriculum update scan",
    message: `${changedCount} change(s) detected, ${unreachableCount} unreachable, ${ingestedTotal} module(s) ingested`,
    status: TASK_STEP_STATUS.COMPLETED, progress: 100,
  });
  await updateLiveAgentState(AGENT_ID, {
    status: "completed", currentTaskId: null, progress: 100,
    lastMessage: `${changedCount} change(s) detected, ${ingestedTotal} ingested`,
  });

  return {
    ok: true,
    outcomes,
    changedCount, unreachableCount, ingestedTotal,
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
  ALLOWED_HOSTS,
  assertWhitelisted,
  sha256Hex,
  summariseChange,
  dueForCheck,
  RUN_BYTE_CAP,
  RUN_FILE_CAP,
  SOURCE_FILE_CAP,
  AGENT_ID,
  SUPERVISOR_DISPLAY,
};
