/**
 * WhatsApp webhook entrypoint for the Zed assistant.
 *
 * Mirrors functions/zedAssistant/index.js:telegramWebhook but for the
 * WhatsApp Cloud API by Meta.
 *
 *   GET  → verification handshake (Meta calls this once when you register
 *          the webhook URL in the Meta app dashboard).
 *   POST → incoming messages. Allowlisted by phone number; supports text
 *          and voice (audio/ogg-opus) — uses the same Whisper STT and
 *          Google TTS helpers as the Telegram bot.
 *
 * Conversation memory is partitioned at zedAssistantChats/wa:{phone}/turns
 * so WhatsApp threads don't bleed into Telegram or the web client.
 *
 * Outgoing voice tip: Meta's free-form-message window is 24h after the
 * user's last message. This bot is founder-only; the founder is always the
 * one initiating, so we stay inside the window in normal use.
 */

const {onRequest} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");

const whatsapp = require("./whatsapp");
const voice = require("./voice");
const {runAgent} = require("./agent");
const {buildToolDefinitions, buildToolRunner} = require("./tools");
const {SYSTEM_PROMPT} = require("./systemPrompt");

const whatsappAccessToken = defineSecret("WHATSAPP_ACCESS_TOKEN");
const whatsappPhoneNumberId = defineSecret("WHATSAPP_PHONE_NUMBER_ID");
const whatsappVerifyToken = defineSecret("WHATSAPP_VERIFY_TOKEN");
const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY");
const openaiApiKey = defineSecret("OPENAI_API_KEY");

const WA_SECRETS = [
  whatsappAccessToken,
  whatsappPhoneNumberId,
  whatsappVerifyToken,
  anthropicApiKey,
  openaiApiKey,
];

const MAX_INCOMING_TEXT = 2000;
const RECENT_TURNS = 6;
const MAX_VOICE_DURATION_S = 120;
const VOICE_OVERFLOW_NOTE =
  "(voice cut at 3000 chars — full reply above)";

function getEnv(key) {
  const value = process.env[key];
  return value ? String(value).trim() : "";
}

function getAllowedNumbers() {
  // Comma-separated E.164 numbers without leading +. Empty = no one allowed
  // (fail-closed). Mirrors the Telegram username/chat-id model.
  return getEnv("ZED_WHATSAPP_ALLOWED_NUMBERS")
    .split(",")
    .map((s) => s.replace(/[^0-9]/g, ""))
    .filter(Boolean);
}

function isAuthorizedSender(fromNumber) {
  const allowed = getAllowedNumbers();
  if (!allowed.length) return false;
  return allowed.includes(String(fromNumber).replace(/[^0-9]/g, ""));
}

function chatIdFor(phoneNumber) {
  return `wa:${String(phoneNumber).replace(/[^0-9]/g, "")}`;
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
    console.warn("zedAssistant.wa loadRecentHistory failed", err?.message);
    return [];
  }
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
    console.warn("zedAssistant.wa appendTurn failed", err?.message);
  }
}

async function clearChatHistory(chatId) {
  let total = 0;
  try {
    const turns = admin.firestore()
      .collection("zedAssistantChats")
      .doc(String(chatId))
      .collection("turns");
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
    console.warn("zedAssistant.wa clearChatHistory failed", err?.message);
  }
  return total;
}

async function getChatVoice(chatId) {
  try {
    const snap = await admin.firestore()
      .collection("zedAssistantChats")
      .doc(String(chatId))
      .get();
    const stored = snap.exists ? snap.data()?.voiceURI : null;
    if (stored && voice.ALLOWED_VOICES.has(stored)) return stored;
  } catch (err) {
    console.warn("zedAssistant.wa getChatVoice failed", err?.message);
  }
  return voice.DEFAULT_VOICE;
}

async function setChatVoice(chatId, voiceURI) {
  if (!voice.ALLOWED_VOICES.has(voiceURI)) {
    throw new Error(`Voice '${voiceURI}' not allowed`);
  }
  await admin.firestore()
    .collection("zedAssistantChats")
    .doc(String(chatId))
    .set({voiceURI, voiceUpdatedAt: admin.firestore.FieldValue.serverTimestamp()},
      {merge: true});
}

function buildVoiceListMessage(currentURI) {
  const lines = ["Pick a voice for Zed. Reply with /voice <number>.", ""];
  voice.VOICE_CATALOG.forEach((v, i) => {
    const marker = v.voiceURI === currentURI ? " ← current" : "";
    lines.push(`${i + 1}. ${v.name}${marker}`);
  });
  return lines.join("\n");
}

function buildUserMessage(messageText) {
  const today = new Date().toISOString().slice(0, 10);
  return [
    `[date=${today}]`,
    String(messageText || "").slice(0, MAX_INCOMING_TEXT),
  ].join("\n");
}

