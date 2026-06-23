function createDawnHandlers({
  onCall,
  HttpsError,
  admin,
  anthropicApiKey,
}) {
  const runDawnBriefing = onCall({
    region: "us-central1",
    timeoutSeconds: 60,
    memory: "256MiB",
    secrets: [anthropicApiKey],
  }, async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");

    const db = admin.firestore();
    const callerSnap = await db.collection("users").doc(uid).get();
    const role = callerSnap.exists ? (callerSnap.data()?.role || "") : "";
    if (role !== "admin" && role !== "superAdmin") {
      throw new HttpsError("permission-denied", "Admin only.");
    }

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

    const {startBriefingRun} = require("./runners/dawn");
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
  });

  return {runDawnBriefing};
}

module.exports = {createDawnHandlers};
