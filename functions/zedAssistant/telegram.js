/**
 * Minimal Telegram Bot API client.
 *
 * Only the methods we actually use: sendMessage (with auto-chunking for the
 * 4096-char limit), sendChatAction, setWebhook, deleteWebhook, getWebhookInfo.
 * No 3rd-party dependency — the bot API is plain HTTPS + JSON.
 */

const TELEGRAM_API = "https://api.telegram.org";
const MAX_MESSAGE_LENGTH = 4000;

function tgUrl(token, method) {
  return `${TELEGRAM_API}/bot${token}/${method}`;
}

async function tgRequest(token, method, body) {
  const res = await fetch(tgUrl(token, method), {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    const description = data?.description || `HTTP ${res.status}`;
    const err = new Error(`Telegram ${method} failed: ${description}`);
    err.telegramResponse = data;
    err.status = res.status;
    throw err;
  }
  return data.result;
}

function chunkText(text, limit = MAX_MESSAGE_LENGTH) {
  const chunks = [];
  let remaining = String(text || "");
  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf("\n", limit);
    if (cut < limit * 0.5) cut = limit;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\n+/, "");
  }
  if (remaining.length) chunks.push(remaining);
  return chunks;
}

async function sendMessage(token, chatId, text, opts = {}) {
  const chunks = chunkText(text);
  const results = [];
  for (const chunk of chunks) {
    const result = await tgRequest(token, "sendMessage", {
      chat_id: chatId,
      text: chunk,
      ...(opts.parseMode ? {parse_mode: opts.parseMode} : {}),
      ...(opts.replyToMessageId ?
        {reply_to_message_id: opts.replyToMessageId} :
        {}),
      disable_web_page_preview: true,
    });
    results.push(result);
  }
  return results;
}

async function sendChatAction(token, chatId, action = "typing") {
  try {
    await tgRequest(token, "sendChatAction", {
      chat_id: chatId,
      action,
    });
  } catch (err) {
    // Non-fatal — chat action is just a UX nicety.
    console.warn("sendChatAction failed:", err?.message);
  }
}

async function setWebhook(token, {url, secretToken, allowedUpdates}) {
  return tgRequest(token, "setWebhook", {
    url,
    ...(secretToken ? {secret_token: secretToken} : {}),
    ...(allowedUpdates ? {allowed_updates: allowedUpdates} : {}),
    drop_pending_updates: true,
  });
}

async function deleteWebhook(token) {
  return tgRequest(token, "deleteWebhook", {drop_pending_updates: true});
}

async function getWebhookInfo(token) {
  return tgRequest(token, "getWebhookInfo", {});
}

async function getMe(token) {
  return tgRequest(token, "getMe", {});
}

module.exports = {
  sendMessage,
  sendChatAction,
  setWebhook,
  deleteWebhook,
  getWebhookInfo,
  getMe,
  chunkText,
  MAX_MESSAGE_LENGTH,
};
