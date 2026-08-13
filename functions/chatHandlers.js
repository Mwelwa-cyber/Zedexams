/**
 * Zed, the learner study assistant (the callable half; the SSE half is apiAiChat).
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
exports.buildChatHandlers = (deps) => {
  const {
    CAPABILITY_AI_CHAT,
    HttpsError,
    LEARNER_BLOCK_MESSAGE,
    LIMITS,
    ZED_CHAT_MODEL,
    assertCallableRateLimit,
    assertDailyLimit,
    assertLearnerCapability,
    assertVerifiedAuth,
    buildAnthropicChat,
    callOpenAI,
    checkLearnerText,
    cleanAiString,
    getApiKey,
    getUserRole,
    isStaffRole,
    openaiApiKey,
    recordAppCheckCallable,
    redactForLogs,
    screenLearnerMessage,
  } = deps;

  return {
    aiChat: async (request) => {
      await assertVerifiedAuth(request);
      recordAppCheckCallable(request, "aiChat");

      // Families policy: a learner whose guardian has not approved the account
      // cannot reach the AI assistant. Enforced HERE, not only in the UI —
      // the compliance test is a direct API call with the banner bypassed.
      await assertLearnerCapability(request.auth.uid, CAPABILITY_AI_CHAT);

      const message = cleanAiString(request.data?.message, LIMITS.message);
      if (!message) {
        throw new HttpsError(
          "invalid-argument",
          "Please enter a question for Zed.",
        );
      }

      // Per-user + per-IP burst cap (fail-open), mirroring apiAiChat so the
      // callable path is throttled the same as the SSE HTTP path.
      await assertCallableRateLimit(request, {action: "aiChat"});

      const role = await getUserRole(request.auth.uid);
      await assertDailyLimit(request.auth.uid, role, "chat");

      // Deterministic child-safety handling, ahead of moderation and the model.
      // A child disclosing self-harm or abuse must not receive the generic
      // "let's keep our chat about schoolwork" refusal — that is the platform
      // turning away at the one moment it matters. Fixed reply, no model call,
      // so it still works when the provider is down. See learnerSafetyCore.
      if (!isStaffRole(role)) {
        const screened = screenLearnerMessage(message);
        if (screened.action === "respond") {
          console.warn(JSON.stringify({
            event: "learner_safety_intercept",
            category: screened.category,
            surface: "aiChat",
            // Redacted: a child pasting contact details into a study chat must
            // not create a durable record of them.
            message: redactForLogs(message).slice(0, 200),
          }));
          return {reply: screened.reply, safetyIntercept: screened.category};
        }
      }

      // Learner-safety moderation (AI-003): screen the child's message BEFORE the
      // model call. A positive unsafe verdict returns a gentle refusal (not an
      // error, so the chat UI shows it); a moderation-service outage fails open.
      const apiKey = getApiKey(openaiApiKey);
      const inputModeration = await checkLearnerText(apiKey, message, {label: "aiChat:input"});
      if (inputModeration.blocked) {
        return {reply: LEARNER_BLOCK_MESSAGE, moderated: true};
      }

      const {systemPrompt, messages} = buildAnthropicChat({
        message,
        context: request.data?.context || {},
        history: request.data?.history || [],
        role,
        customSystemPrompt: request.data?.systemPrompt,
      });
      const reply = await callOpenAI(apiKey, {
        systemPrompt,
        messages,
        model: ZED_CHAT_MODEL,
        maxTokens: 1000,
        temperature: 0.35,
        track: {uid: request.auth.uid, tool: "aiChat"},
      });

      // Screen the model OUTPUT before it reaches the child.
      const outputModeration = await checkLearnerText(apiKey, reply, {label: "aiChat:output"});
      if (outputModeration.blocked) {
        return {reply: LEARNER_BLOCK_MESSAGE, moderated: true};
      }

      return {reply};
    },
  };
};
