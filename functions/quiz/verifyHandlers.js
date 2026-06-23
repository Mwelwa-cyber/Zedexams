function createQuizVerifyHandlers({
  onCall,
  HttpsError,
  anthropicApiKey,
  getUserRole,
  isStaffRole,
  assertDailyLimit,
  cleanAiString,
  LIMITS,
  resolveCbcContext,
  runVex,
}) {
  const verifyQuiz = onCall(
      {
        secrets: [anthropicApiKey],
        region: "us-central1",
        timeoutSeconds: 60,
        memory: "512MiB",
      },
      async (request) => {
        if (!request.auth) {
          throw new HttpsError("unauthenticated", "Please sign in first.");
        }
        const role = await getUserRole(request.auth.uid);
        if (!isStaffRole(role)) {
          throw new HttpsError(
              "permission-denied",
              "Only teachers and admins can verify quizzes.",
          );
        }
        await assertDailyLimit(request.auth.uid, role, "verifyQuiz");

        const data = request.data || {};
        const questions = Array.isArray(data.questions) ? data.questions : [];
        const passages = Array.isArray(data.passages) ? data.passages : [];
        if (!questions.length) {
          throw new HttpsError(
              "invalid-argument",
              "No questions to verify.",
          );
        }
        if (questions.length > 50) {
          throw new HttpsError(
              "invalid-argument",
              "Quiz too large to verify (max 50 questions).",
          );
        }
        let payloadSize;
        try {
          payloadSize = JSON.stringify(questions).length +
          JSON.stringify(passages).length;
        } catch {
          throw new HttpsError("invalid-argument", "Quiz payload is not serialisable.");
        }
        if (payloadSize > 60_000) {
          throw new HttpsError(
              "invalid-argument",
              "Quiz payload too large — trim long questions before verifying.",
          );
        }

        const cleanedPassages = passages.slice(0, 20).map((p) => {
          const rawUrl = typeof p?.imageUrl === "string" ? p.imageUrl.trim() : "";
          const imageUrl = /^https:\/\//i.test(rawUrl) ? rawUrl : null;
          return {
            id: cleanAiString(p?.id, 80),
            title: cleanAiString(p?.title, 200),
            passageKind: p?.passageKind === "map" ? "map" : "comprehension",
            instructions: cleanAiString(p?.instructions, 1500),
            passageText: cleanAiString(p?.passageText, 4000),
            imageUrl,
          };
        }).filter((p) => p.id);

        const meta = data.meta || {};
        const grade = cleanAiString(meta.grade, LIMITS.grade);
        const subject = cleanAiString(meta.subject, LIMITS.subject);
        const topic = cleanAiString(meta.topic, LIMITS.topic);
        const subtopic = cleanAiString(meta.subtopic, LIMITS.topic);
        const difficulty = cleanAiString(meta.difficulty, 24);

        let cbcContextBlock = "";
        try {
          const cbc = await resolveCbcContext({grade, subject, topic, subtopic});
          cbcContextBlock = cbc?.contextBlock || "";
        } catch (err) {
          console.warn("verifyQuiz: CBC context unavailable", err?.message);
        }

        return await runVex({
          input: {
            quizId: cleanAiString(data.quizId, 80),
            questions,
            passages: cleanedPassages,
            meta: {grade, subject, topic, subtopic, difficulty},
            cbcContextBlock,
          },
          anthropicApiKeySecret: anthropicApiKey,
        });
      },
  );

  return {verifyQuiz};
}

module.exports = {createQuizVerifyHandlers};
