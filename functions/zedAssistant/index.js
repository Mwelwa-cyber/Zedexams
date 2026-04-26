/**
 * Zed Telegram assistant — entrypoint.
 *
 * Exports three Cloud Functions:
 *
 *   - telegramWebhook   onRequest, public URL, called by Telegram.
 *                       Validates the secret token, the username/chat-id
 *                       allowlist, then runs the Claude tool-loop and
 *                       replies on the chat.
 *
 *   - zedSetTelegramWebhook   onCall, admin-only. Convenience: registers
 *                             this Cloud Function's URL with Telegram via
 *                             setWebhook. Saves the user from running
 *                             curl by hand.
 *
 *   - zedTelegramWebhookInfo  onCall, admin-only. Returns Telegram's view
 *                             of the current webhook (URL, last error,
 *                             pending update count) for debugging.
 *
 * All three are wired into functions/index.js as named exports.
 */

const {onRequest, onCall, HttpsError} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");

const telegram = require("./telegram");
const voice = require("./voice");
const {runAgent} = require("./agent");
const {buildToolDefinitions, buildToolRunner} = require("./tools");
const {SYSTEM_PROMPT} = require("./systemPrompt");

const telegramBotToken = defineSecret("TELEGRAM_BOT_TOKEN");
const telegramWebhookSecret = defineSecret("TELEGRAM_WEBHOOK_SECRET");
const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY");
const openaiApiKey = defineSecret("OPENAI_API_KEY");

const ZED_SECRETS = [
  telegramBotToken,
  telegramWebhookSecret,
  anthropicApiKey,
  openaiApiKey,
];

const TELEGRAM_HEADER = "x-telegram-bot-api-secret-token";
const MAX_INCOMING_TEXT = 2000;
const RECENT_TURNS = 6;
const MAX_VOICE_DURATION_S = 120;
const VOICE_OVERFLOW_NOTE =
  "\n\n(voice cut at 3000 chars — full reply above)";

function getEnv(key) {
  const value = process.env[key];
  return value ? String(value).trim() : "";
}

function getAllowedUsername() {
  return getEnv("ZED_TELEGRAM_ALLOWED_USERNAME").toLowerCase();
}

function getAllowedChatId() {
  return getEnv("ZED_TELEGRAM_ALLOWED_CHAT_ID");
}

function isAuthorizedSender({chatId, username}) {
  const allowedChatId = getAllowedChatId();
  if (allowedChatId) {
    return String(chatId) === String(allowedChatId);
  }
  const allowedUsername = getAllowedUsername();
  if (allowedUsername) {
    return String(username || "").toLowerCase() === allowedUsername;
  }
  // Fail closed: if neither var is set, no one is allowed.
  return false;
}

function chatIdHint({chatId, username}) {
  return (
    "Hi — you're not on the allowlist for this assistant.\n\n" +
    `Your Telegram chat ID is: ${chatId}\n` +
    `Your username: ${username ? "@" + username : "(none)"}\n\n` +
    "If this is your bot, set ZED_TELEGRAM_ALLOWED_CHAT_ID to the value " +
    "above and redeploy."
  );
}

async function loadRecentHistory(chatId) {
  try {
    const snap = await admin.firestore()
      .collection("zedAssistantChats")
      .doc(String(chatId))
      .collection("turns")
      .orderBy("createdAt", "desc")
      .limit(RECENT_TURNS)
      .get();
    return snap.docs
      .map((d) => d.data())
      .reverse()
      .filter((turn) => turn?.role && turn?.text)
      .map((turn) => ({
        role: turn.role === "assistant" ? "assistant" : "user",
        content: String(turn.text).slice(0, 1500),
      }));
  } catch (err) {
    console.warn("loadRecentHistory failed", err?.message);
    return [];
  }
}

async function clearChatHistory(chatId) {
  // Deletes every turn for this chat. Used by /reset when stale context
  // (e.g. an old "I can't browse" reply) is poisoning current behavior.
  // Batched delete — Firestore caps at 500 ops per batch, so we loop.
  let total = 0;
  try {
    const turns = admin.firestore()
      .collection("zedAssistantChats")
      .doc(String(chatId))
      .collection("turns");
    // Iterate in pages of 400 (well under the 500 batch limit) until empty.
    // 100 turns per chat is a lot already, so this almost always exits in
    // one pass.
    for (let i = 0; i < 20; i++) {
      const snap = await turns.limit(400).get();
      if (snap.empty) break;
      const batch = admin.firestore().batch();
      snap.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      total += snap.size;
      if (snap.size < 400) break;
    }
  } catch (err) {
    console.warn("clearChatHistory failed", err?.message);
  }
  return total;
}

