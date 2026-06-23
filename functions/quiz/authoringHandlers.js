function createQuizAuthoringHandlers({
  onCall,
  HttpsError,
  anthropicApiKey,
  appCheckEnforceCallable,
  recordAppCheckCallable,
  cleanAiString,
  LIMITS,
  getUserRole,
  assertDailyLimit,
  isStaffRole,
  isEditQuestionAction,
  buildExplainMessages,
  buildEditQuestionMessages,
  buildQuizMessages,
  toAnthropicShape,
  callAnthropic,
  getAnthropicApiKey,
  parseEditedQuestion,
  parseGeneratedQuiz,
  resolveCbcContext,
}) {
  const explainAnswer = onCall(
      {
        secrets: [anthropicApiKey],
        region: "us-central1",
        timeoutSeconds: 30,
        enforceAppCheck: appCheckEnforceCallable,
        consumeAppCheckToken: true,
      },
      async (request) => {
        if (!request.auth) {
          throw new HttpsError("unauthenticated", "Please sign in first.");
        }
        recordAppCheckCallable(request, "explainAnswer");

        const question = cleanAiString(request.data?.question, LIMITS.question);
        const correctAnswer = cleanAiString(
            request.data?.correctAnswer,
            LIMITS.answer,
        );
        if (!question || !correctAnswer) {
          throw new HttpsError(
              "invalid-argument",
              "Question and correct answer are required.",
          );
        }

        const role = await getUserRole(request.auth.uid);
        await assertDailyLimit(request.auth.uid, role, "explain");

        const {systemPrompt, messages} = toAnthropicShape(buildExplainMessages({
          ...request.data,
          question,
          correctAnswer,
        }));
        const explanation = await callAnthropic(getAnthropicApiKey(anthropicApiKey), {
          systemPrompt,
          messages,
          maxTokens: 400,
          temperature: 0.25,
          track: {uid: request.auth.uid, tool: "explainAnswer"},
        });

        return {explanation};
      },
  );

  const editQuizQuestion = onCall(
      {
        secrets: [anthropicApiKey],
        region: "us-central1",
        timeoutSeconds: 45,
        enforceAppCheck: appCheckEnforceCallable,
        consumeAppCheckToken: true,
      },
      async (request) => {
        if (!request.auth) {
          throw new HttpsError("unauthenticated", "Please sign in first.");
        }
        recordAppCheckCallable(request, "editQuizQuestion");

        const action = cleanAiString(request.data?.action, 30);
        if (!isEditQuestionAction(action)) {
          throw new HttpsError("invalid-argument", "Unknown AI edit action.");
        }
        const question = cleanAiString(request.data?.question, LIMITS.question);
        if (!question) {
          throw new HttpsError(
              "invalid-argument",
              "There is no question text to work with yet.",
          );
        }

        const role = await getUserRole(request.auth.uid);
        if (!isStaffRole(role)) {
          throw new HttpsError(
              "permission-denied",
              "Only teachers and admins can use the AI question editor.",
          );
        }
        await assertDailyLimit(request.auth.uid, role, "editQuestion");

        const options = Array.isArray(request.data?.options) ?
          request.data.options.slice(0, 6).map((opt) => cleanAiString(opt, 300)) :
          [];

        const {systemPrompt, messages} = toAnthropicShape(
            buildEditQuestionMessages({
              action,
              question,
              options,
              correctAnswer: cleanAiString(request.data?.correctAnswer, 40),
              subject: request.data?.subject,
              grade: request.data?.grade,
              topic: request.data?.topic,
              imageUrl: request.data?.imageUrl,
              optionImages: Array.isArray(request.data?.optionImages) ?
                request.data.optionImages.slice(0, 6) : [],
              passageImageUrl: request.data?.passageImageUrl,
            }),
        );
        const raw = await callAnthropic(getAnthropicApiKey(anthropicApiKey), {
          systemPrompt,
          messages,
          maxTokens: 900,
          temperature: action === "suggest_answer" ? 0.1 : 0.4,
          json: true,
          track: {uid: request.auth.uid, tool: "editQuizQuestion"},
        });

        return {action, patch: parseEditedQuestion(raw)};
      },
  );

  const generateQuizQuestions = onCall(
      {
        secrets: [anthropicApiKey],
        region: "us-central1",
        timeoutSeconds: 45,
        enforceAppCheck: appCheckEnforceCallable,
        consumeAppCheckToken: true,
      },
      async (request) => {
        if (!request.auth) {
          throw new HttpsError("unauthenticated", "Please sign in first.");
        }
        recordAppCheckCallable(request, "generateQuizQuestions");

        const role = await getUserRole(request.auth.uid);
        if (!isStaffRole(role)) {
          throw new HttpsError(
              "permission-denied",
              "Only teachers and admins can generate quiz questions.",
          );
        }

        const subject = cleanAiString(request.data?.subject, LIMITS.subject);
        const grade = cleanAiString(request.data?.grade, LIMITS.grade);
        const topic = cleanAiString(request.data?.topic, LIMITS.topic);
        if (!subject || !grade || !topic) {
          throw new HttpsError(
              "invalid-argument",
              "Subject, grade, and topic are required.",
          );
        }

        await assertDailyLimit(request.auth.uid, role, "generateQuiz");

        const subtopic = cleanAiString(request.data?.subtopic, LIMITS.topic);
        const framework = String(request.data?.framework) === "2013" ?
          "2013" : "2023";
        const {contextBlock, kbWarning} = await resolveCbcContext({
          grade,
          subject,
          topic,
          subtopic,
          framework,
        });

        const {messages: rawMessages} = buildQuizMessages({
          ...request.data,
          subject,
          grade,
          topic,
          subtopic,
          cbcContextBlock: contextBlock,
        });
        const {systemPrompt, messages} = toAnthropicShape(rawMessages);
        const raw = await callAnthropic(getAnthropicApiKey(anthropicApiKey), {
          systemPrompt,
          messages,
          maxTokens: 6000,
          temperature: 0.3,
          json: true,
          track: {uid: request.auth.uid, tool: "generateQuizQuestions"},
        });

        return {
          questions: parseGeneratedQuiz(raw, topic, {
            topic,
            subject,
            grade,
            subtopic,
          }),
          warning: kbWarning || null,
        };
      },
  );

  return {
    explainAnswer,
    editQuizQuestion,
    generateQuizQuestions,
  };
}

module.exports = {createQuizAuthoringHandlers};
