function createNoteAiHandlers({
  onCall,
  HttpsError,
  cleanAiString,
  LIMITS,
  getUserRole,
  assertDailyLimit,
  isStaffRole,
  runNoteInsights,
  runGenerateNoteSmart,
  runNoteImport,
  runNoteOcr,
  getAnthropicApiKey,
  anthropicApiKey,
  appCheckEnforceCallable,
  recordAppCheckCallable,
}) {
  // Learner-facing "AI Summary + Key Points" for a published note. Cached per
  // note (noteInsights/{noteId}), so a cache hit costs nothing and the daily
  // limit only bites on first-generation spam. Any signed-in user may call it;
  // the runner enforces that the note is published.
  const generateNoteInsights = onCall(
      {
        secrets: [anthropicApiKey],
        region: "us-central1",
        timeoutSeconds: 45,
        memory: "256MiB",
        enforceAppCheck: appCheckEnforceCallable,
        consumeAppCheckToken: true,
      },
      async (request) => {
        if (!request.auth) {
          throw new HttpsError("unauthenticated", "Please sign in first.");
        }
        recordAppCheckCallable(request, "generateNoteInsights");

        const noteId = cleanAiString(request.data?.noteId, 80);
        if (!noteId) {
          throw new HttpsError("invalid-argument", "A note id is required.");
        }

        const role = await getUserRole(request.auth.uid);
        await assertDailyLimit(request.auth.uid, role, "noteInsights");

        return await runNoteInsights({
          noteId,
          uid: request.auth.uid,
          apiKey: getAnthropicApiKey(anthropicApiKey),
        });
      },
  );

  // Staff-only: generate AI auto-highlights for a study note and cache them in
  // noteSmart/{noteId}. Mirrors generateNoteInsights but restricted to staff
  // (teachers/admins) because highlight generation is admin-triggered, not
  // lazy-on-first-view.
  const generateNoteSmart = onCall(
      {
        secrets: [anthropicApiKey],
        region: "us-central1",
        timeoutSeconds: 90,
        memory: "256MiB",
        enforceAppCheck: appCheckEnforceCallable,
        consumeAppCheckToken: true,
      },
      async (request) => {
        if (!request.auth) {
          throw new HttpsError("unauthenticated", "Please sign in first.");
        }
        recordAppCheckCallable(request, "generateNoteSmart");
        const role = await getUserRole(request.auth.uid);
        if (!isStaffRole(role)) {
          throw new HttpsError("permission-denied", "Only teachers and admins can generate highlights.");
        }
        const noteId = cleanAiString(request.data?.noteId, 200);
        if (!noteId) {
          throw new HttpsError("invalid-argument", "noteId is required.");
        }
        await assertDailyLimit(request.auth.uid, role, "noteSmart");
        try {
          return await runGenerateNoteSmart({
            noteId,
            uid: request.auth.uid,
            apiKey: getAnthropicApiKey(anthropicApiKey),
          });
        } catch (e) {
          if (e.code === "not-found") throw new HttpsError("not-found", e.message);
          if (e.code === "failed-precondition") throw new HttpsError("failed-precondition", e.message);
          throw new HttpsError("internal", "Could not generate highlights. Please try again.");
        }
      },
  );

  // Notes document import — converts raw document text into structured `study`
  // note blocks via Claude. Staff-only, app-check enforced, daily-capped.
  const structureImportedNote = onCall(
      {
        secrets: [anthropicApiKey],
        region: "us-central1",
        timeoutSeconds: 120,
        enforceAppCheck: appCheckEnforceCallable,
        consumeAppCheckToken: true,
      },
      async (request) => {
        if (!request.auth) {
          throw new HttpsError("unauthenticated", "Please sign in first.");
        }
        recordAppCheckCallable(request, "structureImportedNote");
        const role = await getUserRole(request.auth.uid);
        if (!isStaffRole(role)) {
          throw new HttpsError(
              "permission-denied",
              "Only teachers and admins can import notes.",
          );
        }
        const fileName = cleanAiString(request.data?.fileName, LIMITS.importFileName);
        const documentText = cleanAiString(
            request.data?.documentText,
            LIMITS.importDocumentText,
        );
        if (!documentText || documentText.length < 80) {
          throw new HttpsError(
              "invalid-argument",
              "Not enough document text was available to build a note.",
          );
        }
        await assertDailyLimit(request.auth.uid, role, "importNote");
        return runNoteImport({
          documentText,
          fileName,
          apiKey: getAnthropicApiKey(anthropicApiKey),
          uid: request.auth.uid,
        });
      },
  );

  // Notes scanned-PDF OCR — client batches rendered page images here; each call
  // returns a plain-text transcription that the structureImportedNote callable
  // then converts into study blocks. Staff-only, app-check enforced, daily-capped.
  const ocrNotePages = onCall(
      {
        secrets: [anthropicApiKey],
        region: "us-central1",
        timeoutSeconds: 240,
        memory: "1GiB",
        enforceAppCheck: appCheckEnforceCallable,
        consumeAppCheckToken: true,
      },
      async (request) => {
        if (!request.auth) {
          throw new HttpsError("unauthenticated", "Please sign in first.");
        }
        recordAppCheckCallable(request, "ocrNotePages");
        const role = await getUserRole(request.auth.uid);
        if (!isStaffRole(role)) {
          throw new HttpsError(
              "permission-denied",
              "Only teachers and admins can import notes.",
          );
        }
        const pages = Array.isArray(request.data?.pages) ? request.data.pages : [];
        if (!pages.length) {
          throw new HttpsError("invalid-argument", "No page images were supplied.");
        }
        if (pages.length > 8) {
          throw new HttpsError(
              "invalid-argument",
              "Too many pages in one OCR call (max 8).",
          );
        }
        await assertDailyLimit(request.auth.uid, role, "importNote");
        return runNoteOcr({
          pages,
          apiKey: getAnthropicApiKey(anthropicApiKey),
          uid: request.auth.uid,
        });
      },
  );

  return {
    generateNoteInsights,
    generateNoteSmart,
    structureImportedNote,
    ocrNotePages,
  };
}

module.exports = {createNoteAiHandlers};
