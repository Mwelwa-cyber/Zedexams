/**
 * Compass — product-analytics agent ("what to build next", read-only).
 *
 * ZedExams is well-instrumented on *outcomes* (every quiz/exam attempt records
 * grade, subject, score) but blind on behaviour. Compass mines the outcome data
 * you already have — the `results` and `exam_attempts` collections — into a
 * ranked, evidence-backed backlog: which (grade, subject) areas have real
 * demand but weak mastery, i.e. where building more practice + lessons would
 * help the most learners. That backlog is exactly the gap-list the content
 * line needs, so Compass is the natural driver that pairs with the content gate.
 *
 * Deliberately deterministic — pure aggregation, no LLM call — so a weekly run
 * costs only a bounded set of Firestore reads (≈free) and unit-tests without
 * Firebase or the network. Prioritising prose can come later; v1 earns its keep
 * with arithmetic on real attempts.
 */

const WINDOW_DAYS = 14;
const MAX_DOCS = 1000; // per collection — bounds reads/cost for a weekly run

function clampMessage(err) {
  return String((err && err.message) || err || "").slice(0, 200);
}

function safePercentage(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

function normGrade(g) {
  return (typeof g === "string" || typeof g === "number") ? String(g).trim() : "";
}

/**
 * Aggregate normalized attempt records into a ranked build backlog. Pure.
 *
 * @param {Array<{grade, subject, percentage, userId}>} records
 * @param {Object} [opts]
 * @returns {Object} { totalAttempts, distinctAreas, struggleCount, backlog }
 */
function aggregateAttempts(records, opts = {}) {
  const struggleThreshold = opts.struggleThreshold != null ? opts.struggleThreshold : 55;
  const minAttempts = opts.minAttempts != null ? opts.minAttempts : 8;
  const backlogSize = opts.backlogSize != null ? opts.backlogSize : 12;

  const groups = new Map();
  let total = 0;
  for (const r of records || []) {
    const subject = String((r && r.subject) || "").trim();
    const grade = normGrade(r && r.grade);
    const pct = safePercentage(r && r.percentage);
    if (!subject || pct === null) continue; // can't act on an area we can't name
    total += 1;
    const key = `${grade}|${subject}`;
    let g = groups.get(key);
    if (!g) {
      g = {grade, subject, attempts: 0, sumPct: 0, learners: new Set()};
      groups.set(key, g);
    }
    g.attempts += 1;
    g.sumPct += pct;
    if (r && r.userId) g.learners.add(r.userId);
  }

  const list = [...groups.values()].map((g) => {
    const avg = g.attempts ? g.sumPct / g.attempts : 0;
    const struggle = avg < struggleThreshold && g.attempts >= minAttempts;
    // Demand weighted by struggle — high attempts + low mastery rises to the top.
    const priority = Math.round(g.attempts * (100 - avg) / 100);
    return {
      grade: g.grade,
      subject: g.subject,
      attempts: g.attempts,
      avgPercentage: Math.round(avg),
      learners: g.learners.size,
      struggle,
      priority,
    };
  }).sort((a, b) => b.priority - a.priority);

  const backlog = list
      .filter((g) => g.struggle || g.attempts >= minAttempts)
      .slice(0, backlogSize)
      .map((g) => ({
        ...g,
        recommendation: g.struggle ?
          `Learners are struggling: avg ${g.avgPercentage}% across ${g.attempts} attempts ` +
            `(${g.learners} learners). Build more practice + a focused lesson for ` +
            `Grade ${g.grade || "?"} ${g.subject}.` :
          `Active area: ${g.attempts} attempts (${g.learners} learners), avg ` +
            `${g.avgPercentage}%. Worth expanding Grade ${g.grade || "?"} ${g.subject} coverage.`,
      }));

  return {
    totalAttempts: total,
    distinctAreas: list.length,
    struggleCount: list.filter((g) => g.struggle).length,
    backlog,
  };
}

/**
 * Read recent attempts and produce the backlog. db is injected.
 *
 * @param {Object} args
 * @param {FirebaseFirestore.Firestore} args.db
 * @param {number} [args.now]
 * @param {number} [args.windowDays]
 * @param {number} [args.maxDocs]
 * @param {Object} [args.opts]   forwarded to aggregateAttempts
 * @returns {Promise<Object>} summary
 */
async function runCompass({db, now = Date.now(), windowDays = WINDOW_DAYS, maxDocs = MAX_DOCS, opts = {}}) {
  const summary = {
    windowDays,
    sampled: 0,
    totalAttempts: 0,
    distinctAreas: 0,
    struggleCount: 0,
    backlog: [],
    errors: [],
  };

  const since = new Date(now - windowDays * 24 * 60 * 60 * 1000);
  const records = [];

  async function gather(collection, dateField) {
    try {
      const snap = await db.collection(collection)
          .where(dateField, ">=", since)
          .orderBy(dateField, "desc")
          .limit(maxDocs)
          .get();
      snap.forEach((doc) => {
        const x = doc.data() || {};
        records.push({grade: x.grade, subject: x.subject, percentage: x.percentage, userId: x.userId});
      });
    } catch (err) {
      summary.errors.push({collection, message: clampMessage(err)});
    }
  }

  await gather("results", "completedAt");
  await gather("exam_attempts", "submittedAt");

  summary.sampled = records.length;
  const agg = aggregateAttempts(records, opts);
  summary.totalAttempts = agg.totalAttempts;
  summary.distinctAreas = agg.distinctAreas;
  summary.struggleCount = agg.struggleCount;
  summary.backlog = agg.backlog;
  return summary;
}

module.exports = {runCompass, aggregateAttempts, WINDOW_DAYS, MAX_DOCS};
