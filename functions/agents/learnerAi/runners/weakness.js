/**
 * Weakness Detection Agent — v2.
 *
 * Analyses one learner's recent quiz/exam attempts and writes a
 * structured rollup to learnerWeaknessProfiles/{learnerId}. The Study
 * Tips Agent reads this rollup to produce personalised tips; the
 * Learner Feedback Agent uses it for encouragement-with-context.
 *
 * Privacy invariants (NON-NEGOTIABLE):
 *   - Only reads documents from the `results` and `exam_attempts`
 *     collections filtered by `userId === learnerId`. The
 *     `gatherLearnerData` helper hard-codes that filter; the
 *     `analyseAttempts` helper takes only the filtered docs.
 *   - NEVER touches another learner's data.
 *   - Writes only to `learnerWeaknessProfiles/{learnerId}` — gated
 *     by the existing Firestore rule (`learnerId == auth.uid OR
 *     isAdmin`) so the profile doc is unreadable by other learners.
 *   - Does NOT write to aiGeneratedContent (which has broader read
 *     scope). This agent's output is private rollup data, not
 *     learner-facing content, so the artifact pattern doesn't apply.
 *
 * Pipeline:
 *   The supervisor planner runs weakness_analysis as the sole step
 *   (no Curriculum Reader / Quality Check needed — see updated
 *   planStepsFor in supervisor.js). After analysis, the runner
 *   optionally queues a follow-up `study_tips` task seeded with the
 *   freshly-computed weakLearnerId.
 *
 * Output shape (learnerWeaknessProfileWriteSchema in
 * src/schemas/learnerAi.js):
 *   { learnerId, grade, subject,
 *     weakTopics[], weakSubtopics[], repeatedMistakes[],
 *     recommendedNotes[], recommendedQuizzes[],
 *     lastUpdated }
 */

const admin = require("firebase-admin");
const {
  writeAgentLog, writeSupervisorLog, updateLiveAgentState, writeTaskStep,
} = require("../logger");
const {
  COLLECTIONS, TASK_STATUS, TASK_STEP_STATUS, SEVERITY,
} = require("../v2Collections");

const AGENT_ID = "weakness";

const DEFAULT_PARAMETERS = Object.freeze({
  attemptsLimit: 50,
  triggerStudyTips: true,
  weakTopicThreshold: 70,     // < 70% average → weak
  lowScoreThreshold: 50,      // attempt < 50% → low score
  repeatedMistakeMinHits: 2,  // a topic must score poorly in ≥ N attempts
});

// ── Parameter normalisation ─────────────────────────────────────────

function normaliseParameters(task) {
  const raw = (task && task.parameters) || {};
  const learnerId = typeof raw.learnerId === "string" && raw.learnerId.length ?
    raw.learnerId.slice(0, 120) :
    (typeof raw.weakLearnerId === "string" && raw.weakLearnerId.length ?
      raw.weakLearnerId.slice(0, 120) : null);
  const subjects = Array.isArray(raw.subjects) ?
    raw.subjects.filter((s) => typeof s === "string" && s.length).slice(0, 20) :
    [];
  const attemptsLimit = Number.isInteger(raw.attemptsLimit) ?
    Math.max(1, Math.min(200, raw.attemptsLimit)) :
    DEFAULT_PARAMETERS.attemptsLimit;
  const triggerStudyTips = raw.triggerStudyTips !== false;
  const weakTopicThreshold = Number.isFinite(raw.weakTopicThreshold) ?
    Math.max(10, Math.min(95, raw.weakTopicThreshold)) :
    DEFAULT_PARAMETERS.weakTopicThreshold;
  const lowScoreThreshold = Number.isFinite(raw.lowScoreThreshold) ?
    Math.max(10, Math.min(95, raw.lowScoreThreshold)) :
    DEFAULT_PARAMETERS.lowScoreThreshold;
  const repeatedMistakeMinHits = Number.isInteger(raw.repeatedMistakeMinHits) ?
    Math.max(2, Math.min(10, raw.repeatedMistakeMinHits)) :
    DEFAULT_PARAMETERS.repeatedMistakeMinHits;
  return {
    learnerId, subjects, attemptsLimit, triggerStudyTips,
    weakTopicThreshold, lowScoreThreshold, repeatedMistakeMinHits,
  };
}

// ── Firestore reads (privacy-scoped) ────────────────────────────────

/**
 * Pull recent `results` for ONE learner. Filter is hard-coded to
 * userId === learnerId; never accepts a wildcard. Optional subjects
 * narrow within that learner only.
 */
