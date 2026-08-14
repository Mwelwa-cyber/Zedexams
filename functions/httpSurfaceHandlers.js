/**
 * Unauthenticated, public-facing HTTP surfaces: the Zed chat SSE endpoint and the
 * inbound Meta WhatsApp webhook (Bonga).
 *
 * Phase 5 batch 3 (docs/phase5-plan.md): the BODIES live here; the builders
 * and their frozen options — region, timeout, memory, secrets, App Check —
 * stay in functions/index.js, where the frozen-surface guard reads them.
 * Moving an option here would move it out of the guard's sight, which is the
 * one thing this phase must not do.
 *
 * Bodies are moved VERBATIM. An extraction PR carries no behaviour change, so
 * that a failure can be attributed to relocation or to behaviour and never
 * both; the audit burn-down items on these same functions are separate PRs.
 *
 * Everything the bodies close over is INJECTED rather than re-required. The
 * secret params (`defineSecret` handles) must be the same instances the
 * builders bind — re-declaring them here would create different objects bound
 * to nothing.
 *
 * Both are reached through Hosting rewrites (/api/ai/chat, /api/whatsapp/webhook)
 * rather than by callable SDK, so their auth is hand-rolled inside the body —
 * which is exactly why they are classified audit-surface and why the audit
 * burn-down on them is a SEPARATE PR from this relocation.
 */