async function appendTurn(chatId, role, text) {
  try {
    await admin.firestore()
      .collection("zedAssistantChats")
      .doc(String(chatId))
      .collection("turns")
      .add({
        role,
        text: String(text || "").slice(0, 4000),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
  } catch (err) {
    console.warn("appendTurn failed", err?.message);
  }
}

function buildUserMessage(messageText) {
  const today = new Date().toISOString().slice(0, 10);
  return [
    `[date=${today}]`,
    String(messageText || "").slice(0, MAX_INCOMING_TEXT),
  ].join("\n");
}

async function transcribeIncomingVoice(message, {token, openaiKey}) {
  const v = message.voice;
  if (!v?.file_id) return {ok: false, reason: "no_file_id"};
  if (typeof v.duration === "number" && v.duration > MAX_VOICE_DURATION_S) {
    return {ok: false, reason: "too_long", duration: v.duration};
  }
  if (!openaiKey) return {ok: false, reason: "no_openai_key"};
  try {
    const fileMeta = await telegram.getFile(token, v.file_id);
    const audio = await telegram.downloadFile(token, fileMeta.file_path);
    const transcript = await voice.transcribeOgg(openaiKey, audio);
    if (!transcript) return {ok: false, reason: "empty_transcript"};
    return {ok: true, transcript, durationS: v.duration || 0};
  } catch (err) {
    console.error("zedAssistant: transcribe failed", err?.message);
    return {ok: false, reason: "stt_error", error: err?.message};
  }
}

async function speakReply(token, chatId, replyText) {
  // Synthesize a voice note and post it. Failures here should never block
  // the text reply that already shipped — caller invokes us best-effort.
  try {
    const {audio, truncated} = await voice.synthesizeOgg(replyText);
    await telegram.sendVoice(token, chatId, audio);
    return {ok: true, truncated};
  } catch (err) {
    console.warn("zedAssistant: TTS/sendVoice failed", err?.message);
    return {ok: false, error: err?.message};
  }
}

async function handleTelegramUpdate(update, {token, anthropicKey, openaiKey}) {
  const message = update?.message || update?.edited_message;
  if (!message) return {handled: false, reason: "no_message"};

  const chatId = message.chat?.id;
  const fromUser = message.from || {};
  const username = fromUser.username || "";
  let text = String(message.text || "").trim();
  const isVoiceMessage = Boolean(message.voice?.file_id);

  if (!chatId) return {handled: false, reason: "no_chat_id"};

  // Allowlist gate runs BEFORE we spend tokens or hit Whisper. Strangers
  // shouldn't be able to drain our Whisper quota by sending voice notes.
  // Silent rejection: we log the chat ID server-side (so the founder can
  // recover it from logs to bootstrap a new device), but the bot does NOT
  // reply. The chatIdHint helper is still wired up for the bootstrap path.
  if (!isAuthorizedSender({chatId, username})) {
    console.warn("zedAssistant: ignored unauthorized sender", {
      chatId,
      username,
      hint: chatIdHint({chatId, username}),
    });
    return {handled: true, ignored: "unauthorized"};
  }

  if (isVoiceMessage) {
    await telegram.sendChatAction(token, chatId, "typing");
    const stt = await transcribeIncomingVoice(message, {token, openaiKey});
    if (!stt.ok) {
      const friendly = sttFriendlyError(stt);
      await telegram.sendMessage(token, chatId, friendly);
      return {handled: true, ignored: "voice_failed", reason: stt.reason};
    }
    text = stt.transcript;
  } else if (!text) {
    await telegram.sendMessage(
      token,
      chatId,
      "I only handle text and voice messages right now.",
    );
    return {handled: true, ignored: "non_text"};
  }

  if (text === "/start" || text === "/help") {
    await telegram.sendMessage(
      token,
      chatId,
      "Zed assistant ready. Try:\n" +
      "  • What's left on games?\n" +
      "  • Summarize today's learner activity\n" +
      "  • Draft a Claude prompt to fix the quiz editor\n" +
      "  • Make 5 Grade 5 Maths questions on fractions\n\n" +
      "Commands:\n" +
      "  /reset — wipe my memory of this chat",
    );
    return {handled: true};
  }

  if (text === "/reset") {
    const cleared = await clearChatHistory(chatId);
    await telegram.sendMessage(
      token,
      chatId,
      `Memory wiped (${cleared} turns cleared). Fresh slate.`,
    );
    return {handled: true, cleared};
  }

  await telegram.sendChatAction(token, chatId, "typing");

  const history = await loadRecentHistory(chatId);
  await appendTurn(chatId, "user", text);

  const messages = [
    ...history,
    {role: "user", content: buildUserMessage(text)},
  ];

  let result;
  try {
    result = await runAgent(anthropicKey, {
      systemPrompt: SYSTEM_PROMPT,
      messages,
      tools: buildToolDefinitions(),
      runTool: buildToolRunner({chatId}),
    });
  } catch (err) {
    console.error("zedAssistant agent failed", err?.message);
    await telegram.sendMessage(
      token,
      chatId,
      "Sorry — I hit an error. Try again in a moment, or rephrase.",
    );
    return {handled: true, error: err?.message};
  }

  const reply = result.text ||
    "I didn't produce a reply. Try rephrasing the question.";
  await telegram.sendMessage(token, chatId, reply);
  await appendTurn(chatId, "assistant", reply);

  // Voice reply runs best-effort after the text reply has shipped. If TTS
  // or sendVoice fails, the user still has the full text answer above.
  const tts = await speakReply(token, chatId, reply);
  if (tts.ok && tts.truncated) {
    await telegram.sendMessage(token, chatId, VOICE_OVERFLOW_NOTE.trim());
  }

  return {
    handled: true,
    toolCalls: result.toolCalls.map((c) => c.name),
    stopReason: result.stopReason,
    inputMode: isVoiceMessage ? "voice" : "text",
    voiceReply: tts.ok ? "sent" : "skipped",
  };
}

function sttFriendlyError(stt) {
  switch (stt.reason) {
    case "too_long":
      return `I only listen to clips up to ${MAX_VOICE_DURATION_S} seconds — ` +
        "try again with a shorter recording.";
    case "no_openai_key":
      return "Voice transcription isn't configured yet — please type instead.";
    case "empty_transcript":
      return "Couldn't catch any words in that — say it again or type.";
    case "stt_error":
    default:
      return "Couldn't transcribe that — say it again or type.";
  }
}

exports.telegramWebhook = onRequest(
  {
    region: "us-central1",
    timeoutSeconds: 60,
    secrets: ZED_SECRETS,
    cors: false,
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({error: "POST only"});
      return;
    }

    const expectedSecret = telegramWebhookSecret.value() ||
      process.env.TELEGRAM_WEBHOOK_SECRET || "";
    const sentSecret = req.get(TELEGRAM_HEADER) || "";
    if (!expectedSecret || sentSecret !== expectedSecret) {
      console.warn("zedAssistant: bad webhook secret", {
        hasExpected: Boolean(expectedSecret),
        sentLength: sentSecret.length,
      });
      res.status(401).json({error: "unauthorized"});
      return;
    }

    const token = telegramBotToken.value() || process.env.TELEGRAM_BOT_TOKEN;
    const anthropicKey = anthropicApiKey.value() ||
      process.env.ANTHROPIC_API_KEY;
    // OPENAI_API_KEY is optional — without it, voice messages get a
    // friendly text reply asking the user to type. Text messages still
    // work normally.
    const openaiKey = openaiApiKey.value() ||
      process.env.OPENAI_API_KEY || "";
    if (!token || !anthropicKey) {
      console.error("zedAssistant: missing secrets", {
        hasToken: Boolean(token),
        hasAnthropic: Boolean(anthropicKey),
      });
      // Still 200 — Telegram retries 5xx aggressively, and the user
      // visibility of "missing secret" doesn't help anyone.
      res.status(200).json({ok: false, reason: "not_configured"});
      return;
    }

    try {
      const summary = await handleTelegramUpdate(req.body || {}, {
        token,
        anthropicKey,
        openaiKey,
      });
      res.status(200).json({ok: true, ...summary});
    } catch (err) {
      console.error("zedAssistant: unhandled webhook error", err);
      res.status(200).json({ok: false, error: "internal"});
    }
  },
);

async function assertAdminCaller(request) {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Please sign in first.");
  }
  const snap = await admin.firestore()
    .doc(`users/${request.auth.uid}`)
    .get();
  if (!snap.exists || snap.data()?.role !== "admin") {
    throw new HttpsError("permission-denied", "Admin only.");
  }
}