async function gatherLearnerData({learnerId, attemptsLimit, subjects}) {
  if (!learnerId) return {results: [], examAttempts: []};
  const db = admin.firestore();

  // results collection — quiz results (post-quiz aggregates).
  let resultsQuery = db.collection("results")
      .where("userId", "==", learnerId);
  if (subjects && subjects.length === 1) {
    // Optional subject narrowing only when exactly one — multi-subject
    // would need an `in` filter which has Firestore size limits; we
    // post-filter in JS instead for multi-subject.
    resultsQuery = resultsQuery.where("subject", "==", subjects[0]);
  }
  // Order desc + limit so we get the freshest attempts.
  let results = [];
  try {
    const snap = await resultsQuery.orderBy("completedAt", "desc")
        .limit(attemptsLimit).get();
    results = snap.docs.map((d) => ({id: d.id, ...(d.data() || {})}));
  } catch (err) {
    console.warn("[weakness] results query failed", err && err.message);
  }
  if (subjects && subjects.length > 1) {
    const allow = new Set(subjects.map((s) => s.toLowerCase()));
    results = results.filter((r) => allow.has(String(r.subject || "").toLowerCase()));
  }

  // exam_attempts collection — finer-grained per-section breakdowns.
  // Best-effort; some installations may not have this populated.
  let examAttempts = [];
  try {
    const snap = await db.collection("exam_attempts")
        .where("userId", "==", learnerId)
        .orderBy("completedAt", "desc")
        .limit(attemptsLimit).get();
    examAttempts = snap.docs.map((d) => ({id: d.id, ...(d.data() || {})}));
  } catch (err) {
    // exam_attempts has its own composite index requirements; missing
    // index isn't fatal — the rollup just won't include exam data.
    console.warn("[weakness] exam_attempts query failed", err && err.message);
  }

  return {results, examAttempts};
}

// ── Pure analysis (unit-tested) ─────────────────────────────────────

/**
 * Take pre-fetched per-learner attempt docs and produce the weakness
 * profile rollup. Returns the body of a `learnerWeaknessProfiles`
 * doc minus the `lastUpdated` timestamp (the runner stamps that).
 *
 * @param {object} args
 * @param {string} args.learnerId
 * @param {Array} args.results               from the `results` collection
 * @param {Array} args.examAttempts          from `exam_attempts` collection
 * @param {object} args.parameters
 */
