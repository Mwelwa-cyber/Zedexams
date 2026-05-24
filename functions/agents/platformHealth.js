/**
 * Platform Health — admin diagnostics for the AI agent pipeline.
 *
 * Three callables, all admin-only:
 *   1. getPlatformHealth     — read-only snapshot. Pings Anthropic, reads
 *                              agentControl docs, counts the CBC KB seed +
 *                              Firestore overlay, summarises recent jobs.
 *   2. initializeAgentPipeline — creates missing agentControl docs (paused=false).
 *                              Idempotent.
 *   3. runSampleAgentJob     — fires a real agent brief through Aria → Cala →
 *                              Reva so the admin can watch the pipeline end-to-end.
 */

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");

const {getUserRole} = require("../aiService");
const {anthropicFetch} = require("../anthropicFetch");
const {
  getActiveKbState,
  getAllTopics,
} = require("../teacherTools/cbcKnowledge");

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const APPCHECK_ENFORCE_CALLABLE = process.env.APPCHECK_ENFORCE === "1";

const AGENT_IDS = ["aria", "cala", "reva", "pubo", "quill", "vex"];

// Sample brief that fires through the pipeline. Picked from a Grade 6
// English topic that exists in the in-code seed so Cala never returns
// "topic not found" on a clean install.
const SAMPLE_BRIEF = {
  tool: "lesson_plan",
  grade: "G6",
  subject: "english",
  topic: "Reading Comprehension",
  subtopic: "Identifying main ideas",
  term: 1,
  duration: 40,
  brief: "Single-period lesson on identifying main ideas in short passages.",
};

async function requireAdmin(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Please sign in first.");
  }
  const role = await getUserRole(request.auth.uid);
  if (role !== "admin") {
    throw new HttpsError("permission-denied", "Admins only.");
  }
  return request.auth.uid;
}

/**
 * Tiny Anthropic ping. One token in, one out. Confirms the key is alive
 * without burning meaningful budget. Returns { ok, model, error }.
 */
async function pingAnthropic(anthropicApiKeySecret) {
  const apiKey = anthropicApiKeySecret.value() ||
    process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      error: "ANTHROPIC_API_KEY secret is not set in Firebase Functions.",
    };
  }
  const model = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
  try {
    const res = await anthropicFetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: 1,
        messages: [{role: "user", content: "ping"}],
      }),
    }, {maxRetries: 0, label: "platformHealth.ping"});
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return {
        ok: false,
        model,
        error: `Anthropic returned ${res.status}: ${txt.slice(0, 200)}`,
      };
    }
    return {ok: true, model};
  } catch (err) {
    return {
      ok: false,
      model,
      error: `Anthropic ping failed: ${String(err && err.message || err)
        .slice(0, 200)}`,
    };
  }
}

async function readAgentControl() {
  const db = admin.firestore();
  const out = {};
  await Promise.all(AGENT_IDS.map(async (id) => {
    const snap = await db.doc(`agentControl/${id}`).get().catch(() => null);
    if (snap && snap.exists) {
      const data = snap.data() || {};
      out[id] = {exists: true, paused: Boolean(data.paused)};
    } else {
      out[id] = {exists: false, paused: false};
    }
  }));
  return out;
}

async function summariseKb() {
  let activeState = null;
  try {
    activeState = await getActiveKbState();
  } catch {
    activeState = null;
  }
  const topics = getAllTopics ? await getAllTopics().catch(() => []) : [];
  const byGrade = {};
  const bySubject = {};
  topics.forEach((t) => {
    const g = String(t.grade || "?").toUpperCase();
    const s = String(t.subject || "?").toLowerCase();
    byGrade[g] = (byGrade[g] || 0) + 1;
    bySubject[s] = (bySubject[s] || 0) + 1;
  });
  return {
    activeVersion: activeState?.version || null,
    usePrivateCurriculum: Boolean(activeState?.usePrivateCurriculum),
    totalTopics: topics.length,
    byGrade,
    bySubject,
  };
}

async function summariseRecentJobs() {
  const db = admin.firestore();
  const snap = await db.collection("agentJobs")
    .orderBy("createdAt", "desc")
    .limit(50)
    .get()
    .catch(() => null);
  if (!snap) return {total: 0, byStatus: {}, last: null};
  const byStatus = {};
  let last = null;
  snap.forEach((doc) => {
    const d = doc.data() || {};
    const st = d.status || "unknown";
    byStatus[st] = (byStatus[st] || 0) + 1;
    if (!last || (d.createdAt && d.createdAt > (last.createdAt || 0))) {
      last = {id: doc.id, ...d};
    }
  });
  return {
    total: snap.size,
    byStatus,
    last: last ? {
      id: last.id,
      status: last.status,
      agentId: last.agentId,
      createdAt: last.createdAt || null,
    } : null,
  };
}

function createGetPlatformHealth(anthropicApiKeySecret) {
  return onCall({
    secrets: [anthropicApiKeySecret],
    region: "us-central1",
    timeoutSeconds: 30,
    memory: "256MiB",
    enforceAppCheck: APPCHECK_ENFORCE_CALLABLE,
    consumeAppCheckToken: true,
  }, async (request) => {
    await requireAdmin(request);
    const [anthropic, agentControl, kb, recentJobs] = await Promise.all([
      pingAnthropic(anthropicApiKeySecret),
      readAgentControl(),
      summariseKb(),
      summariseRecentJobs(),
    ]);
    const missingAgentControlDocs = AGENT_IDS.filter(
      (id) => !agentControl[id]?.exists,
    );
    return {
      checkedAt: Date.now(),
      anthropic,
      agentControl,
      missingAgentControlDocs,
      kb,
      recentJobs,
    };
  });
}

function createInitializeAgentPipeline() {
  return onCall({
    region: "us-central1",
    timeoutSeconds: 30,
    memory: "256MiB",
    enforceAppCheck: APPCHECK_ENFORCE_CALLABLE,
    consumeAppCheckToken: true,
  }, async (request) => {
    const uid = await requireAdmin(request);
    const db = admin.firestore();
    const created = [];
    const skipped = [];
    await Promise.all(AGENT_IDS.map(async (id) => {
      const ref = db.doc(`agentControl/${id}`);
      const snap = await ref.get();
      if (snap.exists) {
        skipped.push(id);
        return;
      }
      await ref.set({
        paused: false,
        createdBy: uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: uid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        initializedByHealthPanel: true,
      });
      created.push(id);
    }));
    return {ok: true, created, skipped};
  });
}

function createRunSampleAgentJob() {
  return onCall({
    region: "us-central1",
    timeoutSeconds: 30,
    memory: "256MiB",
    enforceAppCheck: APPCHECK_ENFORCE_CALLABLE,
    consumeAppCheckToken: true,
  }, async (request) => {
    const uid = await requireAdmin(request);
    const db = admin.firestore();
    const ref = db.collection("agentJobs").doc();
    await ref.set({
      agentId: "aria",
      department: "content",
      status: "queued",
      input: SAMPLE_BRIEF,
      createdBy: uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      origin: "platformHealthPanel",
    });
    return {ok: true, jobId: ref.id};
  });
}

module.exports = {
  createGetPlatformHealth,
  createInitializeAgentPipeline,
  createRunSampleAgentJob,
};
