/**
 * Quill — QA Smoke Runner.
 *
 * The Cloud-Function side of Quill. Runs a Firestore-only QA pass:
 *   - count of agentJobs by status (current snapshot)
 *   - jobs stuck in `running` for >2h
 *   - recent agentJobs failures (last 24h) with their error message
 *   - count of aiGenerations created in the last 24h
 *   - KB freshness check: cbcKnowledgeBase/{version}/topics doc count
 *
 * Quill never writes to aiGenerations or modifies state — it only
 * reports. Output is appended as a new agentJobs doc with
 * `agentId: 'quill'`, `status: 'done'`. The dashboard surfaces it in
 * the QA/Eng tab.
 *
 * The "scripted" Quill (file-integrity, schema, sanitiser tests) lives
 * in a separate GitHub Action (.github/workflows/agent-qa-smoke.yml,
 * Phase 3+). They're complementary: one runs against Firestore data,
 * the other against the source repo.
 */

const admin = require("firebase-admin");

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

async function countByStatus(db) {
  // Firestore has no aggregate `count by group` for one-shot reads;
  // pull a bounded slice and tally client-side. Caps at 500 to keep the
  // function cheap even if the queue grows.
  const snap = await db.collection("agentJobs")
    .orderBy("createdAt", "desc")
    .limit(500)
    .get();
  const counts = {};
  snap.forEach((doc) => {
    const s = (doc.data() || {}).status || "unknown";
    counts[s] = (counts[s] || 0) + 1;
  });
  return counts;
}

async function findStuckJobs(db, now) {
  const cutoff = admin.firestore.Timestamp.fromDate(new Date(now - TWO_HOURS_MS));
  const snap = await db.collection("agentJobs")
    .where("status", "==", "running")
    .where("createdAt", "<", cutoff)
    .limit(20)
    .get()
    .catch(() => null);
  if (!snap) return [];
  return snap.docs.map((d) => {
    const data = d.data() || {};
    return {
      id: d.id,
      agentId: data.agentId || null,
      department: data.department || null,
      stuckSince: data.updatedAt || data.createdAt || null,
    };
  });
}

async function findRecentFailures(db, now) {
  const cutoff = admin.firestore.Timestamp.fromDate(new Date(now - ONE_DAY_MS));
  const snap = await db.collection("agentJobs")
    .where("status", "==", "failed")
    .where("createdAt", ">=", cutoff)
    .orderBy("createdAt", "desc")
    .limit(20)
    .get()
    .catch(() => null);
  if (!snap) return [];
  return snap.docs.map((d) => {
    const data = d.data() || {};
    return {
      id: d.id,
      agentId: data.agentId || null,
      error: String(data.error || "").slice(0, 300),
    };
  });
}

async function countRecentGenerations(db, now) {
  const cutoff = admin.firestore.Timestamp.fromDate(new Date(now - ONE_DAY_MS));
  const snap = await db.collection("aiGenerations")
    .where("createdAt", ">=", cutoff)
    .select()
    .get()
    .catch(() => null);
  return snap ? snap.size : null;
}

async function kbHealthCheck(db) {
  const versions = await db.collection("cbcKnowledgeBase").select().get()
    .catch(() => null);
  if (!versions || versions.empty) {
    return {versions: 0, topicsLatest: 0, ok: false, note: "No KB versions found."};
  }
  const latest = versions.docs[versions.docs.length - 1];
  const topics = await db.collection(`cbcKnowledgeBase/${latest.id}/topics`)
    .select()
    .get()
    .catch(() => null);
  return {
    versions: versions.size,
    latestVersion: latest.id,
    topicsLatest: topics ? topics.size : 0,
    ok: Boolean(topics && topics.size > 0),
  };
}

async function runQuill() {
  const db = admin.firestore();
  const now = Date.now();

  const [statusCounts, stuck, failures, recentGenerations, kb] = await Promise.all([
    countByStatus(db),
    findStuckJobs(db, now),
    findRecentFailures(db, now),
    countRecentGenerations(db, now),
    kbHealthCheck(db),
  ]);

  const regressions = [];
  if (stuck.length > 0) {
    regressions.push(`${stuck.length} jobs stuck in 'running' for >2h.`);
  }
  if (failures.length >= 3) {
    regressions.push(`${failures.length} agentJobs failed in the last 24h.`);
  }
  if (!kb.ok) {
    regressions.push("CBC knowledge base is empty or unreachable.");
  }

  return {
    ranAt: new Date(now).toISOString(),
    statusCounts,
    stuck,
    failures,
    recentGenerations,
    kb,
    regressions,
    ok: regressions.length === 0,
  };
}

module.exports = {runQuill};