function analyseAttempts({learnerId, results, examAttempts, parameters}) {
  // Defensive scoping — if anyone ever passes mixed-learner data,
  // refuse to process. This is a belt-and-braces guard against
  // privacy-leakage bugs upstream.
  const ownResults = (results || []).filter((r) =>
    r && r.userId === learnerId);
  const ownExamAttempts = (examAttempts || []).filter((a) =>
    a && a.userId === learnerId);

  // Detect dominant subject + grade (most common across attempts).
  const subject = pickMostCommon(ownResults.map((r) => r.subject)) ||
    pickMostCommon(ownExamAttempts.map((a) => a.subject)) || "";
  const grade = pickMostCommon([
    ...ownResults.map((r) => r.grade != null ? String(r.grade) : ""),
    ...ownExamAttempts.map((a) => a.grade != null ? String(a.grade) : ""),
  ].filter(Boolean)) || "";

  // Average topic score across all attempts. topicScores is a map
  // {topicName: 0..100}.
  const topicTotals = new Map(); // topic → {sum, hits, lowHits}
  for (const r of ownResults) {
    const map = isPlainObject(r.topicScores) ? r.topicScores : {};
    for (const [topic, score] of Object.entries(map)) {
      if (typeof topic !== "string" || !topic.trim()) continue;
      const n = Number(score);
      if (!Number.isFinite(n)) continue;
      const entry = topicTotals.get(topic) || {sum: 0, hits: 0, lowHits: 0};
      entry.sum += n;
      entry.hits += 1;
      if (n < parameters.weakTopicThreshold) entry.lowHits += 1;
      topicTotals.set(topic, entry);
    }
  }

  // Weak topics: average < threshold AND at least 1 hit.
  const weakTopics = [];
  for (const [topic, entry] of topicTotals.entries()) {
    if (entry.hits === 0) continue;
    const avg = entry.sum / entry.hits;
    if (avg < parameters.weakTopicThreshold) {
      weakTopics.push({topic, averageScore: round1(avg), hits: entry.hits});
    }
  }
  weakTopics.sort((a, b) => a.averageScore - b.averageScore);

  // Weak subtopics: derive from exam_attempts.topicBreakdown when
  // present. Same threshold rule. If no exam_attempts available the
  // subtopics list stays empty — better than fabricating.
  const subtopicTotals = new Map();
  for (const a of ownExamAttempts) {
    const breakdown = isPlainObject(a.topicBreakdown) ? a.topicBreakdown : {};
    for (const [key, val] of Object.entries(breakdown)) {
      if (typeof key !== "string" || !key.trim()) continue;
      const score = typeof val === "object" && val ? Number(val.percentage || val.score) :
        Number(val);
      if (!Number.isFinite(score)) continue;
      const e = subtopicTotals.get(key) || {sum: 0, hits: 0};
      e.sum += score;
      e.hits += 1;
      subtopicTotals.set(key, e);
    }
  }
  const weakSubtopics = [];
  for (const [subtopic, e] of subtopicTotals.entries()) {
    const avg = e.hits ? e.sum / e.hits : 0;
    if (e.hits && avg < parameters.weakTopicThreshold) {
      weakSubtopics.push({subtopic, averageScore: round1(avg), hits: e.hits});
    }
  }
  weakSubtopics.sort((a, b) => a.averageScore - b.averageScore);

  // Repeated mistakes — topics with ≥N low-score hits.
  const repeatedMistakes = [];
  for (const [topic, entry] of topicTotals.entries()) {
    if (entry.lowHits >= parameters.repeatedMistakeMinHits) {
      repeatedMistakes.push({
        topic,
        timesMissed: entry.lowHits,
        averageScore: round1(entry.sum / entry.hits),
        mistake: `Consistently scored below ${parameters.weakTopicThreshold}% on ${topic} ` +
          `(${entry.lowHits} of ${entry.hits} attempts).`,
      });
    }
  }
  repeatedMistakes.sort((a, b) => b.timesMissed - a.timesMissed);

  // Low-score attempts — overall percentage < threshold.
  const lowScoreCount = ownResults
      .filter((r) => Number(r.percentage) < parameters.lowScoreThreshold)
      .length;

  // Improvement over time: compare first 3 vs last 3 attempts by date.
  // `results` is already ordered desc when from Firestore, but we
  // re-sort defensively in case the caller passed an unsorted array.
  const sortedByDate = [...ownResults].sort((a, b) =>
    millisOf(a.completedAt) - millisOf(b.completedAt));
  const head = sortedByDate.slice(0, 3);
  const tail = sortedByDate.slice(-3);
  const headAvg = avgPercentage(head);
  const tailAvg = avgPercentage(tail);
  const improvement = (head.length >= 1 && tail.length >= 1) ?
    round1(tailAvg - headAvg) : 0;
  const trend = head.length === 0 ? "no_data" :
    improvement > 5 ? "improving" :
    improvement < -5 ? "declining" : "stable";

  // Question-type difficulty — best-effort across exam_attempts.
  // Each exam_attempt may carry `questionResults[]` with `questionType`
  // and `correct` booleans. Aggregate pass rate per type.
  const typeTotals = new Map();
  for (const a of ownExamAttempts) {
    const list = Array.isArray(a.questionResults) ? a.questionResults : [];
    for (const qr of list) {
      const t = qr && typeof qr.questionType === "string" ? qr.questionType : null;
      if (!t) continue;
      const e = typeTotals.get(t) || {correct: 0, total: 0};
      if (qr.correct === true) e.correct += 1;
      e.total += 1;
      typeTotals.set(t, e);
    }
  }
  const difficultQuestionTypes = [];
  for (const [type, e] of typeTotals.entries()) {
    if (e.total < 3) continue; // need at least 3 attempts for signal
    const passRate = (e.correct / e.total) * 100;
    if (passRate < 60) {
      difficultQuestionTypes.push({questionType: type, passRate: round1(passRate), total: e.total});
    }
  }
  difficultQuestionTypes.sort((a, b) => a.passRate - b.passRate);

  // Time-pressure — if attempts carry `timeTakenMs` and `questionCount`,
  // compute avg per question. Optional; many quizzes don't time.
  const timeSamples = ownExamAttempts
      .map((a) => ({
        ms: Number(a.timeTakenMs),
        qCount: Number(a.questionCount || (a.questionResults || []).length),
      }))
      .filter((s) => Number.isFinite(s.ms) && Number.isFinite(s.qCount) && s.qCount > 0)
      .map((s) => s.ms / s.qCount);
  const avgSecondsPerQuestion = timeSamples.length ?
    round1(timeSamples.reduce((acc, n) => acc + n, 0) / timeSamples.length / 1000) :
    null;

  // Recommendations — derived directly from the weak topics rollup.
  // These are TITLES the Notes/PracticeQuiz generators can use as
  // seeds, NOT references to other learners' work.
  const recommendedNotes = weakTopics.slice(0, 5).map((wt) =>
    `${wt.topic} — re-read notes`);
  const recommendedQuizzes = weakTopics.slice(0, 5).map((wt) =>
    `${wt.topic} — focused practice quiz`);

  return {
    learnerId,
    grade: grade || "",
    subject: subject || "",
    weakTopics: weakTopics.map((wt) => wt.topic).slice(0, 200),
    weakSubtopics: weakSubtopics.map((ws) => ws.subtopic).slice(0, 400),
    repeatedMistakes: repeatedMistakes.slice(0, 200).map((m) => ({
      topic: m.topic, timesMissed: m.timesMissed,
      averageScore: m.averageScore, mistake: m.mistake,
    })),
    recommendedNotes,
    recommendedQuizzes,
    // Analytics that don't fit the strict learnerWeaknessProfileWriteSchema
    // shape — exposed separately on the analysis return so callers
    // (and the runner's logs) can inspect them, but NOT persisted.
    _analytics: {
      attemptsScanned: ownResults.length,
      examAttemptsScanned: ownExamAttempts.length,
      lowScoreCount,
      improvement, trend,
      difficultQuestionTypes,
      avgSecondsPerQuestion,
      headAvg: round1(headAvg), tailAvg: round1(tailAvg),
    },
  };
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function round1(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}
function millisOf(ts) {
  if (!ts) return 0;
  if (typeof ts === "number") return ts;
  if (typeof ts === "string") {
    const t = new Date(ts).getTime();
    return Number.isFinite(t) ? t : 0;
  }
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.seconds === "number") return ts.seconds * 1000;
  return 0;
}
function avgPercentage(list) {
  const nums = list.map((r) => Number(r.percentage)).filter(Number.isFinite);
  if (!nums.length) return 0;
  return nums.reduce((acc, n) => acc + n, 0) / nums.length;
}
function pickMostCommon(values) {
  const counts = new Map();
  for (const v of values || []) {
    if (typeof v !== "string" || !v.trim()) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  let best = null; let bestN = 0;
  for (const [v, n] of counts.entries()) {
    if (n > bestN) { best = v; bestN = n; }
  }
  return best;
}

// ── Downstream trigger: Study Tips ──────────────────────────────────

/**
 * Queue a follow-up study_tips task seeded with the freshly-computed
 * weakLearnerId. The dispatcher's onCreate trigger picks it up
 * automatically. We DON'T inline the study-tips runner here — the
 * dispatcher handles ordering, logging, supervisor planning, etc.
 *
 * Skipped silently when:
 *   - parameters.triggerStudyTips === false
 *   - the profile has zero weak topics + zero weak subtopics
 *     (no real weakness signals → no tips to write)
 */
async function maybeQueueStudyTips({profile, parameters, taskId}) {
  if (!parameters.triggerStudyTips) return null;
  if (!parameters.learnerId) return null;
  const hasSignals = (profile.weakTopics && profile.weakTopics.length) ||
    (profile.weakSubtopics && profile.weakSubtopics.length);
  if (!hasSignals) return null;

  try {
    const ref = await admin.firestore().collection(COLLECTIONS.TASKS).add({
      taskType: "study_tips",
      agentName: "studyTips",
      status: TASK_STATUS.QUEUED,
      grade: profile.grade || null,
      subject: profile.subject || null,
      term: null,
      topic: profile.weakTopics[0] || null,
      subtopic: (profile.weakSubtopics && profile.weakSubtopics[0]) || null,
      lessonNumber: null,
      assessmentType: null,
      parameters: {
        weakLearnerId: parameters.learnerId,
        maxTips: 6,
        includeRevisionPlan: true,
        planDurationDays: 7,
      },
      startedAt: null,
      completedAt: null,
      resultContentId: null,
      errorMessage: null,
      // Audit linkage so admins can see this task was system-triggered.
      triggeredBy: taskId || "weakness_detection",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return ref.id;
  } catch (err) {
    console.warn("[weakness] queueStudyTips failed", err && err.message);
    return null;
  }
}

// ── Runner ──────────────────────────────────────────────────────────

async function runWeakness({task, stepNumber = 1}) {
  const parameters = normaliseParameters(task);
  if (!parameters.learnerId) {
    await writeAgentLog({
      taskId: task.id, agentName: AGENT_ID, action: "weakness_detection",
      message: "Refused: missing learnerId",
      taskType: task.taskType,
      grade: task.grade, subject: task.subject, topic: task.topic,
      severity: SEVERITY.ERROR,
    });
    return {ok: false, reason: "missing_learner_id"};
  }

  await updateLiveAgentState(AGENT_ID, {
    agentName: AGENT_ID,
    status: TASK_STATUS.RUNNING,
    currentTaskId: task.id,
    currentTask: `Analyse weakness for ${parameters.learnerId}`,
    progress: 25,
    grade: task.grade || null,
    subject: task.subject || null,
    term: task.term || null,
    topic: task.topic || null,
    subtopic: task.subtopic || null,
    lastMessage: "Reading own attempts only",
  });
  await writeTaskStep({
    taskId: task.id, agentName: AGENT_ID, stepNumber,
    stepTitle: "Weakness detection",
    message: `Scanning up to ${parameters.attemptsLimit} attempts for ${parameters.learnerId}`,
    status: TASK_STEP_STATUS.RUNNING, progress: 50,
  });

  const {results, examAttempts} = await gatherLearnerData({
    learnerId: parameters.learnerId,
    attemptsLimit: parameters.attemptsLimit,
    subjects: parameters.subjects,
  });

  if (!results.length && !examAttempts.length) {
    await writeAgentLog({
      taskId: task.id, agentName: AGENT_ID, action: "weakness_detection",
      message: `No attempts found for learner ${parameters.learnerId}`,
      taskType: task.taskType,
      grade: task.grade, subject: task.subject, topic: task.topic,
      severity: SEVERITY.WARNING,
    });
    await updateLiveAgentState(AGENT_ID, {
      status: "completed", currentTaskId: null, lastMessage: "no_attempts",
    });
    return {ok: false, reason: "no_attempts"};
  }

  const analysis = analyseAttempts({
    learnerId: parameters.learnerId, results, examAttempts, parameters,
  });
  const {_analytics, ...profileFields} = analysis;

  // Write the profile. Doc ID = learnerId by convention so the
  // Study Tips agent can read it directly via doc-by-id lookup.
  const profileDoc = {
    ...profileFields,
    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
  };
  await admin.firestore()
      .collection(COLLECTIONS.WEAKNESS_PROFILES)
      .doc(parameters.learnerId)
      .set(profileDoc, {merge: true});

  // Trigger Study Tips for follow-up (no-op when no signals).
  const studyTipsTaskId = await maybeQueueStudyTips({
    profile: profileFields, parameters, taskId: task.id,
  });

  // Report to AI Supervisor — Weakness Detection is a data agent so
  // we always 'sent_for_review' (admin can audit the rollup any time).
  await writeSupervisorLog({
    taskId: task.id, agentName: "Weakness Detection Agent",
    contentType: "weakness_profile",
    grade: profileFields.grade || "", subject: profileFields.subject || "", term: "",
    topic: "", subtopic: "",
    actionTaken: "sent_for_review",
    reason: `Analysed ${_analytics.attemptsScanned} attempts; ` +
      `${profileFields.weakTopics.length} weak topics, ` +
      `${profileFields.weakSubtopics.length} weak subtopics, ` +
      `trend=${_analytics.trend}` +
      (studyTipsTaskId ? `; queued studyTips task ${studyTipsTaskId}` : ""),
    confidenceScore: 1,
  });

  await writeAgentLog({
    taskId: task.id, agentName: AGENT_ID, action: "weakness_detection",
    message: `${profileFields.weakTopics.length} weak topics, ` +
      `${profileFields.weakSubtopics.length} weak subtopics, ` +
      `${profileFields.repeatedMistakes.length} repeated mistakes; ` +
      `trend=${_analytics.trend}` +
      (studyTipsTaskId ? `; queued studyTips/${studyTipsTaskId}` : ""),
    taskType: task.taskType,
    grade: profileFields.grade || null,
    subject: profileFields.subject || null,
    topic: null,
    severity: SEVERITY.INFO,
  });
  await writeTaskStep({
    taskId: task.id, agentName: AGENT_ID, stepNumber,
    stepTitle: "Weakness detection",
    message: `Wrote profile for ${parameters.learnerId}` +
      (studyTipsTaskId ? ` + queued studyTips` : ""),
    status: TASK_STEP_STATUS.COMPLETED, progress: 100,
  });
  await updateLiveAgentState(AGENT_ID, {
    status: "completed", currentTaskId: null, progress: 100,
    lastMessage: `Wrote profile, trend=${_analytics.trend}`,
  });

  return {
    ok: true,
    weaknessProfile: profileFields,
    studyTipsTaskId,
  };
}

module.exports = {
  runWeakness,
  // Pure helpers exported for tests + downstream agents.
  normaliseParameters,
  analyseAttempts,
  gatherLearnerData,
  maybeQueueStudyTips,
  DEFAULT_PARAMETERS,
  AGENT_ID,
};
