/**
 * Firestore-triggered runner for the autonomous coder.
 *
 * Webhook handlers (Telegram + WhatsApp) detect /code, post a quick "On
 * it…" reply to the user, and create a doc in zedAssistantCoderTasks with
 * status: "queued". This function picks it up, runs handleCodeTask
 * (which can take 1–3 minutes), then sends a follow-up message to the
 * same channel with the PR URL or the failure reason.
 *
 * This file is the only piece that needs the long timeout (540s). The
 * webhooks themselves stay at 60s and return immediately.
 */

const {onDocumentCreated} = require("firebase-functions/v2/firestore");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");

const telegram = require("../telegram");
const whatsapp = require("../whatsapp");
const {handleCodeTask} = require("./index");

const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY");
const zedGithubToken = defineSecret("ZED_GITHUB_TOKEN");
const telegramBotToken = defineSecret("TELEGRAM_BOT_TOKEN");
const whatsappAccessToken = defineSecret("WHATSAPP_ACCESS_TOKEN");
const whatsappPhoneNumberId = defineSecret("WHATSAPP_PHONE_NUMBER_ID");

const RUNNER_SECRETS = [
  anthropicApiKey,
  zedGithubToken,
  telegramBotToken,
  whatsappAccessToken,
  whatsappPhoneNumberId,
];

async function replyOnChannel({channel, chatId, text}) {
  if (!chatId || !text) return;
  try {
    if (channel === "telegram") {
      const token = telegramBotToken.value() || process.env.TELEGRAM_BOT_TOKEN;
      if (!token) return;
      await telegram.sendMessage(token, chatId, text);
      return;
    }
    if (channel === "whatsapp") {
      const accessToken = whatsappAccessToken.value() ||
        process.env.WHATSAPP_ACCESS_TOKEN;
      const phoneNumberId = whatsappPhoneNumberId.value() ||
        process.env.WHATSAPP_PHONE_NUMBER_ID;
      if (!accessToken || !phoneNumberId) return;
      await whatsapp.sendMessage(accessToken, phoneNumberId, chatId, text);
      return;
    }
  } catch (err) {
    console.warn("zedAssistant.coder replyOnChannel failed", {
      channel,
      err: err?.message,
    });
  }
}

exports.zedCoderTaskRunner = onDocumentCreated({
  document: "zedAssistantCoderTasks/{taskId}",
  region: "us-central1",
  timeoutSeconds: 540,
  memory: "512MiB",
  secrets: RUNNER_SECRETS,
}, async (event) => {
  const snap = event.data;
  if (!snap) return;
  const data = snap.data() || {};

  // Only run on freshly queued docs. handleCodeTask itself writes audit
  // records to other docs and updates this one in place; we don't want
  // recursive triggers.
  if (data.status !== "queued") return;
  if (!data.task || !data.channel || !data.chatId) {
    console.warn("zedAssistant.coder skip malformed task doc", {
      id: snap.id,
      hasTask: Boolean(data.task),
      hasChannel: Boolean(data.channel),
      hasChatId: Boolean(data.chatId),
    });
    return;
  }

  const anthropicKey = anthropicApiKey.value() || process.env.ANTHROPIC_API_KEY;
  const githubToken = zedGithubToken.value() || process.env.ZED_GITHUB_TOKEN;
  if (!anthropicKey || !githubToken) {
    await snap.ref.set({
      status: "failed",
      finishReason: "secrets_missing",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
    await replyOnChannel({
      channel: data.channel,
      chatId: data.chatId,
      text:
        "I can't run /code yet — required secrets aren't configured. " +
        "Set ZED_GITHUB_TOKEN (and ANTHROPIC_API_KEY) and redeploy.",
    });
    return;
  }

  let result;
  try {
    result = await handleCodeTask({
      task: data.task,
      requestedBy: `${data.channel}:${data.chatId}`,
      anthropicKey,
      githubToken,
      taskRef: snap.ref,
    });
  } catch (err) {
    console.error("zedAssistant.coder runner crashed", err);
    await snap.ref.set({
      status: "failed",
      finishReason: "runner_crash",
      error: err?.message || String(err),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
    await replyOnChannel({
      channel: data.channel,
      chatId: data.chatId,
      text: `Coder crashed: ${err?.message || "unknown error"}.`,
    });
    return;
  }

  const headline = result.ok ?
    "Done." :
    "Couldn't finish that.";
  await replyOnChannel({
    channel: data.channel,
    chatId: data.chatId,
    text: `${headline}\n\n${result.message}`,
  });
});
