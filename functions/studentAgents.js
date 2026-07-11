const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {assertVerifiedAuth} = require("./authGuard");
const admin = require("firebase-admin");

const {
  assertDailyLimit,
  callAnthropic,
  cleanString,
  getAnthropicApiKey,
  getUserRole,
  stripJsonFences,
} = require("./aiService");

const DEFAULT_SUBJECTS = [
  "Mathematics",
  "English",
  "Integrated Science",
  "Social Studies",
];

const ALLOWED_TASK_ROUTES = new Set([
  "/dashboard",
  "/quizzes",
  "/lessons",
  "/my-results",
  "/exams",
  "/ai-notes",
  "/ai-practice",
  "/calendar",
]);

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function cleanOptionalDate(value) {
  const text = cleanString(value, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, offset) {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
}

function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.getTime() : 0;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readTopicScore(data) {
  if (!isPlainObject(data)) return {correct: 0, total: 0};
  const correct = Number(data.correct || 0);
  const total = Number(data.total || 0);
  return {
    correct: Number.isFinite(correct) ? correct : 0,
    total: Number.isFinite(total) ? total : 0,
  };
}

function summarizeResults(results) {
  const subjectMap = new Map();
  const topicMap = new Map();

  for (const result of results) {
    const subject = cleanString(result.subject, 80) || "General";
    const percentage = Number(result.percentage);
    if (Number.isFinite(percentage)) {
      const row = subjectMap.get(subject) || {subject, sum: 0, count: 0};
      row.sum += percentage;
      row.count += 1;
      subjectMap.set(subject, row);
    }

    if (!isPlainObject(result.topicScores)) continue;
    for (const [topic, rawScore] of Object.entries(result.topicScores)) {
      const label = cleanString(topic, 120);
      if (!label) continue;
      const score = readTopicScore(rawScore);
      if (score.total <= 0) continue;
      const key = `${subject}::${label}`;
      const row = topicMap.get(key) || {
        topic: label,
        subject,
        correct: 0,
        total: 0,
      };
      row.correct += score.correct;
      row.total += score.total;
      topicMap.set(key, row);
    }
  }

  const subjects = [...subjectMap.values()]
    .map((row) => ({
      subject: row.subject,
      percentage: Math.round(row.sum / Math.max(row.count, 1)),
      attempts: row.count,
    }))
    .sort((a, b) => a.percentage - b.percentage);

  const weakTopics = [...topicMap.values()]
    .map((row) => ({
      topic: row.topic,
      subject: row.subject,
      percentage: Math.round((row.correct / Math.max(row.total, 1)) * 100),
      correct: row.correct,
      total: row.total,
    }))
    .sort((a, b) => a.percentage - b.percentage)
    .slice(0, 8);

  return {subjects, weakTopics};
}

function focusRows({weakTopics, subjects}) {
  const rows = weakTopics.length ?
    weakTopics.map((item) => ({
      label: item.topic,
      subject: item.subject,
      reason: `${item.percentage}% mastery`,
    })) :
    subjects.slice(0, 4).map((item) => ({
      label: item.subject,
      subject: item.subject,
      reason: `${item.percentage}% average`,
    }));

  if (rows.length) return rows.slice(0, 5);
  return DEFAULT_SUBJECTS.map((subject) => ({
    label: subject,
    subject,
    reason: "Start building recent practice data",
  }));
}

function routeForTask(type, subject) {
  if (type === "read") return "/lessons";
  if (type === "results") return "/my-results";
  if (subject) return "/quizzes";
  return "/dashboard";
}

function makeFallbackPlan({profile, params, weakTopics, subjects}) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);

  const minutes = params.minutesPerDay;
  const warmupMinutes = Math.max(5, Math.round(minutes * 0.18));
  const practiceMinutes = Math.max(10, Math.round(minutes * 0.52));
  const reviewMinutes = Math.max(5, minutes - warmupMinutes - practiceMinutes);
  const focus = focusRows({weakTopics, subjects});

  const days = Array.from({length: params.days}, (_, index) => {
    const item = focus[index % focus.length];
    const date = toIsoDate(addDays(start, index));
    const subject = item.subject || item.label;
    const topic = item.label;
    return {
      label: index === 0 ? "Today" : `Day ${index + 1}`,
      date,
      focus: topic,
      checkpoint: "Mark the quiz, then write one mistake to avoid next time.",
      tasks: [
        {
          title: `Review ${topic}`,
          detail: "Read notes or a lesson before practising.",
          minutes: warmupMinutes,
          type: "read",
          subject,
          topic,
          route: routeForTask("read", subject),
        },
        {
          title: `Practise ${subject}`,
          detail: "Take one short quiz and aim for careful corrections.",
          minutes: practiceMinutes,
          type: "practice",
          subject,
          topic,
          route: routeForTask("practice", subject),
        },
        {
          title: "Correct and recap",
          detail: "Review wrong answers and repeat one similar question.",
          minutes: reviewMinutes,
          type: "results",
          subject,
          topic,
          route: routeForTask("results", subject),
        },
      ],
    };
  });

  const grade = profile.grade ? `Grade ${profile.grade}` : "your grade";
  return {
    title: `${grade} study plan`,
    summary: "A balanced plan: revise first, practise next, then correct.",
    generatedAt: new Date().toISOString(),
    minutesPerDay: minutes,
    focusAreas: focus,
    days,
    parentNudge: "Share one completed task and one corrected mistake.",
    nextStep: "Start with the first practice task, then refresh after new results.",
    generatedBy: "fallback",
  };
}