exports.buildHttpSurfaceHandlers = (deps) => {
  const {
    CAPABILITY_AI_CHAT,
    CHAT_HEARTBEAT_MS,
    HttpsError,
    LEARNER_BLOCK_MESSAGE,
    LIMITS,
    ZED_CHAT_MODEL,
    admin,
    anthropicApiKey,
    applyCors,
    assertDailyLimit,
    assertDecodedVerified,
    assertHttpRateLimit,
    assertLearnerCapability,
    buildAnthropicChat,
    callAnthropic,
    callOpenAIStream,
    checkLearnerText,
    checkLearnerTextWindowed,
    cleanAiString,
    getAnthropicApiKey,
    getApiKey,
    getUserRole,
    httpStatusForError,
    isStaffRole,
    openaiApiKey,
    redactForLogs,
    screenLearnerMessage,
    softVerifyAppCheckHttp,
  } = deps;

  return {
    apiAiChat: async (req, res) => {
        // Browser CORS via the shared origin allow-list. The default header
        // set already includes X-Firebase-AppCheck (Audit B3).
        applyCors(req, res);

        // Structured logging + correlation id (OBS-003): trace this request by the
        // id the client sent (src/utils/requestId.js), or mint one, and echo it back
        // so a browser can report it. Every log line below carries `rid`.
        const {createLogger, requestIdFromReq} = require("./logger");
        const rid = requestIdFromReq(req);
        res.set("x-request-id", rid);
        const log = createLogger("apiAiChat", {rid});

        if (req.method === "OPTIONS") {
          res.status(204).send("");
          return;
        }
        if (req.method !== "POST") {
          res.status(405).json({error: "Use POST for Zed chat."});
          return;
        }

        // Declared Content-Type + body cap (SECURITY_ENDPOINT_AUDIT §4.5).
        // Before auth, because it costs nothing and this endpoint's next step
        // is an ID-token verification round-trip. The client
        // (src/utils/aiAssistant.js) sends application/json.
        if (require("./httpRequestGuard").enforceJsonRequest(req, res, {label: "apiAiChat"})) return;

        // ── Auth + validation (before any headers are sent) ─────────────
        let decoded;
        let systemPrompt;
        let messages;
        let apiKey;
        let moderationBlocked = false;
        // Set when learnerSafetyCore intercepts a distress or secrecy message.
        // Streamed verbatim instead of the model reply — see below.
        let safetyReply = null;
        try {
          const token = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
          if (!token) {
            throw new HttpsError("unauthenticated", "Please sign in first.");
          }
          decoded = await admin.auth().verifyIdToken(token);
          await assertDecodedVerified(decoded);
          // Audit B3 — observability + opt-in enforcement gate. Throws
          // permission-denied only when APPCHECK_ENFORCE=1 is set.
          await softVerifyAppCheckHttp(req, "apiAiChat");
          // Per-user + per-IP burst cap (fail-open). Sits in front of the daily
          // quota so a hammering client is rejected cheaply before we build the
          // prompt or touch the model.
          await assertHttpRateLimit(req, res, {action: "aiChat", uid: decoded.uid});

          // Families policy — same gate as the `aiChat` callable. This is the path
          // the SPA actually uses, so gating only the callable would leave the
          // real door open.
          await assertLearnerCapability(decoded.uid, CAPABILITY_AI_CHAT);

          const message = cleanAiString(req.body?.message, LIMITS.message);
          if (!message) {
            throw new HttpsError("invalid-argument", "Please enter a question for Zed.");
          }

          const role = await getUserRole(decoded.uid);
          await assertDailyLimit(decoded.uid, role, "chat");

          log.info("chat_request", {uid: decoded.uid, role});

          // Deterministic child-safety handling, ahead of moderation and the
          // model — same rule as the `aiChat` callable. A child disclosing
          // self-harm or abuse gets a fixed, careful reply naming a trusted adult
          // and a real helpline, not the generic schoolwork redirect.
          if (!isStaffRole(role)) {
            const screened = screenLearnerMessage(message);
            if (screened.action === "respond") {
              console.warn(JSON.stringify({
                event: "learner_safety_intercept",
                category: screened.category,
                surface: "apiAiChat",
                message: redactForLogs(message).slice(0, 200),
              }));
              safetyReply = screened.reply;
            }
          }

          ({systemPrompt, messages} = buildAnthropicChat({
            message,
            context: req.body?.context || {},
            history: req.body?.history || [],
            role,
            customSystemPrompt: req.body?.systemPrompt,
          }));
          apiKey = getApiKey(openaiApiKey);

          // Learner-safety moderation (AI-003): screen the child's message before
          // opening the stream. A positive unsafe verdict streams a gentle refusal
          // instead of the model reply (handled just below, before the real
          // stream's headers). A moderation-service outage fails open.
          const inputModeration = await checkLearnerText(apiKey, message, {label: "apiAiChat:input"});
          moderationBlocked = inputModeration.blocked;
        } catch (error) {
          log.error("chat_auth_error", {
            code: error?.code,
            errorMessage: error?.message,
          });
          res.status(httpStatusForError(error)).json({
            error: error?.message || "Zed is unavailable right now.",
          });
          return;
        }

        // Fixed reply instead of the model, streamed in the same SSE shape the
        // client expects. Two causes, checked in this order:
        //   • safetyReply — a distress or secrecy disclosure. Takes precedence,
        //     because moderation would classify the same message as unsafe and
        //     answer with the generic refusal, which is the wrong answer to a
        //     child asking for help.
        //   • moderationBlocked — the message was flagged unsafe (AI-003).
        const fixedReply = safetyReply || (moderationBlocked ? LEARNER_BLOCK_MESSAGE : null);
        if (fixedReply) {
          res.set("Content-Type", "text/event-stream; charset=utf-8");
          res.set("Cache-Control", "no-cache");
          res.status(200);
          res.write(`data: ${JSON.stringify({text: fixedReply})}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }

        // ── Stream SSE to the client ──────────────────────────────────────
        res.set("Content-Type", "text/event-stream; charset=utf-8");
        res.set("Cache-Control", "no-cache");
        res.set("Connection", "keep-alive");
        res.set("X-Accel-Buffering", "no"); // disable Nginx buffering if present
        res.status(200);
        // Flush an initial keep-alive comment so the client knows the connection opened.
        res.write(": connected\n\n");

        // Heartbeat lives outside the try so `finally` can always clear it.
        let heartbeatTimer = null;
        try {
          // AI-003: the model OUTPUT must be moderated BEFORE it reaches the child,
          // same as the aiChat callable. Streaming tokens live would display unsafe
          // text before we could screen it, so the reply is accumulated, moderated,
          // then sent as one chunk — the client already supports a single-chunk
          // reply (its Android SSE fallback). Input was already moderated above.
          //
          // While buffering + moderating the connection would otherwise go silent,
          // tripping the client's stall watchdog (AI_CHAT_STREAM_STALL_MS = 30s,
          // which resets on ANY bytes it reads). An SSE comment carries no data
          // event, so a TIME-based heartbeat keeps the connection alive. It must be
          // time-based, not token-count-based: a slow or sparse token stream (a long
          // first-token latency) could otherwise miss the 30s window entirely.
          const heartbeat = () => {
            try { res.write(": keepalive\n\n"); } catch (e) { /* client already gone */ }
          };
          heartbeatTimer = setInterval(heartbeat, CHAT_HEARTBEAT_MS);
          let full = "";
          await callOpenAIStream(
            apiKey,
            {
              systemPrompt,
              messages,
              model: ZED_CHAT_MODEL,
              maxTokens: 1000,
              temperature: 0.35,
              track: {uid: decoded.uid, tool: "apiAiChat"},
            },
            (token) => {
              full += token;
            },
          );
          // Screen the ENTIRE reply — moderateText clamps one call to 8000 chars, so
          // a long reply is windowed; content past the first window can't slip through.
          const outputModeration = await checkLearnerTextWindowed(apiKey, full, {label: "apiAiChat:output"});
          if (outputModeration.blocked) {
            log.warn("chat_output_moderated", {uid: decoded.uid, categories: outputModeration.matchedCategories});
          }
          const reply = outputModeration.blocked ? LEARNER_BLOCK_MESSAGE : full;
          res.write(`data: ${JSON.stringify({text: reply})}\n\n`);
          res.write("data: [DONE]\n\n");
        } catch (error) {
          // Route through the request-bound logger so provider outages + mid-stream
          // failures — the incidents most in need of correlation — carry `rid`.
          log.error("chat_stream_error", {
            code: error?.code,
            errorMessage: error?.message,
          });
          // Best-effort: send error event then close. The client uses [ERROR] to
          // surface a user-facing message and fall back gracefully.
          res.write(`data: [ERROR] ${JSON.stringify({error: error?.message || "Zed is unavailable right now."})}\n\n`);
        } finally {
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          res.end();
        }
      },

    apiWhatsAppWebhook: async (req, res) => {
      const meta = require("./metaWhatsApp");

      // GET — Meta subscription verification handshake.
      if (req.method === "GET") {
        const result = meta.verifyWebhookSubscription(req.query || {});
        if (result.ok) {
          res.status(200).send(result.challenge);
        } else {
          console.warn("[whatsappWebhook] verify handshake rejected", result.reason);
          res.status(403).send("verification failed");
        }
        return;
      }
      if (req.method !== "POST") {
        res.status(405).send("Use POST.");
        return;
      }

      // Authenticate the payload. Fail-closed in both directions:
      //   • secret set + bad signature   → 403
      //   • secret unset (cannot verify) → 403, unconditionally
      // An unset META_WHATSAPP_APP_SECRET would otherwise let any caller forge a
      // payload that triggers Anthropic spend, auto-sent WhatsApp replies, and
      // Firestore writes — the public webhook must never accept unverified data.
      // (The WHATSAPP_ALLOW_UNVERIFIED staged-rollout escape hatch was removed: the
      // secret is bound in production, and a "trust everyone" mode on a webhook
      // that can emit outbound sends should not exist to be left on by accident.)
      const auth = meta.verifyInboundSignature({
        rawBody: req.rawBody,
        signature: req.get("x-hub-signature-256") || req.get("X-Hub-Signature-256"),
      });
      if (auth.configured && !auth.ok) {
        console.warn("[whatsappWebhook] rejected: bad X-Hub-Signature-256");
        res.status(403).send("invalid signature");
        return;
      }
      if (!auth.configured) {
        console.error("[whatsappWebhook] rejected: META_WHATSAPP_APP_SECRET unset — refusing unverified payload");
        res.status(403).send("signature verification not configured");
        return;
      }

      // Always ack Meta with 200 at the end so it doesn't retry a payload we've
      // already accepted; processing errors are logged, not surfaced as non-200.
      try {
        const inbound = meta.parseInboundMessages(req.body || {});
        if (!inbound.length) {
          // Status callbacks (delivered/read) and non-text messages land here.
          res.status(200).send("ok");
          return;
        }

        const db = admin.firestore();

        // Kill-switch — if an admin paused Bonga, log the inbound but don't reply.
        let paused = false;
        try {
          const ctrl = await db.collection("agentControl").doc("bonga").get();
          paused = Boolean(ctrl.exists && ctrl.data() && ctrl.data().paused);
        } catch (_e) { /* default to active */ }

        // Resolve the Anthropic key once; degrade to the templated reply if unbound.
        let apiKey = "";
        try {
          apiKey = getAnthropicApiKey(anthropicApiKey) || "";
        } catch (_e) { apiKey = ""; }

        const draftReply = async ({systemPrompt, messages}) => {
          if (!apiKey || paused) return "";
          return await callAnthropic(apiKey, {
            systemPrompt,
            messages,
            model: "claude-haiku-4-5-20251001",
            maxTokens: 600,
            temperature: 0.4,
            track: {tool: "bonga-whatsapp"},
          });
        };

        const {runBongaReply} = require("./agents/runners/bonga");
        const {normalizeToWhatsApp, sendWhatsAppText} = meta;

        // Process at most a handful per delivery (Meta batches; abuse-bound).
        for (const msg of inbound.slice(0, 5)) {
          const convRef = db.collection("whatsappConversations").doc(msg.from);
          let conv = {};
          try {
            const snap = await convRef.get();
            conv = (snap.exists && snap.data()) || {};
          } catch (_e) { conv = {}; }

          // Dedupe Meta redeliveries of the same inbound message id.
          if (msg.messageId && conv.lastInboundId === msg.messageId) continue;

          // Durable dedupe (SECURITY_ENDPOINT_AUDIT §4.1). The check above only
          // remembers the LAST id per conversation, so Meta redelivering A after
          // B has already arrived gets A processed a second time — and neither
          // of the two things that follow is idempotent: an Anthropic call and
          // an outbound WhatsApp send to a real person. The ledger remembers
          // every id, and the claim happens BEFORE either cost is incurred.
          // Fails open, so a Firestore blip degrades to the single-id check
          // rather than dropping a learner's message.
          {
            const {claimWebhookEvent} = require("./webhookEventLedger");
            const {whatsappEventParts, PROVIDERS} = require("./webhookEventLedgerCore");
            const claim = await claimWebhookEvent({
              db,
              provider: PROVIDERS.WHATSAPP,
              parts: whatsappEventParts(msg),
              meta: {messageId: msg.messageId || null},
            });
            if (!claim.shouldProcess) continue;
          }

          const history = Array.isArray(conv.history) ? conv.history : [];
          const {kind, reply, usedFallback} = await runBongaReply({
            inbound: msg,
            history,
            draftReply,
          });

          const to = normalizeToWhatsApp(msg.from);
          let sendResult = {status: "skipped", reason: paused ? "agent-paused" : "no-recipient"};
          if (to && !paused) {
            sendResult = await sendWhatsAppText({to, body: reply});
          }

          // Append both turns, trimmed, so the next message has context.
          const nextHistory = [
            ...history,
            {role: "user", text: msg.text, at: msg.timestamp || Date.now()},
            {role: "assistant", text: reply, at: Date.now()},
          ].slice(-16);

          try {
            await convRef.set({
              phone: msg.from,
              name: msg.name || conv.name || null,
              lastInboundId: msg.messageId || null,
              lastInboundText: msg.text.slice(0, 500),
              lastInboundAt: admin.firestore.FieldValue.serverTimestamp(),
              lastKind: kind,
              lastReplyText: reply.slice(0, 1000),
              lastReplyStatus: sendResult.status,
              lastReplyError: sendResult.error || null,
              lastReplyUsedFallback: Boolean(usedFallback),
              lastReplyAt: admin.firestore.FieldValue.serverTimestamp(),
              messageCount: admin.firestore.FieldValue.increment(1),
              history: nextHistory,
            }, {merge: true});
          } catch (err) {
            console.error("[whatsappWebhook] conversation write failed", err);
          }

          console.log("[whatsappWebhook] replied", {
            from: msg.from, kind, status: sendResult.status, usedFallback,
          });
        }

        res.status(200).send("ok");
      } catch (err) {
        console.error("[whatsappWebhook] processing error", err);
        // 200 so Meta doesn't hammer us with retries for an already-read payload.
        res.status(200).send("ok");
      }
    },
  };
};
