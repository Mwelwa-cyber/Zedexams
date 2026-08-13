/**
 * AI callables that read IMAGES — diagram labels, picture naming, class-list pages.
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
exports.buildVisualAiHandlers = (deps) => {
  const {
    HttpsError,
    MAX_CLASS_LIST_PAGES,
    MAX_PICTURES_PER_CALL,
    admin,
    anthropicApiKey,
    assertCallableRateLimit,
    assertDailyLimit,
    assertVerifiedAuth,
    getAnthropicApiKey,
    getUserRole,
    isStaffRole,
    recordAppCheckCallable,
    runAutoLabelDiagram,
    runClassListExtraction,
    runNamePictures,
  } = deps;

  return {
    autoLabelDiagram: async (request) => {
      await assertVerifiedAuth(request);
      await assertCallableRateLimit(request, {action: "autoLabelDiagram", userPerMin: 8});
      recordAppCheckCallable(request, "autoLabelDiagram");
      const role = await getUserRole(request.auth.uid);
      if (!isStaffRole(role)) {
        throw new HttpsError(
          "permission-denied",
          "Only teachers and admins can auto-label diagrams.",
        );
      }
      await assertDailyLimit(request.auth.uid, role, "autoLabelDiagram");
      return runAutoLabelDiagram({
        dataUrl: String(request.data?.dataUrl || ""),
        subject: String(request.data?.subject || "").slice(0, 100),
        grade: String(request.data?.grade ?? "").slice(0, 20),
        topic: String(request.data?.topic || "").slice(0, 200),
        subtopic: String(request.data?.subtopic || "").slice(0, 200),
        framework: String(request.data?.framework || "").slice(0, 20),
        existingWords: Array.isArray(request.data?.existingWords) ?
          request.data.existingWords : [],
        apiKey: getAnthropicApiKey(anthropicApiKey),
        uid: request.auth.uid,
      });
    },

    nameBankPictures: async (request) => {
      await assertVerifiedAuth(request);
      await assertCallableRateLimit(request, {action: "nameBankPictures", userPerMin: 6});
      const role = await getUserRole(request.auth.uid);
      if (role !== "admin" && role !== "superAdmin") {
        throw new HttpsError(
          "permission-denied",
          "Only admins can auto-name picture-bank images.",
        );
      }

      const data = request.data || {};
      const ids = Array.isArray(data.pictureIds) ?
        data.pictureIds.map((x) => String(x || "").trim()).filter(Boolean) : [];
      if (!ids.length) {
        throw new HttpsError("invalid-argument", "No pictures to name.");
      }
      if (ids.length > 40) {
        throw new HttpsError(
          "invalid-argument",
          "Too many pictures at once — name 40 or fewer per run.",
        );
      }

      const db = admin.firestore();
      const bucket = admin.storage().bucket();

      // Load docs + download bytes. Best-effort per picture: a missing blob or
      // an oversized file is skipped with a warning rather than failing the run.
      const pictures = [];
      const warnings = [];
      await Promise.all(ids.map(async (id) => {
        try {
          const snap = await db.collection("pictureBank").doc(id).get();
          if (!snap.exists) {
            warnings.push(`Picture ${id} no longer exists.`);
            return;
          }
          const pic = snap.data() || {};
          if (!pic.storagePath) {
            warnings.push(`"${pic.name || id}" has no stored file to read.`);
            return;
          }
          const [buf] = await bucket.file(pic.storagePath).download();
          if (!buf || buf.length === 0 || buf.length > 10 * 1024 * 1024) {
            warnings.push(`"${pic.name || id}" is empty or too large to read.`);
            return;
          }
          pictures.push({
            id,
            mediaType: pic.contentType || "image/png",
            data: buf.toString("base64"),
            subjectHint: pic.subject || "",
            gradeBand: pic.gradeBand || "",
          });
        } catch (err) {
          warnings.push(`Could not read picture ${id} (${err?.message || "error"}).`);
        }
      }));

      if (!pictures.length) {
        throw new HttpsError(
          "failed-precondition",
          warnings[0] || "None of the selected pictures could be read.",
        );
      }

      const {results, warnings: aiWarnings} = await runNamePictures({
        pictures,
        anthropicKey: anthropicApiKey.value(),
      });
      warnings.push(...aiWarnings);

      // Write suggestions back. Keep status:'staged' — the admin reviews and
      // activates. aiNamedAt lets the UI badge freshly-named cards.
      let named = 0;
      await Promise.all(results.map(async (r) => {
        if (!r.ok || !r.name) return;
        try {
          await db.collection("pictureBank").doc(r.id).update({
            aiSuggestedName: r.name,
            aiSuggestedKeywords: r.keywords,
            aiSuggestedSubject: r.subject,
            aiNamedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          named += 1;
        } catch (err) {
          warnings.push(`Could not save the name for ${r.id} (${err?.message || "error"}).`);
        }
      }));

      return {
        named,
        total: pictures.length,
        perCall: MAX_PICTURES_PER_CALL,
        results: results.map((r) => ({
          id: r.id, name: r.name, keywords: r.keywords,
          subject: r.subject, ok: r.ok,
        })),
        warnings,
      };
    },

    extractClassListPages: async (request) => {
      await assertVerifiedAuth(request);
      await assertCallableRateLimit(request, {
        action: "extractClassListPages",
        userPerMin: 8,
      });
      recordAppCheckCallable(request, "extractClassListPages");
      const role = await getUserRole(request.auth.uid);
      if (!isStaffRole(role)) {
        throw new HttpsError(
          "permission-denied",
          "Only teachers and administrators can capture a class list.",
        );
      }
      const pages = Array.isArray(request.data?.pages) ? request.data.pages : [];
      if (!pages.length) {
        throw new HttpsError("invalid-argument", "No page images were supplied.");
      }
      if (pages.length > MAX_CLASS_LIST_PAGES) {
        throw new HttpsError(
          "invalid-argument",
          `Too many pages in one call (max ${MAX_CLASS_LIST_PAGES}). ` +
          "Send them in batches.",
        );
      }
      await assertDailyLimit(request.auth.uid, role, "captureClassList");
      return runClassListExtraction({
        pages,
        apiKey: getAnthropicApiKey(anthropicApiKey),
        uid: request.auth.uid,
      });
    },
  };
};
