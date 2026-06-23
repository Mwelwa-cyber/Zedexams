function createRetryHandlers({
  onCall,
  HttpsError,
  admin,
  anthropicApiKey,
  appCheckEnforceCallable,
  recordAppCheckCallable,
  getUserRole,
  runFromCala,
}) {
  const retryAgentJob = onCall(
      {
        secrets: [anthropicApiKey],
        region: "us-central1",
        timeoutSeconds: 300,
        memory: "512MiB",
        enforceAppCheck: appCheckEnforceCallable,
        consumeAppCheckToken: true,
      },
      async (request) => {
        if (!request.auth) {
          throw new HttpsError("unauthenticated", "Please sign in first.");
        }
        recordAppCheckCallable(request, "retryAgentJob");

        const role = await getUserRole(request.auth.uid);
        if (role !== "admin") {
          throw new HttpsError("permission-denied", "Admins only.");
        }

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
          console.error("retryAgentJob: unexpected throw", err);
          throw new HttpsError(
              "internal",
              `Retry failed unexpectedly: ${String(err && err.message || err).slice(0, 300)}`,
          );
        }

        return {ok: true};
      },
  );

  return {retryAgentJob};
}

module.exports = {createRetryHandlers};
