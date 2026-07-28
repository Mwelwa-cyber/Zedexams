const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {assertVerifiedAuth} = require("./authGuard");
const {assertCallableRateLimit} = require("./rateLimit");
const admin = require("firebase-admin");

const {
  assertDailyLimit,
  callAnthropic,
  getAnthropicApiKey,
  getUserRole,
} = require("./aiService");

// Pure decision logic (summaries, fallback plan, plan normalisation, prompt
// shaping) lives in ./studentAgentsCore so it tests under plain `node` with
// no Firebase dependency. This module keeps only the Firestore + model I/O.
const {
  cleanString,
  clampInt,
  cleanOptionalDate,
  summarizeResults,
  makeFallbackPlan,
  normalizePlan,
  parseAiPlan,
  buildPrompt,
} = require("./studentAgentsCore");

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
      // B3 / OBS-005: per-user burst cap on this Anthropic study-plan call.
      await assertCallableRateLimit(request, {action: "generateStudyPlan", userPerMin: 12});
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
