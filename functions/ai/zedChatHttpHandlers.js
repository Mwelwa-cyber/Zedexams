function createZedChatHttpHandlers({
  onRequest,
  HttpsError,
  admin,
  openaiApiKey,
  applyCors,
  softVerifyAppCheckHttp,
  cleanAiString,
  LIMITS,
  getUserRole,
  assertDailyLimit,
  buildAnthropicChat,
  getApiKey,
  callOpenAIStream,
  zedChatModel,
  httpStatusForError,
}) {
  const apiAiChat = onRequest(
      {secrets: [openaiApiKey], region: "us-central1", timeoutSeconds: 60},
      async (req, res) => {
        applyCors(req, res);

        if (req.method === "OPTIONS") {
          res.status(204).send("");
          return;
        }
        if (req.method !== "POST") {
          res.status(405).json({error: "Use POST for Zed chat."});
          return;
        }

        let decoded;
        let systemPrompt;
        let messages;
        let apiKey;
        try {
          const token = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
          if (!token) {
            throw new HttpsError("unauthenticated", "Please sign in first.");
          }
          decoded = await admin.auth().verifyIdToken(token);
          await softVerifyAppCheckHttp(req, "apiAiChat");

          const message = cleanAiString(req.body?.message, LIMITS.message);
          if (!message) {
            throw new HttpsError("invalid-argument", "Please enter a question for Zed.");
          }

          const role = await getUserRole(decoded.uid);
          await assertDailyLimit(decoded.uid, role, "chat");

          ({systemPrompt, messages} = buildAnthropicChat({
            message,
            context: req.body?.context || {},
            history: req.body?.history || [],
            role,
            customSystemPrompt: req.body?.systemPrompt,
          }));
          apiKey = getApiKey(openaiApiKey);
        } catch (error) {
          console.error("apiAiChat auth/validation error", {
            code: error?.code,
            message: error?.message,
          });
          res.status(httpStatusForError(error)).json({
            error: error?.message || "Zed is unavailable right now.",
          });
          return;
        }

        res.set("Content-Type", "text/event-stream; charset=utf-8");
        res.set("Cache-Control", "no-cache");
        res.set("Connection", "keep-alive");
        res.set("X-Accel-Buffering", "no");
        res.status(200);
        res.write(": connected\n\n");

        try {
          await callOpenAIStream(
              apiKey,
              {
                systemPrompt,
                messages,
                model: zedChatModel,
                maxTokens: 1000,
                temperature: 0.35,
                track: {uid: decoded.uid, tool: "apiAiChat"},
              },
              (token) => {
                res.write(`data: ${JSON.stringify({text: token})}\n\n`);
              },
          );
          res.write("data: [DONE]\n\n");
        } catch (error) {
          console.error("apiAiChat stream error", {
            code: error?.code,
            message: error?.message,
          });
          res.write(`data: [ERROR] ${JSON.stringify({error: error?.message || "Zed is unavailable right now."})}\n\n`);
        } finally {
          res.end();
        }
      },
  );

  return {apiAiChat};
}

module.exports = {createZedChatHttpHandlers};