function safeRoute(value, fallback) {
  const route = cleanString(value, 80);
  if (!route || !route.startsWith("/") || route.startsWith("//")) {
    return fallback;
  }
  return ALLOWED_TASK_ROUTES.has(route) ? route : fallback;
}

function normalizeTask(task, fallbackTask) {
  const type = cleanString(task?.type || fallbackTask.type, 24) || "practice";
  const subject = cleanString(task?.subject || fallbackTask.subject, 80);
  const topic = cleanString(task?.topic || fallbackTask.topic, 120);
  return {
    title: cleanString(task?.title || fallbackTask.title, 100),
    detail: cleanString(task?.detail || fallbackTask.detail, 180),
    minutes: clampInt(task?.minutes, 3, 180, fallbackTask.minutes || 10),
    type,
    subject,
    topic,
    route: safeRoute(task?.route, routeForTask(type, subject)),
  };
}

function normalizePlan(rawPlan, fallback) {
  const parsed = isPlainObject(rawPlan) ? rawPlan : {};
  const fallbackDays = Array.isArray(fallback.days) ? fallback.days : [];
  const days = Array.isArray(parsed.days) ?
    parsed.days.slice(0, 14).map((day, index) => {
      const fallbackDay = fallbackDays[index % Math.max(fallbackDays.length, 1)] ||
        fallbackDays[0] || {};
      const fallbackTasks = Array.isArray(fallbackDay.tasks) ?
        fallbackDay.tasks : [];
      const tasks = Array.isArray(day?.tasks) ?
        day.tasks.slice(0, 4).map((task, taskIndex) =>
          normalizeTask(task, fallbackTasks[taskIndex] || fallbackTasks[0] || {}),
        ) :
        fallbackTasks;
      return {
        label: cleanString(day?.label || fallbackDay.label, 40),
        date: cleanOptionalDate(day?.date) || fallbackDay.date || "",
        focus: cleanString(day?.focus || fallbackDay.focus, 120),
        checkpoint: cleanString(day?.checkpoint || fallbackDay.checkpoint, 180),
        tasks,
      };
    }).filter((day) => day.tasks.length) :
    [];

  const focusAreas = Array.isArray(parsed.focusAreas) ?
    parsed.focusAreas.slice(0, 5).map((item, index) => ({
      label: cleanString(item?.label || fallback.focusAreas[index]?.label, 120),
      subject: cleanString(item?.subject || fallback.focusAreas[index]?.subject, 80),
      reason: cleanString(item?.reason || fallback.focusAreas[index]?.reason, 120),
    })).filter((item) => item.label || item.subject) :
    fallback.focusAreas;

  return {
    ...fallback,
    title: cleanString(parsed.title || fallback.title, 100),
    summary: cleanString(parsed.summary || fallback.summary, 300),
    focusAreas: focusAreas.length ? focusAreas : fallback.focusAreas,
    days: days.length ? days : fallback.days,
    parentNudge: cleanString(parsed.parentNudge || fallback.parentNudge, 180),
    nextStep: cleanString(parsed.nextStep || fallback.nextStep, 180),
    generatedAt: new Date().toISOString(),
    generatedBy: "ai",
  };
}

function parseAiPlan(raw) {
  try {
    return JSON.parse(stripJsonFences(raw));
  } catch {
    return null;
  }
}

