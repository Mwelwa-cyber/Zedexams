function createQuizImportHandlers({
  onCall,
  HttpsError,
  anthropicApiKey,
  geminiApiKey,
  appCheckEnforceCallable,
  recordAppCheckCallable,
  getUserRole,
  isStaffRole,
  assertDailyLimit,
  cleanAiString,
  LIMITS,
  callGemini,
  buildImportStructureMessages,
  toAnthropicShape,
  callAnthropic,
  getAnthropicApiKey,
  parseStructuredImport,
  runScannedQuizImport,
  runSuggestQuizAnswers,
}) {
  const structureImportedQuiz = onCall(
      {
        secrets: [anthropicApiKey, geminiApiKey],
        region: "us-central1",
        timeoutSeconds: 90,
        enforceAppCheck: appCheckEnforceCallable,
        consumeAppCheckToken: true,
      },
      async (request) => {
        if (!request.auth) {
          throw new HttpsError("unauthenticated", "Please sign in first.");
        }
        recordAppCheckCallable(request, "structureImportedQuiz");

        const role = await getUserRole(request.auth.uid);
        if (!isStaffRole(role)) {
          throw new HttpsError(
              "permission-denied",
              "Only teachers and admins can use smart quiz import.",
          );
        }

        const fileName = cleanAiString(
            request.data?.fileName,
            LIMITS.importFileName,
        );
        const documentText = cleanAiString(
            request.data?.documentText,
            LIMITS.importDocumentText,
        );
        const localDraft = cleanAiString(
            request.data?.localDraft,
            LIMITS.importLocalDraft,
        );

        if (!documentText || documentText.length < 120) {
          throw new HttpsError(
              "invalid-argument",
              "Not enough document text was available for smart import.",
          );
        }

        await assertDailyLimit(request.auth.uid, role, "smartImport");

        const geminiKey = geminiApiKey.value() || process.env.GEMINI_API_KEY || "";
        let claudeInputHint = localDraft;
        if (geminiKey) {
          try {
            const geminiText = await callGemini(geminiKey, {
              systemPrompt: [
                "You are a document scanner for the ZedExams smart-import pipeline.",
                "Read the raw exam document below and emit a STRUCTURED JSON list",
                "of every question you can find, in the order they appear.",
                "Prefer recall over precision — include any uncertain candidates;",
                "a downstream CBC reviewer will refine and drop bad ones.",
                "For each question, group passages with their child questions.",
                "Preserve mathematics and tables with this markup (do not flatten",
                "them to prose or placeholders): fractions as \\frac{3}{4} (mixed:",
                "1\\frac{1}{3}); other inline maths wrapped in $...$ e.g. $\\sqrt{49}$,",
                "$x^2$; vertical/column arithmetic as one token on its own line",
                "[[vmath op=- lines=954751,362948 answer=]] (op = + - * /, lines are",
                "the operands top-to-bottom); and any table as a GitHub-style",
                "Markdown table (header row, |---| separator, then data rows).",
                "Do NOT invent questions or answers. Return only the JSON object",
                "described below — no markdown fences, no preamble.",
              ].join(" "),
              userPrompt: [
                fileName ? `File name: ${fileName}` : "",
                "",
                "Raw document text:",
                documentText,
                "",
                "Return JSON in this shape:",
                "{\"candidates\":[",
                "  {\"sourceQuestionNumber\":1,\"text\":\"...\",\"options\":[\"\",\"\",\"\",\"\"],",
                "   \"correctAnswer\":\"\",\"explanation\":\"\",\"passageTitle\":\"\",",
                "   \"passageText\":\"\"}",
                "]}",
              ].filter(Boolean).join("\n"),
              maxTokens: 6000,
              temperature: 0.1,
              responseJson: true,
            });
            claudeInputHint = `Pre-structured extraction (use to anchor question grouping, but verify against the raw document above): ${geminiText.slice(0, 60000)}`;
            if (!geminiText.trim()) claudeInputHint = localDraft;
          } catch (geminiErr) {
            console.warn(
                "structureImportedQuiz: Gemini step failed, falling back to Claude-only",
                {message: geminiErr?.message?.slice(0, 200)},
            );
          }
        }

        const {systemPrompt, messages} = toAnthropicShape(buildImportStructureMessages({
          fileName,
          documentText,
          localDraft: claudeInputHint,
        }));
        const raw = await callAnthropic(getAnthropicApiKey(anthropicApiKey), {
          systemPrompt,
          messages,
          maxTokens: 8000,
          temperature: 0.2,
          json: true,
          track: {uid: request.auth.uid, tool: "structureImportedQuiz"},
        });

        return parseStructuredImport(raw);
      },
  );

  const structureScannedQuiz = onCall(
      {
        secrets: [anthropicApiKey, geminiApiKey],
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
        recordAppCheckCallable(request, "structureScannedQuiz");

        const role = await getUserRole(request.auth.uid);
        if (!isStaffRole(role)) {
          throw new HttpsError(
              "permission-denied",
              "Only teachers and admins can import scanned papers.",
          );
        }

        const pages = Array.isArray(request.data?.pages) ? request.data.pages : [];
        if (!pages.length) {
          throw new HttpsError(
              "invalid-argument",
              "No page images were supplied for scanned import.",
          );
        }

        await assertDailyLimit(request.auth.uid, role, "scannedImport");

        return runScannedQuizImport({
          pages,
          fileName: cleanAiString(request.data?.fileName, LIMITS.importFileName),
          subjectHint: cleanAiString(request.data?.subjectHint, 80),
          gradeHint: cleanAiString(request.data?.gradeHint, 20),
          anthropicKey: getAnthropicApiKey(anthropicApiKey),
          geminiKey: geminiApiKey.value() || process.env.GEMINI_API_KEY || "",
          uid: request.auth.uid,
        });
      },
  );

  const suggestQuizAnswers = onCall(
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
        recordAppCheckCallable(request, "suggestQuizAnswers");

        const role = await getUserRole(request.auth.uid);
        if (!isStaffRole(role)) {
          throw new HttpsError(
              "permission-denied",
              "Only teachers and admins can suggest answers.",
          );
        }

        const questions = Array.isArray(request.data?.questions) ?
          request.data.questions : [];
        if (!questions.length) {
          throw new HttpsError(
              "invalid-argument",
              "No questions were supplied for answer suggestion.",
          );
        }

        await assertDailyLimit(request.auth.uid, role, "suggestAnswers");

        return runSuggestQuizAnswers({
          questions,
          subject: cleanAiString(request.data?.subject, 80),
          grade: cleanAiString(request.data?.grade, 20),
          anthropicKey: getAnthropicApiKey(anthropicApiKey),
          uid: request.auth.uid,
        });
      },
  );

  return {
    structureImportedQuiz,
    structureScannedQuiz,
    suggestQuizAnswers,
  };
}

module.exports = {createQuizImportHandlers};
