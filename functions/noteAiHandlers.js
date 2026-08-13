/**
 * AI callables over study NOTES — insights, highlights, import, OCR.
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
exports.buildNoteAiHandlers = (deps) => {
  const {
    HttpsError,
    LIMITS,
    anthropicApiKey,
    assertCallableRateLimit,
    assertDailyLimit,
    assertVerifiedAuth,
    cleanAiString,
    getAnthropicApiKey,
    getUserRole,
    isStaffRole,
    recordAppCheckCallable,
    runGenerateNoteSmart,
    runNoteImport,
    runNoteInsights,
    runNoteOcr,
  } = deps;

  return {
    generateNoteInsights: async (request) => {
      await assertVerifiedAuth(request);
      await assertCallableRateLimit(request, {action: "generateNoteInsights", userPerMin: 15});
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

    generateNoteSmart: async (request) => {
      await assertVerifiedAuth(request);
      await assertCallableRateLimit(request, {action: "generateNoteSmart", userPerMin: 12});
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

    structureImportedNote: async (request) => {
      await assertVerifiedAuth(request);
      await assertCallableRateLimit(request, {action: "structureImportedNote", userPerMin: 8});
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

    ocrNotePages: async (request) => {
      await assertVerifiedAuth(request);
      await assertCallableRateLimit(request, {action: "ocrNotePages", userPerMin: 8});
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
  };
};
