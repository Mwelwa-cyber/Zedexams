function createZedChatHandlers({
  onCall,
  HttpsError,
  openaiApiKey,
  appCheckEnforceCallable,
  recordAppCheckCallable,
  cleanAiString,
  LIMITS,
  getUserRole,
  assertDailyLimit,
  buildAnthropicChat,
  callOpenAI,
  getApiKey,
  zedChatModel,
}) {
  const aiChat = onCall(
      {
        secrets: [openaiApiKey],
        region: "us-central1",
        timeoutSeconds: 30,
        enforceAppCheck: appCheckEnforceCallable,
        consumeAppCheckToken: true,
      },
      async (request) => {
        if (!request.auth) {
          throw new HttpsError("unauthenticated", "Please sign in first.");
        }
        recordAppCheckCallable(request, "aiChat");

        const message = cleanAiString(request.data?.message, LIMITS.message);
        if (!message) {
          throw new HttpsError(
              "invalid-argument",
              "Please enter a question for Zed.",
          );
        }

        const role = await getUserRole(request.auth.uid);
        await assertDailyLimit(request.auth.uid, role, "chat");

        const {systemPrompt, messages} = buildAnthropicChat({
          message,
          context: request.data?.context || {},
          history: request.data?.history || [],
          role,
          customSystemPrompt: request.data?.systemPrompt,
        });
        const reply = await callOpenAI(getApiKey(openaiApiKey), {
          systemPrompt,
          messages,
          model: zedChatModel,
          maxTokens: 1000,
          temperature: 0.35,
          track: {uid: request.auth.uid, tool: "aiChat"},
        });

        return {reply};
      },
  );

  return {aiChat};
}

module.exports = {createZedChatHandlers};
