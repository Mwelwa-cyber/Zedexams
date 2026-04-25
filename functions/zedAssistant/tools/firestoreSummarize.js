/**
 * Read-only Firestore aggregations for the Telegram assistant.
 *
 * All counts use Firestore's count() aggregation where possible — cheap and
 * doesn't pull doc bodies. Detail queries are explicitly capped (limit 5) to
 * keep the response within Telegram's 4k char message budget and to avoid
 * leaking large amounts of user data into a chat surface.
 */

const admin = require("firebase-admin");

const definition = {
  name: "summarize_admin",
  description:
    "Summarize ZedExams admin metrics: registered learners, tests written, " +
    "scores, weak topics. Read-only. Use when the user asks for a status " +
    "report, daily numbers, or 'who is doing what' on the platform. The " +
    "scope argument controls which metrics to fetch — pass 'all' for " +
    "everything, or a specific scope to keep the answer focused.",
  input_schema: {
    type: "object",
    properties: {
      scope: {
        type: "string",
        enum: [
          "all",
          "users",
          "results",
          "exams",
          "weak_topics",
          "scores",
        ],
        description: "Which metric block to fetch.",
      },
      sinceDays: {
        type: "integer",
        minimum: 1,
        maximum: 90,
        description:
          "Window in days for time-bounded metrics (results, exams, " +
          "scores). Defaults to 7. Ignored for 'users' and 'weak_topics'.",
      },
    },
    required: ["scope"],
  },
};

function startOfDayBefore(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(0, 0, 0, 0);
  return admin.firestore.Timestamp.fromDate(d);
}

async function countCollection(name) {
  try {
    const snap = await admin.firestore().collection(name).count().get();
    return snap.data().count;
  } catch (err) {
    console.warn(`countCollection(${name}) failed`, err?.message);
    return null;
  }
}

async function countWhere(name, field, op, value) {
  try {
    const snap = await admin.firestore()
      .collection(name)
      .where(field, op, value)
      .count()
      .get();
    return snap.data().count;
  } catch (err) {
    console.warn(`countWhere(${name}, ${field}) failed`, err?.message);
    return null;
  }
}

async function summarizeUsers() {
  const total = await countCollection("users");
  const learners = await countWhere("users", "role", "==", "learner");
  const teachers = await countWhere("users", "role", "==", "teacher");
  const admins = await countWhere("users", "role", "==", "admin");
  const premium = await countWhere("users", "isPremium", "==", true);
  return {total, learners, teachers, admins, premium};
}

async function summarizeResults(sinceDays) {
  const since = startOfDayBefore(sinceDays);
  const total = await countCollection("results");
  let recent = null;
  let avgPercentage = null;
  try {
    const recentSnap = await admin.firestore()
      .collection("results")
      .where("createdAt", ">=", since)
      .limit(500)
      .get();
    recent = recentSnap.size;
    if (recent > 0) {
      const pct = recentSnap.docs
        .map((d) => Number(d.data()?.percentage))
        .filter((n) => Number.isFinite(n));
      if (pct.length) {
        avgPercentage = Math.round(
          (pct.reduce((a, b) => a + b, 0) / pct.length) * 10,
        ) / 10;
      }
    }
  } catch (err) {
    console.warn("summarizeResults recent query failed", err?.message);
  }
  return {total, recentInWindow: recent, sinceDays, avgPercentage};
}

async function summarizeExamAttempts(sinceDays) {
  const since = startOfDayBefore(sinceDays);
  const submitted = await countWhere(
    "exam_attempts",
    "status",
    "==",
    "submitted",
  );
  let recent = null;
  try {
    const snap = await admin.firestore()
      .collection("exam_attempts")
      .where("status", "==", "submitted")
      .where("submittedAt", ">=", since)
      .count()
      .get();
    recent = snap.data().count;
  } catch (err) {
    console.warn("summarizeExamAttempts recent failed", err?.message);
  }
  return {submittedTotal: submitted, recentInWindow: recent, sinceDays};
}

async function summarizeScores(sinceDays) {
  const since = startOfDayBefore(sinceDays);
  const total = await countCollection("scores");
  let recent = null;
  let topGames = [];
  try {
    const recentSnap = await admin.firestore()
      .collection("scores")
      .where("playedAt", ">=", since)
      .limit(1000)
      .get();
    recent = recentSnap.size;
    const byGame = new Map();
    recentSnap.docs.forEach((d) => {
      const g = String(d.data()?.gameId || "");
      if (!g) return;
      byGame.set(g, (byGame.get(g) || 0) + 1);
    });
    topGames = [...byGame.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([gameId, plays]) => ({gameId, plays}));
  } catch (err) {
    console.warn("summarizeScores recent failed", err?.message);
  }
  return {total, recentInWindow: recent, sinceDays, topGames};
}

async function summarizeWeakTopics() {
  // learner_profiles is the per-user intelligence snapshot. We sample up to
  // 200 profiles and aggregate the union of their .weakTopics arrays.
  const out = {sampled: 0, topWeakTopics: []};
  try {
    const snap = await admin.firestore()
      .collection("learner_profiles")
      .limit(200)
      .get();
    const counts = new Map();
    snap.docs.forEach((d) => {
      const data = d.data() || {};
      const list = Array.isArray(data.weakTopics) ?
        data.weakTopics :
        Array.isArray(data.weakestTopics) ? data.weakestTopics : [];
      list.slice(0, 10).forEach((entry) => {
        const key = String(entry?.topic || entry?.label || entry || "").trim();
        if (!key) return;
        counts.set(key, (counts.get(key) || 0) + 1);
      });
    });
    out.sampled = snap.size;
    out.topWeakTopics = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([topic, learners]) => ({topic, learners}));
  } catch (err) {
    console.warn("summarizeWeakTopics failed", err?.message);
    out.error = err?.message;
  }
  return out;
}

async function run(input = {}) {
  const scope = String(input.scope || "all");
  const sinceDays = Math.max(
    1,
    Math.min(90, Number(input.sinceDays) || 7),
  );

  const out = {generatedAt: new Date().toISOString(), scope, sinceDays};

  const wantAll = scope === "all";
  if (wantAll || scope === "users") out.users = await summarizeUsers();
  if (wantAll || scope === "results") {
    out.results = await summarizeResults(sinceDays);
  }
  if (wantAll || scope === "exams") {
    out.examAttempts = await summarizeExamAttempts(sinceDays);
  }
  if (wantAll || scope === "scores") {
    out.scores = await summarizeScores(sinceDays);
  }
  if (wantAll || scope === "weak_topics") {
    out.weakTopics = await summarizeWeakTopics();
  }
  return out;
}

module.exports = {definition, run};
