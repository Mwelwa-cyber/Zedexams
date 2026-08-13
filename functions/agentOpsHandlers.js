/**
 * Admin-triggered agent operations.
 *
 * Phase 5 batch 2 (docs/phase5-plan.md): the BODIES live here; the builders
 * and their frozen options — region, timeout, memory, secrets, App Check —
 * stay in functions/index.js, where the frozen-surface guard reads them.
 * Moving an option here would move it out of the guard's sight, which is the
 * one thing this phase must not do.
 *
 * Bodies are moved VERBATIM. An extraction PR carries no behaviour change, so
 * that a failure can be attributed to relocation or to behaviour and never
 * both; audit burn-down items are separate PRs even on these same functions.
 *
 * Everything the bodies close over is INJECTED rather than re-required. The
 * secret params (`defineSecret` handles) must be the same instances the
 * builders bind — re-declaring them here would create different objects
 * bound to nothing.
 */
exports.buildAgentOpsHandlers = (deps) => {
  const {
    HttpsError,
    admin,
    anthropicApiKey,
    assertAdminSecondFactor,
    assertCallableRateLimit,
    assertVerifiedAuth,
    getUserRole,
    isAdminRole,
    recordAppCheckCallable,
    runFromCala,
  } = deps;

  return {
    retryAgentJob: async (request) => {
      await assertVerifiedAuth(request);
      await assertCallableRateLimit(request, {action: "retryAgentJob", userPerMin: 10});
      recordAppCheckCallable(request, "retryAgentJob");

      const role = await getUserRole(request.auth.uid);
      if (!isAdminRole(role)) {
        throw new HttpsError("permission-denied", "Admins only.");
      }
      // Retrying a content-agent job is an admin content-pipeline op — require MFA.
      await assertAdminSecondFactor(request, {actorRole: role});

      const jobId = typeof request.data?.jobId === "string" ?
        request.data.jobId.trim() : "";
      if (!jobId) {
        throw new HttpsError("invalid-argument", "jobId is required.");
      }

      const ownerUid = request.auth.uid;
      const db = admin.firestore();
      const ref = db.collection("agentJobs").doc(jobId);
      const snap = await ref.get();
      if (!snap.exists) {
        throw new HttpsError("not-found", `agentJobs/${jobId} not found.`);
      }
      const job = {id: jobId, ...(snap.data() || {})};

      if (job.status !== "failed") {
        throw new HttpsError(
          "failed-precondition",
          `Retry only allowed on failed jobs; status is ${job.status}.`,
        );
      }
      const draft = job.output && job.output.aria && job.output.aria.draft;
      if (!draft) {
        throw new HttpsError(
          "failed-precondition",
          "Aria has not produced a draft yet — there is nothing for Cala to check.",
        );
      }

      // Clear the failure marker before the resume, otherwise the UI keeps
      // showing the stale Cala/Reva error while the new run is in flight.
      await ref.set({
        status: "running",
        agentId: "cala",
        error: admin.firestore.FieldValue.delete(),
        retryRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
        retryRequestedBy: ownerUid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});

      try {
        await runFromCala({jobId, anthropicApiKeySecret: anthropicApiKey});
      } catch (err) {
        // runFromCala already writes status='failed' on its own catch
        // branches; this catches a true unexpected throw (firestore down,
        // etc). Re-stamp the error so the admin sees something.
        console.error("retryAgentJob: unexpected throw", err);
        throw new HttpsError(
          "internal",
          `Retry failed unexpectedly: ${String(err && err.message || err).slice(0, 300)}`,
        );
      }

      return {ok: true};
    },

    runDawnBriefing: async (request) => {
    const uid = await assertVerifiedAuth(request, "Sign in required.");
    // Per-user burst cap on a provider-backed (Anthropic managed-agent) call.
    // The single-in-flight guard below stops concurrent duplicates; this stops
    // rapid sequential "Run Dawn now" taps from spraying agent runs.
    await assertCallableRateLimit(request, {action: "runDawnBriefing", userPerMin: 6});

    const db = admin.firestore();
    const callerSnap = await db.collection("users").doc(uid).get();
    const role = callerSnap.exists ? (callerSnap.data()?.role || "") : "";
    if (role !== "admin" && role !== "superAdmin") {
      throw new HttpsError("permission-denied", "Admin only.");
    }

    // One in-flight run at a time — a second "Run Dawn now" while one is still
    // working would just burn agent budget on a duplicate briefing.
    const inFlight = await db.collection("dawnRuns")
        .where("status", "==", "running")
        .limit(1)
        .get();
    if (!inFlight.empty) {
      throw new HttpsError(
          "already-exists",
          "Dawn is already working on a briefing — it'll arrive shortly.",
      );
    }

    const cfgSnap = await db.collection("dawnConfig").doc("default").get();
    const cfg = cfgSnap.exists ? (cfgSnap.data() || {}) : {};
    const agentId = String(cfg.agentId || "").trim();
    const envId = String(cfg.envId || "").trim();
    const vaultId = String(cfg.vaultId || "").trim();
    const toEmail = String(cfg.toEmail || "").trim();
    if (!agentId || !envId) {
      throw new HttpsError(
          "failed-precondition",
          "Dawn isn't configured yet. Add the agent and environment ids " +
          "(from your launch) in the Dawn panel first.",
      );
    }

    const apiKey = (anthropicApiKey.value() || process.env.ANTHROPIC_API_KEY || "").trim();
    if (!apiKey) {
      throw new HttpsError("failed-precondition", "Anthropic API key is not configured.");
    }

    const {startBriefingRun} = require("./agents/runners/dawn");
    let sessionId;
    try {
      sessionId = await startBriefingRun({fetchImpl: fetch, apiKey, agentId, envId, vaultId});
    } catch (err) {
      throw new HttpsError(
          "internal",
          `Couldn't start Dawn: ${String(err && err.message || err).slice(0, 300)}`,
      );
    }

    await db.collection("dawnRuns").doc(sessionId).set({
      sessionId,
      status: "running",
      requestedBy: uid,
      requestedByEmail: callerSnap.data()?.email || null,
      toEmail: toEmail || null,
      startedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {sessionId, status: "running", toEmail: toEmail || null};
  },

    classifyQuestionGrades: async (request) => {
        const uid = await assertVerifiedAuth(request, "Please sign in.");
        await assertCallableRateLimit(request, {action: "classifyQuestionGrades", userPerMin: 6});
        const role = await getUserRole(uid);
        if (role !== "admin" && role !== "superAdmin") {
          throw new HttpsError("permission-denied", "Admin only.");
        }
        // Bulk question grade-classification is an admin content op — require MFA.
        await assertAdminSecondFactor(request, {actorRole: role});
        const items = Array.isArray(request.data && request.data.questions) ?
          request.data.questions.slice(0, 25) : [];
        const {classifyGrade} = require("./teacherTools/gradeReclassifier");
        const anthropicKey = anthropicApiKey.value() || process.env.ANTHROPIC_API_KEY || "";
        const emptyIndex = new Map(); // force the AI path
        const grades = await Promise.all(items.map(async (q) => {
          try {
            const r = await classifyGrade({
              subject: String(q && q.subject || ""),
              topic: String(q && q.topic || ""),
              text: String(q && q.text || ""),
              options: Array.isArray(q && q.options) ? q.options : [],
              storedGrade: String(q && q.storedGrade || ""),
            }, {index: emptyIndex, anthropicKey});
            return r && r.grade ? String(r.grade) : "";
          } catch {
            return "";
          }
        }));
        return {grades};
      },
  };
};
