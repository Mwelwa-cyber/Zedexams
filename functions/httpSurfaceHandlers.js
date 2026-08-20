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