async function transcribeIncomingVoice({audioId, durationS}, {accessToken, openaiKey}) {
  if (!audioId) return {ok: false, reason: "no_audio_id"};
  if (typeof durationS === "number" && durationS > MAX_VOICE_DURATION_S) {
    return {ok: false, reason: "too_long", durationS};
  }
  if (!openaiKey) return {ok: false, reason: "no_openai_key"};
  try {
    const meta = await whatsapp.getMedia(accessToken, audioId);
    if (!meta?.url) throw new Error("WhatsApp getMedia returned no url");
    const audio = await whatsapp.downloadMedia(accessToken, meta.url);
    const transcript = await voice.transcribeOgg(openaiKey, audio);
    if (!transcript) return {ok: false, reason: "empty_transcript"};
    return {ok: true, transcript};
  } catch (err) {
    console.error("zedAssistant.wa: transcribe failed", err?.message);
    return {ok: false, reason: "stt_error", error: err?.message};
  }
}

async function speakReply({accessToken, phoneNumberId, to, replyText, chatId}) {
  try {
    const preferred = await getChatVoice(chatId);
    const {audio, truncated} = await voice.synthesizeOgg(replyText, {
      voice: preferred,
    });
    await whatsapp.sendVoiceNote(accessToken, phoneNumberId, to, audio);
    return {ok: true, truncated};
  } catch (err) {
    console.warn("zedAssistant.wa: TTS/sendVoiceNote failed", err?.message);
    return {ok: false, error: err?.message};
  }
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

async function handleVoiceCommand({accessToken, phoneNumberId, to, chatId, args}) {
  const arg = String(args || "").trim();
  if (!arg) {
    const current = await getChatVoice(chatId);
    await whatsapp.sendMessage(accessToken, phoneNumberId, to,
      buildVoiceListMessage(current));
    return;
  }
  const num = Number.parseInt(arg, 10);
  if (!Number.isFinite(num) || num < 1 || num > voice.VOICE_CATALOG.length) {
    await whatsapp.sendMessage(accessToken, phoneNumberId, to,
      `Pick a number between 1 and ${voice.VOICE_CATALOG.length}. ` +
      "Send /voice on its own to see the list.");
    return;
  }
  const chosen = voice.VOICE_CATALOG[num - 1];
  await setChatVoice(chatId, chosen.voiceURI);
  await whatsapp.sendMessage(accessToken, phoneNumberId, to,
    `Voice set to ${chosen.name}. Send any message to hear it.`);
}

function extractFirstMessage(body) {
  // Meta wraps everything: object → entry[] → changes[] → value → messages[].
  // We only care about the first message in the first change of the first
  // entry — the Cloud API delivers one webhook per inbound message in
  // practice, but be defensive.
  const value = body?.entry?.[0]?.changes?.[0]?.value;
  const message = value?.messages?.[0];
  if (!message) return null;
  return {
    fromNumber: message.from,
    type: message.type,
    text: message.text?.body || "",
    audioId: message.audio?.id || message.voice?.id || null,
    durationS: message.audio?.duration || message.voice?.duration || null,
    contactName: value?.contacts?.[0]?.profile?.name || "",
  };
}

async function handleWhatsAppUpdate(body, {accessToken, phoneNumberId, openaiKey, anthropicKey}) {
  const message = extractFirstMessage(body);
  if (!message) return {handled: false, reason: "no_message"};

  const {fromNumber, type, audioId, durationS} = message;
  let text = String(message.text || "").trim();
  const isVoiceMessage = type === "audio" || type === "voice";

  if (!fromNumber) return {handled: false, reason: "no_from"};

  if (!isAuthorizedSender(fromNumber)) {
    console.warn("zedAssistant.wa: ignored unauthorized sender", {fromNumber});
    return {handled: true, ignored: "unauthorized"};
  }

  const chatId = chatIdFor(fromNumber);

  if (isVoiceMessage) {
    const stt = await transcribeIncomingVoice({audioId, durationS}, {accessToken, openaiKey});
    if (!stt.ok) {
      await whatsapp.sendMessage(accessToken, phoneNumberId, fromNumber,
        sttFriendlyError(stt));
      return {handled: true, ignored: "voice_failed", reason: stt.reason};
    }
    text = stt.transcript;
  } else if (type !== "text" || !text) {
    await whatsapp.sendMessage(accessToken, phoneNumberId, fromNumber,
      "I only handle text and voice messages right now.");
    return {handled: true, ignored: "non_text"};
  }

  if (text === "/start" || text === "/help") {
    await whatsapp.sendMessage(accessToken, phoneNumberId, fromNumber,
      "Zed assistant ready. Try:\n" +
      "  • What's left on games?\n" +
      "  • Summarize today's learner activity\n" +
      "  • Make 5 Grade 5 Maths questions on fractions\n\n" +
      "Commands:\n" +
      "  /code <task> — write code for me; opens a draft PR\n" +
      "  /voice — list and pick a voice for Zed\n" +
      "  /reset — wipe my memory of this chat");
    return {handled: true};
  }

  if (text === "/code") {
    await whatsapp.sendMessage(accessToken, phoneNumberId, fromNumber,
      "Usage: /code <what you want changed>\n\n" +
      "Example:\n" +
      "  /code add a 'share my score' button to QuizResultsV2 that " +
      "copies a link to clipboard\n\n" +
      "I'll open a draft PR and ping you back here when it's ready. " +
      "I can't touch security rules, secrets, CI, or package.json.");
    return {handled: true, command: "code", action: "usage"};
  }

  if (text.startsWith("/code ")) {
    const taskText = text.slice("/code ".length).trim();
    if (!taskText) {
      await whatsapp.sendMessage(accessToken, phoneNumberId, fromNumber,
        "Empty /code task. Send /code on its own to see usage.");
      return {handled: true, command: "code", action: "empty"};
    }
    const queueRef = await admin.firestore()
      .collection("zedAssistantCoderTasks")
      .add({
        task: taskText.slice(0, 1500),
        channel: "whatsapp",
        chatId: String(fromNumber),
        status: "queued",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    await whatsapp.sendMessage(accessToken, phoneNumberId, fromNumber,
      "On it. I'll ping back here when the draft PR is ready.");
    return {handled: true, command: "code", taskId: queueRef.id};
  }

  if (text === "/voice" || text.startsWith("/voice ")) {
    const args = text === "/voice" ? "" : text.slice("/voice ".length);
    await handleVoiceCommand({accessToken, phoneNumberId, to: fromNumber, chatId, args});
    return {handled: true, command: "voice"};
  }

  if (text === "/reset") {
    const cleared = await clearChatHistory(chatId);
    await whatsapp.sendMessage(accessToken, phoneNumberId, fromNumber,
      `Memory wiped (${cleared} turns cleared). Fresh slate.`);
    return {handled: true, cleared};
  }

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
    console.error("zedAssistant.wa agent failed", err?.message);
    await whatsapp.sendMessage(accessToken, phoneNumberId, fromNumber,
      "Sorry — I hit an error. Try again in a moment, or rephrase.");
    return {handled: true, error: err?.message};
  }

  const reply = result.text ||
    "I didn't produce a reply. Try rephrasing the question.";
  await whatsapp.sendMessage(accessToken, phoneNumberId, fromNumber, reply);
  await appendTurn(chatId, "assistant", reply);

  const tts = await speakReply({
    accessToken,
    phoneNumberId,
    to: fromNumber,
    replyText: reply,
    chatId,
  });
  if (tts.ok && tts.truncated) {
    await whatsapp.sendMessage(accessToken, phoneNumberId, fromNumber,
      VOICE_OVERFLOW_NOTE);
  }

  return {
    handled: true,
    toolCalls: result.toolCalls.map((c) => c.name),
    stopReason: result.stopReason,
    inputMode: isVoiceMessage ? "voice" : "text",
    voiceReply: tts.ok ? "sent" : "skipped",
  };
}

exports.whatsappWebhook = onRequest(
  {
    region: "us-central1",
    timeoutSeconds: 60,
    secrets: WA_SECRETS,
    cors: false,
  },
  async (req, res) => {
    if (req.method === "GET") {
      // Verification handshake — Meta calls this once when you register
      // the webhook URL in the WhatsApp Business app dashboard.
      const expected = whatsappVerifyToken.value() ||
        process.env.WHATSAPP_VERIFY_TOKEN || "";
      const challenge = whatsapp.verifyChallenge({
        mode: req.query["hub.mode"],
        verifyToken: req.query["hub.verify_token"],
        challenge: req.query["hub.challenge"],
      }, expected);
      if (challenge) {
        res.status(200).send(challenge);
      } else {
        console.warn("zedAssistant.wa: bad verification handshake");
        res.status(403).json({error: "verify_token mismatch"});
      }
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({error: "POST or GET only"});
      return;
    }

    const accessToken = whatsappAccessToken.value() ||
      process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = whatsappPhoneNumberId.value() ||
      process.env.WHATSAPP_PHONE_NUMBER_ID;
    const anthropicKey = anthropicApiKey.value() ||
      process.env.ANTHROPIC_API_KEY;
    const openaiKey = openaiApiKey.value() ||
      process.env.OPENAI_API_KEY || "";

    if (!accessToken || !phoneNumberId || !anthropicKey) {
      console.error("zedAssistant.wa: missing secrets", {
        hasAccessToken: Boolean(accessToken),
        hasPhoneNumberId: Boolean(phoneNumberId),
        hasAnthropic: Boolean(anthropicKey),
      });
      // 200 so Meta doesn't retry-storm us; the user-visible "missing
      // secret" wouldn't help anyone anyway.
      res.status(200).json({ok: false, reason: "not_configured"});
      return;
    }

    try {
      const summary = await handleWhatsAppUpdate(req.body || {}, {
        accessToken,
        phoneNumberId,
        anthropicKey,
        openaiKey,
      });
      res.status(200).json({ok: true, ...summary});
    } catch (err) {
      console.error("zedAssistant.wa: unhandled webhook error", err);
      res.status(200).json({ok: false, error: "internal"});
    }
  },
);