exports.zedSetTelegramWebhook = onCall(
  {region: "us-central1", timeoutSeconds: 30, secrets: ZED_SECRETS},
  async (request) => {
    await assertAdminCaller(request);

    const url = String(request.data?.url || "").trim();
    if (!/^https:\/\//i.test(url)) {
      throw new HttpsError(
        "invalid-argument",
        "url is required and must be HTTPS.",
      );
    }
    const token = telegramBotToken.value();
    const secretToken = telegramWebhookSecret.value();
    if (!token || !secretToken) {
      throw new HttpsError(
        "failed-precondition",
        "TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET must be set.",
      );
    }

    const result = await telegram.setWebhook(token, {
      url,
      secretToken,
      allowedUpdates: ["message", "edited_message"],
    });
    const info = await telegram.getWebhookInfo(token);
    const botInfo = await telegram.getMe(token);
    return {ok: true, setResult: result, info, bot: botInfo};
  },
);

exports.zedTelegramWebhookInfo = onCall(
  {region: "us-central1", timeoutSeconds: 15, secrets: ZED_SECRETS},
  async (request) => {
    await assertAdminCaller(request);
    const token = telegramBotToken.value();
    if (!token) {
      throw new HttpsError(
        "failed-precondition",
        "TELEGRAM_BOT_TOKEN is not set.",
      );
    }
    const [info, bot] = await Promise.all([
      telegram.getWebhookInfo(token),
      telegram.getMe(token),
    ]);
    return {info, bot};
  },
);

exports.apiZedAssistantChat = require("./web").apiZedAssistantChat;
