function createNameBankHandlers({
  onCall,
  HttpsError,
  admin,
  anthropicApiKey,
  getUserRole,
  runNamePictures,
  MAX_PICTURES_PER_CALL,
}) {
  const nameBankPictures = onCall(
      {
        secrets: [anthropicApiKey],
        region: "us-central1",
        timeoutSeconds: 300,
        memory: "1GiB",
      },
      async (request) => {
        if (!request.auth) {
          throw new HttpsError("unauthenticated", "Please sign in first.");
        }
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
  );

  return {nameBankPictures};
}

module.exports = {createNameBankHandlers};