function buildPrompt({profile, params, results, weakTopics, subjects}) {
  const recent = results.slice(0, 12).map((result) => ({
    title: cleanString(result.quizTitle, 100),
    subject: cleanString(result.subject, 80),
    percentage: Number(result.percentage || 0),
    date: timestampMillis(result.completedAt) ?
      toIsoDate(new Date(timestampMillis(result.completedAt))) :
      "",
  }));

  return [
    "Create a practical study plan for a ZedExams learner in Zambia.",
    "Return ONLY valid JSON. No markdown fences and no prose.",
    "Use this exact shape:",
    "{\"title\":\"\",\"summary\":\"\",\"focusAreas\":[{\"label\":\"\",",
    "\"subject\":\"\",\"reason\":\"\"}],\"days\":[{\"label\":\"Today\",",
    "\"date\":\"YYYY-MM-DD\",\"focus\":\"\",\"tasks\":[{\"title\":\"\",",
    "\"detail\":\"\",\"minutes\":15,\"type\":\"read|practice|results\",",
    "\"subject\":\"\",\"topic\":\"\",\"route\":\"/quizzes\"}],",
    "\"checkpoint\":\"\"}],\"parentNudge\":\"\",\"nextStep\":\"\"}",
    "",
    "Rules:",
    "- Keep tasks specific, short, and age-appropriate.",
    "- Use route values from /quizzes, /lessons, /my-results, /exams,",
    "  /ai-notes, /ai-practice, /calendar, /dashboard.",
    "- Do not create more than 4 tasks per day.",
    "- Total task minutes per day should stay close to minutesPerDay.",
    "- Start with weak topics when available, then balance subjects.",
    "- Avoid medical, legal, or financial advice.",
    "",
    `Learner: ${JSON.stringify({
      grade: profile.grade || null,
      displayName: profile.displayName || "",
      school: profile.school || "",
    })}`,
    `Plan request: ${JSON.stringify(params)}`,
    `Weak topics: ${JSON.stringify(weakTopics.slice(0, 6))}`,
    `Subject stats: ${JSON.stringify(subjects.slice(0, 6))}`,
    `Recent results: ${JSON.stringify(recent)}`,
  ].join("\n");
}

async function loadContext(uid) {
  const db = admin.firestore();
  const [profileSnap, resultsSnap] = await Promise.all([
    db.collection("users").doc(uid).get(),
    db.collection("results")
      .where("userId", "==", uid)
      .orderBy("completedAt", "desc")
      .limit(50)
      .get(),
  ]);

  const profile = profileSnap.exists ? (profileSnap.data() || {}) : {};
  const results = resultsSnap.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() || {}),
  }));
  const summary = summarizeResults(results);
  return {profile, results, ...summary};
}

function createGenerateStudyPlan(
  anthropicApiKeySecret,
  {enforceAppCheck = false, recordAppCheckCallable} = {},
) {
  return onCall(
    {
      secrets: [anthropicApiKeySecret],
      region: "us-central1",
      timeoutSeconds: 45,
      memory: "512MiB",
      enforceAppCheck,
    },
    async (request) => {
      await assertVerifiedAuth(request);
      if (recordAppCheckCallable) {
        recordAppCheckCallable(request, "generateStudyPlan");
      }

      const params = {
        days: clampInt(request.data?.days, 3, 14, 7),
        minutesPerDay: clampInt(request.data?.minutesPerDay, 15, 180, 45),
        examDate: cleanOptionalDate(request.data?.examDate),
        note: cleanString(request.data?.note, 240),
      };

      const {profile, results, weakTopics, subjects} =
        await loadContext(request.auth.uid);
      const fallback = makeFallbackPlan({profile, params, weakTopics, subjects});

      const role = await getUserRole(request.auth.uid);
      try {
        await assertDailyLimit(request.auth.uid, role, "studyPlan");
      } catch (err) {
        if (err?.code === "resource-exhausted") {
          return {
            plan: fallback,
            warning: "Daily AI limit reached. Showing a quick plan instead.",
          };
        }
        throw err;
      }

      try {
        const raw = await callAnthropic(
          getAnthropicApiKey(anthropicApiKeySecret),
          {
            systemPrompt: [
              "You are the ZedExams Study Planner Agent.",
              "You create safe, motivating revision plans for Zambian learners.",
              "Return compact JSON only.",
            ].join(" "),
            messages: [{role: "user", content: buildPrompt({
              profile,
              params,
              results,
              weakTopics,
              subjects,
            })}],
            maxTokens: 1400,
            temperature: 0.25,
            json: true,
            track: {uid: request.auth.uid, tool: "studyPlan"},
          },
        );
        const plan = normalizePlan(parseAiPlan(raw), fallback);
        return {plan};
      } catch (err) {
        console.warn("generateStudyPlan: AI fallback", {
          code: err?.code,
          message: err?.message,
        });
        return {
          plan: fallback,
          warning: "AI planner is using a quick plan right now.",
        };
      }
    },
  );
}

module.exports = {
  createGenerateStudyPlan,
  // Exported for focused node tests without invoking Firebase Functions.
  _private: {
    makeFallbackPlan,
    normalizePlan,
    summarizeResults,
  },
};
